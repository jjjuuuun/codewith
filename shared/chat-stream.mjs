import { agentResponse } from "./agent-response.mjs";
export function streamedChatMessage(raw) {
  return agentResponse(raw, { complete: false, partialMessage: true }).message;
}
