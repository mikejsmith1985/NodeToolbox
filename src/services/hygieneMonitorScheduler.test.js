// hygieneMonitorScheduler.test.js — Unit tests for the hygiene monitor scheduler's
// pure helpers. All functions tested here are side-effect-free; no mocks needed.

'use strict';

const {
  buildHygieneDigest,
} = require('./hygieneMonitorScheduler');

// ── buildHygieneDigest (T019) ────────────────────────────────────────────────

/** Builds a minimal scan result used by the digest tests. */
function buildScan(overrides = {}) {
  return {
    teamName:        'Platform',
    scannedAt:       '2026-06-16T06:00:00.000Z',
    issuesScanned:   10,
    violationsFound: 4,
    fixesApplied:    2,
    actionsRequired: 2,
    unassignedCount: 1,
    failures:        [],
    ...overrides,
  };
}

describe('buildHygieneDigest', () => {
  it('includes core counts in the digest', () => {
    const digest = buildHygieneDigest(buildScan(), null);

    expect(digest.issuesScanned).toBe(10);
    expect(digest.violationsFound).toBe(4);
    expect(digest.fixesApplied).toBe(2);
    expect(digest.actionsRequired).toBe(2);
    expect(digest.unassignedCount).toBe(1);
  });

  it('sets trend to n/a when there is no prior scan', () => {
    const digest = buildHygieneDigest(buildScan(), null);
    expect(digest.trend).toBe('n/a');
  });

  it('sets trend to down when violations decreased since the prior scan', () => {
    const priorScan = buildScan({ violationsFound: 8 });
    const currentScan = buildScan({ violationsFound: 4 });
    const digest = buildHygieneDigest(currentScan, priorScan);
    expect(digest.trend).toBe('down');
  });

  it('sets trend to up when violations increased since the prior scan', () => {
    const priorScan = buildScan({ violationsFound: 2 });
    const currentScan = buildScan({ violationsFound: 4 });
    const digest = buildHygieneDigest(currentScan, priorScan);
    expect(digest.trend).toBe('up');
  });

  it('sets trend to flat when violations are unchanged', () => {
    const priorScan = buildScan({ violationsFound: 4 });
    const currentScan = buildScan({ violationsFound: 4 });
    const digest = buildHygieneDigest(currentScan, priorScan);
    expect(digest.trend).toBe('flat');
  });

  it('includes any scan failures in the digest', () => {
    const scan = buildScan({ failures: [{ issueKey: 'PROJ-99', reason: 'Jira update rejected 400' }] });
    const digest = buildHygieneDigest(scan, null);
    expect(digest.failures).toHaveLength(1);
    expect(digest.failures[0].issueKey).toBe('PROJ-99');
  });

  it('includes the team name and scan timestamp', () => {
    const digest = buildHygieneDigest(buildScan({ teamName: 'Checkout', scannedAt: '2026-06-16T06:00:00.000Z' }), null);
    expect(digest.teamName).toBe('Checkout');
    expect(digest.scannedAt).toBe('2026-06-16T06:00:00.000Z');
  });
});

describe('buildEnabledCheckFilter — a saved config naming a retired check id still works', () => {
  const { buildEnabledCheckFilter } = require('./hygieneMonitorScheduler');

  it('translates the retired stale-issue id to the stale id both sides now use', () => {
    // The port used to emit 'stale-issue' where the UI has always shown 'stale'. Renaming it to
    // match would otherwise silently drop the rule from any team whose saved config names the old
    // id — a monitor quietly checking one thing fewer than the operator asked for.
    const filter = buildEnabledCheckFilter(['no-assignee', 'stale-issue']);

    expect(filter.has('stale')).toBe(true);
    expect(filter.has('no-assignee')).toBe(true);
  });

  it('leaves current ids untouched', () => {
    const filter = buildEnabledCheckFilter(['stale', 'due-date-overdue']);

    expect(filter.has('stale')).toBe(true);
    expect(filter.has('due-date-overdue')).toBe(true);
  });
});
