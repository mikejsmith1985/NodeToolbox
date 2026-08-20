// HygieneAiPanel.tsx — The Hygiene page's AI Assist panel (behind the Ctrl+Alt+Z gate).
//
// Follows the house AI-assist pattern end to end: build ONE prompt covering the page's AI-fixable
// flags, hand it to an agent (manual copy-out / paste-back), ingest the structured reply,
// and list each proposed fix for an individual Accept / Decline. Accepting writes that one fix to
// Jira through the same helpers the inline Fix controls use, then asks the page to rescan so the
// cleared flag visibly disappears. Nothing is ever written without a per-item click.
//
// Reuse (Article VII): ReportAiPanel is the copy/paste shell, extractJsonPayload/{kind,items[]}
// is the shared envelope (via hygieneAiAssist), and featureReviewFixes are the writes (via
// hygieneAiApply). Only the review list here is new.

import { useCallback, useEffect, useMemo, useState } from 'react'

import { ReportAiPanel } from '../../ReportsHub/ReportAiPanel.tsx'
import type { HygieneFieldConfig, HygieneFinding } from '../checks/hygieneChecks.ts'
import {
  buildHygieneAiPromptPlan,
  hasAiFixableFlags,
  parseHygieneAiReply,
  type HygieneAiProposal,
  type StaleIssueContext,
} from './hygieneAiAssist.ts'
import { applyHygieneAiProposal } from './hygieneAiApply.ts'
import { fetchStaleIssueContexts } from './hygieneAiFetch.ts'
import {
  fetchFeatureReviewFixVersions,
  readProjectKeyFromIssueKey,
} from '../../SprintDashboard/featureReviewFixes.ts'
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

/**
 * The "no filter" value, as a module constant rather than a default `[]` in the signature.
 *
 * A literal default is a NEW array on every render, and this value feeds the dependency array of
 * the memo that feeds the effects — so the default alone re-ran the comment fetch on every render
 * and spun the panel in an endless render loop.
 */
const NO_CHECK_RESTRICTION: readonly string[] = []

/** Where one proposal sits in its lifecycle. Only `applied` has touched Jira. */
type ProposalStatus =
  | { state: 'pending' }
  | { state: 'applying' }
  | { state: 'applied' }
  | { state: 'failed'; message: string }

/** Props: the page's current findings, the resolved field config, and the rescan callback. */
export interface HygieneAiPanelProps {
  findings: readonly HygieneFinding[]
  /**
   * The checks the page is filtered to, or empty for "no filter".
   *
   * Someone reading the stale list is working on stale issues; asking the agent about every missing
   * estimate and absent acceptance criterion as well is how one run reached 181,411 characters
   * against a 128,000-character input box and was refused outright (GH #375).
   */
  restrictToCheckIds?: readonly string[]
  fieldConfig: HygieneFieldConfig
  /** Called after a successful write so the page rescans and the fixed flag disappears. */
  onIssueFixed: (issueKey: string) => void
}

/** Renders the AI Assist workflow for the Hygiene page. The parent gates it behind Ctrl+Alt+Z. */
export function HygieneAiPanel({
  findings,
  restrictToCheckIds = NO_CHECK_RESTRICTION,
  fieldConfig,
  onIssueFixed,
}: HygieneAiPanelProps) {
  const [proposals, setProposals] = useState<HygieneAiProposal[]>([])
  const [statusByProposal, setStatusByProposal] = useState<Record<string, ProposalStatus>>({})
  const [unknownKeys, setUnknownKeys] = useState<string[]>([])
  const [unparsedCount, setUnparsedCount] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const fixableFindings = useMemo(
    () => findings.filter((finding) => hasAiFixableFlags(finding, restrictToCheckIds)),
    [findings, restrictToCheckIds],
  )

  // The stale asks carry each issue's LAST COMMENT so the model can decline to nudge a ticket that
  // already explains its delay. Fetched on demand, only for stale-flagged issues; failures degrade
  // to "no comment context" inside the fetcher, so the prompt always builds.
  const [staleContextsByKey, setStaleContextsByKey] = useState<Record<string, StaleIssueContext>>({})
  useEffect(() => {
    if (fixableFindings.length === 0) {
      return
    }
    let isActive = true
    void fetchStaleIssueContexts(fixableFindings, restrictToCheckIds).then((contexts) => {
      if (isActive) setStaleContextsByKey(contexts)
    })
    return () => {
      isActive = false
    }
  }, [fixableFindings, restrictToCheckIds])

  // The projects in play, and the open releases each one actually has. Without this the model was
  // asked to name a fix version with nothing to go on and invented plausible ones — "PY 2027 AEP" —
  // which Jira rejected with a 400. A model cannot guess a release schedule; it can pick from one.
  const [openVersionNamesByProject, setOpenVersionNamesByProject] = useState<Record<string, string[]>>({})
  useEffect(() => {
    const projectKeys = [...new Set(
      fixableFindings.map((finding) => readProjectKeyFromIssueKey(finding.issue.key)).filter(Boolean),
    )]
    if (projectKeys.length === 0) {
      setOpenVersionNamesByProject({})
      return
    }

    let isActive = true
    void Promise.all(projectKeys.map(async (projectKey) => {
      const versions = await fetchFeatureReviewFixVersions(projectKey).catch(() => [])
      return [projectKey, versions.map((version) => version.label).filter(Boolean)] as const
    })).then((entries) => {
      if (isActive) setOpenVersionNamesByProject(Object.fromEntries(entries))
    })
    return () => { isActive = false }
  }, [fixableFindings])

  const promptPlan = useMemo(
    () => buildHygieneAiPromptPlan(
      fixableFindings,
      { restrictToCheckIds },
      staleContextsByKey,
      openVersionNamesByProject,
    ),
    [fixableFindings, restrictToCheckIds, staleContextsByKey, openVersionNamesByProject],
  )
  const promptText = fixableFindings.length === 0 ? '' : promptPlan.promptText

  // Both paths land here. Auto is a shortcut past the paste box, never a second pipeline.
  const applyResponse = useCallback((responseText: string) => {
    try {
      const runResult = parseHygieneAiReply(responseText, promptPlan.includedIssueKeys)
      setProposals(runResult.proposals)
      setStatusByProposal({})
      setUnknownKeys(runResult.unknownKeys)
      setUnparsedCount(runResult.unparsedCount)
      setErrorMessage(null)
      setStatusMessage(runResult.proposals.length === 0 ? 'No usable proposals in that reply.' : null)
    } catch (parseError) {
      setErrorMessage(parseError instanceof Error ? parseError.message : 'Could not read the response.')
    }
  }, [promptPlan.includedIssueKeys])

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
      prompt={promptText}
      title="AI Assist hygiene fixes"
    >
      {statusMessage !== null && <p className={styles.aiStatusNote}>{statusMessage}</p>}

      {/* A prompt that quietly covers 60 of 300 issues reads exactly like one that covers all of
          them; the difference only shows up when the missing 240 turn up unfixed weeks later. */}
      {promptPlan.omittedCount > 0 && (
        <p className={styles.aiWarningNote}>
          This prompt covers <strong>{promptPlan.includedCount}</strong> of{' '}
          {promptPlan.includedCount + promptPlan.omittedCount} issues — the rest would not fit the
          agent&apos;s input limit. Fix these, rescan, and run it again for the remainder, or filter
          the page to one flag to cover more issues per run.
        </p>
      )}

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
