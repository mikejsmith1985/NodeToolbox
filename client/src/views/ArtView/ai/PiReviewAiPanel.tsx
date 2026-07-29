// PiReviewAiPanel.tsx — The PI Review tab's AI Assistance panel.
//
// Builds one prompt covering every Feature on the page, offers both the manual (copy/paste) and
// automatic (dispatch + poll) paths, and presents the reply as per-Feature suggestions the user
// accepts row by row. It applies nothing itself: Accept hands the suggestion up to the tab, which
// owns the row edit and the unsaved-changes flag. Saving to Confluence stays a deliberate act.
//
// Reuse (Article VII): ReportAiPanel is the copy/paste shell (extended additively with the auto
// path rather than forked), useAiAssistExchange is the dispatch/poll, aiAssistStore is the gate.
// Only the review table below it is new — see PiReviewSuggestionTable's justification.

import { useCallback, useEffect, useMemo, useState } from 'react'

import { useAiAssistStore } from '../../../store/aiAssistStore.ts'
import { useAiAssistExchange } from '../../SnowHub/hooks/useAiAssistExchange.ts'
import { ReportAiPanel } from '../../ReportsHub/ReportAiPanel.tsx'
import type { PiReviewRow } from '../piReviewTable.ts'
import { extractPiReviewFeatureKey } from '../piReviewJira.ts'
import {
  buildPiReviewAiPrompt,
  parsePiReviewAiReply,
  type PiReviewAiColumnAvailability,
  type PiReviewAiSuggestion,
} from './piReviewAiAssist.ts'
import type { PiReviewSuggestionFieldSelection } from './piReviewAiApply.ts'
import { fetchPiReviewAiContexts, type PiReviewAiFeatureContext } from './piReviewAiFetch.ts'
import {
  readPointEstimate,
  suggestPiReviewStartDates,
  type PiWorkingWindow,
  type RankedFeature,
  type SuggestedStart,
} from './piReviewStartDates.ts'
import { PiReviewSuggestionTable } from './PiReviewSuggestionTable.tsx'
import styles from './PiReviewAi.module.css'

/**
 * The panel's standing disclosure. FR-030 makes this a requirement rather than UI copy: accepting an
 * estimate arms the existing Jira write-back (it fires when Jira's estimate is empty — exactly the
 * gap an AI estimate fills), and by design there is no provenance to distinguish it from a typed
 * one. This sentence is the only thing between the user and an unexpected Jira edit, so it must be
 * on screen from the outset, not revealed alongside the Accept controls.
 */
const JIRA_WRITE_DISCLOSURE =
  'review each suggestion · an accepted estimate can update the Jira issue when Jira has none';

/** Props: the rows to size, which optional columns exist, and where an accepted suggestion goes. */
export interface PiReviewAiPanelProps {
  /** The PI Review rows currently on the page. */
  rows: readonly PiReviewRow[]
  /**
   * Which optional columns this page's table actually has. Dev Work and Test Support are optional,
   * so the prompt must not ask for a verdict the table has nowhere to put.
   */
  columnAvailability: PiReviewAiColumnAvailability
  /**
   * Called once per accepted suggestion, with the subset of fields the user kept ticked; the tab
   * applies just those to the row and marks the page dirty.
   */
  onApplySuggestion: (suggestion: PiReviewAiSuggestion, selection: PiReviewSuggestionFieldSelection) => void
  /**
   * The PI's working window (from the PI label's date range), or null when the label carries no
   * dates. Drives the rule-based Target Start suggestions; null hides them behind a how-to hint.
   */
  piWindow: PiWorkingWindow | null
  /**
   * Called when the user accepts a suggested Target Start — the tab writes it straight to Jira for
   * that Feature (option (a)). Returns a promise so the row can show a "writing…" state.
   */
  onApplyStartDate: (issueKey: string, startIso: string) => void | Promise<void>
}

