// HygieneAiPanel.tsx — The Hygiene page's AI Assist panel (behind the Ctrl+Alt+Z gate).
//
// Follows the house AI-assist pattern end to end: build ONE prompt covering the page's AI-fixable
// flags, hand it to an agent (copy/paste or the automatic exchange), ingest the structured reply,
// and list each proposed fix for an individual Accept / Decline. Accepting writes that one fix to
// Jira through the same helpers the inline Fix controls use, then asks the page to rescan so the
// cleared flag visibly disappears. Nothing is ever written without a per-item click.
//
// Reuse (Article VII): ReportAiPanel is the copy/paste shell, useAiAssistExchange is the
// dispatch/poll, extractJsonPayload/{kind,items[]} is the shared envelope (via hygieneAiAssist),
// and featureReviewFixes are the writes (via hygieneAiApply). Only the review list here is new.

import { useCallback, useMemo, useState } from 'react'

import { useAiAssistExchange } from '../../SnowHub/hooks/useAiAssistExchange.ts'
import { ReportAiPanel } from '../../ReportsHub/ReportAiPanel.tsx'
import type { HygieneFieldConfig, HygieneFinding } from '../checks/hygieneChecks.ts'
import {
  buildHygieneAiPrompt,
  hasAiFixableFlags,
  parseHygieneAiReply,
  type HygieneAiProposal,
} from './hygieneAiAssist.ts'
import { applyHygieneAiProposal } from './hygieneAiApply.ts'
import styles from '../HygieneView.module.css'

/**
 * The standing disclosure. The shell's default wording claims the panel writes nothing to Jira —
 * untrue here: accepting a proposal writes that field (or posts that comment) immediately, so the
 * real consequence must be on screen from the outset.
 */
const JIRA_WRITE_DISCLOSURE =
  'review each proposal · accepting writes that one field (or comment) to Jira immediately'
const NO_FIXABLE_FLAGS_MESSAGE =
  'No AI-fixable flags on this page — run Hygiene first, or everything fixable is already clean.'

/** Where one proposal sits in its lifecycle. Only `applied` has touched Jira. */
type ProposalStatus =
  | { state: 'pending' }
  | { state: 'applying' }
  | { state: 'applied' }
  | { state: 'failed'; message: string }

/** Props: the page's current findings, the resolved field config, and the rescan callback. */
export interface HygieneAiPanelProps {
  findings: readonly HygieneFinding[]
  fieldConfig: HygieneFieldConfig
  /** Called after a successful write so the page rescans and the fixed flag disappears. */
  onIssueFixed: (issueKey: string) => void
}

