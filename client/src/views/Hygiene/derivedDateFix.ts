// derivedDateFix.ts — Turns the date policy into Jira writes, for one issue or a hundred.
//
// The check says an issue's dates disagree with the release it is committed to; this works out what
// they should be and writes them. Nobody is asked to retype a date the policy already knows —
// retyping is how a hundred issues stay wrong.
//
// Target Start is the one date the scan cannot see: deriving it needs the changelog entry for
// "Ready to Work", and the scan does not fetch changelogs for every issue it reads. So it is fetched
// HERE, per issue, only for the issues actually being fixed.
//
// Every write goes through the shipped `saveFeatureReviewSimpleFields`, so a date set from Hygiene
// and the same date set from Feature Review produce identical requests — and each issue's dates go
// in ONE request, so an issue is dated wholly or not at all.

import { jiraGet } from '../../services/jiraApi.ts';
import { saveFeatureReviewSimpleFields } from '../SprintDashboard/featureReviewFixes.ts';
import type { HygieneFieldConfig, HygieneFinding, JiraIssue } from './checks/hygieneChecks.ts';
import {
  deriveIssueDates,
  explainMissingDrivingFixVersion,
  READY_TO_WORK_STATUS_NAME,
  WORKING_STATUS_NAME,
  type DerivedIssueDates,
} from './checks/issueDateRules.ts';
import type { WorkingCalendar } from '../../utils/workingDays.ts';

/**
 * What the forecast knows that the date policy cannot work out for itself.
 *
 * Optional at every call site. Without it the fix behaves exactly as it did before the forecast
 * existed — which is what lets Hygiene and Feature Review adopt it one at a time rather than all at
 * once.
 */
export interface DerivedDateContext {
  /** Remaining working days per issue key. A key that is absent simply falls back to the old rule. */
  remainingEffortWorkingDaysByKey?: Record<string, number | null>;
  /**
   * The day each issue has to start for its Feature's whole DEV → SL chain to make code freeze.
   *
   * A key that is absent falls back to the issue's own effort, which is what every caller that
   * cannot see a Feature's other issues gets.
   */
  chainTargetStartByKey?: Record<string, string>;
  /** The PI Definition-of-Done deadline, when the ART has configured one. */
  piDodDeadlineIso?: string | null;
  workingCalendar?: WorkingCalendar;
}

/** One field the fix will set, named so the user can see it before it happens. */
export interface DerivedDateWrite {
  fieldId: string;
  fieldName: string;
  value: string;
}

/** What a fix would do to one issue, and what it could not work out. */
export interface DerivedDatePlan {
  issueKey: string;
  writes: DerivedDateWrite[];
  undecidedReasons: string[];
  /** Which rule produced the Target Start, so a bulk run can report what it did rather than a count. */
  // Taken from the policy's own type rather than restated. The two had already drifted once: a rule
  // added there was a compile error here, which is the good version of this mistake.
  targetStartBasis?: DerivedIssueDates['targetStartBasis'];
}

/** The result of a run: what landed, and precisely what did not. */
export interface DerivedDateOutcome {
  updatedIssueKeys: string[];
  failures: Array<{ issueKey: string; reason: string }>;
  /**
   * Issues the policy could not date, with the reason.
   *
   * Separate from `failures`: nothing went wrong here. A To Do issue genuinely has no Target Start,
   * because that date comes from entering Working or Ready to Work and it has done neither. But
   * skipping it silently reported "Updated 0 issue(s)" for a run of nineteen, which reads exactly
   * like a broken button and was.
   */
  undecided: Array<{ issueKey: string; reasons: string[] }>;
  /**
   * How many Target Starts each rule produced.
   *
   * A run that reports only a count leaves the operator unable to tell a date worked back from the
   * effort left from one that is merely three days after the issue became workable. Those two mean
   * very different things to somebody deciding whether the plan is real.
   */
  targetStartBasisCounts: Record<string, number>;
}

/** One changelog history entry, reduced to what the Ready-to-Work lookup needs. */
interface ChangelogHistory {
  created?: string;
  items?: Array<{ field?: string; toString?: string }>;
}

