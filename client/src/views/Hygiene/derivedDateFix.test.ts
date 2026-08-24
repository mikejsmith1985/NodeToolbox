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
  countUnfixableDateIssues,
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
    expect(plan.undecidedReasons).toContain('no fix version set on the issue');
  });

  it('says WHICH release is undated, because that is fixed once for every issue on it', async () => {
    const plan = await planDerivedDateWrites(buildIssue({ fixVersions: [{ name: '2026.09' }] }), FIELD_CONFIG);

    expect(plan.writes).toEqual([]);
    expect(plan.undecidedReasons).toContain('fix version has no release date in Jira (2026.09)');
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
      { issueKey: 'TBX-3', reasons: ['no fix version set on the issue'] },
    ]);

    expect(summary).toContain('not yet in Ready to Work or Working (2)');
    expect(summary).toContain('no fix version set on the issue (1)');
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

describe('summariseUndecidedDates — the keys are what make it actionable', () => {
  it('names the issues behind each reason', () => {
    // "4 could not be dated" told the user there was a problem and gave them nowhere to go.
    const summary = summariseUndecidedDates([
      { issueKey: 'ENFCT-1', reasons: ['not yet in Ready to Work or Working'] },
      { issueKey: 'ENFCT-2', reasons: ['not yet in Ready to Work or Working'] },
    ]);

    expect(summary).toContain('ENFCT-1, ENFCT-2');
  });

  it('caps a very long list but keeps the count honest', () => {
    const many = Array.from({ length: 30 }, (_unused, index) => ({
      issueKey: `ENFCT-${index + 1}`,
      reasons: ['no fix version set on the issue'],
    }));

    const summary = summariseUndecidedDates(many);

    expect(summary).toContain('(30)');
    expect(summary).toContain('+18 more');
  });
});

describe('the forecast context', () => {
  // Optional everywhere. The point of these tests is that a caller which supplies nothing still
  // gets exactly the dates it got before the forecast existed.

  const PLAIN_CALENDAR = { weekendDays: [0, 6], holidayIsoDates: [] };

  it('works the Target Start back from the effort when a context is supplied', () => {
    // Release 2026-10-08 gives a code freeze of 2026-09-17; three days back is 2026-09-15.
    return planDerivedDateWrites(buildIssue(), FIELD_CONFIG, {
      remainingEffortWorkingDaysByKey: { 'ENCUC-1': 3 },
      workingCalendar: PLAIN_CALENDAR,
    }).then((plan) => {
      const targetStartWrite = plan.writes.find((write) => write.fieldName === 'Target Start');
      expect(targetStartWrite?.value).toBe('2026-09-15');
      expect(plan.targetStartBasis).toBe('back-calculated');
    });
  });

  it('falls back to the old rule for an issue the context says nothing about', async () => {
    mockJiraGet.mockResolvedValue({
      changelog: { histories: [{ created: '2026-08-10T09:00:00.000Z', items: [{ field: 'status', toString: 'Ready to Work' }] }] },
    });

    const plan = await planDerivedDateWrites(buildIssue(), FIELD_CONFIG, {
      remainingEffortWorkingDaysByKey: { 'SOMEONE-ELSE-9': 3 },
      workingCalendar: PLAIN_CALENDAR,
    });

    expect(plan.targetStartBasis).toBe('ready-to-work-lead');
  });

  it('lets the day work actually began win over the calculation', async () => {
    mockJiraGet.mockResolvedValue({
      changelog: { histories: [{ created: '2026-08-03T09:00:00.000Z', items: [{ field: 'status', toString: 'Working' }] }] },
    });

    const plan = await planDerivedDateWrites(buildIssue(), FIELD_CONFIG, {
      remainingEffortWorkingDaysByKey: { 'ENCUC-1': 3 },
      workingCalendar: PLAIN_CALENDAR,
    });

    expect(plan.targetStartBasis).toBe('actual-working');
  });

  it('still works when the changelog fetch fails', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira is down'));

    const plan = await planDerivedDateWrites(buildIssue(), FIELD_CONFIG, {
      remainingEffortWorkingDaysByKey: { 'ENCUC-1': 3 },
      workingCalendar: PLAIN_CALENDAR,
    });

    // No changelog means no actual start day, so the back-calculation is what is left — and it is
    // better than the nothing this issue would otherwise have had.
    expect(plan.targetStartBasis).toBe('back-calculated');
  });

  it('reports how many Target Starts each rule produced', async () => {
    mockJiraGet.mockResolvedValue({ changelog: { histories: [] } });
    mockSaveField.mockResolvedValue(undefined);

    const outcome = await applyDerivedDates(
      [buildIssue({}, 'ENCUC-1'), buildIssue({}, 'ENCUC-2')],
      FIELD_CONFIG,
      { remainingEffortWorkingDaysByKey: { 'ENCUC-1': 3 }, workingCalendar: PLAIN_CALENDAR },
    );

    // One date worked back from real effort, one issue that could not be dated at all. Reporting
    // only "2 updated" would hide the difference between a plan and a placeholder.
    expect(outcome.targetStartBasisCounts['back-calculated']).toBe(1);
  });

  it('behaves exactly as before when no context is given at all', async () => {
    mockJiraGet.mockResolvedValue({
      changelog: { histories: [{ created: '2026-08-10T09:00:00.000Z', items: [{ field: 'status', toString: 'Ready to Work' }] }] },
    });

    const plan = await planDerivedDateWrites(buildIssue(), FIELD_CONFIG);

    expect(plan.writes.find((write) => write.fieldName === 'Target Start')?.value).toBe('2026-08-13');
    expect(plan.targetStartBasis).toBe('ready-to-work-lead');
  });
});

