// agentChannel.ts — The Wizard's side of the tab-to-tab conversation with a bookmark agent: wait for it, ask, get the answer.

/** The part of a window this module listens on (the real `window`, or a test double). */
export interface MessageListenerTarget {
  addEventListener(type: 'message', listener: (messageEvent: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (messageEvent: MessageEvent) => void): void;
}

/** Where the agent lives once it has said hello. */
export interface AgentAddress {
  agentSource: MessageEventSource;
  agentOrigin: string;
}

/** One request the agent runs on its own origin. */
export interface AgentRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  /** "base64" asks the agent to send a file's raw bytes as base64 text, so binary content survives the trip. */
  responseEncoding?: 'base64';
}

/** What the agent answered; status 0 means the request never reached the system (refused, timed out, or failed). */
export interface AgentResponse {
  status: number;
  body: string;
  /** Present only when the agent sent the body as base64 (a file); absent means plain text. */
  bodyEncoding?: 'base64';
}

const MILLISECONDS_PER_SECOND = 1000;
/** A file:// page has the origin "null", which postMessage rejects as a target; "*" is the only way to reach it. */
const OPAQUE_ORIGIN = 'null';

let requestSequence = 0;

function createRequestId(): string {
  requestSequence += 1;
  return `wizard-${Date.now()}-${requestSequence}`;
}

function toTargetOrigin(agentOrigin: string): string {
  return agentOrigin === OPAQUE_ORIGIN || agentOrigin === '' ? '*' : agentOrigin;
}

/**
 * Waits for a bookmark agent to announce itself on our channel. Rejects with a plain reason if none does in time —
 * which, during the probe, is itself the evidence that the browser cut the link between the tabs.
 */
export function waitForAgentHello(
  listenerTarget: MessageListenerTarget,
  channelName: string,
  timeoutMs: number,
  expectedSystem?: 'jira' | 'snow',
  expectedOrigin?: string,
): Promise<AgentAddress> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      listenerTarget.removeEventListener('message', handleMessage);
      reject(new Error(`no hello within ${Math.round(timeoutMs / MILLISECONDS_PER_SECOND)}s`));
    }, timeoutMs);

    function handleMessage(messageEvent: MessageEvent): void {
      const messageData = messageEvent.data;
      if (!messageData || messageData.channel !== channelName || messageData.kind !== 'hello' || !messageEvent.source) return;
      // The ServiceNow and Jira agents share one channel; a waiting step only accepts the system it opened.
      if (expectedSystem && messageData.system !== expectedSystem) return;
      // The Wizard only trusts the Jira it was told about (the Jira address setting).
      if (expectedOrigin && messageEvent.origin !== expectedOrigin) return;
      clearTimeout(timeoutId);
      listenerTarget.removeEventListener('message', handleMessage);
      resolve({ agentSource: messageEvent.source, agentOrigin: messageEvent.origin });
    }

    listenerTarget.addEventListener('message', handleMessage);
  });
}

/** How often a waiting request looks to see whether the agent's tab was closed. */
export const AGENT_CLOSED_CHECK_INTERVAL_MS = 500;
/** The answer given at once when the agent's tab is gone, instead of waiting out the whole request time. */
export const AGENT_TAB_CLOSED_BODY = 'The Jira tab was closed';

/** True when the agent's tab has been closed. `closed` stays readable across origins, so this is safe to ask. */
function isAgentTabClosed(agentSource: MessageEventSource): boolean {
  try {
    return (agentSource as Window).closed === true;
  } catch {
    return false;
  }
}

/**
 * Sends one request to the agent and resolves with its matching answer, or status 0 — never hangs. A closed agent tab
 * answers within half a second (owner feedback: closing the Jira tab left "Checking Jira…" spinning for 30 seconds);
 * an open tab that never answers still gets the full `timeoutMs`.
 */
export function sendAgentRequest(
  listenerTarget: MessageListenerTarget,
  agentSource: MessageEventSource,
  agentOrigin: string,
  channelName: string,
  agentRequest: AgentRequest,
  timeoutMs: number,
): Promise<AgentResponse> {
  const requestId = createRequestId();
  if (isAgentTabClosed(agentSource)) return Promise.resolve({ status: 0, body: AGENT_TAB_CLOSED_BODY });
  return new Promise((resolve) => {
    const stopWaiting = (): void => {
      clearTimeout(timeoutId);
      clearInterval(closedCheckId);
      listenerTarget.removeEventListener('message', handleMessage);
    };
    const timeoutId = setTimeout(() => {
      stopWaiting();
      resolve({ status: 0, body: 'timeout' });
    }, timeoutMs);
    const closedCheckId = setInterval(() => {
      if (!isAgentTabClosed(agentSource)) return;
      stopWaiting();
      resolve({ status: 0, body: AGENT_TAB_CLOSED_BODY });
    }, AGENT_CLOSED_CHECK_INTERVAL_MS);

    function handleMessage(messageEvent: MessageEvent): void {
      const messageData = messageEvent.data;
      if (!messageData || messageData.channel !== channelName || messageData.kind !== 'response' || messageData.requestId !== requestId) return;
      // Answers count only from the agent's own origin (a file:// agent's "null" origin cannot be checked).
      if (agentOrigin !== OPAQUE_ORIGIN && agentOrigin !== '' && messageEvent.origin !== agentOrigin) return;
      stopWaiting();
      const agentResponse: AgentResponse = { status: Number(messageData.status) || 0, body: String(messageData.body ?? '') };
      if (messageData.bodyEncoding === 'base64') agentResponse.bodyEncoding = 'base64';
      resolve(agentResponse);
    }

    listenerTarget.addEventListener('message', handleMessage);
    (agentSource as Window).postMessage({ channel: channelName, kind: 'request', requestId, ...agentRequest }, toTargetOrigin(agentOrigin));
  });
}
