// piReviewAiApply.ts — Turns an accepted AI suggestion into a PI Review row.
//
// This file is where the feature's central guarantee lives, so it is deliberately tiny and pure.
//
// An accepted suggestion may touch exactly FOUR cells, and the user chooses which of them per row
// (an all-or-nothing accept would force an unwanted estimate to ride in with a wanted note):
//   • pointEstimate — replaced, when the suggestion resolved to a number
//   • notes         — replaced with the AI's composed note block (not appended), like the estimate
//   • devWork       — ticked/unticked, when the model gave a verdict
//   • testSupport   — ticked/unticked, when the model gave a verdict
//
// Everything else is off limits, and not by convention — by consequence. Dependency, Risks and
// Priority are rebuilt from the Jira issue on every page load, so text written there would be
// blanked (and, for Dependency/Risks, migrated into notes) the next time the page opened. The user
// would watch their AI results move or vanish. Rather than fight that, the AI contributes the
// explanation those columns cannot hold, as a labelled note line.
//
// Dev Work and Test Support are on the surface for the opposite reason: reconcile passes them
// straight through, so they are human-owned and an accepted value survives the next load. They are
// the PO's own judgement about what the team is being asked to do — build it, or only help test
// what another team built — which is exactly the kind of reading the material supports.
//
// See specs/016-pi-review-ai-assist/contracts/cell-write-contract.md.

import { appendUniqueNoteLine } from '../piReviewJira.ts'
import type { PiReviewRow } from '../piReviewTable.ts'
import { MAX_AI_NOTE_LENGTH, type PiReviewAiSuggestion } from './piReviewAiAssist.ts'

/**
 * Which of a suggestion's four cells the user chose to apply. A suggestion offers up to four edits;
 * the review UI lets the PO tick each one on or off before accepting, so a good note need not drag
 * an unwanted estimate onto the row with it. A `false` field is left exactly as it was.
 */
export interface PiReviewSuggestionFieldSelection {
  pointEstimate: boolean
  notes: boolean
  devWork: boolean
  testSupport: boolean
}

/** The default when a caller does not specify: apply everything the suggestion carries. */
export const ALL_SUGGESTION_FIELDS_SELECTED: PiReviewSuggestionFieldSelection = {
  pointEstimate: true,
  notes: true,
  devWork: true,
  testSupport: true,
}

/**
 * The note labels, in the order they are appended.
 *
 * `Dependency note` and `Risk note` are deliberately the labels reconciliation already writes when
 * it migrates hand-typed text out of those columns — AI-authored and migration-authored notes are
 * the same kind of thing (an explanation that cannot live in a Jira-mirrored column) and should read
 * identically. Dependency-before-Risk mirrors reconciliation's own order.
 */
const NOTE_LABELS = {
  dependency: 'Dependency note',
  risk: 'Risk note',
  implementation: 'Implementation note',
} as const

/** The literal the PI Review table reads as a ticked box; anything else renders unticked. */
const CHECKBOX_TICKED_VALUE = 'Yes'
/** The literal written for an unticked box, matching what an empty row carries. */
const CHECKBOX_UNTICKED_VALUE = ''

/** The estimate this suggestion resolves to, or null when it must leave the cell alone. */
function readResolvedEstimate(suggestion: PiReviewAiSuggestion): number | null {
  // XXL carries no derived number — "100+" is a floor. Only a user-supplied value unblocks it.
  return suggestion.userSuppliedPoints ?? suggestion.derivedPoints
}

/**
 * Resolves one checkbox cell against the model's verdict.
 *
 * A null verdict means the model said nothing, and that is NOT the same as `false`: unticking a box
 * on the strength of silence would quietly undo a human's judgement. Only an explicit verdict moves
 * the cell.
 */
function applyCheckboxVerdict(currentValue: string, verdict: boolean | null): string {
  if (verdict === null) {
    return currentValue
  }
  return verdict ? CHECKBOX_TICKED_VALUE : CHECKBOX_UNTICKED_VALUE
}

/** Truncates AI text to the cap before it can reach a cell. */
function capNoteText(noteText: string): string {
  return noteText.length > MAX_AI_NOTE_LENGTH ? `${noteText.slice(0, MAX_AI_NOTE_LENGTH)}…` : noteText
}

/** Appends one AI note line to a block, reusing reconciliation's convention (label + dedupe). */
function appendAiNote(notes: string, label: string, noteText: string | null): string {
  if (noteText === null) {
    return notes
  }
  return appendUniqueNoteLine(notes, label, capNoteText(noteText))
}

/**
 * Composes the AI's note block from its up-to-three labelled lines, in reconciliation's order, or
 * null when the suggestion carries no note at all.
 *
 * Built from an empty string rather than the row's notes: the block REPLACES the cell (like the
 * estimate replaces its cell), so a repeat accept can never stack a second copy. Null vs empty is
 * the "silence leaves the cell alone" signal the caller relies on — a suggestion with nothing to
 * say about the notes must not blank a human's text.
 */
function composeAiNoteBlock(suggestion: PiReviewAiSuggestion): string | null {
  let noteBlock = ''
  noteBlock = appendAiNote(noteBlock, NOTE_LABELS.dependency, suggestion.dependencyNote)
  noteBlock = appendAiNote(noteBlock, NOTE_LABELS.risk, suggestion.riskNote)
  noteBlock = appendAiNote(noteBlock, NOTE_LABELS.implementation, suggestion.implementationNote)
  return noteBlock === '' ? null : noteBlock
}

/**
 * Applies one accepted suggestion to its row, returning a new row.
 *
 * Pure: no I/O, no mutation. Accepting produces an unsaved edit indistinguishable from typing —
 * publishing it stays a deliberate Save to Confluence click.
 *
 * Each of the four permitted cells is written only when the user selected it AND the suggestion
 * actually carries a value for it; otherwise the cell is left exactly as it was. Overwriting notes
 * (rather than appending) mirrors the estimate: an accepted suggestion states the cell, it does not
 * add to it — which is why the per-field selection matters, so a note the user does not want cannot
 * silently erase what they typed.
 *
 * @param row - The row the suggestion belongs to.
 * @param suggestion - The suggestion the user has accepted.
 * @param selection - Which of the four cells to apply (defaults to all).
 * @returns A new row with at most `pointEstimate`, `notes`, `devWork` and `testSupport` changed.
 */
export function applyPiReviewSuggestion(
  row: PiReviewRow,
  suggestion: PiReviewAiSuggestion,
  selection: PiReviewSuggestionFieldSelection = ALL_SUGGESTION_FIELDS_SELECTED,
): PiReviewRow {
  const resolvedEstimate = readResolvedEstimate(suggestion)
  const composedNotes = composeAiNoteBlock(suggestion)

  return {
    ...row,
    // An unresolved size (outside the scale, or an XXL with no number yet) leaves the cell alone —
    // the suggestion is still worth accepting for its notes and box verdicts.
    pointEstimate: selection.pointEstimate && resolvedEstimate !== null ? String(resolvedEstimate) : row.pointEstimate,
    // Replace with the AI block when selected and present; silence (null) leaves the cell alone.
    notes: selection.notes && composedNotes !== null ? composedNotes : row.notes,
    devWork: selection.devWork ? applyCheckboxVerdict(row.devWork, suggestion.devWork) : row.devWork,
    testSupport: selection.testSupport ? applyCheckboxVerdict(row.testSupport, suggestion.testSupport) : row.testSupport,
  }
}

export { MAX_AI_NOTE_LENGTH }
