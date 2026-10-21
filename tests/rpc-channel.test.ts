import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import * as plugin from '../src/index.js'
import { HOST_ENDPOINTS } from '../src/host/rpc-routes.js'

type FetchRoute = { path: string; methods: readonly string[]; requestBody: string; fetch(request: Request): Promise<Response> }
type WebServerOwner = Context & { webServer: { register(route: { kind: 'prefix'; path: string }): () => void } }
type RpcOwner = { connection: { rpc: { handle(channel: string): unknown } } }

const RECORD = { id: 'mentor', name: '创业导师', description: '创业', category: 'business', persona: '关注现金流。', enabled: true }

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function start() {
  const root = await mkdtemp(join(tmpdir(), 'expert-ai-rpc-channel-'))
  const ctx = new Context()
  const routes = new Map<string, FetchRoute>()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  // Resolves services from the connection plugin's own fiber, as the Harness does: a sibling's webServer is out of reach.
  class OwnerScopedConnection extends Service {
    constructor(inner: Context) {
      super(inner, 'connection')
    }

    get rpc() {
      const owner = this.ctx as WebServerOwner
      return {
        handle: (channel: string) =>
          owner.effect(() => owner.webServer.register({ kind: 'prefix', path: channel }), `rpc ${channel}`),
      }
    }

    get fetch() {
      const owner = this.ctx
      return {
        register: (route: FetchRoute) =>
          owner.effect(() => {
            if (routes.has(route.path)) throw new Error(`route ${route.path} is already registered`)
            routes.set(route.path, route)
            return () => { routes.delete(route.path) }
          }, `fetch ${route.path}`),
      }
    }
  }
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(OwnerScopedConnection)
  await ctx.plugin({
    name: 'fake-web-server',
    apply: (inner: Context) => {
      inner.provide('webServer', { register: () => () => undefined })
    },
  })
  ctx.provide('subagents', { getProvider: () => undefined })
  ctx.provide('agents', {})
  ctx.provide('sandboxPolicy', { defaultMode: 'read-only' })
  const fiber = await ctx.plugin(plugin, { stateDir: root, records: [RECORD] })
  return { ctx, fiber, routes }
}

const envelope = (endpoint: string, payload: unknown, rpcId = 'rpc-1') =>
  ({ type: 'client-request', rpcId, method: `expert-ai/${endpoint}`, payload })

function post(routes: Map<string, FetchRoute>, endpoint: string, body: unknown, contentType = 'application/json') {
  const route = routes.get(`/api/expert-ai/${endpoint}`)
  if (route === undefined) throw new Error(`no route for ${endpoint}`)
  return route.fetch(new Request(`http://127.0.0.1${route.path}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }))
}

describe('the expert-ai Host routes', () => {
  it('cannot use rpc.handle from a plugin context, as in the Harness', async () => {
    const { ctx } = await start()
    let refusal: unknown
    await ctx.plugin({
      name: 'probe',
      inject: ['connection'],
      apply: (inner: Context) => {
        const { connection } = inner as unknown as RpcOwner
        try {
          connection.rpc.handle('/expert-ai')
        } catch (error) {
          refusal = error
        }
      },
    })
    expect(String(refusal)).toContain('cannot get property "webServer" without inject')
  })

  it('activates and serves each endpoint as one exact POST route below /api/expert-ai', async () => {
    const { fiber, routes } = await start()
    await fiber.await()
    expect([...routes.keys()].sort()).toEqual(HOST_ENDPOINTS.map((endpoint) => `/api/expert-ai/${endpoint}`).sort())
    for (const route of routes.values()) expect(route).toMatchObject({ methods: ['POST'], requestBody: 'buffered' })
  })

  it('serves the identity library and single-expert conversations only', () => {
    expect([...HOST_ENDPOINTS]).toEqual([
      'project', 'greeting', 'identity', 'binding', 'unbind', 'bind', 'expert/catalog', 'expert/import',
    ])
    for (const gone of ['review/list', 'review/read'])
      expect([...HOST_ENDPOINTS]).not.toContain(gone)
  })

  it('answers a client-request with a server-response for the same rpcId', async () => {
    const { fiber, routes } = await start()
    await fiber.await()
    const response = await post(routes, 'identity', envelope('identity', { recordId: 'mentor' }, 'rpc-7'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toMatchObject({
      type: 'server-response',
      rpcId: 'rpc-7',
      result: { ok: true, value: { recordId: 'mentor' } },
    })
  })

  it('reports a failing endpoint as a structured failure', async () => {
    const { fiber, routes } = await start()
    await fiber.await()
    const response = await post(routes, 'identity', envelope('identity', { recordId: 'nobody' }))
    expect(await response.json()).toEqual({
      type: 'server-response',
      rpcId: 'rpc-1',
      result: { ok: false, error: { code: 'internal', message: 'expert-ai: unknown expert "nobody"', details: {} } },
    })
  })

  it.each([
    ['a body that is not JSON', '{', 'application/json', 400],
    ['a message that is not a client-request', { type: 'ping', rpcId: 'x', method: 'expert-ai/bind' }, 'application/json', 400],
    ['a message addressed to another endpoint', envelope('unbind', { sessionId: 's' }), 'application/json', 400],
    ['a body not declared as JSON', envelope('bind', {}), 'text/plain', 415],
  ])('refuses %s', async (_label, body, contentType, status) => {
    const { fiber, routes } = await start()
    await fiber.await()
    expect((await post(routes, 'bind', body, contentType)).status).toBe(status)
  })

  it('leaves the shared channel when the plugin is disposed', async () => {
    const { fiber, routes } = await start()
    await fiber.await()
    await fiber.dispose()
    expect([...routes.keys()]).toEqual([])
  })
})
