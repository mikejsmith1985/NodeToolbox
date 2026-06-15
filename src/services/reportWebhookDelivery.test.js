// Unit tests for the report webhook delivery service (fully mocked webhook).

'use strict';

const { deliverReport } = require('./reportWebhookDelivery');

// A configuration with one team wired for all three surfaces.
function buildConfig(triggerUrl = 'https://team.atlassian.net/hook') {
  const teamReports = [{ teamName: 'Alpha', projectKey: 'ALPHA', triggerUrl, triggerSecret: 's3cret' }];
  return {
    version: '9.9.9',
    sslVerify: true,
    scheduler: {
      standupBriefing: { teamReports },
      scopeChange: { teamReports },
      featureChange: { teamReports },
    },
  };
}

// A fake triggerWebhook that records its arguments and returns a chosen status.
function fakeWebhook(status) {
  const calls = [];
  const fn = (url, payload, tls, secret) => {
    calls.push({ url, payload, tls, secret });
    return Promise.resolve({ status, body: '' });
  };
  return { fn, calls };
}

const baseDeps = (webhookFn) => ({ triggerWebhook: webhookFn, now: () => '2026-06-15T11:00:00.000Z' });

describe('deliverReport', () => {
  test('delivers a standup briefing and builds the payloadContext envelope', async () => {
    const { fn, calls } = fakeWebhook(200);
    const result = await deliverReport(buildConfig(), { surface: 'standup-briefing', teamId: 'ALPHA', report: '## Briefing\n- ok' }, baseDeps(fn));

    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].secret).toBe('s3cret'); // secret passed to the helper (header), not in URL
    const env = calls[0].payload.payloadContext;
    expect(env.source).toBe('standup-briefing');
    expect(env.team).toEqual({ name: 'Alpha', projectKey: 'ALPHA' });
    expect(env.generatedAt).toBe('2026-06-15T11:00:00.000Z');
    expect(env.report).toBe('## Briefing\n- ok');
    expect(env.meta).toEqual({ redactionApplied: false, nodeToolboxVersion: '9.9.9' });
  });

  test('redacts secrets in the report and flags redaction', async () => {
    const { fn, calls } = fakeWebhook(200);
    const result = await deliverReport(buildConfig(), { surface: 'scope-change', teamId: 'ALPHA', report: { note: 'password=supersecretvalue' } }, baseDeps(fn));

    expect(result.ok).toBe(true);
    expect(result.redactionApplied).toBe(true);
    expect(result.redactionCount).toBe(1);
    expect(result.message).toMatch(/redacted/);
    expect(calls[0].payload.payloadContext.report.note).not.toContain('supersecretvalue');
  });

  test('rejects an unknown surface with 400', async () => {
    const { fn } = fakeWebhook(200);
    const result = await deliverReport(buildConfig(), { surface: 'git-state', teamId: 'ALPHA', report: 'x' }, baseDeps(fn));
    expect(result).toMatchObject({ ok: false, httpStatus: 400, code: 'unknown-surface' });
  });

  test('rejects an empty report with 400', async () => {
    const { fn } = fakeWebhook(200);
    const result = await deliverReport(buildConfig(), { surface: 'standup-briefing', teamId: 'ALPHA', report: '   ' }, baseDeps(fn));
    expect(result).toMatchObject({ ok: false, httpStatus: 400, code: 'empty-report' });
  });

  test('returns 409 when the team has no configured destination', async () => {
    const { fn } = fakeWebhook(200);
    const result = await deliverReport(buildConfig(), { surface: 'standup-briefing', teamId: 'UnknownTeam', report: 'x' }, baseDeps(fn));
    expect(result).toMatchObject({ ok: false, httpStatus: 409, code: 'no-destination' });
  });

  test('blocks a disallowed host with 422 and sends NOTHING', async () => {
    const { fn, calls } = fakeWebhook(200);
    const result = await deliverReport(buildConfig('https://evil.example.com/hook'), { surface: 'standup-briefing', teamId: 'ALPHA', report: 'x' }, baseDeps(fn));
    expect(result).toMatchObject({ ok: false, httpStatus: 422, code: 'host-not-allowed' });
    expect(calls).toHaveLength(0);
  });

  test('maps a non-2xx webhook response to a 502 failure', async () => {
    const { fn } = fakeWebhook(401);
    const result = await deliverReport(buildConfig(), { surface: 'standup-briefing', teamId: 'ALPHA', report: 'x' }, baseDeps(fn));
    expect(result).toMatchObject({ ok: false, httpStatus: 502, webhookStatus: 401, code: 'webhook-rejected' });
    expect(result.message).toMatch(/HTTP 401/);
  });

  test('maps a thrown network error to a 502 failure (non-silent)', async () => {
    const throwingWebhook = () => Promise.reject(new Error('ECONNREFUSED'));
    const result = await deliverReport(buildConfig(), { surface: 'standup-briefing', teamId: 'ALPHA', report: 'x' }, baseDeps(throwingWebhook));
    expect(result).toMatchObject({ ok: false, httpStatus: 502, code: 'delivery-failed' });
    expect(result.message).toMatch(/ECONNREFUSED/);
  });
});
