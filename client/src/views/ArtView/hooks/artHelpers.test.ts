// artHelpers.test.ts — Unit tests for ART View shared issue helper functions.
// Tests are written before the implementation (TDD) to lock down the expected behaviour
// of every exported helper before any consuming tab relies on it.

import { describe, expect, it } from 'vitest';
import type { JiraIssue } from '../../../types/jira.ts';
import {
  classifyImpedimentStaleness,
  computeCommittedStoryPoints,
  computeDaysSinceUpdate,
  computeMonthlyJiraStats,
  computeVelocityPoints,
  detectImpedimentReasons,
  findPiNameForDate,
  generateMonthlyAccomplishedText,
  generateMonthlyRisksText,
  isImpediment,
  isIssueDone,
  isIssueInProgress,
  parsePiDateRange,
  resolveIssueStoryPoints,
} from './artHelpers.ts';

// ── Minimal test-issue factory ──
// Only supply the fields each test cares about; the factory fills the rest with safe defaults.
function buildTestIssue(fieldOverrides: Partial<JiraIssue['fields']> = {}): JiraIssue {
  return {
    id: 'TEST-1',
    key: 'TEST-1',
    fields: {
      summary: 'Test issue',
      status: { name: 'To Do', statusCategory: { key: 'new' } },
      priority: null,
      assignee: null,
      reporter: null,
      issuetype: { name: 'Story', iconUrl: '' },
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-02T00:00:00.000Z',
      description: null,
      ...fieldOverrides,
    },
  };
}

// ── isIssueDone ──

describe('isIssueDone', () => {
  it('returns true when statusCategory key is "done"', () => {
    const issue = buildTestIssue({ status: { name: 'Done', statusCategory: { key: 'done' } } });
    expect(isIssueDone(issue)).toBe(true);
  });

  it('returns false when statusCategory key is "new"', () => {
    const issue = buildTestIssue({ status: { name: 'To Do', statusCategory: { key: 'new' } } });
    expect(isIssueDone(issue)).toBe(false);
  });

  it('returns false when statusCategory key is "indeterminate"', () => {
    const issue = buildTestIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } });
    expect(isIssueDone(issue)).toBe(false);
  });

  it('falls back to status name "done" (case-insensitive) when statusCategory key is empty', () => {
    const issue = buildTestIssue({ status: { name: 'DONE', statusCategory: { key: '' } } });
    expect(isIssueDone(issue)).toBe(true);
  });

  it('returns false on fallback when status name is not done', () => {
    const issue = buildTestIssue({ status: { name: 'Closed', statusCategory: { key: '' } } });
    expect(isIssueDone(issue)).toBe(false);
  });
});

// ── isIssueInProgress ──

describe('isIssueInProgress', () => {
  it('returns true when statusCategory key is "indeterminate"', () => {
    const issue = buildTestIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } });
    expect(isIssueInProgress(issue)).toBe(true);
  });

  it('returns false for a done issue', () => {
    const issue = buildTestIssue({ status: { name: 'Done', statusCategory: { key: 'done' } } });
    expect(isIssueInProgress(issue)).toBe(false);
  });

  it('falls back to status name "in progress" (case-insensitive) when statusCategory key is empty', () => {
    const issue = buildTestIssue({ status: { name: 'In Progress', statusCategory: { key: '' } } });
    expect(isIssueInProgress(issue)).toBe(true);
  });

  it('falls back to status name "in review" when statusCategory key is empty', () => {
    const issue = buildTestIssue({ status: { name: 'In Review', statusCategory: { key: '' } } });
    expect(isIssueInProgress(issue)).toBe(true);
  });

  it('returns false on fallback when status name is something else', () => {
    const issue = buildTestIssue({ status: { name: 'To Do', statusCategory: { key: '' } } });
    expect(isIssueInProgress(issue)).toBe(false);
  });
});

// ── resolveIssueStoryPoints ──