/** The first time the issue entered a named status, from a changelog already fetched. */
function readFirstEntryInto(histories: readonly ChangelogHistory[], statusName: string): string | null {
  // FIRST rather than most recent: the clock starts when the work first reached that state, and an
  // issue that bounced back and forth should not keep resetting its own start date.
  const entryTimes = histories
    .filter((history) => (history.items ?? []).some((item) =>
      item.field === 'status' && (item.toString ?? '').trim().toLowerCase() === statusName.toLowerCase()))
    .map((history) => history.created ?? '')
    .filter((createdIso) => createdIso !== '')
    .sort();

  return entryTimes[0] ?? null;
}

/**
 * Reads the two status entries Target Start can come from, in ONE request.
 *
 * Both come out of the same changelog, so asking for it twice would double the cost of every fix for
 * nothing. Ready to Work supports a prediction; Working is the day work actually began and wins
 * whenever it exists — including for work that skipped Ready to Work entirely, which had no source
 * at all before and stayed permanently undated.
 */
async function readStartStatusEntries(issueKey: string): Promise<{ readyToWorkIso: string | null; workingIso: string | null }> {
  const response = await jiraGet<{ changelog?: { histories?: ChangelogHistory[] } }>(
    `/rest/api/2/issue/${encodeURIComponent(issueKey)}?expand=changelog&fields=summary`,
  );
  const histories = response.changelog?.histories ?? [];

  return {
    readyToWorkIso: readFirstEntryInto(histories, READY_TO_WORK_STATUS_NAME),
    workingIso: readFirstEntryInto(histories, WORKING_STATUS_NAME),
  };
}

/** Reads a Jira field as its raw date text, or null. */
function readFieldText(issue: JiraIssue, fieldId: string): string | null {
  const rawValue = (issue.fields as unknown as Record<string, unknown>)[fieldId];
  return typeof rawValue === 'string' && rawValue.trim() !== '' ? rawValue.trim() : null;
}

/** The first configured field id in a family, or null when the instance has none. */
function readFirstFieldId(fieldIds: readonly string[]): string | null {
  return fieldIds[0] ?? null;
}

/**
 * Works out every date write one issue needs, without performing any of them.
 *
 * Separated from the writing so the UI can show exactly what is about to change — a bulk action
 * that writes first and reports afterwards is not something anyone can agree to.
 */
export async function planDerivedDateWrites(
  issue: JiraIssue,
  fieldConfig: HygieneFieldConfig,
  context?: DerivedDateContext,
): Promise<DerivedDatePlan> {
  const targetStartFieldId = readFirstFieldId(fieldConfig.targetStartFieldIds);
  const targetEndFieldId = readFirstFieldId(fieldConfig.targetEndFieldIds);
  const startEntries = await readStartStatusEntries(issue.key)
    .catch(() => ({ readyToWorkIso: null, workingIso: null }));

  const derived = deriveIssueDates({
    fixVersions: issue.fields.fixVersions ?? [],
    readyToWorkEnteredIso: startEntries.readyToWorkIso,
    workingEnteredIso: startEntries.workingIso,
    currentDueDate: readFieldText(issue, 'duedate'),
    currentTargetEnd: targetEndFieldId ? readFieldText(issue, targetEndFieldId) : null,
    currentTargetStart: targetStartFieldId ? readFieldText(issue, targetStartFieldId) : null,
    // Absent unless the caller has a forecast in hand. The policy then falls back to the rule it
    // always used, so nothing that has not adopted the forecast changes behaviour.
    remainingEffortWorkingDays: context?.remainingEffortWorkingDaysByKey?.[issue.key] ?? null,
    chainTargetStartIso: context?.chainTargetStartByKey?.[issue.key] ?? null,
    piDodDeadlineIso: context?.piDodDeadlineIso ?? null,
    workingCalendar: context?.workingCalendar,
  });

  const targetStartWrite = derived.mismatchedFieldNames.includes('Target Start') && derived.targetStart && targetStartFieldId
    ? { fieldId: targetStartFieldId, fieldName: 'Target Start', value: derived.targetStart }
    : null;

  return {
    issueKey: issue.key,
    writes: [...buildReleaseDateWrites(derived, targetEndFieldId), ...(targetStartWrite ? [targetStartWrite] : [])],
    undecidedReasons: derived.undecidedReasons,
    targetStartBasis: derived.targetStartBasis,
  };
}

