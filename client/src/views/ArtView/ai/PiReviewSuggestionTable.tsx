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

import type { PiReviewAiSuggestion } from './piReviewAiAssist.ts'
import styles from './PiReviewAi.module.css'

/** Props for the review table: what the AI proposed, what the rows say now, and the three verdicts. */
export interface PiReviewSuggestionTableProps {
  /** The suggestions still awaiting a decision, in page-row order. */
  suggestions: readonly PiReviewAiSuggestion[]
  /** Each Feature's current Point Estimate, so a conflict with a human value is visible not silent. */
  currentEstimatesByKey: Record<string, string>
  /** Apply this one suggestion to its row. */
  onAccept: (suggestion: PiReviewAiSuggestion) => void
  /** Discard this one suggestion; its row is untouched. */
  onReject: (suggestion: PiReviewAiSuggestion) => void
  /** Supply the number an XXL suggestion needs before it can be accepted. */
  onSupplyPoints: (suggestion: PiReviewAiSuggestion, points: number) => void
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

/** True once the suggestion carries everything it needs — XXL is blocked until a number is supplied. */
function canAcceptSuggestion(suggestion: PiReviewAiSuggestion): boolean {
  return suggestion.state !== 'needsPoints'
}

/** One row of the review: what is proposed, what it would replace, and the two verdicts. */
function SuggestionRow({
  suggestion,
  currentEstimate,
  onAccept,
  onReject,
  onSupplyPoints,
}: {
  suggestion: PiReviewAiSuggestion
  currentEstimate: string
  onAccept: (suggestion: PiReviewAiSuggestion) => void
  onReject: (suggestion: PiReviewAiSuggestion) => void
  onSupplyPoints: (suggestion: PiReviewAiSuggestion, points: number) => void
}) {
  const proposedEstimate = readProposedEstimate(suggestion)
  const proposedNoteLines = readProposedNoteLines(suggestion)
  const hasEstimateConflict = currentEstimate.trim() !== '' && proposedEstimate !== null
  const isXxlAwaitingNumber = suggestion.state === 'needsPoints'

  function handleSupplyPoints(rawValue: string): void {
    const parsedPoints = Number(rawValue)
    // Garbage is ignored rather than written: an estimate must be a number or nothing.
    if (rawValue.trim() !== '' && Number.isFinite(parsedPoints)) {
      onSupplyPoints(suggestion, parsedPoints)
    }
  }

  return (
    <li className={styles.suggestionRow}>
      <div className={styles.suggestionHeader}>
        <strong className={styles.suggestionKey}>{suggestion.issueKey}</strong>
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

      {hasEstimateConflict && (
        <p className={styles.suggestionConflict}>
          Replaces your estimate of <strong>{currentEstimate}</strong> with <strong>{proposedEstimate}</strong>.
        </p>
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

      {proposedNoteLines.length > 0 && (
        <ul className={styles.suggestionNotes}>
          {proposedNoteLines.map((noteLine) => <li key={noteLine}>{noteLine}</li>)}
        </ul>
      )}

      <div className={styles.suggestionActions}>
        <button
          className={styles.suggestionAccept}
          disabled={!canAcceptSuggestion(suggestion)}
          onClick={() => onAccept(suggestion)}
          title={isXxlAwaitingNumber ? 'Set a point value for this XXL Feature before accepting.' : undefined}
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
 * Each row shows what would change and what it would replace, so Accept is an informed click. A row
 * can only ever affect two cells — Point Estimate and Implementation Notes — which is why this table
 * shows exactly those two and nothing else.
 */
export function PiReviewSuggestionTable({
  suggestions,
  currentEstimatesByKey,
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
