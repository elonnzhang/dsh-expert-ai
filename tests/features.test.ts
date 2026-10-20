import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import * as plugin from '../src/index.js'
import { loadBinding, saveBinding } from '../src/host/session-binding.js'
import type { DigitalLifeFeature } from '../src/index.js'

const GATED_TOOLS = [
  'consult_digital_life', 'consult_digital_life_category', 'read_expert_reference', 'review_expert_plan',
  'read_expert_review', 'start_team_run', 'amend_team_brief', 'run_team_stage', 'read_team_run', 'cancel_team_run',
]
const CONVERSATION_ENDPOINTS = ['project', 'greeting', 'binding', 'unbind', 'bind', 'review/list', 'review/read', 'review/cancel']
const IDENTITY_ONLY: DigitalLifeFeature[] = ['identity']
const WITH_CONVERSATION: DigitalLifeFeature[] = ['identity', 'conversation']
const RECORDS = [
  { id: 'mentor', name: '创业导师', description: '创业', category: 'business', tags: [], persona: '关注现金流。', enabled: true },
]

type Reply = { ok: boolean; error?: { message: string }; value?: unknown }
type Handler = (endpoint: string, payload: unknown) => Promise<Reply>
type Section = { name: string; text: string }

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function start(initial: DigitalLifeFeature[]) {
  const root = await mkdtemp(join(tmpdir(), 'digital-life-features-'))
  const ctx = new Context()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  const agents = new Map<string, unknown>()
  let handler: Handler | undefined
  ctx.provide('subagents', {})
  ctx.provide('agents', { get: (id: string) => agents.get(id) })
  ctx.provide('connection', { rpc: { handle: (_path: string, fn: Handler) => { handler = fn; return () => undefined } } })
  ctx.provide('sandboxPolicy', { defaultMode: 'read-only' })
  const state = { features: initial }
  const live = <T,>(read: () => T) => ({ get: read })
  const fiber = await ctx.plugin({ name: 'digital-life', inject: plugin.inject, apply: plugin.apply }, {
    features: live(() => state.features),
    provider: live(() => 'spawn'),
    maxBatchSize: live(() => 3),
    stateDir: live(() => root),
    records: live(() => RECORDS),
    teams: live(() => []),
  })
  return {
    root,
    ctx,
    fiber,
    tools: () => GATED_TOOLS.filter((name) => ctx.tools.get(name) !== undefined),
    rpc: (endpoint: string, payload: unknown = {}) => (handler as Handler)(endpoint, payload),
    setFeatures(next: DigitalLifeFeature[]) {
      state.features = next
      ctx.emit('loader/volatile-update', [['features']])
    },
    session(id: string) {
      const sections: Section[] = []
      const session = Session.create(id as never)
      const systemPrompt = { section: (section: Section) => { sections.push(section); return () => undefined } }
      const agent = { id, session, ctx: { systemPrompt } }
      agents.set(id, agent)
      return { agent, session, sections }
    },
    created: (agent: unknown) => ctx.parallel('agent/created', { agent } as never),
  }
}
describe('features setting', () => {
  it('defaults to the identity feature only', () => {
    expect(plugin.Config({}).features.get()).toEqual(['identity'])
  })

  it('accepts conversation and rejects an unknown feature', () => {
    expect(plugin.Config({ features: WITH_CONVERSATION }).features.get()).toEqual(WITH_CONVERSATION)
    expect(() => plugin.Config({ features: ['telepathy'] })).toThrow()
  })

  it('keeps identity on whatever the list says', () => {
    expect([...plugin.enabledFeatures(undefined)]).toEqual(['identity'])
    expect([...plugin.enabledFeatures([])]).toEqual(['identity'])
    expect([...plugin.enabledFeatures(['conversation'])].sort()).toEqual(['conversation', 'identity'])
  })
})

