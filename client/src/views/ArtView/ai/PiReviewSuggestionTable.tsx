// PiReviewSuggestionTable.tsx — The review gate: every AI suggestion passes through here, and the
// user accepts or rejects each one individually. Nothing reaches a PI Review row without a click.
//
// ── Article VII drift justification ────────────────────────────────────────────────────────────
// This is a new component because no reuse candidate exists, verified against all three:
//   • FeatureCanvas/ai/AiSuggestionPanel.tsx:266 — the only per-item Accept/Reject UI in the app, but
//     ~15 lines of inline JSX with FeatureCanvas-local styles, not exported or parameterised, and it
//     carries a single `proposedValue` where we need current-vs-proposed across two cells.
//   • ReportsHub/AgingTriageActionTable.tsx — a browsing table whose rows expand to detail; it has no
//     accept/reject gate at all.
//   • SprintDashboard/RiskManagementSection.tsx — applies AI results to Jira wholesale with NO review;
//     its per-row status is write-outcome feedback, not consent.
// The copy/paste shell, the exchange hook and the clipboard helper ARE reused (see PiReviewAiPanel).
// ───────────────────────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'

import type { PiReviewAiSuggestion } from './piReviewAiAssist.ts'
import type { PiReviewSuggestionFieldSelection } from './piReviewAiApply.ts'
import styles from './PiReviewAi.module.css'

/** Props for the review table: what the AI proposed, what the rows say now, and the three verdicts. */
export interface PiReviewSuggestionTableProps {
  /** The suggestions still awaiting a decision, in page-row order. */
  suggestions: readonly PiReviewAiSuggestion[]
  /** Each Feature's current Point Estimate, so a conflict with a human value is visible not silent. */
  currentEstimatesByKey: Record<string, string>
  /**
   * Which Features are carryover rows. Their Point Estimate is remaining effort, not a fresh size, so
   * their point-estimate checkbox starts OFF and the row is marked — the AI must not silently resize them.
   */
  carryOverByKey: Record<string, boolean>
  /** Apply this one suggestion to its row, limited to the fields the user left ticked. */
  onAccept: (suggestion: PiReviewAiSuggestion, selection: PiReviewSuggestionFieldSelection) => void
  /** Discard this one suggestion; its row is untouched. */
  onReject: (suggestion: PiReviewAiSuggestion) => void
  /** Supply the number an XXL suggestion needs before it can be accepted. */
  onSupplyPoints: (suggestion: PiReviewAiSuggestion, points: number) => void
}

/** Which of a suggestion's four cells actually carry a value to offer, so only those get a toggle. */
interface SuggestionPresentFields {
  pointEstimate: boolean
  notes: boolean
  devWork: boolean
  testSupport: boolean
}

/** Reads which fields the suggestion carries — an absent field gets neither a checkbox nor an edit. */
function readPresentFields(suggestion: PiReviewAiSuggestion): SuggestionPresentFields {
  return {
    // A recognised size puts an estimate on offer (XXL included — it just needs a number first).
    pointEstimate: suggestion.size !== null,
    notes: readProposedNoteLines(suggestion).length > 0,
    devWork: suggestion.devWork !== null,
    testSupport: suggestion.testSupport !== null,
  }
}

/** The note lines a suggestion would append, labelled exactly as they will appear in the cell. */
function readProposedNoteLines(suggestion: PiReviewAiSuggestion): string[] {
  const noteLines: string[] = []
  if (suggestion.dependencyNote) noteLines.push(`Dependency note: ${suggestion.dependencyNote}`)
  if (suggestion.riskNote) noteLines.push(`Risk note: ${suggestion.riskNote}`)
  if (suggestion.implementationNote) noteLines.push(`Implementation note: ${suggestion.implementationNote}`)
  return noteLines
}

/** The estimate this suggestion would write, or null when it would leave the cell alone. */
function readProposedEstimate(suggestion: PiReviewAiSuggestion): number | null {
  return suggestion.userSuppliedPoints ?? suggestion.derivedPoints
}

/**
 * Plain-English lines for the checkbox verdicts, so Accept is never a blind tick.
 *
 * A box the model had no verdict on produces no line at all — showing "Dev Work: no" would read as
 * a judgement when it was silence, and silence leaves the cell untouched.
 */
