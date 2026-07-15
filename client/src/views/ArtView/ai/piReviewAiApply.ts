// piReviewAiApply.ts — Turns an accepted AI suggestion into a PI Review row.
//
// This file is where the feature's central guarantee lives, so it is deliberately tiny and pure.
//
// An accepted suggestion may touch exactly FOUR cells:
//   • pointEstimate — replaced, when the suggestion resolved to a number
//   • notes         — appended to, never overwritten
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

/** Appends one AI note line, reusing the reconciliation's own convention and its dedupe. */
function appendAiNote(notes: string, label: string, noteText: string | null): string {
  if (noteText === null) {
    return notes
  }
  return appendUniqueNoteLine(notes, label, capNoteText(noteText))
}

/**
 * Applies one accepted suggestion to its row, returning a new row.
 *
 * Pure: no I/O, no mutation. Accepting produces an unsaved edit indistinguishable from typing —
 * publishing it stays a deliberate Save to Confluence click.
 *
 * @param row - The row the suggestion belongs to.
 * @param suggestion - The suggestion the user has accepted.
 * @returns A new row with at most `pointEstimate` and `notes` changed.
 */
export function applyPiReviewSuggestion(row: PiReviewRow, suggestion: PiReviewAiSuggestion): PiReviewRow {
  const resolvedEstimate = readResolvedEstimate(suggestion)

  let nextNotes = row.notes
  nextNotes = appendAiNote(nextNotes, NOTE_LABELS.dependency, suggestion.dependencyNote)
  nextNotes = appendAiNote(nextNotes, NOTE_LABELS.risk, suggestion.riskNote)
  nextNotes = appendAiNote(nextNotes, NOTE_LABELS.implementation, suggestion.implementationNote)

  return {
    ...row,
    // An unresolved size (outside the scale, or an XXL with no number yet) leaves the cell alone —
    // the suggestion is still worth accepting for its notes and box verdicts.
    pointEstimate: resolvedEstimate === null ? row.pointEstimate : String(resolvedEstimate),
    notes: nextNotes,
    devWork: applyCheckboxVerdict(row.devWork, suggestion.devWork),
    testSupport: applyCheckboxVerdict(row.testSupport, suggestion.testSupport),
  }
}

export { MAX_AI_NOTE_LENGTH }