describe('with the identity feature only', () => {
  it('registers none of the consult, review or team tools', async () => {
    const h = await start(IDENTITY_ONLY)
    expect(h.tools()).toEqual([])
  })

  it('still serves the expertIdentity service', async () => {
    const h = await start(IDENTITY_ONLY)
    const summaries = await (h.ctx as unknown as { expertIdentity: { list(): Promise<Array<{ id: string }>> } }).expertIdentity.list()
    expect(summaries.map((summary) => summary.id)).toEqual(['mentor'])
  })

  it('refuses every conversation endpoint and writes nothing', async () => {
    const h = await start(IDENTITY_ONLY)
    for (const endpoint of CONVERSATION_ENDPOINTS) {
      const reply = await h.rpc(endpoint, { sessionId: 'nobody', recordId: 'mentor', id: 'x' })
      expect(reply.ok, endpoint).toBe(false)
      expect(reply.error?.message, endpoint).toContain('conversation')
    }
    const entries = await readdir(join(h.root, 'digital-life')).catch(() => [])
    expect(entries).not.toContain('projects')
  })

  it('keeps the identity library endpoints reachable', async () => {
    const h = await start(IDENTITY_ONLY)
    expect(await h.rpc('identity', { recordId: 'mentor' })).toMatchObject({ ok: true })
    const unknown = await h.rpc('expert/unknown')
    expect(unknown.ok).toBe(false)
    expect(unknown.error?.message).toContain('unknown expert endpoint')
  })

  it('leaves a new session without a persona', async () => {
    const h = await start(IDENTITY_ONLY)
    await saveBinding('s-off', { recordId: 'mentor', pre: 'Before', persona: 'Persona', suf: 'After' }, h.root)
    const { agent, sections } = h.session('s-off')
    await h.created(agent)
    expect(sections).toEqual([])
  })
})
const sandboxModes = (session: Session): string[] =>
  session.snapshotEvents()
    .filter((event) => event.type === 'sandbox/mode')
    .map((event) => (event.data as { mode: string }).mode)

describe('with the conversation feature', () => {
  it('registers the consult, review and team tools', async () => {
    const h = await start(WITH_CONVERSATION)
    expect(h.tools()).toEqual(GATED_TOOLS)
  })

  it('serves the conversation endpoints', async () => {
    const h = await start(WITH_CONVERSATION)
    expect(await h.rpc('review/list')).toEqual({ ok: true, value: [] })
    expect(await h.rpc('binding', { sessionId: 'nobody' })).toEqual({ ok: true, value: undefined })
    expect((await h.rpc('project')).ok).toBe(true)
    expect(await readdir(join(h.root, 'digital-life', 'projects'))).toHaveLength(1)
  })

  it('binds the saved persona to a new session', async () => {
    const h = await start(WITH_CONVERSATION)
    await saveBinding('s-on', { recordId: 'mentor', pre: 'Before', persona: 'Persona', suf: 'After' }, h.root)
    const { agent, session, sections } = h.session('s-on')
    await h.created(agent)
    expect(sections.map((section) => section.name)).toEqual([
      'digital-life:source', 'digital-life:pre', 'digital-life:persona', 'digital-life:suf',
    ])
    expect(sections.slice(1).map((section) => section.text)).toEqual(['Before', 'Persona', 'After'])
    expect(sandboxModes(session)).toEqual(['read-only'])
  })

  it('binds a record through the bind endpoint', async () => {
    const h = await start(WITH_CONVERSATION)
    const { sections } = h.session('s-bind')
    expect(await h.rpc('bind', { sessionId: 's-bind', recordId: 'mentor' }))
      .toEqual({ ok: true, value: { sessionId: 's-bind', recordId: 'mentor' } })
    expect(sections.map((section) => section.name)).toContain('digital-life:persona')
    expect(await loadBinding('s-bind', h.root)).toMatchObject({ recordId: 'mentor' })
  })
})

describe('switching conversation while the plugin runs', () => {
  it('registers and withdraws the tools with the setting', async () => {
    const h = await start(IDENTITY_ONLY)
    h.setFeatures(WITH_CONVERSATION)
    expect(h.tools()).toEqual(GATED_TOOLS)
    h.setFeatures(IDENTITY_ONLY)
    expect(h.tools()).toEqual([])
    h.setFeatures(WITH_CONVERSATION)
    expect(h.tools()).toEqual(GATED_TOOLS)
  })

  it('registers the tools once however often settings change', async () => {
    const h = await start(WITH_CONVERSATION)
    h.setFeatures(WITH_CONVERSATION)
    h.setFeatures(WITH_CONVERSATION)
    h.setFeatures(IDENTITY_ONLY)
    expect(h.tools()).toEqual([])
  })

  it('stops binding and serving conversation as soon as it is turned off', async () => {
    const h = await start(WITH_CONVERSATION)
    h.setFeatures(IDENTITY_ONLY)
    expect((await h.rpc('project')).ok).toBe(false)
    await saveBinding('s-late', { recordId: 'mentor', pre: 'Before', persona: 'Persona', suf: 'After' }, h.root)
    const { agent, sections } = h.session('s-late')
    await h.created(agent)
    expect(sections).toEqual([])
  })

  it('removes the tools when the plugin is disposed', async () => {
    const h = await start(WITH_CONVERSATION)
    await h.fiber.dispose()
    expect(h.tools()).toEqual([])
  })
})
