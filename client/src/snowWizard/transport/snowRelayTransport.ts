// snowRelayTransport.ts — Turns Toolbox's ServiceNow relay requests into requests for the ServiceNow tab running the
// Wizard's relay bookmark, and its answers back into the relay's result shape, so Toolbox's snowApi runs unchanged.

import type { RelayRequest, RelayResult } from '../../types/relay.ts';
import type { AgentRequest, AgentResponse } from './agentChannel.ts';
import type { AgentTransport } from './agentTransport.ts';
import type { SnowTransport } from './wizardTransports.ts';

const HTTP_SUCCESS_MIN = 200;
const HTTP_SUCCESS_MAX = 299;

/** The relay request as the ServiceNow tab should run it: the body as the exact text (or base64 bytes) to send. */
export function toSnowAgentRequest(relayRequest: RelayRequest): AgentRequest {
  const agentRequest: AgentRequest = {
    method: (relayRequest.method || 'GET').toUpperCase() as AgentRequest['method'],
    path: relayRequest.path,
  };
  // Toolbox asks for more time on slow calls (uploads); the tab connection honours it.
  if (relayRequest.timeoutMs) agentRequest.timeoutMs = relayRequest.timeoutMs;
  if (relayRequest.body === null || relayRequest.body === undefined) return agentRequest;
  if (relayRequest.bodyEncoding === 'base64') {
    return { ...agentRequest, body: String(relayRequest.body), bodyEncoding: 'base64', contentType: relayRequest.contentType || 'application/octet-stream' };
  }
  return { ...agentRequest, body: typeof relayRequest.body === 'string' ? relayRequest.body : JSON.stringify(relayRequest.body) };
}

/** The tab's answer in the relay's result shape; status 0 (never reached ServiceNow) carries its reason as the error. */
export function toRelayResult(requestId: string, agentResponse: AgentResponse): RelayResult {
  const isReached = agentResponse.status !== 0;
  return {
    id: requestId,
    ok: agentResponse.status >= HTTP_SUCCESS_MIN && agentResponse.status <= HTTP_SUCCESS_MAX,
    status: agentResponse.status,
    data: isReached ? agentResponse.body : null,
    error: isReached ? null : agentResponse.body,
  };
}

/** The ServiceNow connection Toolbox's relay stand-in uses, running every request in the ServiceNow tab. */
export function createSnowRelayTransport(agentTransport: AgentTransport): SnowTransport {
  return {
    execute: async (relayRequest) => toRelayResult(relayRequest.id, await agentTransport.execute(toSnowAgentRequest(relayRequest))),
  };
}
