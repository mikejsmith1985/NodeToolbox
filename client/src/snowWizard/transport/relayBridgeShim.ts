// relayBridgeShim.ts — Inside the Wizard bundle this file REPLACES services/relayBridgeApi.ts (esbuild alias in
// scripts/build-snow-wizard.js). Same exports, but requests go to the ServiceNow tab running the Wizard's bookmark
// instead of through Toolbox's local server — so Toolbox's snowApi, and everything built on it, runs unchanged.
//
// Framework-first drift (Art VII): the bundler's own alias is the seam; no Toolbox file is edited to make room for it.

import type { RelayBridgeStatus, RelayRequest, RelayResult, RelaySystem } from '../../types/relay.ts';
import { readSnowTransport } from './wizardTransports.ts';

const WIZARD_RELAY_VERSION = 'snow-wizard';

const pendingResults = new Map<string, Promise<RelayResult>>();

/** ServiceNow is "connected" once the Wizard has its ServiceNow transport; nothing else is relayed. */
export async function fetchRelayStatus(system: RelaySystem): Promise<RelayBridgeStatus> {
  const isConnected = system === 'snow' && readSnowTransport() !== null;
  return { system, isConnected, lastPingAt: null, version: WIZARD_RELAY_VERSION, hasSessionToken: isConnected };
}

/** Nothing to register: the Wizard's ServiceNow tab is its relay. */
export async function registerRelay(_system: RelaySystem): Promise<void> {
  return undefined;
}

/** Nothing is ever queued for a bookmarklet to poll in the Wizard. */
export async function pollRelay<ResponseBody>(_system: RelaySystem): Promise<{ request: ResponseBody | null }> {
  return { request: null };
}

/** Starts the request at once in the ServiceNow tab; its result is collected by `waitForRelayResult`. */
export async function postRelayRequest(request: RelayRequest): Promise<void> {
  const snowTransport = readSnowTransport();
  if (request.sys !== 'snow' || !snowTransport) {
    throw new Error(request.sys !== 'snow'
      ? `${request.sys} is not available in the SNow Wizard`
      : 'ServiceNow is not connected yet — press "Connect ServiceNow" in the SNow Wizard.');
  }
  pendingResults.set(request.id, snowTransport.execute(request));
}

/** Hands back the result of a request started by `postRelayRequest`. */
export async function waitForRelayResult(requestId: string, _system: RelaySystem, _timeoutMs?: number): Promise<RelayResult> {
  const pendingResult = pendingResults.get(requestId);
  if (!pendingResult) throw new Error(`No Wizard request ${requestId} is in progress`);
  pendingResults.delete(requestId);
  return pendingResult;
}