/** Reads each Feature's current estimate so the review can show a conflict rather than hide it. */
function readCurrentEstimatesByKey(rows: readonly PiReviewRow[]): Record<string, string> {
  const estimatesByKey: Record<string, string> = {}
  for (const row of rows) {
    const issueKey = extractPiReviewFeatureKey(row.feature)
    if (issueKey !== null) {
      estimatesByKey[issueKey] = row.pointEstimate
    }
  }
  return estimatesByKey
}

/**
 * Flags which Features are carryover rows, so the review can protect their remaining-effort estimate.
 *
 * A carryover row's Point Estimate is deliberately its REMAINING effort, not a fresh size — so the AI
 * must not silently overwrite it. The suggestion table uses this to mark those rows and default their
 * point-estimate checkbox off; notes, risks and dependencies still apply, since those legitimately change.
 */
function readCarryOverByKey(rows: readonly PiReviewRow[]): Record<string, boolean> {
  const carryOverByKey: Record<string, boolean> = {}
  for (const row of rows) {
    const issueKey = extractPiReviewFeatureKey(row.feature)
    if (issueKey !== null) {
      carryOverByKey[issueKey] = row.carryOver === 'Yes'
    }
  }
  return carryOverByKey
}

/**
 * Reads the page's Features in rank order (top row = highest priority) with their point estimates,
 * de-duplicated by key. This is the input to the rule-based Target Start scheduler — the order here IS
 * the priority order the schedule assumes.
 */
function readRankedFeatures(rows: readonly PiReviewRow[]): RankedFeature[] {
  const seenKeys = new Set<string>()
  const rankedFeatures: RankedFeature[] = []
  for (const row of rows) {
    const issueKey = extractPiReviewFeatureKey(row.feature)
    if (issueKey === null || seenKeys.has(issueKey)) {
      continue
    }
    seenKeys.add(issueKey)
    rankedFeatures.push({ issueKey, points: readPointEstimate(row.pointEstimate) })
  }
  return rankedFeatures
}

/**
 * The rule-based Target Start section: each schedulable Feature with its suggested start, its finish
 * day, an over-commitment warning when it would spill past the PI, and an Accept that writes the
 * Target Start to Jira. Shown only inside the (unlocked) AI Assist panel; a null PI window swaps the
 * list for a one-line how-to.
 */
