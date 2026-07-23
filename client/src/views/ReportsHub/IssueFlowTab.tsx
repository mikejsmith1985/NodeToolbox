// IssueFlowTab.tsx — The issue-centric Flow Analysis screen.
//
// The Personal Workflow tab answers "how much of this person's time went where". This one answers
// the question that review showed it structurally cannot: for each DELIVERED issue, where did its
// time go, and who was holding it at the time?
//
// This file fetches and renders. It contains NO analysis: the reconstruction lives in
// `issueFlowHistory.ts`, the stages and totals in `issueFlow.ts`, the meaning of a status in
// `issueFlowStatusClass.ts`, and the aggregation in `issueFlowRollup.ts` — each pure and unit-tested.
// Keeping arithmetic out of a React component is what lets every figure here be proved without a DOM.

import { useCallback, useMemo, useRef, useState } from 'react';

import { jiraGet } from '../../services/jiraApi.ts';
import { useSettingsStore } from '../../store/settingsStore.ts';
import styles from './ReportsHubView.module.css';
import {
  buildAssigneeWasClauseFromValues,
  readStoredStandupRosterMembers,
} from '../SprintDashboard/hooks/useStandupRosterStore.ts';
import { resolveRosterMachineIds } from './rosterIdentity.ts';
import { resolveReportRosterScope } from './rosterScope.ts';
import {
  ISSUE_PAGE_SIZE,
  RUN_ISSUE_BUDGET,
  fetchAllUnitIssues,
} from './flowAuditFetch.ts';
import type { FlowFetchCeiling } from './flowAuditFetch.ts';
import { readIssueHolderHistory, readIssueStatusHistory } from './issueFlowHistory.ts';
import { buildIssueFlow } from './issueFlow.ts';
import type { IssueFlow } from './issueFlow.ts';
import { createStatusClassifier } from './issueFlowStatusClass.ts';
import type { StatusFlowClass, StatusFlowOverrides } from './issueFlowStatusClass.ts';
import { computeDeliveryTotals, summariseStageRollups } from './issueFlowRollup.ts';
import { classifyIssueScope } from './issueScope.ts';
import { readBottleneckSettings } from './internalTestingStatuses.ts';
import { summariseInternalTestingCoverage } from './internalTestingCoverage.ts';
import { buildFlowAnalysisDocument } from './flowAnalysisDocument.ts';
import { readToolVersion } from './readToolVersion.ts';
import { copyToClipboard as copyToClipboardWithResult } from '../JiraTemplateMaker/lib/copyToClipboard.ts';
import type { InternalTestingCoverage } from './internalTestingCoverage.ts';
import type { StageRollup } from './issueFlowRollup.ts';
import { readConfiguredStoryPointsFieldId, readStoryPoints } from './storyPointsField.ts';

/** Lookback windows offered, matching the Personal Workflow tab so the two are comparable. */
const WINDOW_OPTIONS = [30, 60, 90, 180, 365] as const;

/** The default lookback: long enough to hold several delivered issues, short enough to stay current. */
const DEFAULT_WINDOW_DAYS = 90;

/** How a stage's class is described to a reader, in words rather than by colour alone. */
const FLOW_CLASS_LABELS: Record<StatusFlowClass, string> = {
  'not-started': 'Not started',
  active: 'Active work',
  waiting: 'Waiting',
  completed: 'Completed',
  unclassified: 'Unclassified',
};

interface RawStatus { id?: string; name?: string; statusCategory?: { key?: string } }
interface RawIssue {
  key?: string;
  fields?: Record<string, unknown> & { issuetype?: { subtask?: boolean; name?: string } | null };
}

/** What one completed run produced, including whether it is complete. */
interface FlowRunOutcome {
  issueFlows: IssueFlow[];
  fetchedIssueCount: number;
  ceilingReached: FlowFetchCeiling | null;
  /** How many fetched issues were sub-tasks, disclosed rather than quietly dropped. */
  subTaskCount: number;
  /** Who actually performed internal testing — the roster, or people outside it. */
  internalTestingCoverage: InternalTestingCoverage;
  statusNamesById: Record<string, string>;
  statusClassByStatusId: Record<string, StatusFlowClass>;
  jql: string;
  /** Run facts the copyable document needs so it stands alone once pasted out of the tool. */
  rosterLabel: string;
  windowDays: number;
  countsSubTasks: boolean;
}