/**
 * The writes that follow from the RELEASE alone: Due Date and Target End.
 *
 * Kept apart from Target Start because these two need nothing the scan does not already hold, which
 * is what lets the button work out at scan time whether it can honestly promise them.
 */
function buildReleaseDateWrites(derived: DerivedIssueDates, targetEndFieldId: string | null): DerivedDateWrite[] {
  const candidateWrites: Array<DerivedDateWrite | null> = [
    derived.mismatchedFieldNames.includes('Due Date') && derived.dueDate
      ? { fieldId: 'duedate', fieldName: 'Due Date', value: derived.dueDate }
      : null,
    derived.mismatchedFieldNames.includes('Target End') && derived.targetEnd && targetEndFieldId
      ? { fieldId: targetEndFieldId, fieldName: 'Target End', value: derived.targetEnd }
      : null,
  ];
  return candidateWrites.filter((write): write is DerivedDateWrite => write !== null);
}

/**
 * The release-derived writes an issue needs, judged from the scan's own data and nothing else.
 *
 * The same policy the fix runs, minus the changelog it has not fetched yet. Target Start is passed
 * as already-agreeing so it never appears here; this answers only "does the release date anything".
 */
function readScanVisibleReleaseWrites(issue: JiraIssue, fieldConfig: HygieneFieldConfig): DerivedDateWrite[] {
  const targetEndFieldId = readFirstFieldId(fieldConfig.targetEndFieldIds);
  const derived = deriveIssueDates({
    fixVersions: issue.fields.fixVersions ?? [],
    readyToWorkEnteredIso: null,
    workingEnteredIso: null,
    currentDueDate: readFieldText(issue, 'duedate'),
    currentTargetEnd: targetEndFieldId ? readFieldText(issue, targetEndFieldId) : null,
    currentTargetStart: null,
  });
  return buildReleaseDateWrites(derived, targetEndFieldId);
}

/**
 * Applies the derived dates to every issue given.
 *
 * One issue's failure never stops the run, and never claims the others failed with it: a locked
 * field on one ticket is not a reason to leave ninety-nine others wrong, and a whole-run "failed"
 * would hide the ninety-nine that worked.
 */
export async function applyDerivedDates(
  issues: readonly JiraIssue[],
  fieldConfig: HygieneFieldConfig,
  context?: DerivedDateContext,
): Promise<DerivedDateOutcome> {
  const updatedIssueKeys: string[] = [];
  const failures: Array<{ issueKey: string; reason: string }> = [];
  const undecided: Array<{ issueKey: string; reasons: string[] }> = [];
  const targetStartBasisCounts: Record<string, number> = {};

  for (const issue of issues) {
    try {
      const plan = await planDerivedDateWrites(issue, fieldConfig, context);
      if (plan.writes.length === 0) {
        // Nothing to write is an ANSWER, not a non-event: the policy could not derive a value, and
        // the reason is the only thing that tells a user whether to wait, fix Jira, or look again.
        undecided.push({
          issueKey: issue.key,
          reasons: plan.undecidedReasons.length > 0
            ? plan.undecidedReasons
            : ['its dates already match the release'],
        });
        continue;
      }
      // One request for the whole issue: three separate writes could land the due date and then be
      // refused on Target End, leaving it half-dated and reported as a failure (GH #384).
      const fieldValuesById = Object.fromEntries(plan.writes.map((write) => [write.fieldId, write.value]));
      await saveFeatureReviewSimpleFields(issue.key, fieldValuesById);
      updatedIssueKeys.push(issue.key);
      // Counted AFTER the write: a basis tallied for a date that never reached Jira produced
      // "Updated 0 issue(s) … Target Start: 2 from the day work began", which claims the opposite.
      recordTargetStartBasis(plan, targetStartBasisCounts);
    } catch (caughtError) {
      failures.push({
        issueKey: issue.key,
        reason: caughtError instanceof Error ? caughtError.message : 'Write failed',
      });
    }
  }

  return { updatedIssueKeys, failures, undecided, targetStartBasisCounts };
}

