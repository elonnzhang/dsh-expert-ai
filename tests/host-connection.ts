import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'

export type RpcReply = { ok: boolean; error?: { code?: string; message: string }; value?: unknown }

/** A Host connection that serves exact Fetch routes and refuses `rpc.handle`, as a composed Profile does. */
export function fakeHostConnection() {
  const routes = new Map<string, ConnectionFetchRoute>()
  const connection = {
    rpc: {
      handle: () => {
        throw new Error('connection.rpc.handle cannot mount from a plugin context')
      },
    },
    fetch: {
      register: (route: ConnectionFetchRoute) => {
        if (routes.has(route.path)) throw new Error(`route ${route.path} is already registered`)
        routes.set(route.path, route)
        return async () => {
          routes.delete(route.path)
        }
      },
    },
  }
  const call = async (endpoint: string, payload: unknown = {}): Promise<RpcReply> => {
    const route = routes.get(`/api/expert-ai/${endpoint}`)
    if (route === undefined) return { ok: false, error: { code: 'not-found', message: `no route for ${endpoint}` } }
    const response = await route.fetch(
      new Request(`http://127.0.0.1${route.path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'rpc-1', method: `expert-ai/${endpoint}`, payload }),
      }),
    )
    return ((await response.json()) as { result: RpcReply }).result
  }
  return { connection, call, paths: () => [...routes.keys()].sort() }
}
