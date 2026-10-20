import type { ClientConnectionRpc } from "@deepseek-ai/dsh-client-connection/client";
import { EXPERT_AI_RPC_CHANNEL, expertAiEndpoint } from "../constants.js";

export const callHost = (rpc: ClientConnectionRpc, endpoint: string, payload: unknown) =>
  rpc.call(EXPERT_AI_RPC_CHANNEL, expertAiEndpoint(endpoint), payload);