describe('resolveIssueStoryPoints', () => {
  it('returns customfield_10016 value when present', () => {
    const issue = buildTestIssue({ customfield_10016: 5 });
    expect(resolveIssueStoryPoints(issue)).toBe(5);
  });

  it('falls back to customfield_10028 when customfield_10016 is null', () => {
    const issue = buildTestIssue({ customfield_10016: null, customfield_10028: 3 });
    expect(resolveIssueStoryPoints(issue)).toBe(3);
  });

  it('returns null when both story-point fields are absent', () => {
    const issue = buildTestIssue();
    expect(resolveIssueStoryPoints(issue)).toBeNull();
  });

  it('prefers customfield_10016 over customfield_10028 when both are set', () => {
    const issue = buildTestIssue({ customfield_10016: 8, customfield_10028: 3 });
    expect(resolveIssueStoryPoints(issue)).toBe(8);
  });

  it('returns null when customfield_10016 is null and customfield_10028 is also absent', () => {
    const issue = buildTestIssue({ customfield_10016: null });
    expect(resolveIssueStoryPoints(issue)).toBeNull();
  });

  it('returns 0 when the primary field is explicitly 0', () => {
    // Zero-point issues are valid estimates and should not be treated as absent.
    const issue = buildTestIssue({ customfield_10016: 0 });
    expect(resolveIssueStoryPoints(issue)).toBe(0);
  });
});

// ── computeVelocityPoints ──

describe('computeVelocityPoints', () => {
  it('sums story points of done issues only', () => {
    const issues = [
      buildTestIssue({ status: { name: 'Done', statusCategory: { key: 'done' } }, customfield_10016: 5 }),
      buildTestIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, customfield_10016: 3 }),
    ];
    expect(computeVelocityPoints(issues)).toBe(5);
  });

  it('returns 0 when no done issues exist', () => {
    const issues = [
      buildTestIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, customfield_10016: 5 }),
    ];
    expect(computeVelocityPoints(issues)).toBe(0);
  });

  it('uses the fallback story-point field when primary is null on a done issue', () => {
    const issues = [
      buildTestIssue({ status: { name: 'Done', statusCategory: { key: 'done' } }, customfield_10016: null, customfield_10028: 8 }),
    ];
    expect(computeVelocityPoints(issues)).toBe(8);
  });

  it('treats unestimated done issues as 0 points', () => {
    const issues = [
      buildTestIssue({ status: { name: 'Done', statusCategory: { key: 'done' } } }),
    ];
    expect(computeVelocityPoints(issues)).toBe(0);
  });

  it('returns 0 for an empty issue list', () => {
    expect(computeVelocityPoints([])).toBe(0);
  });

  it('sums across multiple done issues', () => {
    const issues = [
      buildTestIssue({ status: { name: 'Done', statusCategory: { key: 'done' } }, customfield_10016: 5 }),
      buildTestIssue({ status: { name: 'Done', statusCategory: { key: 'done' } }, customfield_10016: 3 }),
      buildTestIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, customfield_10016: 8 }),
    ];
    expect(computeVelocityPoints(issues)).toBe(8);
  });
});

// ── computeCommittedStoryPoints ──

describe('computeCommittedStoryPoints', () => {
  it('sums story points across all issues regardless of status', () => {
    const issues = [
      buildTestIssue({ customfield_10016: 5 }),
      buildTestIssue({ customfield_10016: 3 }),
    ];
    expect(computeCommittedStoryPoints(issues)).toBe(8);
  });

  it('includes both done and in-progress issues in the total', () => {
    const issues = [
      buildTestIssue({ status: { name: 'Done', statusCategory: { key: 'done' } }, customfield_10016: 5 }),
      buildTestIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, customfield_10016: 3 }),
    ];
    expect(computeCommittedStoryPoints(issues)).toBe(8);
  });

  it('returns 0 when all issues are unestimated', () => {
    expect(computeCommittedStoryPoints([buildTestIssue(), buildTestIssue()])).toBe(0);
  });

  it('returns 0 for an empty issue list', () => {
    expect(computeCommittedStoryPoints([])).toBe(0);
  });

  it('uses the fallback story-point field for unestimated primary field', () => {
    const issues = [
      buildTestIssue({ customfield_10016: null, customfield_10028: 5 }),
    ];
    expect(computeCommittedStoryPoints(issues)).toBe(5);
  });
});

