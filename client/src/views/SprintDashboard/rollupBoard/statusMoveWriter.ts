// statusMoveWriter.ts — The only place the Roll-Up Board changes an issue's state.
//
// Moving a card must leave Jira holding BOTH the column's status and its sub-status. Where Jira's
// transition screen carries the sub-status field, both go in one request and the move is atomic.
// Where it does not, the write has to happen in two steps — and the first can succeed while the
// second fails.
//
// That case is the reason this module is careful. Once Jira has changed the status, putting the card
// back where it started would draw a state Jira does not hold. No error message undoes a board that
// is showing a falsehood, so the card settles where the issue actually is and the shortfall is said
// out loud instead.

import { jiraGet, jiraPut } from '../../../services/jiraApi.ts';
import {
  fetchFeatureReviewTransitions,
  saveFeatureReviewOptionField,
  saveFeatureReviewTransition,
  type FeatureReviewTransition,
  type TransitionRequiredField,
} from '../featureReviewFixes.ts';
import type { ColumnStatusMapping } from './rollupBoardTypes.ts';

/** Compares Jira names the way Jira presents them: trimmed, and casing is not a real distinction. */
function normalizeName(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

/** How the move will be carried out, decided before anything is sent. */
export type StatusMovePlan =
  | { kind: 'no-op' }
  | { kind: 'transition-only'; transitionId: string }
  /** `subStatusValue: null` means CLEAR the field — the column claims the status on its own. */
  | { kind: 'transition-with-substatus'; transitionId: string; subStatusValue: string | null }
  | { kind: 'transition-then-field'; transitionId: string; subStatusValue: string | null }
  | { kind: 'field-only'; subStatusValue: string | null }
  | { kind: 'needs-fields'; transitionId: string; requiredFields: TransitionRequiredField[] }
  | { kind: 'refused'; reason: string; reachableStatusNames: string[] };

export interface PlanStatusMoveInput {
  currentStatusName: string;
  currentSubStatusValue: string | null;
  targetMapping: ColumnStatusMapping;
  transitions: readonly FeatureReviewTransition[];
  /** '' when this instance has no sub-status field, in which case columns match on status alone. */
  subStatusFieldId: string;
}

/**
 * Works out how — or whether — this move can be made, before any request is sent.
 *
 * Deciding up front is what lets an impossible move be refused without touching Jira at all, so a
 * card never half-moves because the board tried something the workflow forbids.
 */
export function planStatusMove(input: PlanStatusMoveInput): StatusMovePlan {
  const isStatusAlreadyRight = normalizeName(input.currentStatusName) === normalizeName(input.targetMapping.jiraStatusName);
  const hasSubStatusField = input.subStatusFieldId !== '';
  const targetSubStatusValue = hasSubStatusField ? input.targetMapping.subStatusValue : null;
  const isSubStatusAlreadyRight = normalizeName(input.currentSubStatusValue) === normalizeName(targetSubStatusValue);

  if (isStatusAlreadyRight && isSubStatusAlreadyRight) {
    return { kind: 'no-op' };
  }

  // Only the sub-status differs, so there is no status transition to attempt — and attempting one
  // that does not exist would refuse a move that is perfectly legal. This covers CLEARING as well as
  // setting: a card sitting in "Working / New" belongs in the Working column, which claims the status
  // on its own, and the way to put it there is to empty the sub-status rather than to look for a
  // Working → Working transition that no workflow has.
  if (isStatusAlreadyRight) {
    return hasSubStatusField ? { kind: 'field-only', subStatusValue: targetSubStatusValue } : { kind: 'no-op' };
  }

  const matchingTransition = input.transitions.find(
    (transition) => normalizeName(transition.to?.name ?? '') === normalizeName(input.targetMapping.jiraStatusName),
  );
  if (!matchingTransition) {
    return {
      kind: 'refused',
      reason:
        `Jira does not allow moving from "${input.currentStatusName}" to `
        + `"${input.targetMapping.jiraStatusName}" — the workflow has no such transition.`,
      // Naming where the card CAN go turns a dead end into a next step; without it the user is left
      // guessing which of a dozen columns the workflow would have accepted.
      reachableStatusNames: input.transitions
        .map((transition) => transition.to?.name ?? '')
        .filter((statusName) => statusName !== ''),
    };
  }

  if (matchingTransition.requiredFields.length > 0) {
    return { kind: 'needs-fields', transitionId: matchingTransition.id, requiredFields: matchingTransition.requiredFields };
  }

  // Nothing to do to the sub-status: either this instance has no such field, or it already holds what
  // the target column wants (including both being empty).
  if (!hasSubStatusField || isSubStatusAlreadyRight) {
    return { kind: 'transition-only', transitionId: matchingTransition.id };
  }

  // One request beats two whenever Jira allows it: an atomic write cannot half-apply.
  return (matchingTransition.screenFieldIds ?? []).includes(input.subStatusFieldId)
    ? { kind: 'transition-with-substatus', transitionId: matchingTransition.id, subStatusValue: targetSubStatusValue }
    : { kind: 'transition-then-field', transitionId: matchingTransition.id, subStatusValue: targetSubStatusValue };
}

/** What happened, and what the board should do about the card. */
export type StatusMoveOutcome =
  | { status: 'applied'; message: null }
  | { status: 'refused'; message: string; reachableStatusNames: string[] }
  | { status: 'needs-fields'; message: string; transitionId: string; requiredFields: TransitionRequiredField[] }
  | { status: 'failed'; message: string; shouldRevertCard: true }
  | {
    status: 'partially-applied';
    message: string;
    shouldRevertCard: false;
    actualStatusName: string | null;
    actualSubStatusValue: string | null;
  };

export interface ExecuteStatusMoveInput {
  issueKey: string;
  currentStatusName: string;
  currentSubStatusValue: string | null;
  targetMapping: ColumnStatusMapping;
  subStatusFieldId: string;
}

/** Reads an option-shaped field value back off a re-read issue. */
function readSubStatusFromIssue(issueFields: Record<string, unknown>, subStatusFieldId: string): string | null {
  const rawValue = issueFields[subStatusFieldId];
  if (typeof rawValue === 'string') return rawValue.trim() || null;
  if (rawValue && typeof rawValue === 'object') {
    return (rawValue as { value?: string; name?: string }).value ?? (rawValue as { name?: string }).name ?? null;
  }
  return null;
}

/**
 * Re-reads the issue so the card can settle at Jira's actual state.
 *
 * If even this fails we still report the partial write — claiming success because we could not check
 * would be the worst of both.
 */
async function readIssueStateAfterPartialWrite(
  issueKey: string,
  subStatusFieldId: string,
): Promise<{ statusName: string | null; subStatusValue: string | null }> {
  try {
    const issue = await jiraGet<{ fields?: Record<string, unknown> }>(
      `/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=status,${subStatusFieldId}`,
    );
    const issueFields = issue.fields ?? {};
    return {
      statusName: (issueFields.status as { name?: string } | undefined)?.name ?? null,
      subStatusValue: readSubStatusFromIssue(issueFields, subStatusFieldId),
    };
  } catch {
    return { statusName: null, subStatusValue: null };
  }
}

/**
 * Sets the sub-status on its own — or empties it when the target column claims the status alone.
 *
 * Clearing goes through a direct `null` write rather than the option saver, because an option saver
 * resolves a VALUE against Jira's allowed list and there is no allowed value meaning "none".
 */
async function writeSubStatusField(
  issueKey: string,
  subStatusFieldId: string,
  subStatusValue: string | null,
): Promise<void> {
  if (subStatusValue === null) {
    await jiraPut(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, {
      fields: { [subStatusFieldId]: null },
    });
    return;
  }

  await saveFeatureReviewOptionField(issueKey, subStatusFieldId, subStatusValue, undefined);
}

/**
 * Carries out a card move, reporting precisely what happened.
 *
 * A refusal or an unanswered required field sends nothing at all. An atomic failure returns the card
 * to where it started. A two-step partial success does NOT — see the note at the top of this file.
 */
export async function executeStatusMove(input: ExecuteStatusMoveInput): Promise<StatusMoveOutcome> {
  const transitions = await fetchFeatureReviewTransitions(input.issueKey);
  const plan = planStatusMove({ ...input, transitions });

  if (plan.kind === 'no-op') {
    return { status: 'applied', message: null };
  }
  if (plan.kind === 'refused') {
    return { status: 'refused', message: plan.reason, reachableStatusNames: plan.reachableStatusNames };
  }
  if (plan.kind === 'needs-fields') {
    return {
      status: 'needs-fields',
      message: `Jira needs a few more answers before this move: ${plan.requiredFields.map((field) => field.name).join(', ')}.`,
      transitionId: plan.transitionId,
      requiredFields: plan.requiredFields,
    };
  }

  try {
    if (plan.kind === 'field-only') {
      await writeSubStatusField(input.issueKey, input.subStatusFieldId, plan.subStatusValue);
      return { status: 'applied', message: null };
    }
    if (plan.kind === 'transition-only') {
      await saveFeatureReviewTransition(input.issueKey, plan.transitionId);
      return { status: 'applied', message: null };
    }
    if (plan.kind === 'transition-with-substatus') {
      await saveFeatureReviewTransition(input.issueKey, plan.transitionId, {
        [input.subStatusFieldId]: plan.subStatusValue === null ? null : { value: plan.subStatusValue },
      });
      return { status: 'applied', message: null };
    }
  } catch (error: unknown) {
    // Everything above is a single request, so a failure leaves Jira exactly as it was.
    return { status: 'failed', message: String(error), shouldRevertCard: true };
  }

  // The two-step plan: the status change lands first and stands on its own from here.
  try {
    await saveFeatureReviewTransition(input.issueKey, plan.transitionId);
  } catch (error: unknown) {
    return { status: 'failed', message: String(error), shouldRevertCard: true };
  }

  try {
    await writeSubStatusField(input.issueKey, input.subStatusFieldId, plan.subStatusValue);
    return { status: 'applied', message: null };
  } catch (error: unknown) {
    const actualState = await readIssueStateAfterPartialWrite(input.issueKey, input.subStatusFieldId);
    return {
      status: 'partially-applied',
      shouldRevertCard: false,
      actualStatusName: actualState.statusName,
      actualSubStatusValue: actualState.subStatusValue,
      message:
        plan.subStatusValue === null
          ? `Moved to "${input.targetMapping.jiraStatusName}", but the sub-status could not be cleared:`
            + ` ${String(error)}`
          : `Moved to "${input.targetMapping.jiraStatusName}", but the sub-status could not be set to `
            + `"${plan.subStatusValue}": ${String(error)}`,
    };
  }
}
