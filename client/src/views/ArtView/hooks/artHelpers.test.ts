// artHelpers.test.ts — Unit tests for ART View shared issue helper functions.
// Tests are written before the implementation (TDD) to lock down the expected behaviour
// of every exported helper before any consuming tab relies on it.

import { describe, expect, it } from 'vitest';
import type { JiraIssue } from '../../../types/jira.ts';
import {
  computeCommittedStoryPoints,
  computeVelocityPoints,
  detectImpedimentReasons,
  isImpediment,
  isIssueDone,
  isIssueInProgress,
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
