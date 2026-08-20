// derivedDateFix.test.ts — Writing the dates the policy derives, for one issue and for many.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet, mockSaveField } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockSaveField: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));
vi.mock('../SprintDashboard/featureReviewFixes.ts', () => ({
  saveFeatureReviewSimpleField: mockSaveField,
}));

import {
  applyDerivedDates,
  planDerivedDateWrites,
  readDeterministicDateFixCandidates,
  summariseUndecidedDates,
} from './derivedDateFix.ts';
import type { HygieneFinding, JiraIssue } from './checks/hygieneChecks.ts';
import { resolveHygieneFieldConfig } from './checks/hygieneChecks.ts';

const FIELD_CONFIG = resolveHygieneFieldConfig();

function buildIssue(overrides: Record<string, unknown> = {}, issueKey = 'ENCUC-1') {
  return {
    key: issueKey,
    fields: {
      summary: 'A story',
      issuetype: { name: 'Story' },
      status: { name: 'Ready to Work', statusCategory: { key: 'indeterminate' } },
      fixVersions: [{ name: 'R1', releaseDate: '2026-10-08', released: false }],
      duedate: null,
      ...overrides,
    },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSaveField.mockResolvedValue(undefined);
  mockJiraGet.mockResolvedValue({ changelog: { histories: [] } });
});

describe('planDerivedDateWrites', () => {
  it('plans the due date and target end from the release', async () => {
    const plan = await planDerivedDateWrites(buildIssue(), FIELD_CONFIG);

    expect(plan.writes).toEqual([
      { fieldId: 'duedate', fieldName: 'Due Date', value: '2026-10-08' },
      { fieldId: 'customfield_10102', fieldName: 'Target End', value: '2026-09-17' },
    ]);
  });

  it('predicts Target Start three days after Ready to Work while work has not started', async () => {
    mockJiraGet.mockResolvedValue({
      changelog: {
        histories: [{
          created: '2026-09-04T15:00:00.000+0000',
          items: [{ field: 'status', toString: 'Ready to Work' }],
        }],
      },
    });

    const plan = await planDerivedDateWrites(buildIssue(), FIELD_CONFIG);

    expect(plan.writes).toContainEqual({
      fieldId: 'customfield_10101', fieldName: 'Target Start', value: '2026-09-07',
    });
  });

  it('uses the day work actually started, from the same changelog, in one request', async () => {
    // Both statuses come out of one fetch: asking twice would double the cost of every fix for
    // nothing. Working wins over the Ready-to-Work prediction because it is the fact.
    mockJiraGet.mockResolvedValue({
      changelog: {
        histories: [
          { created: '2026-09-04T15:00:00.000+0000', items: [{ field: 'status', toString: 'Ready to Work' }] },
          { created: '2026-09-09T09:00:00.000+0000', items: [{ field: 'status', toString: 'Working' }] },
        ],
      },
    });

    const plan = await planDerivedDateWrites(buildIssue(), FIELD_CONFIG);

    expect(plan.writes).toContainEqual({
      fieldId: 'customfield_10101', fieldName: 'Target Start', value: '2026-09-09',
    });
    expect(mockJiraGet).toHaveBeenCalledTimes(1);
  });

  it('dates work that skipped Ready to Work entirely, which used to stay undated forever', async () => {
    mockJiraGet.mockResolvedValue({
      changelog: {
        histories: [{ created: '2026-09-09T09:00:00.000+0000', items: [{ field: 'status', toString: 'Working' }] }],
      },
    });

    const plan = await planDerivedDateWrites(buildIssue(), FIELD_CONFIG);

    expect(plan.writes).toContainEqual({
      fieldId: 'customfield_10101', fieldName: 'Target Start', value: '2026-09-09',
    });
  });

  it('plans nothing and explains itself when there is no dated fix version', async () => {
    const plan = await planDerivedDateWrites(buildIssue({ fixVersions: [] }), FIELD_CONFIG);

    expect(plan.writes).toEqual([]);
    expect(plan.undecidedReasons).toContain('no unreleased fix version with a release date');
  });

  it('plans nothing when every date already agrees, so a fix run is a no-op', async () => {
    const plan = await planDerivedDateWrites(
      buildIssue({ duedate: '2026-10-08', customfield_10102: '2026-09-17' }),
      FIELD_CONFIG,
    );

    expect(plan.writes).toEqual([]);
  });
});

describe('applyDerivedDates', () => {
  it('writes every planned field through the shipped writer', async () => {
    const outcome = await applyDerivedDates([buildIssue()], FIELD_CONFIG);

    expect(mockSaveField).toHaveBeenCalledWith('ENCUC-1', 'duedate', '2026-10-08');
    expect(mockSaveField).toHaveBeenCalledWith('ENCUC-1', 'customfield_10102', '2026-09-17');
    expect(outcome.updatedIssueKeys).toEqual(['ENCUC-1']);
    expect(outcome.failures).toEqual([]);
  });

  it('keeps going after one issue fails and reports which one', async () => {
    // A run over a hundred issues must not be undone by one locked field; the honest outcome names
    // what landed and what did not, rather than reporting a whole-run success or failure.
    mockSaveField.mockRejectedValueOnce(new Error('Field is not on the screen'));
    const issues = [buildIssue(), buildIssue({}, 'ENCUC-2')];

    const outcome = await applyDerivedDates(issues, FIELD_CONFIG);

    expect(outcome.failures).toEqual([{ issueKey: 'ENCUC-1', reason: 'Field is not on the screen' }]);
    expect(outcome.updatedIssueKeys).toEqual(['ENCUC-2']);
  });

  it('skips issues with nothing to write instead of touching them', async () => {
    const outcome = await applyDerivedDates(
      [buildIssue({ duedate: '2026-10-08', customfield_10102: '2026-09-17' })],
      FIELD_CONFIG,
    );

    expect(mockSaveField).not.toHaveBeenCalled();
    expect(outcome.updatedIssueKeys).toEqual([]);
  });
});