// ── detectImpedimentReasons ──

describe('detectImpedimentReasons', () => {
  it('returns an empty array for a clean issue with no impediment signals', () => {
    expect(detectImpedimentReasons(buildTestIssue())).toEqual([]);
  });

  it('detects "Blocked Status" when status name contains "block"', () => {
    const issue = buildTestIssue({ status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } } });
    expect(detectImpedimentReasons(issue)).toContain('Blocked Status');
  });

  it('detects "Blocked Status" for multi-word statuses like "Blocked – Waiting"', () => {
    const issue = buildTestIssue({ status: { name: 'Blocked – Waiting', statusCategory: { key: 'indeterminate' } } });
    expect(detectImpedimentReasons(issue)).toContain('Blocked Status');
  });

  it('detects "Flagged" when customfield_10021 is boolean true', () => {
    const issue = buildTestIssue({ customfield_10021: true });
    expect(detectImpedimentReasons(issue)).toContain('Flagged');
  });

  it('detects "Flagged" when customfield_10021 is a non-empty string', () => {
    const issue = buildTestIssue({ customfield_10021: 'Impediment' });
    expect(detectImpedimentReasons(issue)).toContain('Flagged');
  });

  it('does not detect "Flagged" when customfield_10021 is false', () => {
    const issue = buildTestIssue({ customfield_10021: false });
    expect(detectImpedimentReasons(issue)).not.toContain('Flagged');
  });

  it('does not detect "Flagged" when customfield_10021 is null', () => {
    const issue = buildTestIssue({ customfield_10021: null });
    expect(detectImpedimentReasons(issue)).not.toContain('Flagged');
  });

  it('detects "Label" when the issue carries a "blocked" label', () => {
    const issue = buildTestIssue({ labels: ['blocked'] });
    expect(detectImpedimentReasons(issue)).toContain('Label');
  });

  it('detects "Label" when the issue carries an "impediment" label', () => {
    const issue = buildTestIssue({ labels: ['impediment'] });
    expect(detectImpedimentReasons(issue)).toContain('Label');
  });

  it('does not detect "Label" for unrelated labels', () => {
    const issue = buildTestIssue({ labels: ['tech-debt', 'needs-review'] });
    expect(detectImpedimentReasons(issue)).not.toContain('Label');
  });

  it('detects "Blocked Link" when an open inward issue has a blocking link type', () => {
    const issue = buildTestIssue({
      issuelinks: [
        {
          type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
          inwardIssue: { key: 'TBX-99', fields: { summary: 'Blocker story', status: { name: 'In Progress' } } },
        },
      ],
    });
    expect(detectImpedimentReasons(issue)).toContain('Blocked Link');
  });

  it('does not detect "Blocked Link" when the linked inward issue is done', () => {
    const issue = buildTestIssue({
      issuelinks: [
        {
          type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
          inwardIssue: { key: 'TBX-99', fields: { summary: 'Old blocker', status: { name: 'Done' } } },
        },
      ],
    });
    expect(detectImpedimentReasons(issue)).not.toContain('Blocked Link');
  });

  it('does not detect "Blocked Link" when issuelinks is absent', () => {
    expect(detectImpedimentReasons(buildTestIssue())).not.toContain('Blocked Link');
  });

  it('can return multiple reasons simultaneously', () => {
    const issue = buildTestIssue({
      status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } },
      customfield_10021: true,
      labels: ['blocked'],
    });
    const reasons = detectImpedimentReasons(issue);
    expect(reasons).toContain('Blocked Status');
    expect(reasons).toContain('Flagged');
    expect(reasons).toContain('Label');
  });
});

// ── isImpediment ──

describe('isImpediment', () => {
  it('returns false for a clean issue with no impediment signals', () => {
    expect(isImpediment(buildTestIssue())).toBe(false);
  });

  it('returns true when the flagged field is set', () => {
    expect(isImpediment(buildTestIssue({ customfield_10021: true }))).toBe(true);
  });

  it('returns true when the status name includes "block"', () => {
    expect(isImpediment(buildTestIssue({ status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } } }))).toBe(true);
  });
});

