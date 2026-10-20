// readOnlyTransport.test.ts — Proves the Review job can only read ServiceNow: any write is refused before it leaves the
// Wizard, and a whole review run through Toolbox's real readers sends nothing but reads.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../services/snowApi.ts';
import { useConnectionStore } from '../../store/connectionStore.ts';
import type { RelayRequest, RelayResult } from '../../types/relay.ts';
import { installWizardTransports, readSnowTransport, resetWizardTransports, type SnowTransport } from '../transport/wizardTransports.ts';
import { runChangeReview } from './changeReview.ts';
import {
  createReadOnlySnowTransport,
  installReadOnlySnowTransport,
  isReadOnlySnowTransport,
  ReviewIsReadOnlyError,
} from './readOnlyTransport.ts';

// Inside the Wizard file the bundler swaps the relay bridge for the Wizard's shim; the test does the same, so snowApi
// runs exactly as it does in production.
vi.mock('../../services/relayBridgeApi.ts', async () => await import('../transport/relayBridgeShim.ts'));

const CHANGE_SYS_ID = 'abc123';

/** The change record a lookup returns. */
const CHANGE_RECORD = {
  sys_id: CHANGE_SYS_ID,
  number: 'CHG0012345',
  state: 'Assess',
  assigned_to: { value: 'user1', display_value: 'Smith, Jane' },
  short_description: 'Login page fix',
  description: '',
  justification: 'Members are locked out.',
};

/** A transport that records every request and answers reads with a small, believable ServiceNow. */
function createRecordingTransport(): SnowTransport & { requests: RelayRequest[] } {
  const requests: RelayRequest[] = [];
  return {
    requests,
    async execute(relayRequest: RelayRequest): Promise<RelayResult> {
      requests.push(relayRequest);
      const isChangeLookup = relayRequest.path.startsWith('/api/now/table/change_request?');
      const isChangeRead = relayRequest.path.startsWith(`/api/now/table/change_request/${CHANGE_SYS_ID}`);
      const replyBody = isChangeLookup ? { result: [CHANGE_RECORD] } : isChangeRead ? { result: CHANGE_RECORD } : { result: [] };
      return { id: relayRequest.id, ok: true, status: 200, data: replyBody, error: null };
    },
  };
}

function buildRequest(method: string): RelayRequest {
  return { sys: 'snow', id: `request-${method}`, method, path: '/api/now/table/change_request' };
}

beforeEach(() => {
  useConnectionStore.setState({
    relayBridgeStatus: { system: 'snow', isConnected: true, hasSessionToken: true, lastPingAt: null, version: null },
  });
});

afterEach(() => {
  resetWizardTransports();
});

describe('createReadOnlySnowTransport', () => {
  it('passes reads through to the real connection', async () => {
    const innerTransport = createRecordingTransport();
    const readOnlyTransport = createReadOnlySnowTransport(innerTransport);

    const relayResult = await readOnlyTransport.execute(buildRequest('get'));

    expect(relayResult.ok).toBe(true);
    expect(innerTransport.requests).toHaveLength(1);
  });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE', 'HEAD'])('refuses a %s before it reaches ServiceNow', async (method) => {
    const innerTransport = createRecordingTransport();
    const readOnlyTransport = createReadOnlySnowTransport(innerTransport);

    await expect(readOnlyTransport.execute(buildRequest(method))).rejects.toBeInstanceOf(ReviewIsReadOnlyError);
    expect(innerTransport.requests).toHaveLength(0);
  });
});

describe('installReadOnlySnowTransport', () => {
  it('guards the installed connection for the job and puts the original back on exit', () => {
    const innerTransport = createRecordingTransport();
    installWizardTransports({ snow: innerTransport });

    const restoreOriginal = installReadOnlySnowTransport();
    expect(isReadOnlySnowTransport(readSnowTransport())).toBe(true);
    restoreOriginal();

    expect(readSnowTransport()).toBe(innerTransport);
  });

  it('does not wrap twice, and does nothing before ServiceNow is connected', () => {
    expect(installReadOnlySnowTransport()).toBeTypeOf('function');
    expect(readSnowTransport()).toBeNull();
    installWizardTransports({ snow: createRecordingTransport() });

    installReadOnlySnowTransport();
    const guardedTransport = readSnowTransport();
    installReadOnlySnowTransport();

    expect(readSnowTransport()).toBe(guardedTransport);
  });

  it('refuses a write made through Toolbox\'s own ServiceNow client', async () => {
    const innerTransport = createRecordingTransport();
    installWizardTransports({ snow: innerTransport });
    installReadOnlySnowTransport();

    await expect(snowFetch('/api/now/table/change_request/abc123', { method: 'PATCH', body: '{}' }))
      .rejects.toThrow(/read-only/i);
    expect(innerTransport.requests).toHaveLength(0);
  });
});

describe('a full review run', () => {
  it('sends zero writes to ServiceNow', async () => {
    const innerTransport = createRecordingTransport();
    installWizardTransports({ snow: innerTransport });
    const restoreOriginal = installReadOnlySnowTransport();

    const review = await runChangeReview('CHG0012345', { todayIso: '2026-10-20', isRcpRulesEnabled: true });
    restoreOriginal();

    expect(review.isChangeFound).toBe(true);
    expect(innerTransport.requests.length).toBeGreaterThan(0);
    expect(innerTransport.requests.filter((relayRequest) => relayRequest.method.toUpperCase() !== 'GET')).toEqual([]);
  });
});
