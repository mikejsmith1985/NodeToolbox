// useWizardConnections.ts — Opens the Wizard's two connections: ServiceNow straight away (the Wizard runs inside it)
// and Jira when the user presses "Open Jira". Installs them where Toolbox's snowApi and jiraApi will find them.

import { useCallback, useEffect, useState } from 'react';

import { useConnectionStore } from '../../store/connectionStore.ts';
import { SNOW_IDENTITY_PATH } from '../probe/snowProbes.ts';
import type { MessageListenerTarget } from '../transport/agentChannel.ts';
import { createJiraOpenerTransport } from '../transport/jiraOpenerTransport.ts';
import { createSnowSameOriginTransport, requestTokenOverChannel, type TokenRequestChannel } from '../transport/snowSameOriginTransport.ts';
import { installWizardTransports } from '../transport/wizardTransports.ts';
import { useWizardConnectionStore } from './wizardConnectionStore.ts';

/** What the bookmark handed the Wizard window when it opened it. */
export interface WizardBoot {
  instanceOrigin: string;
  userToken: string;
  channelName: string;
}

/** Everything the Wizard touches outside itself, injected so the app can be tested without real windows. */
export interface WizardAppDependencies {
  fetchFn: (input: string, init?: RequestInit) => Promise<Response>;
  createChannel: (channelName: string) => TokenRequestChannel;
  openWindow: (url: string, windowName: string) => Window | null;
  listenerTarget: MessageListenerTarget;
  helloTimeoutMs: number;
  requestTimeoutMs: number;
  tokenTimeoutMs: number;
}

type SnowTransportHandle = ReturnType<typeof createSnowSameOriginTransport>;
type JiraTransportHandle = ReturnType<typeof createJiraOpenerTransport>;

function markToolboxRelayConnected(): void {
  // Toolbox's snowApi refuses to send until its relay reports connected with a session token.
  useConnectionStore.getState().setRelayBridgeStatus({ system: 'snow', isConnected: true, lastPingAt: new Date().toISOString(), version: 'snow-wizard', hasSessionToken: true });
}

async function readSnowIdentity(snowTransport: SnowTransportHandle): Promise<string> {
  const identityResult = await snowTransport.execute({ sys: 'snow', id: crypto.randomUUID(), method: 'GET', path: SNOW_IDENTITY_PATH });
  if (!identityResult.ok) throw new Error(`ServiceNow answered ${identityResult.status}${identityResult.error ? ` (${identityResult.error})` : ''}`);
  const identityBody = JSON.parse(String(identityResult.data)) as { result?: Array<{ name?: string }> };
  return identityBody.result?.[0]?.name ?? '';
}

function createTransports(boot: WizardBoot, dependencies: WizardAppDependencies) {
  const { setConnection } = useWizardConnectionStore.getState();
  const snowTransport = createSnowSameOriginTransport({
    instanceOrigin: boot.instanceOrigin,
    initialToken: boot.userToken,
    fetchFn: dependencies.fetchFn,
    requestFreshToken: () => requestTokenOverChannel(dependencies.createChannel, boot.channelName, dependencies.tokenTimeoutMs),
    onSessionExpired: () => setConnection('snow', { status: 'expired' }),
  });
  const jiraTransport = createJiraOpenerTransport({
    listenerTarget: dependencies.listenerTarget,
    openWindow: dependencies.openWindow,
    channelName: boot.channelName,
    helloTimeoutMs: dependencies.helloTimeoutMs,
    requestTimeoutMs: dependencies.requestTimeoutMs,
    onDisconnected: () => setConnection('jira', { status: 'expired', detail: 'The Jira tab stopped answering.' }),
  });
  installWizardTransports({ snow: snowTransport, jira: jiraTransport });
  markToolboxRelayConnected();
  return { snowTransport, jiraTransport };
}

/** Listens for the launcher (a new bookmark click): answers "are you open?" and takes the fresh token it pushes. */
function listenToServiceNowTab(boot: WizardBoot, dependencies: WizardAppDependencies, snowTransport: SnowTransportHandle): () => void {
  const tabChannel = dependencies.createChannel(boot.channelName);
  tabChannel.addEventListener('message', (messageEvent: MessageEvent) => {
    const messageData = messageEvent.data;
    if (messageData?.kind === 'ping') tabChannel.postMessage({ kind: 'pong' });
    if (messageData?.kind === 'token' && messageData.token) {
      snowTransport.updateToken(String(messageData.token));
      const snowState = useWizardConnectionStore.getState().snow;
      if (snowState.status === 'expired') useWizardConnectionStore.getState().setConnection('snow', { status: 'connected', identity: snowState.identity });
    }
  });
  return () => tabChannel.close();
}

/** Connects ServiceNow on open and returns `openJira` for the Connect screen and the banner. */
export function useWizardConnections(boot: WizardBoot, dependencies: WizardAppDependencies): { openJira: (jiraUrl: string) => void } {
  // Created once for the window's life: a lazy state initializer runs on the first render only.
  const [transports] = useState<{ snowTransport: SnowTransportHandle; jiraTransport: JiraTransportHandle }>(() => createTransports(boot, dependencies));

  useEffect(() => {
    const { snowTransport } = transports;
    const { setConnection } = useWizardConnectionStore.getState();
    setConnection('snow', { status: 'connecting' });
    readSnowIdentity(snowTransport)
      .then((identity) => setConnection('snow', { status: 'connected', identity }))
      .catch((connectError: Error) => setConnection('snow', { status: 'notConnected', detail: connectError.message }));
    return listenToServiceNowTab(boot, dependencies, snowTransport);
  }, [boot, dependencies, transports]);

  const openJira = useCallback((jiraUrl: string) => {
    const { setConnection } = useWizardConnectionStore.getState();
    setConnection('jira', { status: 'connecting' });
    transports.jiraTransport.connect(jiraUrl)
      .then(({ displayName }) => setConnection('jira', { status: 'connected', identity: displayName }))
      .catch((connectError: Error) => setConnection('jira', { status: 'notConnected', detail: connectError.message }));
  }, [transports]);

  return { openJira };
}
