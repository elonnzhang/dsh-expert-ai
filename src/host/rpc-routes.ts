import type { ConnectionFetchRoute, ConnectionRpcResult, HostConnectionHandle } from "@deepseek-ai/dsh-client-connection";
import { expertAiEndpoint } from "../constants.js";

/** Every endpoint the Host serves; each is one exact route below `/api/expert-ai/`. */
export const HOST_ENDPOINTS = [
  "project",
  "greeting",
  "identity",
  "binding",
  "unbind",
  "bind",
  "expert/catalog",
  "expert/import",
] as const;

export type HostRpcHandler = (endpoint: string, payload: unknown) => Promise<ConnectionRpcResult<unknown>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function routeFor(endpoint: string, handle: HostRpcHandler): ConnectionFetchRoute {
  const method = expertAiEndpoint(endpoint);
  return {
    path: `/api/${method}`,
    methods: ["POST"],
    requestBody: "buffered",
    async fetch(request) {
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json")
        return new Response("content type must be application/json", { status: 415 });
      const message: unknown = await request.json().catch(() => undefined);
      if (!isRecord(message) || message.type !== "client-request" || typeof message.rpcId !== "string" || message.method !== method)
        return new Response("invalid client-request message", { status: 400 });
      const result = await handle(endpoint, message.payload).catch((error: unknown): ConnectionRpcResult<unknown> => ({
        ok: false,
        error: { code: "internal", message: error instanceof Error ? error.message : String(error), details: {} },
      }));
      return Response.json({ type: "server-response", rpcId: message.rpcId, result });
    },
  };
}

/**
 * `connection.rpc.handle` resolves `webServer` from the connection plugin's own fiber, which a
 * composed Profile does not give it, so the endpoints are exact Fetch routes on the shared `/api` channel.
 */
export function serveHostRpc(connection: HostConnectionHandle, handle: HostRpcHandler): () => Promise<void> {
  const disposers = HOST_ENDPOINTS.map((endpoint) => connection.fetch.register(routeFor(endpoint, handle)));
  return async () => {
    await Promise.all(disposers.map((dispose) => dispose()));
  };
}
