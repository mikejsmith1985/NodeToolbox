// ReleasePriorityPanel.tsx — The Releases tab's "Prioritise Release" round trip: copy one prompt
// out, paste the ranking back, review it top-to-bottom, then write "01" … "NN" into Status Summary.
//
// Propose-only, like every AI surface here: the assistant never touches Jira. The person sees the
// whole proposed order — with the current Status Summary beside the new one and the assistant's
// reason for each row — and nothing is written until they press the one button that writes it.
// Rows the assistant skipped are shown flagged, not hidden, so an incomplete reply cannot quietly
// demote the work it forgot to the bottom of the release.
//
// The tab already gates this behind the AI Assist unlock and only offers the button when unlocked,
// so this panel is a modal in the same style as the release-notes and dev-skip prompts.

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { JiraIssue } from '../../../types/jira.ts';
import { useCopyFeedback } from '../../../hooks/useCopyFeedback.ts';
import styles from '../SprintDashboardView.module.css';
import {
  fetchReleasePriorityContext,
  resolveReleasePriorityFieldIds,
  writeStatusSummaryPlan,
  type ReleasePriorityContext,
  type StatusSummaryWriteOutcome,
} from './releasePriorityApply.ts';
import {
  buildReleasePriorityPrompt,
  buildStatusSummaryPlan,
  calculateAgeDays,
  parseReleasePriorityReply,
  type ReleasePriorityPromptIssue,
  type ReleasePriorityRankResult,
  type StatusSummaryPlanEntry,
} from './releasePriorityRank.ts';

const COPY_PROMPT_LABEL = '📋 Copy Prompt';
const COPIED_LABEL = '✓ Copied!';
const LOAD_RANKING_LABEL = '↩ Load ranking';
const CLOSE_LABEL = 'Close';
const CONTEXT_LOADING_MESSAGE = 'Reading ages, due dates and Feature dates…';
const CONTEXT_FAILED_MESSAGE =
  'Could not read ages, due dates or Feature dates — the prompt below ranks on Priority and status alone.';
const UNRANKED_ROW_NOTE = 'not ranked by the assistant — appended in its original order';
const INSTRUCTIONS =
  'Copy this prompt into AI Assist, paste the JSON reply below, review the order, then write it. '
  + 'Status Summary "01" is the most important item; the last number is the least.';

/** An empty context: every signal unknown. What the prompt uses when the reads fail. */
const EMPTY_CONTEXT: ReleasePriorityContext = { issueContextByKey: new Map(), featureContextByKey: new Map() };

export interface ReleasePriorityPanelProps {
  projectKey: string;
  versionName: string;
  releaseDate: string | null;
  issues: readonly JiraIssue[];
  /** Which Feature each issue delivers, already resolved by the tab from Jira's link fields. */
  featureKeyByIssueKey: ReadonlyMap<string, string | null>;
  featureSummaryByKey: ReadonlyMap<string, string>;
  onClose: () => void;
  /** Today, injectable so the ages in the prompt are stable under test. */
  todayIso?: string;
}

type ContextState = 'loading' | 'ready' | 'failed';

/** Builds the prompt's issue list from the tab's issues plus whatever context the reads returned. */
function buildPromptIssues(
  issues: readonly JiraIssue[],
  featureKeyByIssueKey: ReadonlyMap<string, string | null>,
  featureSummaryByKey: ReadonlyMap<string, string>,
  context: ReleasePriorityContext,
  todayIso: string,
): ReleasePriorityPromptIssue[] {
  return issues.map((issue) => {
    const issueContext = context.issueContextByKey.get(issue.key);
    const featureKey = featureKeyByIssueKey.get(issue.key) ?? null;
    const featureContext = featureKey === null ? undefined : context.featureContextByKey.get(featureKey);
    return {
      issueKey: issue.key,
      summary: issue.fields.summary,
      issueTypeName: issue.fields.issuetype?.name ?? null,
      statusName: issue.fields.status?.name ?? 'Unknown',
      priorityName: issue.fields.priority?.name ?? null,
      assigneeName: issue.fields.assignee?.displayName ?? null,
      createdIso: issueContext?.createdIso ?? null,
      ageDays: calculateAgeDays(issueContext?.createdIso ?? null, todayIso),
      dueDateIso: issueContext?.dueDateIso ?? null,
      currentStatusSummary: issueContext?.currentStatusSummary ?? null,
      featureKey,
      featureSummary: featureKey === null ? '' : featureSummaryByKey.get(featureKey) ?? '',
      featureTargetEndIso: featureContext?.targetEndIso ?? null,
      featureDueDateIso: featureContext?.dueDateIso ?? null,
    };
  });
}