function readProposedBoxLines(suggestion: PiReviewAiSuggestion): string[] {
  const boxLines: string[] = []
  if (suggestion.devWork !== null) {
    boxLines.push(suggestion.devWork
      ? 'Dev Work — tick: the team builds this'
      : 'Dev Work — untick: the team does not build this')
  }
  if (suggestion.testSupport !== null) {
    boxLines.push(suggestion.testSupport
      ? "Test Support — tick: the team only supports another team's testing"
      : 'Test Support — untick: this is not only test support')
  }
  return boxLines
}

/**
 * True once Accept would actually do something: at least one offered field is still ticked, and the
 * estimate — if it is the ticked field — is not an XXL still waiting for its number. Unticking the
 * estimate lifts that XXL block, because a number is only needed for a field being applied.
 */
function canAcceptSelection(
  present: SuggestionPresentFields,
  selection: PiReviewSuggestionFieldSelection,
  isXxlAwaitingNumber: boolean,
): boolean {
  const anyFieldSelected =
    (present.pointEstimate && selection.pointEstimate)
    || (present.notes && selection.notes)
    || (present.devWork && selection.devWork)
    || (present.testSupport && selection.testSupport)
  const estimateBlockedByXxl = selection.pointEstimate && isXxlAwaitingNumber
  return anyFieldSelected && !estimateBlockedByXxl
}

