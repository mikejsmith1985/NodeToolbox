// hygieneChecks.test.ts — Unit tests for the Hygiene issue-health predicates.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkMissingFeatureLink,
  checkMissingProgramIncrement,
  checkTargetEndOverdue,
  checkTargetStartReady,
  checkDueDateOverdue,
  checkMissingTargetStart,
  checkMissingTargetEnd,
  checkMissingStoryPoints,
  checkNoAcceptanceCriteria,
  checkNoAssignee,
  checkOldInSprint,
  checkStaleIssue,
  evaluateHygieneIssue,
  resolveHygieneFieldConfig,
  summarizeHygieneFindings,
  type JiraIssue,
} from './hygieneChecks.ts';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const ACTIVE_STATUS = { name: 'In Progress', statusCategory: { key: 'indeterminate' } };
const TODO_STATUS = { name: 'To Do', statusCategory: { key: 'new' } };
const DONE_STATUS = { name: 'Done', statusCategory: { key: 'done' } };

function buildDateDaysAgo(dayCount: number): string {
  return new Date(Date.now() - dayCount * MILLISECONDS_PER_DAY).toISOString();
}

function buildIssue(overrides: Partial<JiraIssue['fields']> = {}): JiraIssue {
  return {
    key: 'TBX-101',
    fields: {
      summary: 'Sample issue',
      status: TODO_STATUS,
      assignee: { displayName: 'Alex' },
      issuetype: { name: 'Story' },
      created: buildDateDaysAgo(5),
      updated: buildDateDaysAgo(1),
      description: 'Given a user opens the tool, when they run hygiene, then issues are reviewed.',
      customfield_10108: 'FEAT-10',
      customfield_10028: 3,
      customfield_10016: null,
      customfield_10020: [],
      ...overrides,
    },
  };
}

