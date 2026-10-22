// useWizardConnections.ts — Opens the Wizard's two connections when the user presses Connect: each opens its system in
// a tab, the user clicks the relay bookmark there, and that tab answers the Wizard. Installs them where Toolbox's
// snowApi and jiraApi will find them.

import { useCallback, useState } from 'react';

import { useConnectionStore } from '../../store/connectionStore.ts';
import type { MessageListenerTarget } from '../transport/agentChannel.ts';
import { createAgentTransport, type AgentTransport } from '../transport/agentTransport.ts';
import { createSnowRelayTransport } from '../transport/snowRelayTransport.ts';
import { installWizardTransports } from '../transport/wizardTransports.ts';
import { JIRA_IDENTITY_PATH, SNOW_IDENTITY_PATH, WIZARD_CHANNEL_NAME } from '../wizardDefaults.ts';
import { useWizardConnectionStore, type WizardSystem } from './wizardConnectionStore.ts';

/** Everything the Wizard touches outside itself, injected so the app can be tested without real windows. */
export interface WizardAppDependencies {
  openWindow: (url: string, windowName: string) => Window | null;
  listenerTarget: MessageListenerTarget;
  helloTimeoutMs: number;
  requestTimeoutMs: number;
}

/** The two actions the Connect screen and the banner call. */
export interface WizardConnectActions {
  connectSnow: (snowUrl: string) => void;
  connectJira: (jiraUrl: string) => void;
}

type TransportPair = Record<WizardSystem, AgentTransport>;

/**
 * The tab names carry this page's own id: a reopened Wizard must never reuse a tab opened by an earlier, closed Wizard
 * page, because the bookmark there would answer that old page.
 */
const PAGE_ID = Date.now().toString(36);
const SNOW_WINDOW_NAME = `snowWizardServiceNow-${PAGE_ID}`;
const JIRA_WINDOW_NAME = `snowWizardJira-${PAGE_ID}`;
/** This page's own name, which the bookmark uses to bring the Wizard back to the front after Connect. */
export const APP_WINDOW_NAME = `snowWizardApp-${PAGE_ID}`;

function nameThisWindow(): void {
  try {
    window.name = APP_WINDOW_NAME;
  } catch {
    // Unnamed, the Wizard still works; the user switches back to it by hand.
  }
}

function readSnowIdentity(responseBody: string): string {
  try {
    return String((JSON.parse(responseBody) as { result?: Array<{ name?: unknown }> }).result?.[0]?.name ?? '');
  } catch {
    return '';
  }
}

function readJiraIdentity(responseBody: string): string {
  try {
    return String((JSON.parse(responseBody) as { displayName?: unknown }).displayName ?? '');
  } catch {
    return '';
  }
}

function setToolboxRelayConnected(isConnected: boolean): void {
  // Toolbox's snowApi refuses to send until its relay reports connected with a session token.
  useConnectionStore.getState().setRelayBridgeStatus({
    system: 'snow', isConnected, lastPingAt: new Date().toISOString(), version: 'snow-wizard', hasSessionToken: isConnected,
  });
}

function createTransports(dependencies: WizardAppDependencies): TransportPair {
  const { setConnection } = useWizardConnectionStore.getState();
  nameThisWindow();
  const sharedOptions = {
    appWindowName: APP_WINDOW_NAME,
    listenerTarget: dependencies.listenerTarget,
    openWindow: dependencies.openWindow,
    channelName: WIZARD_CHANNEL_NAME,
    helloTimeoutMs: dependencies.helloTimeoutMs,
    requestTimeoutMs: dependencies.requestTimeoutMs,
  };
  const snowTransport = createAgentTransport({
    ...sharedOptions,
    system: 'snow', systemLabel: 'ServiceNow', windowName: SNOW_WINDOW_NAME, identityPath: SNOW_IDENTITY_PATH, readIdentity: readSnowIdentity,
    onDisconnected: (reasonText) => {
      setToolboxRelayConnected(false);
      setConnection('snow', { status: 'expired', detail: reasonText ? `${reasonText}.` : 'The ServiceNow tab stopped answering.' });
    },
  });
  const jiraTransport = createAgentTransport({
    ...sharedOptions,
    system: 'jira', systemLabel: 'Jira', windowName: JIRA_WINDOW_NAME, identityPath: JIRA_IDENTITY_PATH, readIdentity: readJiraIdentity,
    onDisconnected: (reasonText) => setConnection('jira', { status: 'expired', detail: reasonText ? `${reasonText}.` : 'The Jira tab stopped answering.' }),
  });
  installWizardTransports({ snow: createSnowRelayTransport(snowTransport), jira: jiraTransport });
  return { snow: snowTransport, jira: jiraTransport };
}

/** Creates both connections once, and returns the Connect actions. */
export function useWizardConnections(dependencies: WizardAppDependencies): WizardConnectActions {
  // Created once for the page's life: a lazy state initializer runs on the first render only.
  const [transports] = useState<TransportPair>(() => createTransports(dependencies));

  const connectSystem = useCallback((system: WizardSystem, systemUrl: string) => {
    const { setConnection } = useWizardConnectionStore.getState();
    setConnection(system, { status: 'connecting' });
    transports[system].connect(systemUrl)
      .then(({ displayName }) => {
        if (system === 'snow') setToolboxRelayConnected(true);
        setConnection(system, { status: 'connected', identity: displayName });
      })
      .catch((connectError: Error) => setConnection(system, { status: 'notConnected', detail: connectError.message }));
  }, [transports]);

  const connectSnow = useCallback((snowUrl: string) => connectSystem('snow', snowUrl), [connectSystem]);
  const connectJira = useCallback((jiraUrl: string) => connectSystem('jira', jiraUrl), [connectSystem]);
  return { connectSnow, connectJira };
}
