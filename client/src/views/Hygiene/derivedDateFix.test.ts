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

import { applyDerivedDates, planDerivedDateWrites } from './derivedDateFix.ts';
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

  it('adds Target Start once the changelog shows when Ready to Work was reached', async () => {
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
      fieldId: 'customfield_10101', fieldName: 'Target Start', value: '2026-09-08',
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