// ── computeDaysSinceUpdate ──

describe('computeDaysSinceUpdate', () => {
  it('returns 0 when the issue was updated right now', () => {
    const nowMs = Date.now();
    const issue = buildTestIssue({ updated: new Date(nowMs).toISOString() });
    expect(computeDaysSinceUpdate(issue, nowMs)).toBe(0);
  });

  it('returns 1 when the issue was updated exactly 1 day ago', () => {
    const nowMs = Date.now();
    const oneDayAgoMs = nowMs - 1000 * 60 * 60 * 24;
    const issue = buildTestIssue({ updated: new Date(oneDayAgoMs).toISOString() });
    expect(computeDaysSinceUpdate(issue, nowMs)).toBe(1);
  });

  it('returns 5 when the issue was updated 5 days ago', () => {
    const nowMs = Date.now();
    const fiveDaysAgoMs = nowMs - 5 * 1000 * 60 * 60 * 24;
    const issue = buildTestIssue({ updated: new Date(fiveDaysAgoMs).toISOString() });
    expect(computeDaysSinceUpdate(issue, nowMs)).toBe(5);
  });

  it('returns 0 (not negative) when the updated field is in the future', () => {
    const nowMs = Date.now();
    const futureMs = nowMs + 1000 * 60 * 60 * 24;
    const issue = buildTestIssue({ updated: new Date(futureMs).toISOString() });
    expect(computeDaysSinceUpdate(issue, nowMs)).toBe(0);
  });

  it('uses Date.now() when nowMs is omitted (smoke test — result must be >= 0)', () => {
    const issue = buildTestIssue({ updated: '2020-01-01T00:00:00.000Z' });
    expect(computeDaysSinceUpdate(issue)).toBeGreaterThan(0);
  });
});

// ── classifyImpedimentStaleness ──

describe('classifyImpedimentStaleness', () => {
  it('returns "fresh" when days is below the threshold', () => {
    expect(classifyImpedimentStaleness(3, 5)).toBe('fresh');
  });

  it('returns "stale" when days equals the threshold', () => {
    expect(classifyImpedimentStaleness(5, 5)).toBe('stale');
  });

  it('returns "stale" when days is above threshold but below 2× threshold', () => {
    expect(classifyImpedimentStaleness(7, 5)).toBe('stale');
  });

  it('returns "critical" when days equals 2× the threshold', () => {
    expect(classifyImpedimentStaleness(10, 5)).toBe('critical');
  });

  it('returns "critical" when days exceeds 2× the threshold', () => {
    expect(classifyImpedimentStaleness(20, 5)).toBe('critical');
  });

  it('returns "fresh" when days is 0', () => {
    expect(classifyImpedimentStaleness(0, 5)).toBe('fresh');
  });
});

// ── Program Increment date helpers ──

describe('parsePiDateRange', () => {
  it('returns start and end dates for a PI label with an embedded date range', () => {
    const parsedDateRange = parsePiDateRange('PI 26.3 (05/21/26 - 07/29/26)');

    expect(parsedDateRange).not.toBeNull();
    expect(parsedDateRange?.startDate.getFullYear()).toBe(2026);
    expect(parsedDateRange?.startDate.getMonth()).toBe(4);
    expect(parsedDateRange?.startDate.getDate()).toBe(21);
    expect(parsedDateRange?.endDate.getFullYear()).toBe(2026);
    expect(parsedDateRange?.endDate.getMonth()).toBe(6);
    expect(parsedDateRange?.endDate.getDate()).toBe(29);
  });

  it('returns null when the PI label does not contain a date range', () => {
    expect(parsePiDateRange('PI 26.3')).toBeNull();
  });

  it('supports four-digit years in the embedded PI date range', () => {
    const parsedDateRange = parsePiDateRange('PI 2026.3 (05/21/2026 - 07/29/2026)');

    expect(parsedDateRange?.startDate.getFullYear()).toBe(2026);
    expect(parsedDateRange?.endDate.getFullYear()).toBe(2026);
  });
});