/** Everything one prioritise-release run holds: the reads, the prompt, the parsed order, the writes. */
interface ReleasePriorityRun {
  contextState: ContextState;
  context: ReleasePriorityContext;
  prompt: string;
  replyText: string;
  setReplyText: (replyText: string) => void;
  rankResult: ReleasePriorityRankResult | null;
  plan: StatusSummaryPlanEntry[];
  errorMessage: string | null;
  outcomeByKey: Record<string, StatusSummaryWriteOutcome>;
  isWriting: boolean;
  loadRanking: () => void;
  writeRanking: () => Promise<void>;
}

/** Reads the extra signals once on mount; a failure leaves the prompt buildable with ages unknown. */
function useReleasePriorityContext(
  issueKeys: readonly string[],
  featureKeys: readonly string[],
  fieldIds: ReturnType<typeof resolveReleasePriorityFieldIds>,
): { context: ReleasePriorityContext; contextState: ContextState } {
  const [context, setContext] = useState<ReleasePriorityContext>(EMPTY_CONTEXT);
  const [contextState, setContextState] = useState<ContextState>('loading');

  useEffect(() => {
    let isMounted = true;
    fetchReleasePriorityContext(issueKeys, featureKeys, fieldIds)
      .then((loadedContext) => {
        if (!isMounted) return;
        setContext(loadedContext);
        setContextState('ready');
      })
      .catch(() => {
        if (isMounted) setContextState('failed');
      });
    return () => { isMounted = false; };
  }, [featureKeys, fieldIds, issueKeys]);

  return { context, contextState };
}

/** Owns the round trip's state so the panel itself only renders it. */
function useReleasePriorityRun(props: Omit<ReleasePriorityPanelProps, 'onClose'> & { todayIso: string }): ReleasePriorityRun {
  const { projectKey, versionName, releaseDate, issues, featureKeyByIssueKey, featureSummaryByKey, todayIso } = props;
  const [fieldIds] = useState(() => resolveReleasePriorityFieldIds(window.localStorage));
  const [replyText, setReplyText] = useState('');
  const [rankResult, setRankResult] = useState<ReleasePriorityRankResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [outcomeByKey, setOutcomeByKey] = useState<Record<string, StatusSummaryWriteOutcome>>({});
  const [isWriting, setIsWriting] = useState(false);

  const issueKeys = useMemo(() => issues.map((issue) => issue.key), [issues]);
  const featureKeys = useMemo(
    () => [...new Set(issueKeys.map((issueKey) => featureKeyByIssueKey.get(issueKey) ?? null))]
      .filter((featureKey): featureKey is string => featureKey !== null),
    [featureKeyByIssueKey, issueKeys],
  );
  const { context, contextState } = useReleasePriorityContext(issueKeys, featureKeys, fieldIds);

  const prompt = useMemo(() => buildReleasePriorityPrompt({
    projectKey,
    releaseName: versionName,
    releaseDate,
    todayIso: todayIso.slice(0, 'YYYY-MM-DD'.length),
    issues: buildPromptIssues(issues, featureKeyByIssueKey, featureSummaryByKey, context, todayIso),
  }), [context, featureKeyByIssueKey, featureSummaryByKey, issues, projectKey, releaseDate, todayIso, versionName]);

  const plan = useMemo<StatusSummaryPlanEntry[]>(
    () => (rankResult ? buildStatusSummaryPlan(rankResult.rankedItems) : []),
    [rankResult],
  );

  const loadRanking = useCallback(() => {
    setErrorMessage(null);
    setOutcomeByKey({});
    try {
      setRankResult(parseReleasePriorityReply(replyText, issueKeys));
    } catch (parseError) {
      setRankResult(null);
      setErrorMessage(parseError instanceof Error ? parseError.message : 'Could not read the AI reply.');
    }
  }, [issueKeys, replyText]);

  const writeRanking = useCallback(async () => {
    setIsWriting(true);
    setErrorMessage(null);
    setOutcomeByKey({});
    try {
      await writeStatusSummaryPlan(plan, fieldIds.statusSummaryFieldId, (outcome) => {
        setOutcomeByKey((current) => ({ ...current, [outcome.issueKey]: outcome }));
      });
    } finally {
      setIsWriting(false);
    }
  }, [fieldIds.statusSummaryFieldId, plan]);

  return {
    contextState, context, prompt, replyText, setReplyText, rankResult, plan,
    errorMessage, outcomeByKey, isWriting, loadRanking, writeRanking,
  };
}

