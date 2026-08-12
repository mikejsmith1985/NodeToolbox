// cardTransitions.ts — Where an issue can actually go from where it is, and which column that lands in.
//
// The board answers "where is this" well and "where can it go next" not at all. Everywhere on a board
// the answer is a guess: you drag a card at a column and find out whether the workflow allows it by
// whether it fails. For an Unmapped card there is not even a guess to make, because no column claims
// the state it is in.
//
// Jira knows the answer exactly — it is the issue's own transition list — so the open card shows it.
// And because a status name on its own does not tell a board user very much, each destination is
// named together with the COLUMN it would land in, which is the thing they were actually asking:
// move this to "Ready for Testing" and it appears under "SL TESTING". A destination no column claims
// says so, because landing back in Unmapped is a real outcome and a surprising one.

import type { FeatureReviewTransition, TransitionRequiredField } from '../featureReviewFixes.ts';
import { resolveColumnIdForItem } from './boardColumns.ts';
import { UNMAPPED_COLUMN_ID, type BoardVocabulary, type RenderedColumn } from './rollupBoardTypes.ts';

/** One place this issue can go, described the way the board talks rather than the way Jira does. */
export interface CardTransitionOption {
  transitionId: string;
  /** The workflow's own name for the step, e.g. "Start Review". */
  transitionName: string;
  /** The status the issue ends up in. */
  toStatusName: string;
  /** The board column that status lands in, or null when no column claims it. */
  landsInColumnName: string | null;
  /** Names of the fields the transition screen will demand, for saying so up front. */
  requiredFieldNames: string[];
  /**
   * The same fields in full.
   *
   * Carried so that choosing this transition can hand them straight to the dialog a refused drag
   * already uses — being asked for Story Points should look identical however the move was started.
   */
  requiredFields: TransitionRequiredField[];
}

/**
 * Works out, for each transition Jira offers, which board column the issue would end up in.
 *
 * The sub-status is deliberately carried over from the issue's CURRENT state: a plain transition
 * changes the status and leaves the sub-status alone, so that is what decides the landing column. It
 * is the honest prediction rather than the flattering one — if a move would land the card back in
 * Unmapped, the user should know that before making it, not after.
 */
export function buildCardTransitionOptions(
  transitions: readonly FeatureReviewTransition[],
  currentSubStatusValue: string | null,
  vocabulary: BoardVocabulary,
  columns: readonly RenderedColumn[],
  hasSubStatusField: boolean,
): CardTransitionOption[] {
  return (transitions ?? []).map((transition) => {
    const toStatusName = transition.to?.name ?? '';
    const landingColumnId = resolveColumnIdForItem(
      toStatusName,
      currentSubStatusValue,
      vocabulary,
      hasSubStatusField,
    );
    const landingColumn = landingColumnId === UNMAPPED_COLUMN_ID
      ? null
      : columns.find((column) => column.id === landingColumnId) ?? null;

    return {
      transitionId: transition.id,
      transitionName: transition.name,
      toStatusName,
      landsInColumnName: landingColumn ? landingColumn.name : null,
      requiredFieldNames: (transition.requiredFields ?? []).map((field) => field.name),
      requiredFields: [...(transition.requiredFields ?? [])],
    };
  });
}

/** One line per destination: the status, the column it lands in, and anything Jira will ask for first. */
export function describeCardTransitionOption(option: CardTransitionOption): string {
  const landing = option.landsInColumnName === null
    ? 'stays in Unmapped — no column claims that status'
    : `lands in ${option.landsInColumnName}`;

  if (option.requiredFieldNames.length === 0) return landing;
  return `${landing} · asks for ${option.requiredFieldNames.join(', ')}`;
}

/**
 * What to say when Jira offers nothing.
 *
 * An empty list is a real answer, not a failure — a closed issue has nowhere to go, and so does one
 * the viewer lacks permission to move. Saying "no transitions" without naming both would read as a bug.
 */
export const NO_TRANSITIONS_MESSAGE =
  'Jira offers no moves from here — the issue may be closed, or you may not have permission to move it.';
