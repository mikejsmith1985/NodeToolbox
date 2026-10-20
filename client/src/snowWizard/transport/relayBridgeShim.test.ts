// relayBridgeShim.test.ts — Proves the Wizard's stand-in for Toolbox's relay bridge keeps the same API, so Toolbox's own
// snowApi runs unchanged inside the Wizard.

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as toolboxRelayBridge from '../../services/relayBridgeApi.ts';
import * as wizardRelayBridge from './relayBridgeShim.ts';
import { installWizardTransports, resetWizardTransports } from './wizardTransports.ts';

afterEach(() => {
  resetWizardTransports();
});

describe('relayBridgeShim', () => {
  it('exports every function Toolbox\'s relay bridge exports', () => {
    expect(Object.keys(wizardRelayBridge).sort()).toEqual(Object.keys(toolboxRelayBridge).sort());
  });

  it('runs a ServiceNow request through the installed transport and hands back its result', async () => {
    const execute = vi.fn(async () => ({ id: 'r1', ok: true, status: 200, data: '{}', error: null }));
    installWizardTransports({ snow: { execute } });

    await wizardRelayBridge.postRelayRequest({ sys: 'snow', id: 'r1', method: 'GET', path: '/api/now/table/x' });

    await expect(wizardRelayBridge.waitForRelayResult('r1', 'snow')).resolves.toEqual({ id: 'r1', ok: true, status: 200, data: '{}', error: null });
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ path: '/api/now/table/x' }));
  });

  it('reports ServiceNow connected only once a transport is installed', async () => {
    await expect(wizardRelayBridge.fetchRelayStatus('snow')).resolves.toEqual(expect.objectContaining({ isConnected: false }));
    installWizardTransports({ snow: { execute: vi.fn() } });
    await expect(wizardRelayBridge.fetchRelayStatus('snow')).resolves.toEqual(expect.objectContaining({ isConnected: true, hasSessionToken: true }));
  });

  it('refuses systems the Wizard does not relay, in plain words', async () => {
    installWizardTransports({ snow: { execute: vi.fn() } });
    await expect(wizardRelayBridge.postRelayRequest({ sys: 'sharepoint', id: 'r2', method: 'GET', path: '/x' }))
      .rejects.toThrow('sharepoint is not available in the SNow Wizard');
  });

  it('fails clearly when asked for a result it never started', async () => {
    await expect(wizardRelayBridge.waitForRelayResult('missing', 'snow')).rejects.toThrow('No Wizard request missing');
  });
});