describe('hygiene check predicates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flags Story issues when both story-point fields are empty', () => {
    const hygieneFlag = checkMissingStoryPoints(buildIssue({ customfield_10028: null, customfield_10016: null }));

    expect(hygieneFlag?.checkId).toBe('missing-sp');
  });

  it('does not flag Bugs for missing story points', () => {
    const hygieneFlag = checkMissingStoryPoints(
      buildIssue({ issuetype: { name: 'Bug' }, customfield_10028: null, customfield_10016: null }),
    );

    expect(hygieneFlag).toBeNull();
  });

  it('does not flag Risk issues for missing story points because that field does not exist on the Risk screen', () => {
    const hygieneFlag = checkMissingStoryPoints(
      buildIssue({ issuetype: { name: 'Risk' }, customfield_10028: null, customfield_10016: null }),
    );

    expect(hygieneFlag).toBeNull();
  });

  it('flags in-progress issues that have not been updated for more than fourteen days', () => {
    const hygieneFlag = checkStaleIssue(buildIssue({ status: ACTIVE_STATUS, updated: buildDateDaysAgo(15) }));

    expect(hygieneFlag?.checkId).toBe('stale');
  });

  it('does not flag recently updated in-progress issues as stale', () => {
    const hygieneFlag = checkStaleIssue(buildIssue({ status: ACTIVE_STATUS, updated: buildDateDaysAgo(3) }));

    expect(hygieneFlag).toBeNull();
  });

  it('flags in-progress issues with no assignee', () => {
    const hygieneFlag = checkNoAssignee(buildIssue({ status: ACTIVE_STATUS, assignee: null }));

    expect(hygieneFlag?.checkId).toBe('no-assignee');
  });

  it('does not flag completed issues that no longer need an assignee', () => {
    const hygieneFlag = checkNoAssignee(buildIssue({ status: DONE_STATUS, assignee: null }));

    expect(hygieneFlag).toBeNull();
  });

  it('flags child delivery issues that are missing the feature link', () => {
    const fieldConfig = resolveHygieneFieldConfig();
    const hygieneFlag = checkMissingFeatureLink(buildIssue({ customfield_10108: null }), fieldConfig);

    expect(hygieneFlag?.checkId).toBe('missing-feature-link');
  });

  it('flags stories whose acceptance criteria is blank', () => {
    const hygieneFlag = checkNoAcceptanceCriteria(buildIssue({ description: '   ' }), resolveHygieneFieldConfig());

    expect(hygieneFlag?.checkId).toBe('no-ac');
  });

  it('does not flag stories with a Given When Then description', () => {
    const hygieneFlag = checkNoAcceptanceCriteria(
      buildIssue({ description: 'Given a release manager opens the report, when data loads, then risks are visible.' }),
      resolveHygieneFieldConfig(),
    );

    expect(hygieneFlag).toBeNull();
  });

  it('does not flag stories with descriptive acceptance criteria text that does not use Given When Then wording', () => {
    const hygieneFlag = checkNoAcceptanceCriteria(
      buildIssue({
        description: 'Demonstrate the ability to correctly determine whether the member identifier already exists and use that result to distinguish new enrollment from an update.',
      }),
      resolveHygieneFieldConfig(),
    );

    expect(hygieneFlag).toBeNull();
  });

  it('flags stories whose acceptance criteria is only a TBD placeholder', () => {
    const hygieneFlag = checkNoAcceptanceCriteria(
      buildIssue({ description: 'TBD' }),
      resolveHygieneFieldConfig(),
    );

    expect(hygieneFlag?.checkId).toBe('no-ac');
  });

  it('flags active-sprint issues created more than thirty days ago', () => {
    const hygieneFlag = checkOldInSprint(
      buildIssue({ created: buildDateDaysAgo(31), customfield_10020: [{ id: 10, state: 'active' }] }),
    );

    expect(hygieneFlag?.checkId).toBe('old-in-sprint');
  });

  it('does not flag completed issues even when they remain in an active sprint', () => {
    const hygieneFlag = checkOldInSprint(
      buildIssue({ status: DONE_STATUS, created: buildDateDaysAgo(60), customfield_10020: [{ state: 'active' }] }),
    );

    expect(hygieneFlag).toBeNull();
  });

  it('evaluates multiple flags for the same unhealthy active issue', () => {
    const flags = evaluateHygieneIssue(
      buildIssue({
        status: ACTIVE_STATUS,
        assignee: null,
        updated: buildDateDaysAgo(20),
        customfield_10108: 'FEAT-10',
        customfield_10028: null,
        customfield_10016: null,
      }),
    );

    expect(flags.map((flag) => flag.checkId)).toEqual(expect.arrayContaining(['missing-sp', 'stale', 'no-assignee']));
  });

  it('flags feature issues that are missing PI and target dates', () => {
    const featureIssue = buildIssue({
      issuetype: { name: 'Feature' },
      customfield_10301: null,
      customfield_10101: null,
      customfield_10102: null,
      fixVersions: [],
      duedate: null,
    });
    const fieldConfig = resolveHygieneFieldConfig();

    expect(checkMissingProgramIncrement(featureIssue, fieldConfig)?.checkId).toBe('missing-pi');
    expect(checkMissingTargetStart(featureIssue, fieldConfig)?.checkId).toBe('missing-target-start');
    expect(checkMissingTargetEnd(featureIssue, fieldConfig)?.checkId).toBe('missing-target-end');
  });

  it('flags features whose Target Start has arrived while the feature is still To Do', () => {
    const featureIssue = buildIssue({
      issuetype: { name: 'Feature' },
      status: { name: 'To Do', statusCategory: { key: 'new', name: 'To Do' } },
      customfield_10101: new Date().toISOString().slice(0, 10),
    });

    expect(checkTargetStartReady(featureIssue, resolveHygieneFieldConfig())?.checkId).toBe('target-start-ready');
  });

  it('flags features whose Target End has arrived before leaving To Do or Implementing', () => {
    const featureIssue = buildIssue({
      issuetype: { name: 'Feature' },
      status: { name: 'Implementing', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
      customfield_10102: new Date().toISOString().slice(0, 10),
    });

    expect(checkTargetEndOverdue(featureIssue, resolveHygieneFieldConfig())?.checkId).toBe('target-end-overdue');
  });

  it('flags features whose Due Date has arrived before completion', () => {
    const featureIssue = buildIssue({
      issuetype: { name: 'Feature' },
      status: { name: 'Implementing', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
      duedate: '2026-07-15',
    });

    expect(checkDueDateOverdue(featureIssue)?.checkId).toBe('due-date-overdue');
  });

  it('treats Jira date-only strings as the same calendar day instead of shifting by timezone', () => {
    const featureIssue = buildIssue({
      issuetype: { name: 'Feature' },
      status: { name: 'Implementing', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
      duedate: '2026-07-16',
    });

    expect(checkDueDateOverdue(featureIssue)).toBeNull();
  });

  it('supports enabled built-in filtering and custom required-field rules', () => {
    const flags = evaluateHygieneIssue(
      buildIssue({
        status: ACTIVE_STATUS,
        assignee: null,
        issuetype: { name: 'Story' },
        customfield_12345: null,
      }),
      {
        enabledBuiltInCheckIds: new Set(['missing-sp']),
        customRules: [
          {
            id: 'custom-1',
            name: 'Missing Business Owner',
            description: 'Business Owner is required.',
            isBuiltIn: false,
            isEnabled: true,
            severity: 'error',
            ruleType: 'required-field',
            fieldId: 'customfield_12345',
            fieldLabel: 'Business Owner',
            issueTypeNames: ['Story'],
          },
        ],
      },
    );

    expect(flags.map((flag) => flag.checkId)).toContain('custom-1');
    expect(flags.map((flag) => flag.checkId)).not.toContain('no-assignee');
  });

  it('aggregates summary counts across a mixed finding set', () => {
    const missingStoryPointsIssue = buildIssue({ customfield_10028: null, customfield_10016: null });
    const staleIssue = { ...buildIssue(), key: 'TBX-102' };
    const findings = [
      { issue: missingStoryPointsIssue, flags: evaluateHygieneIssue(missingStoryPointsIssue) },
      { issue: staleIssue, flags: [{ checkId: 'stale' as const, label: 'Stale', severity: 'warn' as const }] },
    ];

    const summary = summarizeHygieneFindings(findings);

    expect(summary.totalIssues).toBe(2);
    expect(summary.totalFlags).toBe(2);
    expect(summary.countByCheck['missing-sp']).toBe(1);
    expect(summary.countByCheck.stale).toBe(1);
  });
});
