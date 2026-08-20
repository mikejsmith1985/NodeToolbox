// hygieneChecks.test.ts — Unit tests for the Hygiene issue-health predicates.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  checkMissingFeatureLink,
  checkMissingFixVersion,
  checkMissingProgramIncrement,
  checkTargetEndOverdue,
  checkTargetStartReady,
  checkDueDateOverdue,
  checkDatesOutOfSync,
  checkMissingDueDate,
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
      // In progress, so a Target Start is genuinely owed. The default fixture sits in an unstarted
      // status, where a missing Target Start is correct rather than a gap.
      status: { name: 'Working', statusCategory: { key: 'indeterminate' } },
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

  it('flags every delivery work item past its due date, not only Features', () => {
    // The reason this exists: the check was gated to Feature/Epic, so a Story a fortnight past its
    // due date produced no warning anywhere — Today, Hygiene, or the team scan. A Scrum Master's
    // own queue is almost entirely Stories, so the card read zero beside a Jira board full of them.
    const overdueOf = (issueTypeName: string) => buildIssue({
      issuetype: { name: issueTypeName },
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
      duedate: '2026-07-15',
    });

    // Epic is in the list as a REGRESSION guard, not a new case: it was already covered by the old
    // Feature/Epic gate, and broadening a warning must never quietly stop catching something.
    ['Story', 'Task', 'Defect', 'Feature', 'Epic'].forEach((issueTypeName) => {
      expect(checkDueDateOverdue(overdueOf(issueTypeName))?.checkId).toBe('due-date-overdue');
    });
  });

  it('leaves a Sub-task alone, because it inherits the dates on its parent', () => {
    expect(checkDueDateOverdue(buildIssue({
      issuetype: { name: 'Sub-task' },
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
      duedate: '2026-07-15',
    }))).toBeNull();
  });

  it('DOES ask a Story for a due date, now that one can be derived for it', () => {
    // A deliberate reversal. This used to be Feature-only so a hundred unfixable flags would not
    // bury the signal; the due date is now derived from the fix version, so a missing one is both
    // detectable and fixable in a single action rather than a hundred manual edits.
    expect(checkMissingDueDate(buildIssue({
      issuetype: { name: 'Story' },
      status: ACTIVE_STATUS,
      duedate: null,
    }))?.checkId).toBe('missing-due-date');
  });

  it('flags a Feature past Target End in any status before testing', () => {
    // Previously an allowlist of exactly two statuses (To Do category, or the literal name
    // "Implementing"), so a Feature sitting In Progress or Blocked months past Target End was
    // silent. The rule always meant "has not reached Integrated Test yet"; now it says so.
    const pastTargetEndIn = (statusName: string, statusCategoryKey: string) => buildIssue({
      issuetype: { name: 'Feature' },
      status: { name: statusName, statusCategory: { key: statusCategoryKey, name: statusName } },
      customfield_10102: '2026-07-15',
    });

    expect(checkTargetEndOverdue(pastTargetEndIn('To Do', 'new'), resolveHygieneFieldConfig())?.checkId).toBe('target-end-overdue');
    expect(checkTargetEndOverdue(pastTargetEndIn('Implementing', 'indeterminate'), resolveHygieneFieldConfig())?.checkId).toBe('target-end-overdue');
    expect(checkTargetEndOverdue(pastTargetEndIn('In Progress', 'indeterminate'), resolveHygieneFieldConfig())?.checkId).toBe('target-end-overdue');
    expect(checkTargetEndOverdue(pastTargetEndIn('Blocked', 'indeterminate'), resolveHygieneFieldConfig())?.checkId).toBe('target-end-overdue');
    expect(checkTargetEndOverdue(pastTargetEndIn('In Review', 'indeterminate'), resolveHygieneFieldConfig())?.checkId).toBe('target-end-overdue');
  });

  it('stops flagging Target End once the Feature has reached testing or later', () => {
    // The rule's own remedy is "move it to Integrated Test or update Target End" — so a Feature that
    // HAS moved has complied, and repeating the warning would be nagging about a done instruction.
    const pastTargetEndIn = (statusName: string, statusCategoryKey: string) => buildIssue({
      issuetype: { name: 'Feature' },
      status: { name: statusName, statusCategory: { key: statusCategoryKey, name: statusName } },
      customfield_10102: '2026-07-15',
    });

    expect(checkTargetEndOverdue(pastTargetEndIn('Integrated Test', 'indeterminate'), resolveHygieneFieldConfig())).toBeNull();
    expect(checkTargetEndOverdue(pastTargetEndIn('Ready for QA', 'indeterminate'), resolveHygieneFieldConfig())).toBeNull();
    expect(checkTargetEndOverdue(pastTargetEndIn('Ready to Accept', 'indeterminate'), resolveHygieneFieldConfig())).toBeNull();
    expect(checkTargetEndOverdue(pastTargetEndIn('Done', 'done'), resolveHygieneFieldConfig())).toBeNull();
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
    // Given a fix version AND the three policy dates so it carries ONLY the missing-sp flag. Both
    // broadenings land here: GH #200 put the fix-version check on Stories, and the date policy now
    // asks every delivery type for its dates — either would otherwise add flags and change the count.
    const missingStoryPointsIssue = buildIssue({
      customfield_10028: null,
      customfield_10016: null,
      fixVersions: [{ name: 'R1', releaseDate: '2026-10-08', released: false }],
      duedate: '2026-10-08',
      customfield_10101: '2026-09-01',
      customfield_10102: '2026-09-17',
    });
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

describe('date policy checks apply to every delivery work item', () => {
  const RELEASE_FIX_VERSION = [{ name: '10/08/2026', releaseDate: '2026-10-08', released: false }];

  function buildStoryWithDates(overrides: Record<string, unknown>) {
    return buildIssue({
      issuetype: { name: 'Story' },
      status: { name: 'Ready to Work', statusCategory: { key: 'indeterminate', name: 'In Progress' } },
      fixVersions: RELEASE_FIX_VERSION,
      ...overrides,
    });
  }

  it('asks a Story for its target dates, which only Features used to be asked for', () => {
    // The blind spot the reporter spotted: every Target Start / Target End tile read 0 on a board of
    // Stories and Defects, because the checks were gated to Feature/Epic and nothing was looking.
    const storyIssue = buildStoryWithDates({ duedate: null, customfield_10101: null, customfield_10102: null });
    const flagIds = evaluateHygieneIssue(storyIssue).map((flag) => flag.checkId);

    expect(flagIds).toContain('missing-target-start');
    expect(flagIds).toContain('missing-target-end');
    expect(flagIds).toContain('missing-due-date');
  });

  it('still leaves a Sub-task alone — it inherits its parent dates', () => {
    const subTaskIssue = buildIssue({
      issuetype: { name: 'Sub-task' },
      status: ACTIVE_STATUS,
      duedate: null,
    });

    expect(evaluateHygieneIssue(subTaskIssue).map((flag) => flag.checkId)).not.toContain('missing-due-date');
  });

  it('flags dates that disagree with the fix version the issue is committed to', () => {
    const storyIssue = buildStoryWithDates({
      duedate: '2026-11-30',
      customfield_10102: '2026-09-17',
    });

    expect(checkDatesOutOfSync(storyIssue, resolveHygieneFieldConfig())?.checkId).toBe('dates-out-of-sync');
  });

  it('says nothing when the derivable dates already match the release', () => {
    const storyIssue = buildStoryWithDates({
      duedate: '2026-10-08',
      customfield_10102: '2026-09-17',
    });

    expect(checkDatesOutOfSync(storyIssue, resolveHygieneFieldConfig())).toBeNull();
  });

  it('says nothing when there is no dated fix version to derive from', () => {
    const storyIssue = buildIssue({
      issuetype: { name: 'Story' },
      status: ACTIVE_STATUS,
      fixVersions: [],
      duedate: '2026-11-30',
    });

    expect(checkDatesOutOfSync(storyIssue, resolveHygieneFieldConfig())).toBeNull();
  });
});

describe('checkMissingTargetStart — a date nobody has earned yet is not a gap', () => {
  // It flagged every delivery issue with no Target Start, so eighteen issues sitting in To Do were
  // reported as hygiene gaps and the bulk fix could not touch one of them: the date comes from
  // ENTERING Ready to Work, so a To Do issue correctly has none (GH #375). The team assigns Target
  // Start once work reaches Ready to Work, with three days of grace.
  const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
  const FIELD_CONFIG = resolveHygieneFieldConfig();

  function issueInStatus(statusName: string, categoryKey: string, statusChangedIso: string | null): JiraIssue {
    return {
      key: 'TBX-1',
      fields: {
        summary: 'A story',
        issuetype: { name: 'Story' },
        status: { name: statusName, statusCategory: { key: categoryKey } },
        ...(statusChangedIso ? { statuscategorychangedate: statusChangedIso } : {}),
      },
    } as unknown as JiraIssue;
  }

  function isoDaysAgo(dayCount: number): string {
    return new Date(Date.now() - dayCount * 24 * 60 * 60 * 1000).toISOString();
  }

  it('does not flag an issue that has not reached Ready to Work', () => {
    expect(checkMissingTargetStart(issueInStatus('To Do', 'new', isoDaysAgo(40)), FIELD_CONFIG)).toBeNull();
    expect(checkMissingTargetStart(issueInStatus('Triage', 'new', isoDaysAgo(40)), FIELD_CONFIG)).toBeNull();
  });

  it('does not flag an issue that only just reached Ready to Work', () => {
    // Three days of grace: the policy itself dates Target Start at Ready to Work + 3.
    expect(checkMissingTargetStart(issueInStatus('Ready to Work', 'new', isoDaysAgo(1)), FIELD_CONFIG)).toBeNull();
  });

  it('flags an issue that has sat in Ready to Work past the grace period', () => {
    expect(checkMissingTargetStart(issueInStatus('Ready to Work', 'new', isoDaysAgo(4)), FIELD_CONFIG)).not.toBeNull();
  });

  it('flags an issue already being worked, whatever the clock says', () => {
    // Past Ready to Work the date is simply overdue — there is no grace left to give.
    expect(checkMissingTargetStart(issueInStatus('Working', 'indeterminate', isoDaysAgo(0)), FIELD_CONFIG)).not.toBeNull();
  });

  it('flags a Ready to Work issue whose status-change date is missing rather than assuming it is fresh', () => {
    // An absent date means the grace period cannot be measured. Treating that as "just arrived"
    // would hide the flag forever on exactly the issues whose history is hardest to read.
    expect(checkMissingTargetStart(issueInStatus('Ready to Work', 'new', null), FIELD_CONFIG)).not.toBeNull();
  });

  it('still never flags an issue that already has a target start', () => {
    const dated = issueInStatus('Working', 'indeterminate', isoDaysAgo(10));
    (dated.fields as Record<string, unknown>)[FIELD_CONFIG.targetStartFieldIds[0]] = '2026-08-01';

    expect(checkMissingTargetStart(dated, FIELD_CONFIG)).toBeNull();
  });

  it('ignores case and padding in the status name, which Jira instances vary on', () => {
    expect(checkMissingTargetStart(issueInStatus('  ready to work ', 'new', isoDaysAgo(9)), FIELD_CONFIG)).not.toBeNull();
  });

  void THREE_DAYS_MS;
});
