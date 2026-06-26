// Unit tests for the report delivery status store — verifies it records delivered/skipped/error
// outcomes, wraps delivery calls, and survives a simulated restart, all against an isolated temp file.

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const {
  recordDeliveryStatus,
  recordDeliveryOutcome,
  loadDeliveryStatuses,
  getStatusFilePath,
  DELIVERY_STATUS_DELIVERED,
  DELIVERY_STATUS_SKIPPED,
  DELIVERY_STATUS_ERROR,
} = require('./reportDeliveryStatus');

const TEMP_STATUS_FILE = path.join(os.tmpdir(), 'nodetoolbox-delivery-status-test', 'status.json');

beforeAll(() => {
  process.env.TBX_DELIVERY_STATUS_PATH = TEMP_STATUS_FILE;
});

afterAll(() => {
  delete process.env.TBX_DELIVERY_STATUS_PATH;
});

beforeEach(() => {
  try { fs.rmSync(path.dirname(TEMP_STATUS_FILE), { recursive: true, force: true }); } catch (_ignored) { /* nothing to clean */ }
});

describe('getStatusFilePath', () => {
  it('honours the TBX_DELIVERY_STATUS_PATH override', () => {
    expect(getStatusFilePath()).toBe(TEMP_STATUS_FILE);
  });
});

describe('recordDeliveryStatus', () => {
  it('persists a delivered outcome with a timestamp and reads it back', () => {
    recordDeliveryStatus('scopeChange', 'team-0-ENFCT', {
      status: DELIVERY_STATUS_DELIVERED,
      message: 'Report delivered — 2 release change(s).',
      postUrl: 'https://example.atlassian.net/wiki/x/AB',
      label: 'Transformers',
    });

    const statuses = loadDeliveryStatuses();
    expect(statuses.scopeChange['team-0-ENFCT']).toMatchObject({
      status: 'delivered',
      message: 'Report delivered — 2 release change(s).',
      postUrl: 'https://example.atlassian.net/wiki/x/AB',
      label: 'Transformers',
      trigger: 'scheduled',
    });
    expect(statuses.scopeChange['team-0-ENFCT'].ranAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('overwrites the previous outcome so only the latest run is kept', () => {
    recordDeliveryStatus('scopeChange', 'team-0-ENFCT', { status: DELIVERY_STATUS_DELIVERED, label: 'Transformers' });
    recordDeliveryStatus('scopeChange', 'team-0-ENFCT', { status: DELIVERY_STATUS_SKIPPED, message: 'No changes', label: 'Transformers' });

    const statuses = loadDeliveryStatuses();
    expect(statuses.scopeChange['team-0-ENFCT'].status).toBe('skipped');
  });

  it('keeps scope and feature schedulers isolated within one file', () => {
    recordDeliveryStatus('scopeChange', 'artRollup', { status: DELIVERY_STATUS_DELIVERED });
    recordDeliveryStatus('featureChange', 'feature-art-rollup', { status: DELIVERY_STATUS_SKIPPED });

    const statuses = loadDeliveryStatuses();
    expect(statuses.scopeChange.artRollup.status).toBe('delivered');
    expect(statuses.featureChange['feature-art-rollup'].status).toBe('skipped');
  });

  it('survives a simulated restart — a fresh load sees prior writes', () => {
    recordDeliveryStatus('scopeChange', 'team-0-ENFCT', { status: DELIVERY_STATUS_ERROR, message: 'HTTP 409' });
    expect(loadDeliveryStatuses().scopeChange['team-0-ENFCT'].status).toBe('error');
  });
});

describe('recordDeliveryOutcome', () => {
  it('records "delivered" when the thunk resolves without skipped', async () => {
    const result = await recordDeliveryOutcome('scopeChange', 'team-0-ENFCT', 'Transformers', 'scheduled',
      async () => ({ skipped: false, message: 'Report delivered.', postUrl: 'https://x/AB' }));

    expect(result.message).toBe('Report delivered.');
    expect(loadDeliveryStatuses().scopeChange['team-0-ENFCT'].status).toBe('delivered');
  });

  it('records "skipped" when the thunk resolves with skipped: true', async () => {
    await recordDeliveryOutcome('scopeChange', 'team-0-ENFCT', 'Transformers', 'scheduled',
      async () => ({ skipped: true, message: 'No fix version changes since Jun 25.' }));

    const outcome = loadDeliveryStatuses().scopeChange['team-0-ENFCT'];
    expect(outcome.status).toBe('skipped');
    expect(outcome.message).toBe('No fix version changes since Jun 25.');
  });

  it('records "error" and re-throws when the thunk rejects', async () => {
    await expect(
      recordDeliveryOutcome('scopeChange', 'team-0-ENFCT', 'Transformers', 'manual',
        async () => { throw new Error('Confluence returned HTTP 409'); }),
    ).rejects.toThrow('Confluence returned HTTP 409');

    const outcome = loadDeliveryStatuses().scopeChange['team-0-ENFCT'];
    expect(outcome.status).toBe('error');
    expect(outcome.message).toBe('Confluence returned HTTP 409');
    expect(outcome.trigger).toBe('manual');
  });
});