/** One row of the review: each offered change is a labelled checkbox the user includes or excludes. */
function SuggestionRow({
  suggestion,
  currentEstimate,
  isCarryOver,
  onAccept,
  onReject,
  onSupplyPoints,
}: {
  suggestion: PiReviewAiSuggestion
  currentEstimate: string
  isCarryOver: boolean
  onAccept: (suggestion: PiReviewAiSuggestion, selection: PiReviewSuggestionFieldSelection) => void
  onReject: (suggestion: PiReviewAiSuggestion) => void
  onSupplyPoints: (suggestion: PiReviewAiSuggestion, points: number) => void
}) {
  const proposedEstimate = readProposedEstimate(suggestion)
  const proposedNoteLines = readProposedNoteLines(suggestion)
  const proposedBoxLines = readProposedBoxLines(suggestion)
  const present = readPresentFields(suggestion)
  const hasEstimateConflict = currentEstimate.trim() !== '' && proposedEstimate !== null
  const isXxlAwaitingNumber = suggestion.state === 'needsPoints'

  // Every offered field starts ticked, so a plain Accept applies the whole suggestion as before —
  // EXCEPT the point estimate on a carryover row, which starts OFF. That row's estimate is remaining
  // effort carried from the prior PI, and a fresh AI size would silently destroy it; the user can still
  // tick it deliberately. Notes/risks/dependencies stay on, since those do legitimately change.
  const [selection, setSelection] = useState<PiReviewSuggestionFieldSelection>(() => ({
    pointEstimate: present.pointEstimate && !isCarryOver,
    notes: present.notes,
    devWork: present.devWork,
    testSupport: present.testSupport,
  }))

  function toggleField(field: keyof PiReviewSuggestionFieldSelection): void {
    setSelection((current) => ({ ...current, [field]: !current[field] }))
  }

  function handleSupplyPoints(rawValue: string): void {
    const parsedPoints = Number(rawValue)
    // Garbage is ignored rather than written: an estimate must be a number or nothing.
    if (rawValue.trim() !== '' && Number.isFinite(parsedPoints)) {
      onSupplyPoints(suggestion, parsedPoints)
    }
  }

  return (
    <li className={isCarryOver ? `${styles.suggestionRow} ${styles.suggestionRowCarryOver}` : styles.suggestionRow}>
      <div className={styles.suggestionHeader}>
        <strong className={styles.suggestionKey}>{suggestion.issueKey}</strong>
        {isCarryOver && (
          <span className={styles.suggestionCarryOverBadge} title="Carried over from the prior PI — its Point Estimate is remaining effort, so it is left unticked by default.">
            Carryover — points left unticked
          </span>
        )}
        {suggestion.size === null ? (
          <span className={styles.suggestionWarning}>size not recognised — estimate left alone</span>
        ) : (
          <span className={styles.suggestionSize}>
            {suggestion.size}
            {isXxlAwaitingNumber ? ' (100+) — set a value' : ''}
          </span>
        )}
        {proposedEstimate !== null && <span className={styles.suggestionPoints}>{proposedEstimate}</span>}
      </div>

      {suggestion.rationale && <p className={styles.suggestionRationale}>{suggestion.rationale}</p>}

      <div className={styles.suggestionFields}>
        {present.pointEstimate && (
          // A div wrapper, not a <label>: the XXL points input nested below must not sit inside a
          // label (a label may hold only one control). The htmlFor ties the heading to the checkbox.
          <div className={styles.suggestionField}>
            <input
              aria-label={`Apply point estimate for ${suggestion.issueKey}`}
              checked={selection.pointEstimate}
              id={`${suggestion.issueKey}-apply-estimate`}
              onChange={() => toggleField('pointEstimate')}
              type="checkbox"
            />
            <div className={styles.suggestionFieldBody}>
              {hasEstimateConflict ? (
                <label className={styles.suggestionConflict} htmlFor={`${suggestion.issueKey}-apply-estimate`}>
                  Replaces your estimate of <strong>{currentEstimate}</strong> with <strong>{proposedEstimate}</strong>.
                </label>
              ) : (
                <label htmlFor={`${suggestion.issueKey}-apply-estimate`}>
                  Set Point Estimate{proposedEstimate !== null ? ` to ${proposedEstimate}` : ''}
                </label>
              )}
              {isXxlAwaitingNumber && (
                <label className={styles.suggestionPointsField}>
                  Points
                  <input
                    aria-label={`Points for ${suggestion.issueKey}`}
                    inputMode="numeric"
                    onChange={(changeEvent) => handleSupplyPoints(changeEvent.target.value)}
                    placeholder="100+"
                    type="text"
                  />
                </label>
              )}
            </div>
          </div>
        )}

        {present.notes && (
          // A div wrapper because the note lines are a <ul> (flow content a label may not contain).
          <div className={styles.suggestionField}>
            <input
              aria-label={`Overwrite Implementation Notes for ${suggestion.issueKey}`}
              checked={selection.notes}
              id={`${suggestion.issueKey}-apply-notes`}
              onChange={() => toggleField('notes')}
              type="checkbox"
            />
            <div className={styles.suggestionFieldBody}>
              <label htmlFor={`${suggestion.issueKey}-apply-notes`}>Overwrite Implementation Notes:</label>
              <ul className={styles.suggestionNotes}>
                {proposedNoteLines.map((noteLine) => <li key={noteLine}>{noteLine}</li>)}
              </ul>
            </div>
          </div>
        )}

        {proposedBoxLines.map((boxLine) => {
          const isDevWorkLine = boxLine.startsWith('Dev Work')
          const field = isDevWorkLine ? 'devWork' : 'testSupport'
          return (
            // Body is plain text, so a <label> wrapper is valid and gives the whole line as a target.
            <label className={styles.suggestionField} key={boxLine}>
              <input
                aria-label={`Apply ${isDevWorkLine ? 'Dev Work' : 'Test Support'} for ${suggestion.issueKey}`}
                checked={selection[field]}
                onChange={() => toggleField(field)}
                type="checkbox"
              />
              <span className={styles.suggestionFieldBody}>{boxLine}</span>
            </label>
          )
        })}
      </div>

      <div className={styles.suggestionActions}>
        <button
          className={styles.suggestionAccept}
          disabled={!canAcceptSelection(present, selection, isXxlAwaitingNumber)}
          onClick={() => onAccept(suggestion, selection)}
          title={isXxlAwaitingNumber && selection.pointEstimate ? 'Set a point value for this XXL Feature, or untick the estimate.' : undefined}
          type="button"
        >
          Accept
        </button>
        <button className={styles.suggestionReject} onClick={() => onReject(suggestion)} type="button">
          Reject
        </button>
      </div>
    </li>
  )
}

/**
 * Renders the pending AI suggestions for review, or nothing when there are none.
 *
 * Each row shows what would change and what it would replace, as a checklist the user tunes before
 * accepting. A row can only ever affect four cells — Point Estimate, Implementation Notes, Dev Work
 * and Test Support — and the user includes or excludes each one independently, so Accept is never
 * all-or-nothing.
 */
export function PiReviewSuggestionTable({
  suggestions,
  currentEstimatesByKey,
  carryOverByKey,
  onAccept,
  onReject,
  onSupplyPoints,
}: PiReviewSuggestionTableProps): React.JSX.Element | null {
  if (suggestions.length === 0) {
    return null
  }

  return (
    <ul aria-label="AI suggestions" className={styles.suggestionList}>
      {suggestions.map((suggestion) => (
        <SuggestionRow
          currentEstimate={currentEstimatesByKey[suggestion.issueKey] ?? ''}
          isCarryOver={carryOverByKey[suggestion.issueKey] ?? false}
          key={suggestion.issueKey}
          onAccept={onAccept}
          onReject={onReject}
          onSupplyPoints={onSupplyPoints}
          suggestion={suggestion}
        />
      ))}
    </ul>
  )
}
