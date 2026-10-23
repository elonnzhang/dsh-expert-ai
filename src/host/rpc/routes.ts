import type { ConnectionFetchRoute, HostConnectionHandle } from "@deepseek-ai/dsh-client-connection";
import { expertAiEndpoint } from "../../constants.js";
import { dispatch, type Endpoint } from "./endpoint.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function routeFor(endpoint: Endpoint): ConnectionFetchRoute {
  const method = expertAiEndpoint(endpoint.name);
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
      return Response.json({ type: "server-response", rpcId: message.rpcId, result: await dispatch(endpoint, message.payload) });
    },
  };
}

/**
 * `connection.rpc.handle` resolves `webServer` from the connection plugin's own fiber, which a
 * composed Profile does not give it, so the endpoints are exact Fetch routes on the shared `/api` channel.
 */
export function serveEndpoints(connection: HostConnectionHandle, endpoints: readonly Endpoint[]): () => Promise<void> {
  const disposers = endpoints.map((endpoint) => connection.fetch.register(routeFor(endpoint)));
  return async () => {
    await Promise.all(disposers.map((dispose) => dispose()));
  };
}
