// wizardConnectionStore.ts — The live state of the Wizard's two connections, shown on every screen's banner.

import { create } from 'zustand';

export type WizardSystem = 'snow' | 'jira';

/** One system's connection: whether it works, who is signed in, and the browser's reason when it does not. */
export interface ConnectionState {
  status: 'notConnected' | 'connecting' | 'connected' | 'expired';
  identity: string;
  detail: string;
}

const NOT_CONNECTED_STATE: ConnectionState = { status: 'notConnected', identity: '', detail: '' };

interface WizardConnectionState {
  snow: ConnectionState;
  jira: ConnectionState;
  setConnection: (system: WizardSystem, update: Partial<ConnectionState>) => void;
  resetConnections: () => void;
}

const STATUS_WORDS: Record<ConnectionState['status'], string> = {
  notConnected: 'not connected yet',
  connecting: 'connecting',
  connected: 'connected',
  expired: 'needs reconnecting',
};

/** Describes one system's connection in words (never colour alone). */
export function describeConnection(systemLabel: string, connectionState: ConnectionState): string {
  const nameSuffix = connectionState.status === 'connected' && connectionState.identity ? ` as ${connectionState.identity}` : '';
  return `${systemLabel}: ${STATUS_WORDS[connectionState.status]}${nameSuffix}`;
}

/** True only when both ServiceNow and Jira answered a live read — the jobs stay closed until then. */
export function isWizardReady(snowState: ConnectionState, jiraState: ConnectionState): boolean {
  return snowState.status === 'connected' && jiraState.status === 'connected';
}

/** The connection store. Changing one system never touches the other. */
export const useWizardConnectionStore = create<WizardConnectionState>()((setState) => ({
  snow: NOT_CONNECTED_STATE,
  jira: NOT_CONNECTED_STATE,
  // A status change starts from a clean slate so a stale name or reason never lingers on the banner.
  setConnection: (system, update) => setState(() => ({ [system]: { ...NOT_CONNECTED_STATE, ...update } })),
  resetConnections: () => setState({ snow: NOT_CONNECTED_STATE, jira: NOT_CONNECTED_STATE }),
}));