/** Renders the prioritise-release modal for one fix version. */
export function ReleasePriorityPanel({ onClose, todayIso = new Date().toISOString(), ...runProps }: ReleasePriorityPanelProps): React.JSX.Element {
  const { versionName, issues } = runProps;
  const run = useReleasePriorityRun({ ...runProps, todayIso });
  const { hasCopied, confirmCopy } = useCopyFeedback();
  const isPromptReady = run.contextState !== 'loading';
  const summaryByKey = useMemo(() => new Map(issues.map((issue) => [issue.key, issue.fields.summary])), [issues]);

  return (
    <div aria-modal="true" className={styles.releasePromptOverlay} role="dialog">
      <div className={`${styles.releasePromptWideModal} ${styles.releasePriorityModal}`}>
        <h3 className={styles.releasePromptTitle}>Prioritise release {versionName}</h3>
        <p className={styles.releasePromptInstructions}>{INSTRUCTIONS}</p>
        {run.contextState === 'loading' && <p className={styles.releasePromptInstructions}>{CONTEXT_LOADING_MESSAGE}</p>}
        {run.contextState === 'failed' && <p className={styles.errorMessage}>{CONTEXT_FAILED_MESSAGE}</p>}

        <textarea
          aria-label="Release priority prompt"
          className={`${styles.releasePromptTextArea} ${styles.releasePriorityTextArea}`}
          readOnly
          value={isPromptReady ? run.prompt : ''}
        />
        <div className={styles.releasePromptActions}>
          <button
            className={styles.secondaryButton}
            disabled={!isPromptReady}
            onClick={() => confirmCopy(run.prompt)}
            type="button"
          >
            {hasCopied ? COPIED_LABEL : COPY_PROMPT_LABEL}
          </button>
          <button className={styles.textActionButton} onClick={onClose} type="button">{CLOSE_LABEL}</button>
        </div>

        <label className={styles.releasePromptInstructions} htmlFor="release-priority-reply">
          Paste the assistant&apos;s JSON reply here
        </label>
        <textarea
          aria-label="Release priority reply"
          className={`${styles.releasePromptTextArea} ${styles.releasePriorityTextArea}`}
          id="release-priority-reply"
          onChange={(changeEvent) => run.setReplyText(changeEvent.target.value)}
          value={run.replyText}
        />
        <div className={styles.releasePromptActions}>
          <button
            className={styles.secondaryButton}
            disabled={run.replyText.trim() === ''}
            onClick={run.loadRanking}
            type="button"
          >
            {LOAD_RANKING_LABEL}
          </button>
        </div>

        {run.errorMessage && <p className={styles.errorMessage} role="alert">{run.errorMessage}</p>}

        {run.rankResult && (
          <RankingPreview
            context={run.context}
            isWriting={run.isWriting}
            onWrite={() => void run.writeRanking()}
            outcomeByKey={run.outcomeByKey}
            plan={run.plan}
            rankResult={run.rankResult}
            summaryByKey={summaryByKey}
          />
        )}
      </div>
    </div>
  );
}

