import type { ClientConnectionRpc } from "@deepseek-ai/dsh-client-connection/client";
import { DIGITAL_LIFE_RPC_CHANNEL, digitalLifeEndpoint } from "../constants.js";

export const callHost = (rpc: ClientConnectionRpc, endpoint: string, payload: unknown) =>
  rpc.call(DIGITAL_LIFE_RPC_CHANNEL, digitalLifeEndpoint(endpoint), payload);
