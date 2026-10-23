/**
 * One Host endpoint: a name, a Schema for its payload, and a handler that receives the
 * parsed payload. Payloads are checked here, so handlers never see an unchecked shape.
 */
import type { ConnectionRpcResult } from "@deepseek-ai/dsh-client-connection";
import type z from "@deepseek-ai/schemastery";

export interface Endpoint<P = unknown> {
  name: string;
  payload: z<P>;
  handle(payload: P): Promise<unknown>;
}

export function defineEndpoint<P>(name: string, payload: z<P>, handle: (payload: P) => Promise<unknown>): Endpoint<P> {
  return { name, payload, handle };
}

function failure(code: "invalid-request" | "internal", error: unknown): ConnectionRpcResult<never> {
  return { ok: false, error: { code, message: error instanceof Error ? error.message : String(error), details: {} } };
}

/** Check the payload, then run the handler; neither a bad payload nor a thrown handler escapes as an exception. */
export async function dispatch(endpoint: Endpoint, raw: unknown): Promise<ConnectionRpcResult<unknown>> {
  let payload: unknown;
  try {
    payload = endpoint.payload(raw ?? {});
  } catch (error) {
    return failure("invalid-request", new Error(`expert-ai: invalid ${endpoint.name} request: ${error instanceof Error ? error.message : String(error)}`));
  }
  try {
    return { ok: true, value: await endpoint.handle(payload) };
  } catch (error) {
    return failure("internal", error);
  }
}