interface RankingPreviewProps {
  rankResult: ReleasePriorityRankResult;
  plan: readonly StatusSummaryPlanEntry[];
  context: ReleasePriorityContext;
  summaryByKey: ReadonlyMap<string, string>;
  outcomeByKey: Record<string, StatusSummaryWriteOutcome>;
  isWriting: boolean;
  onWrite: () => void;
}

/** One line saying what a write run did — counted from the outcomes, never assumed. */
function describeWriteOutcome(outcomeByKey: Record<string, StatusSummaryWriteOutcome>, planLength: number): string | null {
  const outcomes = Object.values(outcomeByKey);
  if (outcomes.length === 0) return null;
  const writtenCount = outcomes.filter((outcome) => outcome.isWritten).length;
  const failedCount = outcomes.length - writtenCount;
  const progressNote = outcomes.length < planLength ? ` · ${outcomes.length} of ${planLength} attempted` : '';
  return failedCount === 0
    ? `✓ ${writtenCount} written${progressNote}`
    : `${writtenCount} written · ⚠ ${failedCount} failed${progressNote}`;
}

/** The proposed order, top first, with the current and new Status Summary side by side. */
function RankingPreview({ rankResult, plan, context, summaryByKey, outcomeByKey, isWriting, onWrite }: RankingPreviewProps) {
  const writeOutcomeLine = describeWriteOutcome(outcomeByKey, plan.length);
  const rationaleByKey = new Map(rankResult.rankedItems.map((item) => [item.issueKey, item]));

  return (
    <section className={styles.releaseNotesSection} aria-label="Proposed release order">
      {rankResult.unknownKeys.length > 0 && (
        <p className={styles.errorMessage}>
          Ignored {rankResult.unknownKeys.length} key{rankResult.unknownKeys.length === 1 ? '' : 's'} not in this release: {rankResult.unknownKeys.join(', ')}
        </p>
      )}
      {rankResult.unrankedKeys.length > 0 && (
        <p className={styles.errorMessage}>
          The assistant did not rank {rankResult.unrankedKeys.join(', ')} — appended at the bottom in original order.
        </p>
      )}
      <div className={styles.releaseNotesTableShell}>
        <table className={`${styles.releaseNotesTable} ${styles.releasePriorityTable}`}>
          <thead>
            <tr>
              <th scope="col">New</th>
              <th scope="col">Current</th>
              <th scope="col">Issue and why it sits here</th>
              <th scope="col">Written</th>
            </tr>
          </thead>
          <tbody>
            {plan.map((planEntry) => {
              const rankedItem = rationaleByKey.get(planEntry.issueKey);
              const outcome = outcomeByKey[planEntry.issueKey];
              return (
                <tr key={planEntry.issueKey}>
                  <td className={styles.releasePriorityRankCell}><strong>{planEntry.value}</strong></td>
                  <td className={styles.releasePriorityRankCell}>
                    {context.issueContextByKey.get(planEntry.issueKey)?.currentStatusSummary ?? '—'}
                  </td>
                  <td>
                    <strong>{planEntry.issueKey}</strong> {summaryByKey.get(planEntry.issueKey) ?? ''}
                    {/* The reason sits under the item rather than in its own column, so a 720px modal
                        shows it without a horizontal scrollbar hiding it off the right edge. */}
                    {rankedItem?.wasRankedByAssistant === false
                      ? <span className={styles.releasePriorityRationale}><span className={styles.statusBadge}>{UNRANKED_ROW_NOTE}</span></span>
                      : rankedItem?.rationale
                        ? <span className={styles.releasePriorityRationale}>{rankedItem.rationale}</span>
                        : null}
                  </td>
                  <td className={styles.releasePriorityRankCell}>
                    {outcome ? (outcome.isWritten ? '✓' : `⚠ ${outcome.errorMessage ?? 'failed'}`) : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={styles.releasePromptActions}>
        <button className={styles.secondaryButton} disabled={isWriting || plan.length === 0} onClick={onWrite} type="button">
          {isWriting ? 'Writing…' : `✔ Write Status Summary to Jira (${plan.length})`}
        </button>
        {writeOutcomeLine && <span className={styles.releasePromptInstructions}>{writeOutcomeLine}</span>}
      </div>
    </section>
  );
}
