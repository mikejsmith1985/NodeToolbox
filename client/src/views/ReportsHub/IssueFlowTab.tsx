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
  buildStandupRosterAssigneeWasClause,
  readAvailableRosterTeamNames,
  describeRosterScope,
  resolveActiveRosterTeamName,
  useStandupRosterStore,
} from '../SprintDashboard/hooks/useStandupRosterStore.ts';
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
  statusNamesById: Record<string, string>;
  statusClassByStatusId: Record<string, StatusFlowClass>;
  jql: string;
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
  const rosterMembers = useStandupRosterStore((state) => state.rosterMembers);
  const availableTeamNames = useMemo(() => readAvailableRosterTeamNames(rosterMembers), [rosterMembers]);
  // The requested team may not exist in the roster; resolving it once means the heading and the data
  // are derived from the SAME name, so the report can never be labelled with a team it did not analyse.
  const effectiveTeamName = useMemo(
    () => resolveActiveRosterTeamName(teamFilter, rosterMembers),
    [teamFilter, rosterMembers],
  );

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
    const rosterClause = buildStandupRosterAssigneeWasClause(rosterMembers, effectiveTeamName);
    if (rosterClause === null) {
      setErrorMessage('No roster members for this team — import a roster in the Sprint Dashboard first.');
      return;
    }

    cancelRef.current = false;
    setIsLoading(true);
    setErrorMessage(null);
    setProgressMessage('Reading the instance’s statuses…');

    try {
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
        ceilingReached: fetchOutcome.ceilingReached,
        statusNamesById,
        statusClassByStatusId: readClassificationUsed(issueFlows),
        jql,
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
        For every issue the <strong>{describeRosterScope(effectiveTeamName)}</strong> roster delivered in the
        window, this shows where its time went and who was holding it — including time it spent in
        nobody’s hands. All durations are <strong>working days</strong> (Monday–Friday).
      </p>
      {availableTeamNames.length > 0 && teamFilter !== '' && effectiveTeamName !== teamFilter && (
        <p className={styles.captionText}>
          “{teamFilter}” is not in the imported roster — showing <strong>{effectiveTeamName}</strong> instead.
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
function FlowResultsView({ outcome }: { outcome: FlowRunOutcome }): React.JSX.Element {
  const rollups = useMemo(() => summariseStageRollups(outcome.issueFlows), [outcome.issueFlows]);
  const deliveryTotals = useMemo(() => computeDeliveryTotals(outcome.issueFlows), [outcome.issueFlows]);

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

      <FlowSummarySection issueFlows={outcome.issueFlows} deliveryTotals={deliveryTotals} />
      <StageRollupSection rollups={rollups} />
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
