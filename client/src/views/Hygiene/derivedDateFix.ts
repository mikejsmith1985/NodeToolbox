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
// Every write goes through the shipped `saveFeatureReviewSimpleField`, so a date set from Hygiene
// and the same date set from Feature Review produce identical requests.

import { jiraGet } from '../../services/jiraApi.ts';
import { saveFeatureReviewSimpleField } from '../SprintDashboard/featureReviewFixes.ts';
import type { HygieneFieldConfig, HygieneFinding, JiraIssue } from './checks/hygieneChecks.ts';
import { deriveIssueDates, READY_TO_WORK_STATUS_NAME, WORKING_STATUS_NAME } from './checks/issueDateRules.ts';
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
  targetStartBasis?: 'actual-working' | 'back-calculated' | 'ready-to-work-lead' | 'none';
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
    piDodDeadlineIso: context?.piDodDeadlineIso ?? null,
    workingCalendar: context?.workingCalendar,
  });

  const candidateWrites: Array<DerivedDateWrite | null> = [
    derived.mismatchedFieldNames.includes('Due Date') && derived.dueDate
      ? { fieldId: 'duedate', fieldName: 'Due Date', value: derived.dueDate }
      : null,
    derived.mismatchedFieldNames.includes('Target End') && derived.targetEnd && targetEndFieldId
      ? { fieldId: targetEndFieldId, fieldName: 'Target End', value: derived.targetEnd }
      : null,
    derived.mismatchedFieldNames.includes('Target Start') && derived.targetStart && targetStartFieldId
      ? { fieldId: targetStartFieldId, fieldName: 'Target Start', value: derived.targetStart }
      : null,
  ];

  return {
    issueKey: issue.key,
    writes: candidateWrites.filter((write): write is DerivedDateWrite => write !== null),
    undecidedReasons: derived.undecidedReasons,
    targetStartBasis: derived.targetStartBasis,
  };
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
      if (plan.writes.some((write) => write.fieldName === 'Target Start') && plan.targetStartBasis) {
        targetStartBasisCounts[plan.targetStartBasis] = (targetStartBasisCounts[plan.targetStartBasis] ?? 0) + 1;
      }
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
      for (const write of plan.writes) {
        await saveFeatureReviewSimpleField(issue.key, write.fieldId, write.value);
      }
      updatedIssueKeys.push(issue.key);
    } catch (caughtError) {
      failures.push({
        issueKey: issue.key,
        reason: caughtError instanceof Error ? caughtError.message : 'Write failed',
      });
    }
  }

  return { updatedIssueKeys, failures, undecided, targetStartBasisCounts };
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
 * The issues a bulk derived-date write would actually change, each listed once.
 *
 * Pure and separately testable because it decides the number shown on the button, and a count that
 * disagrees with what the button then writes is worse than no count.
 */
export function readDeterministicDateFixCandidates(
  findings: readonly HygieneFinding[],
): JiraIssue[] {
  return findings
    .filter((finding) => finding.flags.some((flag) => DETERMINISTIC_DATE_CHECK_IDS.includes(flag.checkId)))
    .map((finding) => finding.issue);
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
