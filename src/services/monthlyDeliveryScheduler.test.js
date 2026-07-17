// monthlyDeliveryScheduler.test.js — Unit tests for the Monthly Delivery Report scheduler:
// pure date math (2nd Tuesday, covered month, window), the once-per-month guard, the run
// orchestration (honest per-team failures + persisted RunResult), and the DI tick.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Mock ONLY the Jira fetch functions; classification, grouping, and the prompt builder run for real
// so these tests exercise the genuine pipeline on fixture issues.
jest.mock('./monthlyDeliveryReport', () => {
  const actualReportModule = jest.requireActual('./monthlyDeliveryReport');
  return {
    ...actualReportModule,
    fetchTeamDeliveryData: jest.fn(),
    fetchFeatureSummaries: jest.fn(),
  };
});

const { fetchTeamDeliveryData, fetchFeatureSummaries } = require('./monthlyDeliveryReport');
const {
  computeSecondTuesdayDate,
  resolveCoveredMonth,
  buildCoveredMonthWindow,
  hasAlreadyFiredThisMonth,
  runMonthlyDeliveryNow,
  readLastRunResult,
  checkAndFireMonthlyDelivery,
} = require('./monthlyDeliveryScheduler');

describe('computeSecondTuesdayDate', () => {
  it('finds the 2nd Tuesday when the month starts mid-week', () => {
    // July 2026 starts on a Wednesday: Tuesdays fall on the 7th and 14th.
    expect(computeSecondTuesdayDate(2026, 6)).toBe('2026-07-14');
  });

  it('finds the 2nd Tuesday when the 1st IS a Tuesday (earliest possible: the 8th)', () => {
    // September 2026 starts on a Tuesday: the second Tuesday is the 8th.
    expect(computeSecondTuesdayDate(2026, 8)).toBe('2026-09-08');
  });

  it('finds the 2nd Tuesday when the month starts on a Wednesday (latest possible: the 14th)', () => {
    // April 2026 starts on a Wednesday: Tuesdays fall on the 7th and 14th.
    expect(computeSecondTuesdayDate(2026, 3)).toBe('2026-04-14');
  });
});

describe('resolveCoveredMonth', () => {
  it('covers the calendar month before the given day', () => {
    expect(resolveCoveredMonth('2026-07-16')).toBe('2026-06');
  });

  it('rolls the year back when the run happens in January', () => {
    expect(resolveCoveredMonth('2026-01-05')).toBe('2025-12');
  });
});

describe('buildCoveredMonthWindow', () => {
  it('spans the first local instant of the month to the last instant of its final day', () => {
    const juneWindow = buildCoveredMonthWindow('2026-06');
    expect(juneWindow.firstDayDate).toBe('2026-06-01');
    expect(juneWindow.lastDayDate).toBe('2026-06-30');
    expect(juneWindow.startMs).toBe(new Date(2026, 5, 1, 0, 0, 0, 0).getTime());
    expect(juneWindow.endMs).toBe(new Date(2026, 6, 1, 0, 0, 0, 0).getTime() - 1);
  });

  it('handles leap-year February', () => {
    const leapFebruaryWindow = buildCoveredMonthWindow('2024-02');
    expect(leapFebruaryWindow.lastDayDate).toBe('2024-02-29');
  });

  it('handles December → January rollover at the window end', () => {
    const decemberWindow = buildCoveredMonthWindow('2025-12');
    expect(decemberWindow.lastDayDate).toBe('2025-12-31');
    expect(decemberWindow.endMs).toBe(new Date(2026, 0, 1, 0, 0, 0, 0).getTime() - 1);
  });
});

describe('hasAlreadyFiredThisMonth', () => {
  it('treats any fired date within the current calendar month as already fired', () => {
    expect(hasAlreadyFiredThisMonth('2026-07-14', '2026-07-16')).toBe(true);
    expect(hasAlreadyFiredThisMonth('2026-07-16', '2026-07-16')).toBe(true);
  });

  it('does not count a fired date from an earlier month (or no fired date at all)', () => {
    expect(hasAlreadyFiredThisMonth('2026-06-10', '2026-07-16')).toBe(false);
    expect(hasAlreadyFiredThisMonth(undefined, '2026-07-16')).toBe(false);
    expect(hasAlreadyFiredThisMonth('', '2026-07-16')).toBe(false);
  });
});

// ── Run orchestration ──