/** Builds the JQL for issues the roster held AT ANY POINT — see `buildStandupRosterAssigneeWasClause`. */
function buildFlowSearchJql(rosterClause: string, windowDays: number): string {
  return `${rosterClause} AND resolutiondate >= -${windowDays}d ORDER BY resolutiondate DESC`;
}

/** Wraps the JQL with the changelog expand and page cap — the changelog is what the analysis reads. */
function buildFlowSearchPath(jql: string, storyPointsFieldId: string, startAt: number): string {
  // `issuetype` carries the `subtask` boolean the scope rule reads.
  const fields = ['summary', 'created', 'assignee', 'status', 'resolutiondate', 'issuetype', storyPointsFieldId]
    .join(',');
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&expand=changelog&fields=${fields}`
    + `&startAt=${startAt}&maxResults=${ISSUE_PAGE_SIZE}`;
}

/** Builds the statusId → category-key and statusId → name maps from the instance's status list. */
function readStatusMaps(statuses: readonly RawStatus[]) {
  const statusCategoryByStatusId: Record<string, string> = {};
  const statusNamesById: Record<string, string> = {};
  for (const status of statuses) {
    if (typeof status.id !== 'string') continue;
    statusCategoryByStatusId[status.id] = status.statusCategory?.key ?? 'new';
    if (typeof status.name === 'string') statusNamesById[status.id] = status.name;
  }
  return { statusCategoryByStatusId, statusNamesById };
}

/** Formats a duration for display. Every figure in this tab is in working days — never calendar days. */
function formatDays(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/** The Reports Hub tab: choose a window, run for the scoped roster, read where the flow went. */
export function IssueFlowTab({ teamFilter = '' }: { teamFilter?: string }): React.JSX.Element {
  // Teams are saved Dashboard Team PROFILES, each owning its own roster. Resolved through the SAME
  // helper the Personal Workflow tab uses, so both tabs scope a given team identically — and neither
  // selects the profile, which would re-point the user's Agile Hub as a side effect.
  const teamProfiles = useSettingsStore((state) => state.sprintDashboardTeamProfiles);
  const activeTeamProfileId = useSettingsStore((state) => state.sprintDashboardActiveTeamProfileId);
  const rosterScope = useMemo(
    () => resolveReportRosterScope({
      requestedTeamName: teamFilter,
      teamProfiles,
      activeTeamProfileId,
      readRosterForProfile: readStoredStandupRosterMembers,
    }),
    [teamFilter, teamProfiles, activeTeamProfileId],
  );
  const rosterMembers = rosterScope.rosterMembers;
  const effectiveTeamName = rosterScope.label;

  // The SAME setting the Personal Workflow tab reads — one source, so the two cannot disagree.
  const shouldCountSubTasks = useSettingsStore((state) => state.countSubTasksInFlowReports);
  const setShouldCountSubTasks = useSettingsStore((state) => state.setCountSubTasksInFlowReports);
  const [windowDays, setWindowDays] = useState<number>(DEFAULT_WINDOW_DAYS);
  const [statusOverrides] = useState<StatusFlowOverrides>({});
  const [outcome, setOutcome] = useState<FlowRunOutcome | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cancelRef = useRef(false);

  const runAnalysis = useCallback(async () => {
    if (rosterMembers.length === 0) {
      setErrorMessage('No roster members for this team — import a roster in the Sprint Dashboard first.');
      return;
    }

    cancelRef.current = false;
    setIsLoading(true);
    setErrorMessage(null);

    try {
      // Resolve every roster DISPLAY NAME to a Jira machine id before building the clause. Jira rejects
      // a display name in the assignee field, so querying the roster names directly returns a 400 —
      // this is the same resolution the Personal Workflow report does, now shared so both agree.
      setProgressMessage('Resolving roster members in Jira…');
      const resolvedMembers = await resolveRosterMachineIds(rosterMembers);
      const queryValues = resolvedMembers
        .map((resolved) => resolved.queryValue)
        .filter((queryValue): queryValue is string => queryValue !== null);
      const unresolvedNames = resolvedMembers
        .filter((resolved) => resolved.queryValue === null)
        .map((resolved) => resolved.member.displayName);
      const rosterClause = buildAssigneeWasClauseFromValues(queryValues);
      if (rosterClause === null) {
        setErrorMessage('None of this team’s roster members could be matched to a Jira user, so no query '
          + `could be built. Unmatched: ${unresolvedNames.join(', ') || 'all members'}.`);
        return;
      }

      setProgressMessage('Reading the instance’s statuses…');
      const statuses = await jiraGet<RawStatus[]>('/rest/api/2/status');
      const { statusCategoryByStatusId, statusNamesById } = readStatusMaps(statuses ?? []);
      const storyPointsFieldId = readConfiguredStoryPointsFieldId();
      const jql = buildFlowSearchJql(rosterClause, windowDays);

      const fetchOutcome = await fetchAllUnitIssues<RawIssue>(
        async (startAt) => {
          setProgressMessage(`Fetching issues — ${startAt} so far…`);
          const searchResponse = await jiraGet<{ issues?: RawIssue[] }>(
            buildFlowSearchPath(jql, storyPointsFieldId, startAt),
          );
          return searchResponse.issues ?? [];
        },
        { remainingRunBudget: RUN_ISSUE_BUDGET, isCancelled: () => cancelRef.current },
      );

      // A cancelled run leaves the previous results alone and produces nothing new: half an analysis
      // presented as a finished one is worse than no analysis.
      if (fetchOutcome.wasCancelled) {
        setProgressMessage(null);
        return;
      }

      setProgressMessage('Reconstructing each issue’s history…');
      const statusClassifier = createStatusClassifier(statusCategoryByStatusId, statusOverrides);
      const issueFlows = fetchOutcome.issues
        .map((issue) => toIssueFlow(issue, {
          statusCategoryByStatusId, statusNamesById, statusClassifier, storyPointsFieldId,
          shouldCountSubTasks,
        }))
        .filter((issueFlow): issueFlow is IssueFlow => issueFlow !== null);

      setOutcome({
        issueFlows,
        fetchedIssueCount: fetchOutcome.issues.length,
        subTaskCount: shouldCountSubTasks
          ? 0
          : fetchOutcome.issues
            .filter((issue) => classifyIssueScope(issue.fields?.issuetype) === 'sub-task').length,
        // Uses the SAME internal-testing statuses the Bottleneck panel was configured with, so the
        // two figures on this page cannot disagree about which statuses count as internal testing.
        internalTestingCoverage: summariseInternalTestingCoverage({
          issueFlows,
          rosterMembers,
          internalTestingStatusNames: readBottleneckSettings().statusNames,
        }),
        ceilingReached: fetchOutcome.ceilingReached,
        statusNamesById,
        statusClassByStatusId: readClassificationUsed(issueFlows),
        jql,
        rosterLabel: effectiveTeamName,
        windowDays,
        countsSubTasks: shouldCountSubTasks,
      });
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : 'The flow analysis could not run.');
    } finally {
      setIsLoading(false);
      setProgressMessage(null);
    }
  }, [rosterMembers, effectiveTeamName, windowDays, statusOverrides, shouldCountSubTasks]);

  return (
    <div>
      <p className={styles.captionText} style={{ marginTop: 0 }}>
        For every issue the <strong>{effectiveTeamName}</strong> roster delivered in the
        window, this shows where its time went and who was holding it — including time it spent in
        nobody’s hands. All durations are <strong>working days</strong> (Monday–Friday).
      </p>
      {!rosterScope.isRequestedTeamMatched && (
        <p className={styles.captionText}>
          “{teamFilter}” is not one of your saved teams — showing <strong>{effectiveTeamName}</strong> instead.
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <label>
          Window{' '}
          <select value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))}>
            {WINDOW_OPTIONS.map((option) => <option key={option} value={option}>{option} days</option>)}
          </select>
        </label>
        <button type="button" className={styles.actionButton} onClick={() => { void runAnalysis(); }} disabled={isLoading}>
          {isLoading ? 'Analysing…' : 'Run flow analysis'}
        </button>
        {isLoading && (
          <button type="button" className={styles.actionButton} onClick={() => { cancelRef.current = true; }}>
            Cancel
          </button>
        )}
        {progressMessage !== null && <span className={styles.captionText}>{progressMessage}</span>}
      </div>

      <label style={{ display: 'block', marginTop: 8 }} className={styles.captionText}>
        <input
          type="checkbox"
          checked={shouldCountSubTasks}
          onChange={(event) => setShouldCountSubTasks(event.target.checked)}
        />{' '}
        Count sub-tasks as issues in their own right
      </label>

      {errorMessage !== null && <p className={styles.captionText}>⚠️ {errorMessage}</p>}

      {outcome !== null && <FlowResultsView outcome={outcome} />}
    </div>
  );
}

/** Maps one raw Jira issue into a flow, or null when it never reached a done status. */
function toIssueFlow(
  issue: RawIssue,
  options: {
    statusCategoryByStatusId: Record<string, string>;
    statusNamesById: Record<string, string>;
    statusClassifier: (statusId: string, statusName: string) => StatusFlowClass;
    storyPointsFieldId: string;
    shouldCountSubTasks: boolean;
  },
): IssueFlow | null {
  const fields = issue.fields ?? {};
  // Sub-tasks are dropped BEFORE any stages are built. A parent story's stages and its sub-tasks'
  // stages cover the same elapsed time, so counting both would double-count the very delay this
  // analysis exists to locate.
  if (!options.shouldCountSubTasks && classifyIssueScope(fields.issuetype) === 'sub-task') return null;
  const holderHistory = readIssueHolderHistory(issue);
  const statusHistory = readIssueStatusHistory(issue);
  return buildIssueFlow({
    issueKey: issue.key ?? '',
    issueSummary: typeof fields.summary === 'string' ? fields.summary : '',
    storyPoints: readStoryPoints(fields, options.storyPointsFieldId),
    createdIso: typeof fields.created === 'string' ? fields.created : null,
    initialStatusId: statusHistory.initialStatusId,
    statusTransitions: statusHistory.statusTransitions,
    initialHolder: holderHistory.initialHolder,
    holderTransitions: holderHistory.holderTransitions,
    statusCategoryByStatusId: options.statusCategoryByStatusId,
    statusNamesById: options.statusNamesById,
    statusClassifier: options.statusClassifier,
    todayIso: new Date().toISOString(),
  });
}

/**
 * Collects the classification each status ACTUALLY received during this run.
 *
 * Reported rather than assumed: the waiting/active split is a judgement, and a reader who can see the
 * judgement can correct it. One that cannot has to take the conclusion on trust.
 */
function readClassificationUsed(issueFlows: readonly IssueFlow[]): Record<string, StatusFlowClass> {
  const statusClassByStatusId: Record<string, StatusFlowClass> = {};
  for (const issueFlow of issueFlows) {
    for (const stage of issueFlow.stages) {
      statusClassByStatusId[stage.statusName] = stage.flowClass;
    }
  }
  return statusClassByStatusId;
}

/** Renders everything a completed run produced. */
type AuditCopyState = 'idle' | 'copied' | 'failed';

function FlowResultsView({ outcome }: { outcome: FlowRunOutcome }): React.JSX.Element {
  const rollups = useMemo(() => summariseStageRollups(outcome.issueFlows), [outcome.issueFlows]);
  const deliveryTotals = useMemo(() => computeDeliveryTotals(outcome.issueFlows), [outcome.issueFlows]);
  const [copyState, setCopyState] = useState<AuditCopyState>('idle');

  /** Builds the copyable Flow Analysis document from the run on screen and puts it on the clipboard. */
  const handleCopy = async (): Promise<void> => {
    setCopyState('idle');
    const toolVersion = await readToolVersion();
    const document = buildFlowAnalysisDocument({
      envelope: {
        rosterLabel: outcome.rosterLabel,
        windowDays: outcome.windowDays,
        generatedAtIso: new Date().toISOString(),
        toolVersion,
        countsSubTasks: outcome.countsSubTasks,
      },
      issueFlows: outcome.issueFlows,
      rollups,
      deliveryTotals,
      statusClassByStatusName: outcome.statusClassByStatusId,
      internalTestingCoverage: outcome.internalTestingCoverage,
    });
    setCopyState(await copyToClipboardWithResult(document) ? 'copied' : 'failed');
  };

  if (outcome.issueFlows.length === 0) {
    return (
      <p className={styles.captionText} style={{ marginTop: 12 }}>
        No delivered issues in this window. If that is unexpected, check the VPN — an unreachable Jira
        looks exactly like an empty result from in here.
      </p>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      {outcome.ceilingReached !== null && (
        <p className={styles.captionText}>
          ⚠️ These figures are <strong>incomplete</strong>: the analysis stopped at{' '}
          {outcome.ceilingReached === 'per-unit' ? 'the per-run issue ceiling' : 'the overall run budget'}{' '}
          after {outcome.fetchedIssueCount} issues. Narrow the window to see a complete picture.
        </p>
      )}

      {outcome.subTaskCount > 0 && (
        <p className={styles.captionText}>
          {outcome.subTaskCount} sub-task{outcome.subTaskCount === 1 ? ' was' : 's were'} excluded. Sub-tasks
          are part of a story’s delivery rather than deliverables of their own — counting them would credit
          one piece of work twice and, as they are short-lived, make delivery look faster than it was.
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className={styles.actionButton} onClick={() => { void handleCopy(); }}>
          Copy Flow Analysis report
        </button>
        <span className={styles.captionText}>
          {copyState === 'copied' && 'Copied — paste into a Confluence page.'}
          {copyState === 'failed' && 'Copy failed — nothing was placed on the clipboard.'}
          {copyState === 'idle'
            && 'A shareable write-up: the flow figures, who did the internal testing, and the per-issue detail.'}
        </span>
      </div>

      <FlowSummarySection issueFlows={outcome.issueFlows} deliveryTotals={deliveryTotals} />
      <StageRollupSection rollups={rollups} />
      <InternalTestingCoverageSection coverage={outcome.internalTestingCoverage} />
      <ClassificationSection statusClassByStatusId={outcome.statusClassByStatusId} />
      <PerIssueSection issueFlows={outcome.issueFlows} />
    </div>
  );
}

/** Lead time, cycle time and the pre-work wait — always together, never one alone. */
function FlowSummarySection({
  issueFlows,
  deliveryTotals,
}: {
  issueFlows: readonly IssueFlow[];
  deliveryTotals: { deliveredIssueCount: number; deliveredStoryPoints: number };
}): React.JSX.Element {
  const averageOf = (read: (issueFlow: IssueFlow) => number) =>
    issueFlows.reduce((total, issueFlow) => total + read(issueFlow), 0) / issueFlows.length;

  return (
    <section>
      <h4 className={styles.tabSectionHeading}>Flow summary</h4>
      <p className={styles.captionText} style={{ marginTop: 0 }}>
        Lead and cycle time are shown together deliberately. Cycle time alone hides a backlog that sat
        for weeks; lead time alone lets backlog age mask a slow delivery system. The gap between them
        is the pre-work wait, shown as its own figure rather than left as a subtraction.
      </p>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Delivered issues</th><th>Story points</th><th>Avg lead time (working days)</th>
              <th>Avg cycle time (working days)</th><th>Avg pre-work wait (working days)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{deliveryTotals.deliveredIssueCount}</td>
              <td>{formatDays(deliveryTotals.deliveredStoryPoints)}</td>
              <td>{formatDays(averageOf((issueFlow) => issueFlow.leadTimeWorkingDays))}</td>
              <td>{formatDays(averageOf((issueFlow) => issueFlow.cycleTimeWorkingDays))}</td>
              <td>{formatDays(averageOf((issueFlow) => issueFlow.preWorkWaitWorkingDays))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Where the time accumulated, largest first, with waiting kept separate from active work. */
function StageRollupSection({ rollups }: { rollups: readonly StageRollup[] }): React.JSX.Element {
  return (
    <section style={{ marginTop: 16 }}>
      <h4 className={styles.tabSectionHeading}>Where the time goes</h4>
      <p className={styles.captionText} style={{ marginTop: 0 }}>
        Largest contributor first. The median is the typical case; p85 is the tail — 85% of issues
        cleared the status in that time or less. A mean is not shown, because one issue stuck for
        months would describe a healthy stage as broken. Waiting time is usually a property of the
        system, not of whoever was holding the issue.
      </p>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Status</th><th>Class</th><th>Total (working days)</th><th>Median</th><th>p85</th><th>Issues</th>
            </tr>
          </thead>
          <tbody>
            {rollups.map((rollup) => (
              <tr key={rollup.statusName}>
                <td>{rollup.statusName}</td>
                <td>{FLOW_CLASS_LABELS[rollup.flowClass]}</td>
                <td>{formatDays(rollup.totalWorkingDays)}</td>
                <td>{formatDays(rollup.medianWorkingDays)}</td>
                <td>{formatDays(rollup.p85WorkingDays)}</td>
                <td>{rollup.issueCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** The classification actually used, so a wrong guess is visible and can be argued with. */
function ClassificationSection({
  statusClassByStatusId,
}: {
  statusClassByStatusId: Record<string, StatusFlowClass>;
}): React.JSX.Element {
  const entries = Object.entries(statusClassByStatusId);
  return (
    <section style={{ marginTop: 16 }}>
      <h4 className={styles.tabSectionHeading}>How statuses were classified</h4>
      <p className={styles.captionText} style={{ marginTop: 0 }}>
        Jira puts every in-flight status in one category, so separating work from waiting is a
        judgement. Anything genuinely ambiguous is left <em>Unclassified</em> and its time still
        counts — guessing would move real work into the queue bucket and blame a delay that never
        happened.
      </p>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead><tr><th>Status</th><th>Classified as</th></tr></thead>
          <tbody>
            {entries.map(([statusName, flowClass]) => (
              <tr key={statusName}>
                <td>{statusName}</td>
                <td>{FLOW_CLASS_LABELS[flowClass]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** One row per delivered issue, plus the stage breakdown that can be checked against Jira history. */
function PerIssueSection({ issueFlows }: { issueFlows: readonly IssueFlow[] }): React.JSX.Element {
  return (
    <section style={{ marginTop: 16 }}>
      <h4 className={styles.tabSectionHeading}>Per-issue flow</h4>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr>
              <th>Issue</th><th>Summary</th><th>Lead (working days)</th><th>Cycle (working days)</th>
              <th>Pre-work wait (working days)</th><th>Stages</th>
            </tr>
          </thead>
          <tbody>
            {issueFlows.map((issueFlow) => (
              <tr key={issueFlow.issueKey}>
                <td>{issueFlow.issueKey}</td>
                <td>{issueFlow.issueSummary}</td>
                <td>{formatDays(issueFlow.leadTimeWorkingDays)}</td>
                <td>{formatDays(issueFlow.cycleTimeWorkingDays)}</td>
                <td>{formatDays(issueFlow.preWorkWaitWorkingDays)}</td>
                <td>{issueFlow.stages.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Who performed this team's internal testing — the evidence for whether the team can sustain its own
 * testing, or is relying on people it does not have.
 *
 * The headline is a COUNT OF ISSUES and a share, not a total of days. Elapsed holding time is not
 * effort (one tester holding fifteen issues accrues elapsed days on all fifteen at once), so days
 * appear only as elapsed time and are never converted into anything resembling a headcount. A figure
 * that collapses under scrutiny would discredit the rest of the page beside it.
 */
function InternalTestingCoverageSection({
  coverage,
}: {
  coverage: InternalTestingCoverage;
}): React.JSX.Element {
  if (!coverage.isConfigured) {
    return (
      <section style={{ marginTop: 16 }}>
        <h4 className={styles.tabSectionHeading}>Who did the internal testing</h4>
        <p className={styles.captionText} style={{ marginTop: 0 }}>
          Not calculated: no internal-testing statuses have been chosen yet. Pick them in the
          <strong> Internal Testing Bottleneck</strong> panel on the Personal Flow tab and re-run.
          They are not guessed — a wrong guess here would turn into a staffing claim that is not true.
        </p>
      </section>
    );
  }

  if (coverage.issuesWithInternalTestingCount === 0) {
    return (
      <section style={{ marginTop: 16 }}>
        <h4 className={styles.tabSectionHeading}>Who did the internal testing</h4>
        <p className={styles.captionText} style={{ marginTop: 0 }}>
          None of the delivered issues in this window passed through a configured internal-testing
          status.
        </p>
      </section>
    );
  }

  return (
    <section style={{ marginTop: 16 }}>
      <h4 className={styles.tabSectionHeading}>Who did the internal testing</h4>
      <p className={styles.captionText} style={{ marginTop: 0 }}>
        <strong>
          {coverage.issuesTestedOffRosterCount} of {coverage.issuesWithInternalTestingCount} internally
          tested issues ({formatDays(coverage.offRosterSharePercent ?? 0)}%) had internal testing done
          by someone outside this roster
        </strong>
        , across {coverage.offRosterTesters.length}{' '}
        {coverage.offRosterTesters.length === 1 ? 'person' : 'people'}. Of those,{' '}
        {coverage.issuesHandedOffRosterCount} started with this team’s own tester and were then handed
        to someone off-roster to finish.
      </p>
      <div className={styles.tableWrapper}>
        <table className={styles.reportTable}>
          <thead>
            <tr><th>Measure</th><th>Issues</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Internally tested in this window</td>
              <td>{coverage.issuesWithInternalTestingCount}</td>
            </tr>
            <tr>
              <td>Tested by this roster’s internal tester(s)</td>
              <td>{coverage.issuesTestedByRosterTesterCount}</td>
            </tr>
            <tr>
              <td>Tested by someone off-roster</td>
              <td>{coverage.issuesTestedOffRosterCount}</td>
            </tr>
            <tr>
              <td>Started by our tester, finished off-roster</td>
              <td>{coverage.issuesHandedOffRosterCount}</td>
            </tr>
            <tr>
              <td>Sat unassigned while in an internal-testing status</td>
              <td>{coverage.issuesUnassignedInTestingCount}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {coverage.offRosterTesters.length > 0 && (
        <>
          <p className={styles.captionText}>
            Everyone outside the roster who did internal testing, by name. <strong>Check this list.</strong>{' '}
            If somebody here is actually on your team, they are missing from the roster — fix that
            before quoting the figures above, rather than publishing a roster gap as a finding.
          </p>
          <div className={styles.tableWrapper}>
            <table className={styles.reportTable}>
              <thead>
                <tr><th>Person</th><th>Issues</th><th>Elapsed working days held</th><th>Issue keys</th></tr>
              </thead>
              <tbody>
                {coverage.offRosterTesters.map((tester) => (
                  <tr key={tester.holderName}>
                    <td>{tester.holderName}</td>
                    <td>{tester.issueCount}</td>
                    <td>{formatDays(tester.elapsedWorkingDays)}</td>
                    <td>{tester.issueKeys.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className={styles.captionText}>
        ⚠️ <strong>Elapsed working days is not effort.</strong> It is how long each person held an issue
        in an internal-testing status; someone holding several issues at once accrues elapsed days on
        all of them simultaneously. Do not read it as person-days or convert it to a headcount — the
        issue counts above are the figures that support that argument.
      </p>
    </section>
  );
}