function StartDateSuggestions({ piWindow, suggestions, onApply }: {
  piWindow: PiWorkingWindow | null
  suggestions: readonly SuggestedStart[]
  onApply: (issueKey: string, startIso: string) => void | Promise<void>
}): React.JSX.Element | null {
  const [appliedKeys, setAppliedKeys] = useState<Set<string>>(new Set())
  const [busyKey, setBusyKey] = useState<string | null>(null)

  if (piWindow === null) {
    return (
      <details className={styles.sizingCard}>
        <summary className={styles.sizingSummary}>Suggested start dates</summary>
        <p className={styles.startDateHint}>
          Add the PI dates to the PI name (e.g. “PI 26.3 (05/21/26 - 07/29/26)”) to get rule-based Target Start suggestions.
        </p>
      </details>
    )
  }

  // Only Features that carry an estimate can be scheduled — the rest need a Point Estimate first.
  const schedulableSuggestions = suggestions.filter((suggestion) => suggestion.startIso !== null)
  if (schedulableSuggestions.length === 0) {
    return null
  }

  const handleApply = async (suggestion: SuggestedStart): Promise<void> => {
    if (suggestion.startIso === null) {
      return
    }
    setBusyKey(suggestion.issueKey)
    try {
      await onApply(suggestion.issueKey, suggestion.startIso)
      setAppliedKeys((previous) => new Set(previous).add(suggestion.issueKey))
    } catch {
      // The tab surfaces the failure via a toast; leave the row un-applied so it can be retried.
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <details className={styles.sizingCard} open>
      <summary className={styles.sizingSummary}>Suggested start dates (rule-based · 1 point = 1 working day)</summary>
      <p className={styles.startDateHint}>
        Ranked top-to-bottom by priority and scheduled one after another from the PI’s first working day. Accept to write the Target Start to Jira.
      </p>
      <ul className={styles.suggestionList}>
        {schedulableSuggestions.map((suggestion) => {
          const isApplied = appliedKeys.has(suggestion.issueKey)
          const isBusy = busyKey === suggestion.issueKey
          return (
            <li className={styles.suggestionRow} key={suggestion.issueKey}>
              <div className={styles.suggestionHeader}>
                <span className={styles.suggestionKey}>{suggestion.issueKey}</span>
                <span className={styles.startDateMeta}>
                  {suggestion.points} pt · start <span className={styles.startDateValue}>{suggestion.startIso}</span> · finishes {suggestion.endIso}
                </span>
                {!suggestion.fitsInPi && (
                  <span className={styles.suggestionWarning}>⚠ finishes after the PI ends</span>
                )}
              </div>
              <div className={styles.suggestionActions}>
                {isApplied ? (
                  <span className={styles.startDateApplied}>✓ Target Start written to Jira</span>
                ) : (
                  <button
                    className={styles.suggestionAccept}
                    disabled={isBusy}
                    onClick={() => void handleApply(suggestion)}
                    type="button"
                  >
                    {isBusy ? 'Writing…' : 'Accept start date'}
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </details>
  )
}

/** Renders the AI Assistance panel, or nothing when AI Assist is locked. */
export function PiReviewAiPanel({ rows, columnAvailability, onApplySuggestion, piWindow, onApplyStartDate }: PiReviewAiPanelProps): React.JSX.Element | null {
  const isUnlocked = useAiAssistStore((state) => state.isAiAssistUnlocked)
  const { isRunning, runAiAssistExchange } = useAiAssistExchange()

  const [featureContexts, setFeatureContexts] = useState<PiReviewAiFeatureContext[]>([])
  const [suggestions, setSuggestions] = useState<PiReviewAiSuggestion[]>([])
  const [unknownKeys, setUnknownKeys] = useState<string[]>([])
  const [unparsedCount, setUnparsedCount] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const hasFeatures = useMemo(
    () => rows.some((row) => extractPiReviewFeatureKey(row.feature) !== null),
    [rows],
  )
  const currentEstimatesByKey = useMemo(() => readCurrentEstimatesByKey(rows), [rows])
  const carryOverByKey = useMemo(() => readCarryOverByKey(rows), [rows])

  // Rule-based Target Start suggestions: derived purely from rank (row order) + point estimate +
  // the PI window, independent of the AI reply — so they are available as soon as the panel opens.
  const rankedFeatures = useMemo(() => readRankedFeatures(rows), [rows])
  const startDateSuggestions = useMemo(
    () => (piWindow === null ? [] : suggestPiReviewStartDates(rankedFeatures, piWindow)),
    [piWindow, rankedFeatures],
  )

  // Gather the prompt's inputs once the panel is visible and there is something to size. This is the
  // AI panel's OWN fetch — a page load never pays for the description/AC it needs.
  useEffect(() => {
    if (!isUnlocked || !hasFeatures) {
      return
    }
    let isActive = true
    const timeoutHandle = setTimeout(() => {
      void (async () => {
        try {
          const contexts = await fetchPiReviewAiContexts(rows)
          if (isActive) setFeatureContexts(contexts)
        } catch (fetchError) {
          if (isActive) {
            setErrorMessage(fetchError instanceof Error ? fetchError.message : 'Could not read these Features from Jira.')
          }
        }
      })()
    }, 0)
    return () => {
      isActive = false
      clearTimeout(timeoutHandle)
    }
  }, [isUnlocked, hasFeatures, rows])

  const promptText = useMemo(
    () => (featureContexts.length === 0 ? '' : buildPiReviewAiPrompt(featureContexts, columnAvailability)),
    [columnAvailability, featureContexts],
  )

  // Both paths land here. Auto is a shortcut past the paste box, never a second pipeline.
  const applyResponse = useCallback((responseText: string) => {
    try {
      const runResult = parsePiReviewAiReply(responseText, featureContexts.map((context) => context.issueKey))
      setSuggestions(runResult.suggestions)
      setUnknownKeys(runResult.unknownKeys)
      setUnparsedCount(runResult.unparsedCount)
      setErrorMessage(null)
      setStatusMessage(runResult.suggestions.length === 0 ? 'No usable suggestions in that reply.' : null)
    } catch (parseError) {
      setErrorMessage(parseError instanceof Error ? parseError.message : 'Could not read the response.')
    }
  }, [featureContexts])

  const handleRunAuto = useCallback(() => {
    void (async () => {
      setStatusMessage('Sending to AI Assist…')
      // runAiAssistExchange never throws — every failure is a returned {ok:false, message}.
      const exchange = await runAiAssistExchange(promptText)
      if (!exchange.ok) {
        setStatusMessage(null)
        setErrorMessage(exchange.message)
        return
      }
      setStatusMessage(null)
      applyResponse(exchange.response ?? '')
    })()
  }, [applyResponse, promptText, runAiAssistExchange])

  /** Removes a suggestion from the review list once it has been decided either way. */
  const dropSuggestion = useCallback((decided: PiReviewAiSuggestion) => {
    setSuggestions((current) => current.filter((suggestion) => suggestion.issueKey !== decided.issueKey))
  }, [])

  const handleAccept = useCallback((accepted: PiReviewAiSuggestion, selection: PiReviewSuggestionFieldSelection) => {
    onApplySuggestion(accepted, selection)
    dropSuggestion(accepted)
  }, [dropSuggestion, onApplySuggestion])

  const handleSupplyPoints = useCallback((target: PiReviewAiSuggestion, points: number) => {
    // Supplying the number an XXL Feature needs is what unblocks its Accept.
    setSuggestions((current) => current.map((suggestion) => (
      suggestion.issueKey === target.issueKey
        ? { ...suggestion, userSuppliedPoints: points, state: 'pending' as const }
        : suggestion
    )))
  }, [])

  if (!isUnlocked) {
    return null
  }

  if (!hasFeatures) {
    return (
      <section className={styles.aiPanelEmpty}>
        <p>No Features on this page to size yet — use <strong>Pull Features from Jira</strong> first.</p>
      </section>
    )
  }

  return (
    <ReportAiPanel
      error={errorMessage}
      hint={JIRA_WRITE_DISCLOSURE}
      ingestLabel="Review suggestions"
      onIngest={applyResponse}
      onRunAuto={handleRunAuto}
      isRunning={isRunning}
      prompt={promptText}
      title="AI Assistance"
    >
      {statusMessage !== null && <p className={styles.aiStatus}>{statusMessage}</p>}

      <StartDateSuggestions piWindow={piWindow} suggestions={startDateSuggestions} onApply={onApplyStartDate} />

      {unknownKeys.length > 0 && (
        <p className={styles.aiWarning}>
          Ignored {unknownKeys.length} suggestion{unknownKeys.length === 1 ? '' : 's'} for{' '}
          <strong>{unknownKeys.join(', ')}</strong> — not on this page.
        </p>
      )}
      {unparsedCount > 0 && (
        <p className={styles.aiWarning}>
          {unparsedCount} item{unparsedCount === 1 ? '' : 's'} could not be read and {unparsedCount === 1 ? 'was' : 'were'} skipped.
        </p>
      )}

      <PiReviewSuggestionTable
        carryOverByKey={carryOverByKey}
        currentEstimatesByKey={currentEstimatesByKey}
        onAccept={handleAccept}
        onReject={dropSuggestion}
        onSupplyPoints={handleSupplyPoints}
        suggestions={suggestions}
      />
    </ReportAiPanel>
  )
}