/** Tallies which rule produced a Target Start that actually landed. */
function recordTargetStartBasis(plan: DerivedDatePlan, targetStartBasisCounts: Record<string, number>): void {
  if (!plan.writes.some((write) => write.fieldName === 'Target Start') || !plan.targetStartBasis) {
    return;
  }
  targetStartBasisCounts[plan.targetStartBasis] = (targetStartBasisCounts[plan.targetStartBasis] ?? 0) + 1;
}

/**
 * The date checks a derived write actually fixes.
 *
 * `dates-out-of-sync` covers an issue whose dates DISAGREE with its release, but the far commoner
 * case is an issue simply missing one — and the bulk button was gated to the disagreement alone, so
 * the majority case was never offered to it. Nothing about these needs a person or a model: the
 * policy derives the value and the changelog supplies the start.
 *
 * The three OVERDUE flags are deliberately absent. "Due date passed while the issue sat in an early
 * status" is a true statement about the work, not a wrong field, and rewriting the date to make the
 * warning disappear is the one thing that must never happen automatically.
 */
const DETERMINISTIC_DATE_CHECK_IDS = [
  'missing-due-date',
  'missing-target-start',
  'missing-target-end',
  'dates-out-of-sync',
];

/**
 * The date flags the bulk fix will NEVER write, however plainly they are about a date.
 *
 * Each says the date has ARRIVED and the work has not: Target Start came and went while the issue
 * sat in To Do, Target End passed before testing, the due date passed before completion. The field
 * is correct; the schedule is not. Moving the date would make the warning disappear and change
 * nothing about the work, which is the one thing an automatic fix must never do.
 */
const OVERDUE_DATE_CHECK_IDS = [
  'target-start-ready',
  'target-end-overdue',
  'due-date-overdue',
];

/**
 * How many issues carry a date problem the button deliberately leaves alone.
 *
 * The button counted only what it would write, so a board showing seven date flags offered to fix
 * one and never said why — which reads as a broken button rather than as a decision. This is the
 * number that makes the difference visible, so the screen states its own scope instead of leaving
 * the reader to work out that the two figures measure different things.
 *
 * An issue that ALSO has something fixable is not counted here: it is already in the button's set,
 * and counting it twice would make the two figures overlap and stop adding up.
 */
export function countUnfixableDateIssues(findings: readonly HygieneFinding[]): number {
  return findings.filter((finding) =>
    finding.flags.some((flag) => OVERDUE_DATE_CHECK_IDS.includes(flag.checkId))
    && !finding.flags.some((flag) => DETERMINISTIC_DATE_CHECK_IDS.includes(flag.checkId))).length;
}

/** The date flags whose value is derived FROM the release, and so cannot be written without one. */
const RELEASE_DERIVED_DATE_CHECK_IDS = ['missing-due-date', 'missing-target-end', 'dates-out-of-sync'];

/** The one date flag whose value comes from the changelog rather than the release. */
const TARGET_START_CHECK_ID = 'missing-target-start';

/** The reason given when a release dates the issue but no field is configured to receive the date. */
const NO_DATE_FIELD_CONFIGURED_REASON = 'no Target End field is configured to receive the date';

/** True when the finding carries any flag the bulk fix is willing to act on. */
function hasDeterministicDateFlag(finding: HygieneFinding): boolean {
  return finding.flags.some((flag) => DETERMINISTIC_DATE_CHECK_IDS.includes(flag.checkId));
}

/**
 * True when the scan already holds everything needed to write at least one of this issue's dates.
 *
 * "Fix 5 blank or mismatched date(s)" wrote to none of them: three had no dated release, which the
 * scan could see without fetching anything (GH #384). A flag says a date is missing; only the policy
 * says whether one can be derived, so the policy is what decides the count — the same arithmetic the
 * fix runs, on the same data, minus the changelog.
 *
 * Target Start is the exception: it comes from the changelog, which the scan does not fetch, so a
 * missing one is always offered and only the fix — changelog in hand — can say no, and says why.
 */
