// hygieneMonitorScheduler.test.js — Unit tests for the hygiene monitor scheduler's
// pure helpers. All functions tested here are side-effect-free; no mocks needed.

'use strict';

const {
  parseAiAssistClassifications,
  buildHygieneDigest,
} = require('./hygieneMonitorScheduler');

// ── parseAiAssistClassifications (T018) ──────────────────────────────────────────

describe('parseAiAssistClassifications', () => {
  it('parses a FIXABLE line into a classification with the correct shape', () => {
    const text = 'FIXABLE: PROJ-1 | customfield_10200 | Generate acceptance criteria from summary.';
    const results = parseAiAssistClassifications(text);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      issueKey:  'PROJ-1',
      type:      'FIXABLE',
      field:     'customfield_10200',
      value:     'Generate acceptance criteria from summary.',
    });
  });

  it('parses an UNFIXABLE line into a classification with guidance', () => {
    const text = 'UNFIXABLE: PROJ-2 | no-assignee | Assign this issue to the responsible engineer before the sprint starts.';
    const results = parseAiAssistClassifications(text);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      issueKey:  'PROJ-2',
      type:      'UNFIXABLE',
      checkId:   'no-assignee',
      guidance:  'Assign this issue to the responsible engineer before the sprint starts.',
    });
  });

  it('parses a mixed block of FIXABLE and UNFIXABLE lines', () => {
    const text = [
      'FIXABLE: PROJ-1 | customfield_10028 | 3',
      'UNFIXABLE: PROJ-2 | no-assignee | Please assign.',
      'FIXABLE: PROJ-3 | customfield_10200 | AC text here.',
    ].join('\n');

    const results = parseAiAssistClassifications(text);
    expect(results).toHaveLength(3);
    expect(results.map((result) => result.issueKey)).toEqual(['PROJ-1', 'PROJ-2', 'PROJ-3']);
    expect(results[0].type).toBe('FIXABLE');
    expect(results[1].type).toBe('UNFIXABLE');
    expect(results[2].type).toBe('FIXABLE');
  });

  it('skips malformed lines that do not match the expected format', () => {
    const text = [
      'FIXABLE: PROJ-1 | customfield_10028 | 3',
      'GARBAGE LINE WITH NO PIPE SEPARATORS',
      'random note from AI Assist',
      'UNFIXABLE: PROJ-2 | no-assignee | Assign it.',
    ].join('\n');

    const results = parseAiAssistClassifications(text);
    // Only the two well-formed lines should survive.
    expect(results).toHaveLength(2);
    expect(results[0].issueKey).toBe('PROJ-1');
    expect(results[1].issueKey).toBe('PROJ-2');
  });

  it('returns an empty array when the input text is empty', () => {
    expect(parseAiAssistClassifications('')).toEqual([]);
  });

  it('returns an empty array when the input text is null or undefined', () => {
    expect(parseAiAssistClassifications(null)).toEqual([]);
    expect(parseAiAssistClassifications(undefined)).toEqual([]);
  });

  it('trims whitespace from all parsed fields', () => {
    const text = 'FIXABLE:  PROJ-10  |  customfield_10200  |  Some long value here.  ';
    const results = parseAiAssistClassifications(text);

    expect(results[0].issueKey).toBe('PROJ-10');
    expect(results[0].field).toBe('customfield_10200');
    expect(results[0].value).toBe('Some long value here.');
  });
});

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
