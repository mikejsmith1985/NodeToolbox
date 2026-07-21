// hygieneChecks.test.ts — Unit tests for the Hygiene issue-health predicates.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkMissingFeatureLink,
  checkMissingFixVersion,
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

  // GH #200: the fix-version check reported 0 of 72 because it only evaluated Feature/Epic — the missing 72 were
  // Stories/Tasks/Defects. It must flag every delivery type expected to carry a fix version.
  // "Epic" is intentionally excluded — this instance's hierarchy tops out at Feature (GH #200 follow-up), and
  // including a non-existent type would make the generated Jira JQL error out.
  it.each(['Story', 'Task', 'Defect', 'Feature'])(
    'flags %s issues that have no fix version',
    (issueTypeName) => {
      const hygieneFlag = checkMissingFixVersion(buildIssue({ issuetype: { name: issueTypeName }, fixVersions: [] }));
      expect(hygieneFlag?.checkId).toBe('missing-fix-version');
    },
  );

  it('does not flag Sub-tasks for a missing fix version (they inherit the parent release)', () => {
    const hygieneFlag = checkMissingFixVersion(buildIssue({ issuetype: { name: 'Sub-task' }, fixVersions: [] }));
    expect(hygieneFlag).toBeNull();
  });

  it('does not flag an issue that already has a fix version', () => {
    const hygieneFlag = checkMissingFixVersion(buildIssue({ issuetype: { name: 'Story' }, fixVersions: [{ name: 'R1' }] }));
    expect(hygieneFlag).toBeNull();
  });

  // Staleness is measured in BUSINESS days. With "now" pinned to Wed 2026-07-15, these fixed update dates give
  // the exact business-day ages the assertions rely on: 2026-07-01 → 10, 2026-07-08 → 5, 2026-07-09 → 4,
  // 2026-07-10 (a Friday) → 3, 2026-07-14 → 1. (Their raw calendar ages are 14, 7, 6, 5 and 1 respectively.)
  it('flags in-progress issues left untouched beyond the threshold in business days', () => {
    const hygieneFlag = checkStaleIssue(buildIssue({ status: ACTIVE_STATUS, updated: '2026-07-01T12:00:00.000Z' }));

    expect(hygieneFlag?.checkId).toBe('stale'); // 10 business days ≥ the 5-business-day default
  });

  it('does not flag recently updated in-progress issues as stale', () => {
    const hygieneFlag = checkStaleIssue(buildIssue({ status: ACTIVE_STATUS, updated: '2026-07-14T12:00:00.000Z' }));

    expect(hygieneFlag).toBeNull(); // 1 business day
  });

  it('excludes the weekend: an issue updated Friday is not stale over the following weekend', () => {
    // 2026-07-10 is a Friday; by Wed 2026-07-15 only 3 business days have elapsed even though 5 calendar days
    // have. Under the old calendar rule a 4-day threshold would have flagged it; business days must not.
    const flagBelowBusinessThreshold = checkStaleIssue(buildIssue({ status: ACTIVE_STATUS, updated: '2026-07-10T12:00:00.000Z' }), 4);
    const flagAtBusinessThreshold = checkStaleIssue(buildIssue({ status: ACTIVE_STATUS, updated: '2026-07-10T12:00:00.000Z' }), 3);

    expect(flagBelowBusinessThreshold).toBeNull(); // 3 business days < 4
    expect(flagAtBusinessThreshold?.checkId).toBe('stale'); // inclusive (>=) at exactly 3 business days
  });

  it('falls back to the same five-business-day default every live surface uses when no threshold is provided', () => {
    // The fallback is aligned with the dashboard's DEFAULT_STALE_DAYS_THRESHOLD (5). 2026-07-08 is exactly 5
    // business days before "now"; 2026-07-09 is 4 — proving the inclusive boundary at the default.
    const flagAtThreshold = checkStaleIssue(buildIssue({ status: ACTIVE_STATUS, updated: '2026-07-08T12:00:00.000Z' }));
    const noFlagBelowThreshold = checkStaleIssue(buildIssue({ status: ACTIVE_STATUS, updated: '2026-07-09T12:00:00.000Z' }));

    expect(flagAtThreshold?.checkId).toBe('stale'); // inclusive (>=) at exactly five business days
    expect(noFlagBelowThreshold).toBeNull();
  });

  it('uses the context stale threshold when evaluating a full issue', () => {
    const flags = evaluateHygieneIssue(
      buildIssue({ status: ACTIVE_STATUS, updated: '2026-07-08T12:00:00.000Z' }),
      { staleDaysThreshold: 5 },
    );

    expect(flags.some((flag) => flag.checkId === 'stale')).toBe(true); // 5 business days ≥ 5
  });

  it('flags in-progress issues with no assignee', () => {
    const hygieneFlag = checkNoAssignee(buildIssue({ status: ACTIVE_STATUS, assignee: null }));

    expect(hygieneFlag?.checkId).toBe('no-assignee');
  });

  it('does not flag completed issues that no longer need an assignee', () => {
    const hygieneFlag = checkNoAssignee(buildIssue({ status: DONE_STATUS, assignee: null }));

    expect(hygieneFlag).toBeNull();
  });

  it('does not flag To Do issues without an assignee — only active work needs an owner', () => {
    const hygieneFlag = checkNoAssignee(buildIssue({ status: TODO_STATUS, assignee: null }));

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
    // Give it a fix version so it carries ONLY the missing-sp flag (GH #200 broadened the fix-version check to
    // Stories, which would otherwise add a second flag and change this aggregation count).
    const missingStoryPointsIssue = buildIssue({ customfield_10028: null, customfield_10016: null, fixVersions: [{ name: 'R1' }] });
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

// ── Field precedence (fix) ──
//
// Every hygiene CHECK asks "does any configured field have a value?", so field order does not affect
// whether an issue is flagged. But the direct-fix controls take the FIRST id in the list as the field to
// write to. That makes order matter for exactly one thing: which field a fix targets.

describe('resolveHygieneFieldConfig — a configured field outranks the built-in default', () => {
  it('puts a workspace-configured Program Increment field first, so a fix writes where the team keeps it', () => {
    // The bug this guards: an admin configures a PI field, and the direct fix writes to the built-in
    // default instead — silently populating a field the team does not use, and leaving theirs empty.
    const fieldConfig = resolveHygieneFieldConfig({ programIncrementFieldIds: ['customfield_99999'] });

    expect(fieldConfig.programIncrementFieldIds[0]).toBe('customfield_99999');
  });

  it('still keeps the default as a fallback, so a check finds a value in either field', () => {
    const fieldConfig = resolveHygieneFieldConfig({ programIncrementFieldIds: ['customfield_99999'] });

    expect(fieldConfig.programIncrementFieldIds).toContain('customfield_10301');
  });

  it('applies the same precedence to every field that has a built-in default', () => {
    const fieldConfig = resolveHygieneFieldConfig({
      acceptanceCriteriaFieldIds: ['customfield_aaa'],
      featureLinkFieldIds: ['customfield_bbb'],
      parentLinkFieldIds: ['customfield_ccc'],
      targetStartFieldIds: ['customfield_ddd'],
      targetEndFieldIds: ['customfield_eee'],
    });

    expect(fieldConfig.acceptanceCriteriaFieldIds[0]).toBe('customfield_aaa');
    expect(fieldConfig.featureLinkFieldIds[0]).toBe('customfield_bbb');
    expect(fieldConfig.parentLinkFieldIds[0]).toBe('customfield_ccc');
    expect(fieldConfig.targetStartFieldIds[0]).toBe('customfield_ddd');
    expect(fieldConfig.targetEndFieldIds[0]).toBe('customfield_eee');
  });

  it('falls back to the default when nothing is configured', () => {
    expect(resolveHygieneFieldConfig().programIncrementFieldIds[0]).toBe('customfield_10301');
    expect(resolveHygieneFieldConfig({}).programIncrementFieldIds[0]).toBe('customfield_10301');
  });

  it('does not duplicate an id that is both configured and a default', () => {
    const fieldConfig = resolveHygieneFieldConfig({ programIncrementFieldIds: ['customfield_10301'] });

    expect(fieldConfig.programIncrementFieldIds).toEqual(['customfield_10301']);
  });

  it('leaves a field with no default configured-only, as before', () => {
    const fieldConfig = resolveHygieneFieldConfig({ productOwnerFieldIds: ['customfield_777'] });

    expect(fieldConfig.productOwnerFieldIds).toEqual(['customfield_777']);
  });

  it('still resolves an unconfigured, defaultless field to empty, so its check keeps skipping', () => {
    // FR-028 elsewhere depends on this: a field this Jira does not have must not flag every issue.
    expect(resolveHygieneFieldConfig().productOwnerFieldIds).toEqual([]);
    expect(resolveHygieneFieldConfig().applicationFieldIds).toEqual([]);
  });

  // ── 021 Readiness: two additive, configured-only field families (Estimate NF, Spark ID/PCode) ──

  it('exposes estimate and pcode field families, defaulting to empty (configured-only)', () => {
    // These back the Readiness tab's alerts; like productOwner/application they have no built-in
    // default, so an instance that lacks them resolves to [] and the alert renders "not checked".
    expect(resolveHygieneFieldConfig().estimateFieldIds).toEqual([]);
    expect(resolveHygieneFieldConfig().pcodeFieldIds).toEqual([]);
  });

  it('passes configured estimate and pcode field ids straight through', () => {
    const fieldConfig = resolveHygieneFieldConfig({
      estimateFieldIds: ['customfield_20001'],
      pcodeFieldIds: ['customfield_20002'],
    });

    expect(fieldConfig.estimateFieldIds).toEqual(['customfield_20001']);
    expect(fieldConfig.pcodeFieldIds).toEqual(['customfield_20002']);
  });

  it('does not change WHETHER an issue is flagged — checks read every field, not just the first', () => {
    const fieldConfig = resolveHygieneFieldConfig({ programIncrementFieldIds: ['customfield_99999'] });
    const issueWithPiInTheDefaultField = buildIssue({
      issuetype: { name: 'Feature' },
      customfield_10301: { value: 'PI 26.3' },
    });

    expect(checkMissingProgramIncrement(issueWithPiInTheDefaultField, fieldConfig)).toBeNull();
  });
});
