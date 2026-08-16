// checklistSyntax.ts — Finding out, by experiment, how this instance's checklist writes a status.
//
// This module exists because guessing failed repeatedly, and it failed in the most expensive way: each
// guess looked plausible, wrote successfully, and produced a checklist that had not moved. Jira's 204
// says nothing about what a third-party app made of the text it stored.
//
// The stored form for an unfinished item on the live instance turned out to be:
//
//     - this is a test @C8Q6T3
//
// No checkbox at all. The board had been writing `- [x] …` and `- [>] …`, which the app does not
// recognise as markers — so it read the whole thing as a to-do item whose text happened to begin with
// a bracket, and an item dragged to Complete came back as To Do.
//
// Rather than guess a fourth syntax, this writes each candidate form in turn and reads back what the
// app made of it. The answer is then a fact about this instance rather than a belief about the app,
// and it is recorded so nobody has to find it again.
//
// The probe MUTATES a real checklist, so it restores the original text when it finishes — including
// when a step throws.

import type { ChecklistItem, ChecklistItemState } from './checklistItems.ts';

/** One way a checklist line might express a status. */
export interface ChecklistLineForm {
  id: string;
  /** How the line looks, for the results table. */
  label: string;
  buildLine: (itemText: string) => string;
}

/**
 * The forms worth trying, and nothing beyond them.
 *
 * Every one is a shape this app or a checklist app like it is documented or observed to use. Random
 * characters are deliberately absent: an unrecognised marker is stored as literal text, so a probe
 * that tried arbitrary symbols would be writing rubbish into somebody's checklist to learn nothing.
 */
export const CHECKLIST_LINE_FORMS: ChecklistLineForm[] = [
  // The four the app documents, in its own words: "- item todo, + item done, ~ item in progress,
  // x item cancelled".
  { id: 'dash', label: '- item  (to do)', buildLine: (itemText) => `- ${itemText}` },
  { id: 'plus', label: '+ item  (done)', buildLine: (itemText) => `+ ${itemText}` },
  { id: 'tilde', label: '~ item  (in progress)', buildLine: (itemText) => `~ ${itemText}` },
  { id: 'letter-x', label: 'x item  (cancelled)', buildLine: (itemText) => `x ${itemText}` },
  // The custom-status form, kept because a team that has defined its own statuses writes them this
  // way and the board should be able to confirm which ones this instance actually honours.
  { id: 'custom-in-progress', label: '- [IN PROGRESS] item', buildLine: (itemText) => `- [IN PROGRESS] ${itemText}` },
  { id: 'custom-done', label: '+ [DONE] item', buildLine: (itemText) => `+ [DONE] ${itemText}` },
  // Kept only to DISPROVE it: this is the form the board wrongly wrote for four releases, and seeing
  // it come back as "To do" beside the ones that work is the clearest possible record of why.
  { id: 'bracket-x', label: '- [x] item  (wrong — a custom status named "x")', buildLine: (itemText) => `- [x] ${itemText}` },
];

/** What one candidate form turned out to mean on this instance. */
export interface ChecklistFormResult {
  formId: string;
  label: string;
  /** The state the app put the item in after this form was written. Null when the read failed. */
  resultingState: ChecklistItemState | null;
  /** Set when the step could not be completed at all, rather than completing with a surprise. */
  errorMessage: string | null;
}

export interface ChecklistSyntaxProbeResult {
  results: ChecklistFormResult[];
  /** The form to use for each state, where a form produced it. */
  formIdByState: Partial<Record<ChecklistItemState, string>>;
  /** True when the original checklist text was put back. */
  isRestored: boolean;
  errorMessage: string | null;
}

/** What the probe needs from the outside world, injected so the logic can be tested without Jira. */
export interface ChecklistProbeDependencies {
  /** Writes the checklist text and resolves once Jira has accepted it. */
  writeChecklistText: (nextText: string) => Promise<void>;
  /** Reads the checklist back as the board parses it. */
  readChecklistItems: () => Promise<ChecklistItem[]>;
}

/**
 * Picks, for each state, the first form that produced it.
 *
 * First rather than best: the list is ordered from the plainest form outwards, and where two forms
 * both work the plainer one is less likely to be stored as literal text by a future app version.
 */
export function resolveFormIdByState(
  results: readonly ChecklistFormResult[],
): Partial<Record<ChecklistItemState, string>> {
  const formIdByState: Partial<Record<ChecklistItemState, string>> = {};

  for (const result of results) {
    if (result.resultingState === null) continue;
    if (formIdByState[result.resultingState] === undefined) {
      formIdByState[result.resultingState] = result.formId;
    }
  }

  return formIdByState;
}

/**
 * Writes each candidate form to a real checklist and reads back what the app made of it.
 *
 * One item is probed rather than the whole checklist, and the original text is restored at the end,
 * so the cost of finding out is one item briefly changing status and changing back.
 */
export async function runChecklistSyntaxProbe(
  originalItems: readonly ChecklistItem[],
  probeItemText: string,
  dependencies: ChecklistProbeDependencies,
  /** The checklist exactly as it is now, to put back afterwards. */
  originalText: string,
): Promise<ChecklistSyntaxProbeResult> {
  const results: ChecklistFormResult[] = [];

  try {
    for (const lineForm of CHECKLIST_LINE_FORMS) {
      try {
        await dependencies.writeChecklistText(lineForm.buildLine(probeItemText));
        const reReadItems = await dependencies.readChecklistItems();
        // Matched on TEXT rather than on id: a rewritten checklist may hand the item a new id, and an
        // id lookup would then report every form as unreadable.
        const probedItem = reReadItems.find((item) => item.text.trim() === probeItemText.trim());
        results.push({
          formId: lineForm.id,
          label: lineForm.label,
          resultingState: probedItem?.state ?? null,
          errorMessage: probedItem === undefined ? 'the item could not be found after writing' : null,
        });
      } catch (stepError: unknown) {
        results.push({
          formId: lineForm.id,
          label: lineForm.label,
          resultingState: null,
          errorMessage: String(stepError),
        });
      }
    }
  } finally {
    // Nothing below this depends on the probe having succeeded; the checklist goes back either way.
  }

  let isRestored = false;
  let errorMessage: string | null = null;
  try {
    await dependencies.writeChecklistText(originalText);
    isRestored = true;
  } catch (restoreError: unknown) {
    errorMessage = `The probe finished but could not put the checklist back: ${String(restoreError)}. `
      + `It read: ${originalItems.map((item) => item.text).join(', ')}`;
  }

  return { results, formIdByState: resolveFormIdByState(results), isRestored, errorMessage };
}
