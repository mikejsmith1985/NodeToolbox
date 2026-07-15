// test/unit/piReviewScheduler.test.js — Scheduler tick + run-now orchestration (feature 015). The
// refresh core is mocked, so these run in Jest (no linkedom): the DOM-hosted end-to-end invariants
// live in test/server-dom/piReviewRefresh.spec.js (node --test, real linkedom).

'use strict';

const path = require('path');
const os = require('os');

jest.mock('../../src/services/piReviewRefresh', () => ({ refreshPiReviewPage: jest.fn() }));
const { refreshPiReviewPage } = require('../../src/services/piReviewRefresh');
const { checkAndFireScheduledPiReviews, runPiReviewTeamNow } = require('../../src/services/piReviewScheduler');

function configWithTeam(teamOverrides) {
  return {
    scheduler: {
      piReview: {
        teams: [{
          teamName: 'T',
          isEnabled: true,
          scheduleTime: '06:00',
          productOwnerAssignee: 'C73130',
          piFieldId: 'customfield_10301',
          pages: [{ pageUrlOrId: '12345', piName: 'PI 26.4' }],
          ...teamOverrides,
        }],
      },
    },
  };
}

describe('checkAndFireScheduledPiReviews (tick)', () => {
  function tickOptions(overrides) {
    return {
      currentTime: '06:00',
      today: '2026-07-14',
      firedDates: new Map(),
      runningTeams: new Set(),
      recordFired: jest.fn(),
      runTeam: jest.fn().mockResolvedValue({ ok: true }),
      ...overrides,
    };
  }

  it('fires an enabled team when the scheduled time is reached', () => {
    const options = tickOptions();
    const fired = checkAndFireScheduledPiReviews(configWithTeam(), options);
    expect(fired).toHaveLength(1);
    expect(options.runTeam).toHaveBeenCalledTimes(1);
    expect(options.recordFired).toHaveBeenCalledWith(expect.stringContaining('piReview-team-0'), '2026-07-14');
  });

  it('catches up when the scheduled time has already passed today', () => {
    const fired = checkAndFireScheduledPiReviews(configWithTeam(), tickOptions({ currentTime: '06:05' }));
    expect(fired).toHaveLength(1);
  });

  it('does not fire before the scheduled time', () => {
    const fired = checkAndFireScheduledPiReviews(configWithTeam(), tickOptions({ currentTime: '05:59' }));
    expect(fired).toHaveLength(0);
  });

  it('does not fire a disabled team', () => {
    const fired = checkAndFireScheduledPiReviews(configWithTeam({ isEnabled: false }), tickOptions());
    expect(fired).toHaveLength(0);
  });

  it('does not fire twice in one day (fired-state guard)', () => {
    const firedDates = new Map([['piReview-team-0-T', '2026-07-14']]);
    const fired = checkAndFireScheduledPiReviews(configWithTeam(), tickOptions({ firedDates }));
    expect(fired).toHaveLength(0);
  });

  it('does not start a second concurrent run for a team already running (overlap guard)', () => {
    const runningTeams = new Set(['piReview-team-0-T']);
    const fired = checkAndFireScheduledPiReviews(configWithTeam(), tickOptions({ runningTeams }));
    expect(fired).toHaveLength(0);
  });
});

describe('runPiReviewTeamNow', () => {
  beforeEach(() => {
    refreshPiReviewPage.mockReset();
    // Route the persisted results file to a throwaway temp path so tests never touch the real profile.
    process.env.TBX_PI_REVIEW_RESULTS_PATH = path.join(os.tmpdir(), `pi-review-results-${process.pid}.json`);
  });

  it('refreshes every configured page and reports ok when none failed', async () => {
    refreshPiReviewPage.mockResolvedValue({ status: 'success', pageUrlOrId: '12345', ranAtIso: 'x', message: '', featuresAppended: 1, rowsReconciled: 2 });
    const configuration = configWithTeam({ pages: [{ pageUrlOrId: '12345', piName: 'PI 26.4' }, { pageUrlOrId: '67890', piName: 'PI 26.5' }] });

    // Inject a placeholder domParser so linkedom is never loaded in this Jest run.
    const outcome = await runPiReviewTeamNow(configuration, 0, { domParser: {}, makeJiraApiRequest: () => {}, makeConfluenceApiRequest: () => {} });

    expect(outcome.ok).toBe(true);
    expect(outcome.results).toHaveLength(2);
    expect(refreshPiReviewPage).toHaveBeenCalledTimes(2);
  });

  it('reports not-ok when a page fails', async () => {
    refreshPiReviewPage.mockResolvedValueOnce({ status: 'failed', pageUrlOrId: '12345', message: 'boom' });
    const outcome = await runPiReviewTeamNow(configWithTeam(), 0, { domParser: {} });
    expect(outcome.ok).toBe(false);
  });

  it('returns not-ok for an unknown team without calling the refresh core', async () => {
    const outcome = await runPiReviewTeamNow(configWithTeam(), 5, { domParser: {} });
    expect(outcome.ok).toBe(false);
    expect(outcome.results).toHaveLength(0);
    expect(refreshPiReviewPage).not.toHaveBeenCalled();
  });
});