describe('findPiNameForDate', () => {
  it('returns the PI whose date range covers the supplied day', () => {
    const matchedPiName = findPiNameForDate(
      ['PI 26.2 (02/26/26 - 04/29/26)', 'PI 26.3 (05/21/26 - 07/29/26)'],
      new Date(2026, 5, 1),
    );

    expect(matchedPiName).toBe('PI 26.3 (05/21/26 - 07/29/26)');
  });

  it('treats the PI start and end dates as inclusive', () => {
    expect(
      findPiNameForDate(['PI 26.3 (05/21/26 - 07/29/26)'], new Date(2026, 4, 21)),
    ).toBe('PI 26.3 (05/21/26 - 07/29/26)');
    expect(
      findPiNameForDate(['PI 26.3 (05/21/26 - 07/29/26)'], new Date(2026, 6, 29)),
    ).toBe('PI 26.3 (05/21/26 - 07/29/26)');
  });

  it('returns null when no available PI covers the supplied day', () => {
    const matchedPiName = findPiNameForDate(
      ['PI 26.2 (02/26/26 - 04/29/26)', 'PI 26.4 (08/13/26 - 10/28/26)'],
      new Date(2026, 5, 1),
    );

    expect(matchedPiName).toBeNull();
  });

  it('skips PI labels that do not contain a parseable date range', () => {
    const matchedPiName = findPiNameForDate(
      ['PI Legacy', 'PI 26.3 (05/21/26 - 07/29/26)'],
      new Date(2026, 5, 1),
    );

    expect(matchedPiName).toBe('PI 26.3 (05/21/26 - 07/29/26)');
  });
});

// ── computeMonthlyJiraStats ──

describe('computeMonthlyJiraStats', () => {
  it('returns all-zero stats for an empty issue list', () => {
    const stats = computeMonthlyJiraStats([]);
    expect(stats.totalIssueCount).toBe(0);
    expect(stats.doneIssueCount).toBe(0);
    expect(stats.velocityPoints).toBe(0);
    expect(stats.committedPoints).toBe(0);
    expect(stats.completionPercent).toBe(0);
    expect(stats.impedimentCount).toBe(0);
  });

  it('counts done issues and computes completion percent', () => {
    const issues = [
      buildTestIssue({ status: { name: 'Done', statusCategory: { key: 'done' } } }),
      buildTestIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }),
      buildTestIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }),
      buildTestIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }),
    ];
    const stats = computeMonthlyJiraStats(issues);
    expect(stats.totalIssueCount).toBe(4);
    expect(stats.doneIssueCount).toBe(1);
    expect(stats.completionPercent).toBe(25);
  });

  it('sums velocity points from done issues only', () => {
    const issues = [
      buildTestIssue({ status: { name: 'Done', statusCategory: { key: 'done' } }, customfield_10016: 5 }),
      buildTestIssue({ status: { name: 'Done', statusCategory: { key: 'done' } }, customfield_10016: 3 }),
      buildTestIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, customfield_10016: 8 }),
    ];
    const stats = computeMonthlyJiraStats(issues);
    expect(stats.velocityPoints).toBe(8); // only done issues
  });

  it('sums committed points across all issues', () => {
    const issues = [
      buildTestIssue({ customfield_10016: 5 }),
      buildTestIssue({ customfield_10016: 3 }),
    ];
    const stats = computeMonthlyJiraStats(issues);
    expect(stats.committedPoints).toBe(8);
  });

  it('counts impediments using the four-signal detection', () => {
    const issues = [
      buildTestIssue({ customfield_10021: true }), // flagged
      buildTestIssue({ status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } } }), // blocked status
      buildTestIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }), // clean
    ];
    const stats = computeMonthlyJiraStats(issues);
    expect(stats.impedimentCount).toBe(2);
  });

  it('returns completionPercent of 100 when all issues are done', () => {
    const issues = [
      buildTestIssue({ status: { name: 'Done', statusCategory: { key: 'done' } } }),
      buildTestIssue({ status: { name: 'Done', statusCategory: { key: 'done' } } }),
    ];
    expect(computeMonthlyJiraStats(issues).completionPercent).toBe(100);
  });
});