describe('readDeterministicDateFixCandidates', () => {
  // The bulk button was gated to `dates-out-of-sync` alone, so an issue simply MISSING a date was
  // never offered to it — the one case there was most of. Nothing about those dates needs a person
  // or a model: the policy derives them, and the changelog supplies the start (GH #375).
  function findingWith(issueKey: string, checkIds: string[]): HygieneFinding {
    return {
      issue: { key: issueKey, fields: {} },
      flags: checkIds.map((checkId) => ({ checkId, label: checkId, severity: 'warn' })),
    } as unknown as HygieneFinding;
  }

  it('includes an issue that is simply missing a date, not only one that disagrees', () => {
    const candidates = readDeterministicDateFixCandidates([
      findingWith('TBX-1', ['missing-target-start']),
      findingWith('TBX-2', ['missing-due-date']),
      findingWith('TBX-3', ['missing-target-end']),
      findingWith('TBX-4', ['dates-out-of-sync']),
    ]);

    expect(candidates.map((issue) => issue.key)).toEqual(['TBX-1', 'TBX-2', 'TBX-3', 'TBX-4']);
  });

  it('counts an issue once however many date flags it carries', () => {
    const candidates = readDeterministicDateFixCandidates([
      findingWith('TBX-1', ['missing-due-date', 'missing-target-end', 'dates-out-of-sync']),
    ]);

    expect(candidates).toHaveLength(1);
  });

  it('leaves out an issue with no date flag', () => {
    const candidates = readDeterministicDateFixCandidates([findingWith('TBX-1', ['missing-sp', 'no-ac'])]);

    expect(candidates).toEqual([]);
  });

  it('leaves out the overdue flags, which a date write would only hide', () => {
    // "Due date passed while the issue sat in an early status" is a real state, not a wrong field.
    // Rewriting the date to make the warning go away is the one thing that must never be automatic.
    const candidates = readDeterministicDateFixCandidates([
      findingWith('TBX-1', ['due-date-overdue', 'target-end-overdue', 'target-start-ready']),
    ]);

    expect(candidates).toEqual([]);
  });
});

describe('applyDerivedDates — an issue it cannot date must say why', () => {
  // "Fix all 19 date issue(s)" reported "Updated 0 issue(s)." and nothing else (GH #375). The engine
  // was right — 18 of them were in To Do, and Target Start comes from entering Working or Ready to
  // Work, which a To Do issue has never done — but a button that does nothing and explains nothing
  // is indistinguishable from a broken one, which is exactly how it was read.
  function toDoIssue(issueKey: string): JiraIssue {
    return { key: issueKey, fields: { summary: issueKey, fixVersions: [] } } as unknown as JiraIssue;
  }

  it('reports the reason an issue could not be dated instead of skipping it silently', async () => {
    mockJiraGet.mockResolvedValue({ changelog: { histories: [] } });

    const outcome = await applyDerivedDates([toDoIssue('TBX-1')], FIELD_CONFIG);

    expect(outcome.updatedIssueKeys).toEqual([]);
    expect(outcome.undecided).toHaveLength(1);
    expect(outcome.undecided[0].issueKey).toBe('TBX-1');
    expect(outcome.undecided[0].reasons.join(' ')).toMatch(/Ready to Work|Working/);
  });

  it('does not report an issue it actually wrote to', async () => {
    mockJiraGet.mockResolvedValue({
      changelog: { histories: [{ created: '2026-08-03T10:00:00.000Z', items: [{ field: 'status', toString: 'Working' }] }] },
    });

    const outcome = await applyDerivedDates([toDoIssue('TBX-1')], FIELD_CONFIG);

    expect(outcome.updatedIssueKeys).toEqual(['TBX-1']);
    expect(outcome.undecided).toEqual([]);
  });
});

describe('summariseUndecidedDates', () => {
  it('groups one reason across many issues into a single counted phrase', () => {
    // Nineteen identical lines is a wall; "not yet in Ready to Work or Working (18)" is an answer.
    const summary = summariseUndecidedDates([
      { issueKey: 'TBX-1', reasons: ['not yet in Ready to Work or Working'] },
      { issueKey: 'TBX-2', reasons: ['not yet in Ready to Work or Working'] },
      { issueKey: 'TBX-3', reasons: ['no unreleased fix version with a release date'] },
    ]);

    expect(summary).toContain('not yet in Ready to Work or Working (2)');
    expect(summary).toContain('no unreleased fix version with a release date (1)');
  });

  it('is empty when nothing was left undecided, so the caller can say nothing', () => {
    expect(summariseUndecidedDates([])).toBe('');
  });

  it('counts an issue once per distinct reason it carries', () => {
    const summary = summariseUndecidedDates([
      { issueKey: 'TBX-1', reasons: ['reason A', 'reason B'] },
    ]);

    expect(summary).toContain('reason A (1)');
    expect(summary).toContain('reason B (1)');
  });
});