/** A minimal issue that entered done inside June 2026. */
function buildDoneInJuneIssue(issueKey) {
  return {
    key: issueKey,
    changelog: {
      histories: [{ id: '1', created: '2026-06-11T10:00:00.000Z', items: [{ field: 'status', toString: 'Accepted' }] }],
    },
    fields: {
      summary: 'Done work ' + issueKey,
      status: { name: 'Accepted', statusCategory: { key: 'done' } },
      issuetype: { name: 'Story' },
      created: '2026-04-01T00:00:00.000Z',
      fixVersions: [],
      customfield_10108: 'FEAT-1',
    },
  };
}

/** A minimal issue that entered Ready for QA inside June 2026 and is still there. */
function buildExternalTestInJuneIssue(issueKey) {
  return {
    key: issueKey,
    changelog: {
      histories: [{ id: '1', created: '2026-06-05T10:00:00.000Z', items: [{ field: 'status', toString: 'Ready for QA' }] }],
    },
    fields: {
      summary: 'Testing work ' + issueKey,
      status: { name: 'Ready for QA', statusCategory: { key: 'indeterminate' } },
      issuetype: { name: 'Story' },
      created: '2026-04-01T00:00:00.000Z',
      fixVersions: [],
    },
  };
}

describe('runMonthlyDeliveryNow', () => {
  let temporaryResultsPath;

  beforeEach(() => {
    jest.clearAllMocks();
    temporaryResultsPath = path.join(os.tmpdir(), 'tbx-monthly-delivery-test-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.json');
    process.env.TBX_MONTHLY_DELIVERY_RESULTS_PATH = temporaryResultsPath;
    fetchFeatureSummaries.mockResolvedValue(new Map([['FEAT-1', 'Payments revamp']]));
  });

  afterEach(() => {
    delete process.env.TBX_MONTHLY_DELIVERY_RESULTS_PATH;
    try { fs.unlinkSync(temporaryResultsPath); } catch (_cleanupError) { /* file may not exist */ }
  });

  function buildConfiguration(teams) {
    return { scheduler: { monthlyDelivery: { isEnabled: true, scheduleTime: '08:00', featureLinkFieldId: 'customfield_10108', teams } } };
  }

  const RUN_DEPS = { today: '2026-07-14', nowIso: () => '2026-07-14T08:00:00.000Z', requestJira: async () => ({ status: 200, body: {} }) };

  // ── Delivery: same webhook → Automation email channel as every other scheduled report ──

  function buildDeliveryConfiguration(triggerUrl) {
    const configuration = buildConfiguration([{ teamName: 'Transformers', projectKey: 'TRFM', boardId: '42' }]);
    configuration.scheduler.monthlyDelivery.triggerUrl = triggerUrl;
    return configuration;
  }

  it('delivers the prompt to the configured webhook and records the outcome on the run', async () => {
    fetchTeamDeliveryData.mockResolvedValue({ issues: [], releasedVersionsInWindow: new Map() });
    const deliverReport = jest.fn().mockResolvedValue({ ok: true, code: 'delivered' });
    const configuration = buildDeliveryConfiguration('https://api-private.atlassian.com/automation/webhooks/x');

    const outcome = await runMonthlyDeliveryNow(configuration, { ...RUN_DEPS, deliverReport });

    expect(deliverReport).toHaveBeenCalledTimes(1);
    const [, request] = deliverReport.mock.calls[0];
    expect(request.surface).toBe('monthly-delivery');
    expect(request.report.coveredMonth).toBe('2026-06');
    expect(typeof request.report.promptText).toBe('string');
    expect(outcome.result.delivery).toEqual({ attempted: true, ok: true, message: 'Delivered to the Automation webhook.' });
  });

  it('records a failed delivery with its reason instead of hiding it', async () => {
    fetchTeamDeliveryData.mockResolvedValue({ issues: [], releasedVersionsInWindow: new Map() });
    const deliverReport = jest.fn().mockResolvedValue({ ok: false, code: 'host-not-allowed', message: 'Host not allowed.' });
    const configuration = buildDeliveryConfiguration('https://evil.example.com/webhook');

    const outcome = await runMonthlyDeliveryNow(configuration, { ...RUN_DEPS, deliverReport });

    expect(outcome.ok).toBe(true); // the run itself still succeeds — the prompt is cached
    expect(outcome.result.delivery).toEqual({ attempted: true, ok: false, message: 'Host not allowed.' });
  });

  it('skips delivery entirely when no webhook is configured', async () => {
    fetchTeamDeliveryData.mockResolvedValue({ issues: [], releasedVersionsInWindow: new Map() });
    const deliverReport = jest.fn();
    const configuration = buildConfiguration([{ teamName: 'Transformers', projectKey: 'TRFM', boardId: '42' }]);

    const outcome = await runMonthlyDeliveryNow(configuration, { ...RUN_DEPS, deliverReport });

    expect(deliverReport).not.toHaveBeenCalled();
    expect(outcome.result.delivery).toEqual({ attempted: false });
  });

  it('produces a persisted RunResult covering the prior month with per-team counts', async () => {
    fetchTeamDeliveryData.mockResolvedValue({
      issues: [buildDoneInJuneIssue('TRFM-1'), buildExternalTestInJuneIssue('TRFM-2')],
      releasedVersionsInWindow: new Map(),
    });
    const configuration = buildConfiguration([{ teamName: 'Transformers', projectKey: 'TRFM', boardId: '42' }]);

    const outcome = await runMonthlyDeliveryNow(configuration, RUN_DEPS);

    expect(outcome.ok).toBe(true);
    expect(outcome.result.coveredMonth).toBe('2026-06');
    expect(outcome.result.trigger).toBe('manual');
    expect(outcome.result.teams).toEqual([
      { teamName: 'Transformers', status: 'ok', productionCount: 1, externalTestCount: 1, message: '' },
    ]);
    expect(outcome.result.promptText).toContain('=== Team: Transformers ===');
    expect(outcome.result.promptText).toContain('Feature FEAT-1 — Payments revamp:');
    expect(outcome.result.promptText).toContain('- TRFM-1: Done work TRFM-1 (reached production 2026-06-11)');
    // The result survives on disk for the status route.
    expect(readLastRunResult()).toEqual(outcome.result);
  });

  it('reports a failed team honestly and keeps going for the rest (never a fake clean result)', async () => {
    fetchTeamDeliveryData
      .mockRejectedValueOnce(new Error('Jira search failed: 401'))
      .mockResolvedValueOnce({ issues: [buildDoneInJuneIssue('CLNC-1')], releasedVersionsInWindow: new Map() });
    const configuration = buildConfiguration([
      { teamName: 'Broken Team', projectKey: 'BRKN', boardId: '1' },
      { teamName: 'Cleanup Crew', projectKey: 'CLNC', boardId: '2' },
    ]);

    const outcome = await runMonthlyDeliveryNow(configuration, RUN_DEPS);

    expect(outcome.ok).toBe(true);
    expect(outcome.result.teams[0]).toEqual(
      { teamName: 'Broken Team', status: 'error', productionCount: 0, externalTestCount: 0, message: 'Jira search failed: 401' },
    );
    expect(outcome.result.teams[1].status).toBe('ok');
    expect(outcome.result.promptText).toContain('DATA UNAVAILABLE: Jira search failed: 401');
    expect(outcome.result.promptText).toContain('- CLNC-1: Done work CLNC-1 (reached production 2026-06-11)');
  });

  it('marks a team with no qualifying work as empty and says so in the prompt', async () => {
    fetchTeamDeliveryData.mockResolvedValue({ issues: [], releasedVersionsInWindow: new Map() });
    const configuration = buildConfiguration([{ teamName: 'Quiet Team', projectKey: 'QUIET', boardId: '3' }]);

    const outcome = await runMonthlyDeliveryNow(configuration, RUN_DEPS);

    expect(outcome.result.teams[0].status).toBe('empty');
    expect(outcome.result.promptText).toContain('No recorded deliveries this month.');
  });

  it('refuses to run with no teams configured instead of emitting an empty prompt', async () => {
    const outcome = await runMonthlyDeliveryNow(buildConfiguration([]), RUN_DEPS);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/no teams configured/i);
    expect(fetchTeamDeliveryData).not.toHaveBeenCalled();
  });
});