describe('summariseUndecidedDates — rolled up by release, not by issue', () => {
  it('collapses every issue blocked by one undated release into a single line naming it', () => {
    // The whole point: this is fixed ONCE, in Jira's release admin, and it unblocks all three of
    // these at the same moment. Seven issue-level failures hid that it was one job.
    const summary = summariseUndecidedDates([
      { issueKey: 'ENCUC-2198', reasons: ['fix version has no release date in Jira (2026.09)'] },
      { issueKey: 'ENCUC-2196', reasons: ['fix version has no release date in Jira (2026.09)'] },
      { issueKey: 'ENCUC-2170', reasons: ['fix version has no release date in Jira (2026.09)'] },
    ]);

    expect(summary).toBe(
      'fix version has no release date in Jira (2026.09) (3): ENCUC-2198, ENCUC-2196, ENCUC-2170',
    );
  });

  it('keeps different releases apart, because they are different jobs for different people', () => {
    const summary = summariseUndecidedDates([
      { issueKey: 'ENCUC-1', reasons: ['fix version has no release date in Jira (2026.09)'] },
      { issueKey: 'ENCUC-2', reasons: ['fix version has no release date in Jira (2026.12)'] },
    ]);

    expect(summary).toContain('(2026.09) (1): ENCUC-1');
    expect(summary).toContain('(2026.12) (1): ENCUC-2');
  });

  it('separates a missing release from an undated one — the two need different fixes', () => {
    const summary = summariseUndecidedDates([
      { issueKey: 'ENCUC-1', reasons: ['no fix version set on the issue'] },
      { issueKey: 'ENCUC-2', reasons: ['fix version has no release date in Jira (2026.09)'] },
    ]);

    expect(summary).toContain('no fix version set on the issue (1): ENCUC-1');
    expect(summary).toContain('fix version has no release date in Jira (2026.09) (1): ENCUC-2');
  });
});

describe('countUnfixableDateIssues', () => {
  function findingWith(issueKey: string, checkIds: string[]): HygieneFinding {
    return {
      issue: { key: issueKey, fields: { summary: issueKey } },
      flags: checkIds.map((checkId) => ({ checkId, label: checkId, severity: 'warn' as const })),
    } as unknown as HygieneFinding;
  }

  it('counts the overdue-date issues the button deliberately leaves alone', () => {
    // The board showed seven date flags and the button offered to fix one, with nothing on screen
    // saying the two figures measure different things — so it read as broken (GH #375).
    const count = countUnfixableDateIssues([
      findingWith('ENFCT-1', ['target-end-overdue']),
      findingWith('ENFCT-2', ['due-date-overdue']),
      findingWith('ENFCT-3', ['target-start-ready']),
    ]);

    expect(count).toBe(3);
  });

  it('does not count an issue that also has something fixable', () => {
    // It is already in the button-s set; counting it twice would make the two figures overlap.
    const count = countUnfixableDateIssues([
      findingWith('ENFCT-1', ['target-end-overdue', 'missing-target-end']),
    ]);

    expect(count).toBe(0);
  });

  it('ignores flags that are not about dates at all', () => {
    expect(countUnfixableDateIssues([findingWith('ENFCT-1', ['missing-sp', 'no-assignee'])])).toBe(0);
  });

  it('counts an issue once however many overdue flags it carries', () => {
    const count = countUnfixableDateIssues([
      findingWith('ENFCT-1', ['target-end-overdue', 'due-date-overdue']),
    ]);

    expect(count).toBe(1);
  });

  it('is zero for an empty scan', () => {
    expect(countUnfixableDateIssues([])).toBe(0);
  });
});