// ── generateMonthlyAccomplishedText ──

describe('generateMonthlyAccomplishedText', () => {
  it('returns an empty string when no issues are done', () => {
    const issues = [
      buildTestIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }),
    ];
    expect(generateMonthlyAccomplishedText(issues)).toBe('');
  });

  it('returns an empty string for an empty issue list', () => {
    expect(generateMonthlyAccomplishedText([])).toBe('');
  });

  it('formats a single done issue as a bullet line', () => {
    const issue = buildTestIssue({
      status: { name: 'Done', statusCategory: { key: 'done' } },
    });
    // Use the default key 'TEST-1' and summary 'Test issue' from the factory.
    const result = generateMonthlyAccomplishedText([issue]);
    expect(result).toBe('• TEST-1: Test issue');
  });

  it('includes all done issues when count is within the cap', () => {
    const issues = [
      buildTestIssue({ status: { name: 'Done', statusCategory: { key: 'done' } } }),
      buildTestIssue({ status: { name: 'Done', statusCategory: { key: 'done' } } }),
    ];
    const lines = generateMonthlyAccomplishedText(issues).split('\n');
    expect(lines).toHaveLength(2);
  });

  it('omits non-done issues from the generated text', () => {
    const issues = [
      buildTestIssue({ status: { name: 'Done', statusCategory: { key: 'done' } } }),
      buildTestIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }),
    ];
    const lines = generateMonthlyAccomplishedText(issues).split('\n');
    // Only the done issue should appear.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('TEST-1');
  });

  it('appends an overflow line when done count exceeds 10', () => {
    // Build 11 done issues — one above the cap.
    const doneIssues = Array.from({ length: 11 }, () =>
      buildTestIssue({
        status: { name: 'Done', statusCategory: { key: 'done' } },
      }),
    );
    const lines = generateMonthlyAccomplishedText(doneIssues).split('\n');
    // 10 bullets + 1 overflow line.
    expect(lines).toHaveLength(11);
    expect(lines[10]).toContain('…and 1 more');
  });
});

// ── generateMonthlyRisksText ──

describe('generateMonthlyRisksText', () => {
  it('returns an empty string when no impediments are detected', () => {
    const issues = [
      buildTestIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }),
    ];
    expect(generateMonthlyRisksText(issues)).toBe('');
  });

  it('returns an empty string for an empty issue list', () => {
    expect(generateMonthlyRisksText([])).toBe('');
  });

  it('formats a single flagged issue as a bullet line', () => {
    const issue = buildTestIssue({ customfield_10021: true });
    const result = generateMonthlyRisksText([issue]);
    expect(result).toBe('• TEST-1: Test issue');
  });

  it('includes all impediment signals — blocked status, flagged, label', () => {
    const issues = [
      buildTestIssue({ status: { name: 'Blocked', statusCategory: { key: 'indeterminate' } } }),
      buildTestIssue({ customfield_10021: true }),
      buildTestIssue({ labels: ['impediment'] }),
      buildTestIssue({ status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } }),
    ];
    const lines = generateMonthlyRisksText(issues).split('\n');
    // 3 impediment issues, 1 clean issue.
    expect(lines).toHaveLength(3);
  });

  it('includes done issues when they still match impediment signals', () => {
    // generateMonthlyRisksText delegates to isImpediment which checks all signals.
    // The done status does NOT suppress the impediment flag — both can coexist.
    // This test verifies the actual behaviour rather than an assumed filter.
    const issue = buildTestIssue({
      status: { name: 'Done', statusCategory: { key: 'done' } },
      customfield_10021: true,
    });
    const result = generateMonthlyRisksText([issue]);
    // isImpediment only checks flag/status/label/link — not whether the item is done.
    // The risks text faithfully surfaces everything isImpediment returns.
    expect(result).toContain('TEST-1');
  });
});