// ── Scheduled tick (DI pattern from piReviewScheduler tests) ──
// July 2026's 2nd Tuesday is the 14th; August 2026's is the 11th.

describe('checkAndFireMonthlyDelivery', () => {
  function buildTickConfiguration(overrides = {}) {
    return {
      scheduler: {
        monthlyDelivery: {
          isEnabled: true,
          scheduleTime: '08:00',
          featureLinkFieldId: 'customfield_10108',
          teams: [{ teamName: 'Transformers', projectKey: 'TRFM', boardId: '42' }],
          ...overrides,
        },
      },
    };
  }

  function buildTickOptions(overrides = {}) {
    return {
      today: '2026-07-14',
      currentTime: '08:00',
      firedDates: new Map(),
      recordFired: jest.fn(),
      runReport: jest.fn().mockResolvedValue({ ok: true }),
      isRunBusy: () => false,
      ...overrides,
    };
  }

  it('stays idle when the scheduler is disabled', () => {
    const options = buildTickOptions();
    expect(checkAndFireMonthlyDelivery(buildTickConfiguration({ isEnabled: false }), options)).toBe(false);
    expect(options.runReport).not.toHaveBeenCalled();
  });

  it('skips without firing (and without consuming the month) when no teams are configured', () => {
    const options = buildTickOptions();
    expect(checkAndFireMonthlyDelivery(buildTickConfiguration({ teams: [] }), options)).toBe(false);
    expect(options.recordFired).not.toHaveBeenCalled();
  });

  it('stays idle before the 2nd Tuesday of the month', () => {
    const options = buildTickOptions({ today: '2026-07-10' });
    expect(checkAndFireMonthlyDelivery(buildTickConfiguration(), options)).toBe(false);
  });

  it('stays idle on the 2nd Tuesday before the scheduled time', () => {
    const options = buildTickOptions({ currentTime: '07:59' });
    expect(checkAndFireMonthlyDelivery(buildTickConfiguration(), options)).toBe(false);
  });

  it('fires once on the 2nd Tuesday at the scheduled time and records the month', () => {
    const options = buildTickOptions();
    expect(checkAndFireMonthlyDelivery(buildTickConfiguration(), options)).toBe(true);
    expect(options.recordFired).toHaveBeenCalledWith('monthlyDelivery', '2026-07-14');
    expect(options.runReport).toHaveBeenCalledTimes(1);
  });

  it('catches up on a later day in the same month regardless of the time of day', () => {
    const options = buildTickOptions({ today: '2026-07-20', currentTime: '00:30' });
    expect(checkAndFireMonthlyDelivery(buildTickConfiguration(), options)).toBe(true);
  });

  it('never double-fires within a month (fired-state guard)', () => {
    const options = buildTickOptions({
      today: '2026-07-20',
      firedDates: new Map([['monthlyDelivery', '2026-07-14']]),
    });
    expect(checkAndFireMonthlyDelivery(buildTickConfiguration(), options)).toBe(false);
    expect(options.runReport).not.toHaveBeenCalled();
  });

  it('fires again the next month', () => {
    const options = buildTickOptions({
      today: '2026-08-11',
      firedDates: new Map([['monthlyDelivery', '2026-07-14']]),
    });
    expect(checkAndFireMonthlyDelivery(buildTickConfiguration(), options)).toBe(true);
  });

  it('skips (without consuming the month) while a run is already in flight', () => {
    const options = buildTickOptions({ isRunBusy: () => true });
    expect(checkAndFireMonthlyDelivery(buildTickConfiguration(), options)).toBe(false);
    expect(options.recordFired).not.toHaveBeenCalled();
  });

  it('honors live config changes between ticks without a restart (FR-004)', () => {
    const configuration = buildTickConfiguration({ isEnabled: false });
    const options = buildTickOptions();
    expect(checkAndFireMonthlyDelivery(configuration, options)).toBe(false);

    configuration.scheduler.monthlyDelivery.isEnabled = true;
    expect(checkAndFireMonthlyDelivery(configuration, options)).toBe(true);
  });

  it('is not consumed by a manual run — the scheduled fire still happens afterwards (FR-003)', async () => {
    const manualRunResultsPath = path.join(os.tmpdir(), 'tbx-monthly-delivery-tick-test-' + process.pid + '.json');
    process.env.TBX_MONTHLY_DELIVERY_RESULTS_PATH = manualRunResultsPath;
    try {
      fetchTeamDeliveryData.mockResolvedValue({ issues: [], releasedVersionsInWindow: new Map() });
      fetchFeatureSummaries.mockResolvedValue(new Map());
      const configuration = buildTickConfiguration();
      const options = buildTickOptions();

      // A manual Run Now earlier the same day must not write fired state...
      await runMonthlyDeliveryNow(configuration, { today: '2026-07-14', nowIso: () => 'x', requestJira: async () => ({ status: 200, body: {} }) });
      expect(options.firedDates.size).toBe(0);

      // ...so the scheduled tick still fires.
      expect(checkAndFireMonthlyDelivery(configuration, options)).toBe(true);
    } finally {
      delete process.env.TBX_MONTHLY_DELIVERY_RESULTS_PATH;
      try { fs.unlinkSync(manualRunResultsPath); } catch (_cleanupError) { /* file may not exist */ }
    }
  });
});