function canWriteFromScanData(finding: HygieneFinding, fieldConfig: HygieneFieldConfig): boolean {
  const checkIds = finding.flags.map((flag) => flag.checkId);
  if (checkIds.includes(TARGET_START_CHECK_ID)) {
    return true;
  }
  if (!checkIds.some((checkId) => RELEASE_DERIVED_DATE_CHECK_IDS.includes(checkId))) {
    return false;
  }
  return readScanVisibleReleaseWrites(finding.issue, fieldConfig).length > 0;
}

/**
 * The issues a bulk derived-date write would actually change, each listed once.
 *
 * Pure and separately testable because it decides the number shown on the button AND on the stat
 * band, and a count that disagrees with what the button then writes is worse than no count.
 */
export function readDeterministicDateFixCandidates(
  findings: readonly HygieneFinding[],
  fieldConfig: HygieneFieldConfig,
): JiraIssue[] {
  return findings
    .filter((finding) => hasDeterministicDateFlag(finding) && canWriteFromScanData(finding, fieldConfig))
    .map((finding) => finding.issue);
}

/**
 * The date-flagged issues the button leaves out because the scan can already see they cannot be
 * dated, each with the policy's own reason.
 *
 * They are not allowed to vanish: three of five silently dropping off the count is the same
 * broken-button reading GH #384 started with, one step earlier. Named here, before the click, they
 * tell the operator what to fix in Jira first — a fix version, or a release date on one.
 */
export function readUndatableDateIssues(
  findings: readonly HygieneFinding[],
  fieldConfig: HygieneFieldConfig,
): Array<{ issueKey: string; reasons: string[] }> {
  return findings
    .filter((finding) => hasDeterministicDateFlag(finding) && !canWriteFromScanData(finding, fieldConfig))
    .map((finding) => ({
      issueKey: finding.issue.key,
      reasons: [explainMissingDrivingFixVersion(finding.issue.fields.fixVersions ?? []) ?? NO_DATE_FIELD_CONFIGURED_REASON],
    }));
}

/** How many issue keys one reason lists before it summarises the rest. */
const MAX_LISTED_UNDECIDED_KEYS = 12;

/**
 * Turns the undecided list into one readable phrase, grouped by reason and NAMING the issues.
 *
 * The keys are what makes it actionable: a count says there is a problem and gives nowhere to go.
 *
 * Grouped because the reasons repeat: nineteen issues in To Do produce nineteen identical lines,
 * which is a wall rather than an explanation. "not yet in Ready to Work or Working (18)" is the
 * whole answer in one clause.
 *
 * An issue carrying two reasons counts toward both — it is blocked by both, and reporting only the
 * first would send somebody to fix one thing and find the date still missing.
 */
export function summariseUndecidedDates(
  undecided: readonly { issueKey: string; reasons: string[] }[],
): string {
  const countByReason = new Map<string, string[]>();
  for (const undecidedIssue of undecided) {
    for (const reason of undecidedIssue.reasons) {
      countByReason.set(reason, [...(countByReason.get(reason) ?? []), undecidedIssue.issueKey]);
    }
  }

  return [...countByReason.entries()]
    .sort((first, second) => second[1].length - first[1].length)
    .map(([reason, issueKeys]) => `${reason} (${issueKeys.length}): ${formatIssueKeyList(issueKeys)}`)
    .join('; ');
}

/**
 * Lists the issue keys behind one reason, capping a long list rather than printing all of it.
 *
 * The keys are the whole point — "3 could not be dated" tells somebody there is a problem and gives
 * them nowhere to go, while three issue keys can be opened. The cap exists because a scan of two
 * thousand could otherwise put two thousand keys on one line, and the count still states the truth
 * after the "+N more".
 */
function formatIssueKeyList(issueKeys: readonly string[]): string {
  if (issueKeys.length <= MAX_LISTED_UNDECIDED_KEYS) {
    return issueKeys.join(', ');
  }
  const listedKeys = issueKeys.slice(0, MAX_LISTED_UNDECIDED_KEYS).join(', ');
  return `${listedKeys} +${issueKeys.length - MAX_LISTED_UNDECIDED_KEYS} more`;
}
