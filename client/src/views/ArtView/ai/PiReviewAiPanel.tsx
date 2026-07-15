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
import { buildPiReviewAiPrompt, parsePiReviewAiReply, type PiReviewAiSuggestion } from './piReviewAiAssist.ts'
import { fetchPiReviewAiContexts, type PiReviewAiFeatureContext } from './piReviewAiFetch.ts'
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

/** Props: the rows to size, and where an accepted suggestion goes. */
export interface PiReviewAiPanelProps {
  /** The PI Review rows currently on the page. */
  rows: readonly PiReviewRow[]
  /** Called once per accepted suggestion; the tab applies it to the row and marks the page dirty. */
  onApplySuggestion: (suggestion: PiReviewAiSuggestion) => void
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

/** Renders the AI Assistance panel, or nothing when AI Assist is locked. */
export function PiReviewAiPanel({ rows, onApplySuggestion }: PiReviewAiPanelProps): React.JSX.Element | null {
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
    () => (featureContexts.length === 0 ? '' : buildPiReviewAiPrompt(featureContexts)),
    [featureContexts],
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

  const handleAccept = useCallback((accepted: PiReviewAiSuggestion) => {
    onApplySuggestion(accepted)
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
        currentEstimatesByKey={currentEstimatesByKey}
        onAccept={handleAccept}
        onReject={dropSuggestion}
        onSupplyPoints={handleSupplyPoints}
        suggestions={suggestions}
      />
    </ReportAiPanel>
  )
}
