// jiraOpenerTransport.ts — Reaches Jira through the Jira tab the Wizard opens: the Wizard bookmark clicked there answers
// the Wizard's requests with the user's own Jira session (proven live by the probe, research R-001).

import { sendAgentRequest, waitForAgentHello, type MessageListenerTarget } from './agentChannel.ts';
import type { JiraTransport } from './wizardTransports.ts';

const HTTP_OK = 200;
const JIRA_IDENTITY_PATH = '/rest/api/2/myself';
/** The Jira tab is opened under one name, so reconnecting reuses it instead of stacking tabs. */
const JIRA_WINDOW_NAME = 'snowWizardJira';
/** A file from Jira can be tens of megabytes, so it gets up to five minutes instead of the ordinary request wait. */
const FILE_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/** What the transport needs from the Wizard window. */
export interface JiraOpenerTransportOptions {
  listenerTarget: MessageListenerTarget;
  openWindow: (url: string, windowName: string) => Window | null;
  channelName: string;
  helloTimeoutMs: number;
  requestTimeoutMs: number;
  /** Called when Jira stops answering, so the Wizard can show "open Jira again". */
  onDisconnected: () => void;
}

interface AgentLink {
  agentSource: MessageEventSource;
  agentOrigin: string;
}

function readDisplayName(responseBody: string): string {
  try {
    return String((JSON.parse(responseBody) as { displayName?: unknown }).displayName ?? '');
  } catch {
    return '';
  }
}

/** Creates the Jira connection: `connect` opens Jira and confirms the user; `execute` runs one request. */
export function createJiraOpenerTransport(options: JiraOpenerTransportOptions): JiraTransport & {
  connect(jiraUrl: string): Promise<{ displayName: string }>;
  isConnected(): boolean;
} {
  let agentLink: AgentLink | null = null;

  const execute: JiraTransport['execute'] = async (jiraRequest) => {
    if (!agentLink) return { status: 0, body: 'Jira is not connected' };
    const isFileDownload = jiraRequest.responseEncoding === 'base64';
    const timeoutMs = isFileDownload ? Math.max(options.requestTimeoutMs, FILE_DOWNLOAD_TIMEOUT_MS) : options.requestTimeoutMs;
    const agentResponse = await sendAgentRequest(
      options.listenerTarget, agentLink.agentSource, agentLink.agentOrigin, options.channelName, jiraRequest, timeoutMs);
    if (agentResponse.status === 0) {
      agentLink = null;
      options.onDisconnected();
    }
    return agentResponse;
  };

  const connect = async (jiraUrl: string) => {
    agentLink = null;
    const jiraOrigin = new URL(jiraUrl).origin;
    options.openWindow(jiraUrl, JIRA_WINDOW_NAME);
    const helloAddress = await waitForAgentHello(options.listenerTarget, options.channelName, options.helloTimeoutMs, 'jira', jiraOrigin);
    agentLink = helloAddress;
    const identityResponse = await execute({ method: 'GET', path: JIRA_IDENTITY_PATH });
    if (identityResponse.status !== HTTP_OK) {
      agentLink = null;
      throw new Error(`Jira answered ${identityResponse.status} when asked who is signed in`);
    }
    return { displayName: readDisplayName(identityResponse.body) };
  };

  return { execute, connect, isConnected: () => agentLink !== null };
}