/** Renders the AI Assist workflow for the Hygiene page. The parent gates it behind Ctrl+Alt+Z. */
export function HygieneAiPanel({ findings, fieldConfig, onIssueFixed }: HygieneAiPanelProps) {
  const { isRunning, runAiAssistExchange } = useAiAssistExchange()
  const [proposals, setProposals] = useState<HygieneAiProposal[]>([])
  const [statusByProposal, setStatusByProposal] = useState<Record<string, ProposalStatus>>({})
  const [unknownKeys, setUnknownKeys] = useState<string[]>([])
  const [unparsedCount, setUnparsedCount] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const fixableFindings = useMemo(() => findings.filter(hasAiFixableFlags), [findings])
  const promptText = useMemo(
    () => (fixableFindings.length === 0 ? '' : buildHygieneAiPrompt(fixableFindings)),
    [fixableFindings],
  )

  // Both paths land here. Auto is a shortcut past the paste box, never a second pipeline.
  const applyResponse = useCallback((responseText: string) => {
    try {
      const runResult = parseHygieneAiReply(responseText, fixableFindings.map((finding) => finding.issue.key))
      setProposals(runResult.proposals)
      setStatusByProposal({})
      setUnknownKeys(runResult.unknownKeys)
      setUnparsedCount(runResult.unparsedCount)
      setErrorMessage(null)
      setStatusMessage(runResult.proposals.length === 0 ? 'No usable proposals in that reply.' : null)
    } catch (parseError) {
      setErrorMessage(parseError instanceof Error ? parseError.message : 'Could not read the response.')
    }
  }, [fixableFindings])

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

  function proposalKey(proposal: HygieneAiProposal): string {
    return `${proposal.issueKey}:${proposal.checkId}`
  }

  function setProposalStatus(proposal: HygieneAiProposal, status: ProposalStatus) {
    setStatusByProposal((currentStatuses) => ({ ...currentStatuses, [proposalKey(proposal)]: status }))
  }

  async function handleAccept(proposal: HygieneAiProposal) {
    setProposalStatus(proposal, { state: 'applying' })
    try {
      await applyHygieneAiProposal(proposal, fieldConfig)
      setProposalStatus(proposal, { state: 'applied' })
      onIssueFixed(proposal.issueKey)
    } catch (applyError) {
      setProposalStatus(proposal, {
        state: 'failed',
        message: applyError instanceof Error ? applyError.message : String(applyError),
      })
    }
  }

  function handleDecline(declined: HygieneAiProposal) {
    setProposals((currentProposals) => currentProposals.filter(
      (proposal) => proposalKey(proposal) !== proposalKey(declined),
    ))
  }

  if (fixableFindings.length === 0 && proposals.length === 0) {
    return <p className={styles.aiEmptyNote}>{NO_FIXABLE_FLAGS_MESSAGE}</p>
  }

  return (
    <ReportAiPanel
      error={errorMessage}
      hint={JIRA_WRITE_DISCLOSURE}
      ingestLabel="Review proposals"
      onIngest={applyResponse}
      onRunAuto={handleRunAuto}
      isRunning={isRunning}
      prompt={promptText}
      title="AI Assist hygiene fixes"
    >
      {statusMessage !== null && <p className={styles.aiStatusNote}>{statusMessage}</p>}

      {unknownKeys.length > 0 && (
        <p className={styles.aiWarningNote}>
          Ignored proposals for <strong>{unknownKeys.join(', ')}</strong> — not on this page.
        </p>
      )}
      {unparsedCount > 0 && (
        <p className={styles.aiWarningNote}>
          {unparsedCount} proposal{unparsedCount === 1 ? '' : 's'} could not be read and {unparsedCount === 1 ? 'was' : 'were'} skipped.
        </p>
      )}

      {proposals.length > 0 && (
        <ul aria-label="AI fix proposals" className={styles.aiProposalList}>
          {proposals.map((proposal) => {
            const status = statusByProposal[proposalKey(proposal)] ?? { state: 'pending' }
            return (
              <li className={styles.aiProposalRow} key={proposalKey(proposal)}>
                <div className={styles.aiProposalHeader}>
                  <strong>{proposal.issueKey}</strong>
                  <span className={styles.aiProposalCheck}>{proposal.checkId}</span>
                </div>
                <p className={styles.aiProposalValue}>{proposal.proposedValue}</p>
                {proposal.rationale && <p className={styles.aiProposalRationale}>{proposal.rationale}</p>}
                {status.state === 'failed' && (
                  <p className={styles.aiProposalError} role="alert">⚠ {status.message}</p>
                )}
                <div className={styles.aiProposalActions}>
                  {status.state === 'applied' ? (
                    <span className={styles.aiProposalApplied}>✓ Applied</span>
                  ) : (
                    <>
                      <button
                        className={styles.aiProposalAccept}
                        disabled={status.state === 'applying'}
                        onClick={() => void handleAccept(proposal)}
                        type="button"
                      >
                        {status.state === 'applying' ? 'Applying…' : 'Accept'}
                      </button>
                      <button
                        className={styles.aiProposalDecline}
                        disabled={status.state === 'applying'}
                        onClick={() => handleDecline(proposal)}
                        type="button"
                      >
                        Decline
                      </button>
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </ReportAiPanel>
  )
}
