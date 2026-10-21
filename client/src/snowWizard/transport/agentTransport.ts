// agentTransport.ts — Reaches ServiceNow or Jira through a tab the Wizard opens: the relay bookmark clicked in that tab
// answers the Wizard's requests with the user's own signed-in session, so no password or token is ever stored.

import { AGENT_TAB_CLOSED_BODY, sendAgentRequest, waitForAgentHello, type AgentRequest, type AgentResponse, type MessageListenerTarget } from './agentChannel.ts';

const HTTP_OK = 200;
/** A file can be tens of megabytes, so it gets up to five minutes instead of the ordinary request wait. */
const FILE_TRANSFER_TIMEOUT_MS = 5 * 60 * 1000;
/** How often a waiting Connect looks to see whether its tab was closed or cut off. */
export const TAB_CHECK_INTERVAL_MS = 500;

/** What one connection needs: which system, how to open its tab, and how to ask who is signed in. */
export interface AgentTransportOptions {
  system: 'snow' | 'jira';
  /** The system's name as the user reads it ("ServiceNow", "Jira"). */
  systemLabel: string;
  /** The tab's name. Unique to this Wizard page, so a reopened Wizard never reuses a tab tied to an old page. */
  windowName: string;
  identityPath: string;
  /** Reads the signed-in person's name from the identity answer. */
  readIdentity: (responseBody: string) => string;
  listenerTarget: MessageListenerTarget;
  openWindow: (url: string, windowName: string) => Window | null;
  channelName: string;
  helloTimeoutMs: number;
  requestTimeoutMs: number;
  /** Called when the tab stops answering (with why, when known), so the Wizard can offer "connect again". */
  onDisconnected: (reasonText?: string) => void;
}

/** One live connection: `connect` opens the tab and confirms the user; `execute` runs one request there. */
export interface AgentTransport {
  connect(systemUrl: string): Promise<{ displayName: string }>;
  execute(agentRequest: AgentRequest): Promise<AgentResponse>;
  isConnected(): boolean;
}

interface AgentLink {
  agentSource: MessageEventSource;
  agentOrigin: string;
}

function readRequestTimeout(agentRequest: AgentRequest, ordinaryTimeoutMs: number): number {
  const isFileTransfer = agentRequest.responseEncoding === 'base64' || agentRequest.bodyEncoding === 'base64';
  return Math.max(ordinaryTimeoutMs, agentRequest.timeoutMs ?? 0, isFileTransfer ? FILE_TRANSFER_TIMEOUT_MS : 0);
}

function isTabClosed(openedTab: Window): boolean {
  try {
    return openedTab.closed === true;
  } catch {
    return false;
  }
}

/**
 * Rejects as soon as the tab is closed. A browser that cuts the tab off from this page (ServiceNow's pop-up isolation
 * header) also reports it closed at once, so the user hears why within a second instead of after minutes.
 */
function watchTabClosed(openedTab: Window, closedText: string): { closedPromise: Promise<never>; stopWatching: () => void } {
  let watchId: ReturnType<typeof setInterval> | undefined;
  const closedPromise = new Promise<never>((_resolve, reject) => {
    watchId = setInterval(() => {
      if (!isTabClosed(openedTab)) return;
      clearInterval(watchId);
      reject(new Error(closedText));
    }, TAB_CHECK_INTERVAL_MS);
  });
  return { closedPromise, stopWatching: () => clearInterval(watchId) };
}

/** Creates one connection. Nothing is opened until `connect` is called (from the Connect screen or the banner). */
export function createAgentTransport(options: AgentTransportOptions): AgentTransport {
  let agentLink: AgentLink | null = null;
  let openedTab: Window | null = null;
  let openedUrl = '';
  const closedTabText = `The ${options.systemLabel} tab was closed`;
  const cutTabText = `The ${options.systemLabel} tab was closed, or the browser cut its link to this page. Press Connect `
    + `${options.systemLabel} to try again; if this keeps happening, your browser is blocking the link for this site.`;

  const execute: AgentTransport['execute'] = async (agentRequest) => {
    if (!agentLink) return { status: 0, body: `${options.systemLabel} is not connected` };
    const agentResponse = await sendAgentRequest(options.listenerTarget, agentLink.agentSource, agentLink.agentOrigin,
      options.channelName, agentRequest, readRequestTimeout(agentRequest, options.requestTimeoutMs));
    if (agentResponse.status !== 0) return agentResponse;
    agentLink = null;
    const isClosed = agentResponse.body === AGENT_TAB_CLOSED_BODY;
    options.onDisconnected(isClosed ? closedTabText : undefined);
    return isClosed ? { status: 0, body: closedTabText } : agentResponse;
  };

  // The tab this connection opened earlier for the same address is reused as it is — never reloaded, so work in it is
  // kept; the user just clicks the bookmark there again. Otherwise (first time, closed, or a new address) it is opened.
  const openSystemTab = (systemUrl: string): Window | null => {
    if (openedTab && openedUrl === systemUrl && !isTabClosed(openedTab)) {
      try {
        openedTab.focus();
      } catch {
        // Focus is a courtesy; the Connect screen says which tab to use.
      }
      return openedTab;
    }
    openedTab = options.openWindow(systemUrl, options.windowName);
    openedUrl = systemUrl;
    return openedTab;
  };

  const connect: AgentTransport['connect'] = async (systemUrl) => {
    agentLink = null;
    const systemOrigin = new URL(systemUrl).origin;
    const systemTab = openSystemTab(systemUrl);
    if (!systemTab) throw new Error(`The browser blocked the ${options.systemLabel} tab — allow pop-ups for this page, then press Connect ${options.systemLabel} again.`);
    const tabWatch = watchTabClosed(systemTab, cutTabText);
    try {
      const helloPromise = waitForAgentHello(options.listenerTarget, options.channelName, options.helloTimeoutMs, options.system, systemOrigin);
      agentLink = await Promise.race([helloPromise, tabWatch.closedPromise]);
    } finally {
      tabWatch.stopWatching();
    }
    const identityResponse = await execute({ method: 'GET', path: options.identityPath });
    if (identityResponse.status !== HTTP_OK) {
      agentLink = null;
      throw new Error(`${options.systemLabel} answered ${identityResponse.status} when asked who is signed in`);
    }
    return { displayName: options.readIdentity(identityResponse.body) };
  };

  return { connect, execute, isConnected: () => agentLink !== null };
}
