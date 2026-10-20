// createOutcome.ts — Reads the create path's result line into the changes made per environment, the notes, and what is missing.
//
// Framework-first: Toolbox's createChg already reports everything it did (and what failed) as one summary line, in a
// fixed format (useCrgState formatCreatedChangeSummary). Reading that line keeps createChg untouched beyond the one
// recorded drift; targets are always created in REL → PRD → PFIX order, so the n-th change belongs to the n-th asked.

import type { PlanEnvironmentKey } from './ctaskEnvironmentPlan.ts';

/** One change that now exists. */
export interface CreatedChangeSummary {
  environmentLabel: PlanEnvironmentKey | null;
  changeNumber: string;
}

/** Everything the result screen shows about one create attempt. */
export interface CreateOutcome {
  createdChanges: CreatedChangeSummary[];
  /** Extra outcomes: outages not made, PRBs linked or skipped, task dates not set. */
  notes: string[];
  failureText: string | null;
  /** Environments still without a change — what "Retry what's missing" creates. */
  missingEnvironments: PlanEnvironmentKey[];
  isComplete: boolean;
}

const CHANGE_NUMBER_PATTERN = /\bCHG\d+\b/g;
const LATER_FAILURE_MARKER = '; then a later submission failed: ';
const PARTIAL_TASK_FAILURE_PATTERN = /^(CHG\d+) created, but ([\s\S]*)$/;
const ERROR_PREFIX = 'Error: ';
const NOTE_SEPARATOR = '; ';

/** The text before any failure, and the failure itself (null when the whole attempt worked). */
function splitFailure(summaryText: string): { headText: string; failureText: string | null } {
  const laterFailureIndex = summaryText.indexOf(LATER_FAILURE_MARKER);
  if (laterFailureIndex !== -1) {
    return { headText: summaryText.slice(0, laterFailureIndex), failureText: summaryText.slice(laterFailureIndex + LATER_FAILURE_MARKER.length).trim() };
  }
  const partialTaskMatch = PARTIAL_TASK_FAILURE_PATTERN.exec(summaryText);
  if (partialTaskMatch) return { headText: `${partialTaskMatch[1]} created`, failureText: partialTaskMatch[2].trim() };
  if (summaryText.startsWith(ERROR_PREFIX)) return { headText: '', failureText: summaryText.slice(ERROR_PREFIX.length).trim() };
  return { headText: summaryText, failureText: null };
}

/**
 * Reads a create result line. `attemptedEnvironments` are the environments this attempt asked for, in the order
 * createChg makes them; a line naming no change at all is a refusal before anything was sent.
 */
export function readCreateOutcome(summaryText: string, attemptedEnvironments: readonly PlanEnvironmentKey[]): CreateOutcome {
  const { headText, failureText } = splitFailure(summaryText.trim());
  const [createdListText, ...noteParts] = headText.split(NOTE_SEPARATOR);
  const changeNumbers = createdListText.match(CHANGE_NUMBER_PATTERN) ?? [];
  const createdChanges = changeNumbers.map((changeNumber, index) => ({ environmentLabel: attemptedEnvironments[index] ?? null, changeNumber }));
  const resolvedFailureText = failureText ?? (changeNumbers.length === 0 ? summaryText.trim() : null);
  const missingEnvironments = attemptedEnvironments.slice(createdChanges.length);
  return {
    createdChanges,
    notes: noteParts.map((notePart) => notePart.trim()).filter((notePart) => notePart !== ''),
    failureText: resolvedFailureText,
    missingEnvironments,
    isComplete: resolvedFailureText === null && missingEnvironments.length === 0,
  };
}

/** The changes from every attempt so far, one per environment (a retry never makes a second for the same one). */
export function mergeCreatedChanges(earlierChanges: readonly CreatedChangeSummary[], newChanges: readonly CreatedChangeSummary[]): CreatedChangeSummary[] {
  const mergedChanges = [...earlierChanges];
  for (const newChange of newChanges) {
    if (!mergedChanges.some((existingChange) => existingChange.changeNumber === newChange.changeNumber)) mergedChanges.push(newChange);
  }
  return mergedChanges;
}

/** A link that opens the change by its number on the ServiceNow site the Wizard runs in. */
export function buildChangeLink(serviceNowOrigin: string, changeNumber: string): string {
  return `${serviceNowOrigin.replace(/\/+$/, '')}/change_request.do?sysparm_query=${encodeURIComponent(`number=${changeNumber}`)}`;
}
