// DeliveryHealthTab.tsx — Where the work is, and what it is costing, on one screen.
//
// Four reports on four tabs, each with its own scope box, is four answers a reader has to hold in
// their head and reconcile. And a table only hands over the data: "I can get the data by running a
// query — understanding the data requires visualisation" is exactly the right complaint about a
// report that tabulates and stops.
//
// So this is one scope, read once, drawn four ways, with the same visual language as the PI Review
// capacity panel this app baselines on:
//
//   - WHERE IS IT PILING UP — the constraint, discovered from where work is actually sitting rather
//     than from a list of statuses somebody had to nominate first;
//   - WHO IS HOLDING IT — the same waiting, by person, because a queue with one server has a name;
//   - WHAT COMES BACK — the rework, priced in days to recover;
//   - WHAT SENT IT BACK — which stage is finding defects late.
//
// Read-only, and no assistant: every figure comes from Jira history.

import { useState } from 'react';

import JiraProjectPicker from '../../components/JiraProjectPicker/index.tsx';
import { buildJiraIssueNavigatorUrl } from '../Hygiene/utils/buildHygieneJqlUrl.ts';
import { useConnectionStore } from '../../store/connectionStore.ts';
import { fetchDeliveryHealth, MAX_DELIVERY_HEALTH_ISSUES, type DeliveryHealthData } from './deliveryHealthFetch.ts';
import {
  describeBacklog,
  describeConstraint,
  readBacklogStages,
  readConstraintStage,
  readInFlightStages,
  scanQueues,
  type QueueScanResult,
  type QueueStage,
} from './queueScan.ts';
import { describeReworkExclusions, describeReworkScan, scanRework, type ReworkScanResult } from './reworkScan.ts';
import { buildScopeClause, describeFetchFailure } from './reworkScope.ts';
import {
  DistributionBar,
  EmptyNote,
  MeterList,
  ReportPanel,
  StatCards,
  type MeterRowData,
  type StatCardData,
} from './visuals/ReportVisuals.tsx';
import { ReportAiPanel } from './ReportAiPanel.tsx';
import {
  buildDeliveryHealthPrompt,
  parseDeliveryHealthReply,
  type DeliveryHealthPlan,
  type DeliveryHealthTopic,
} from './ai/deliveryHealthAiAssist.ts';
import { readTeamContext, writeTeamContext } from './ai/teamContextStore.ts';
import styles from './ReportsHubView.module.css';

/** How far back to read. A quarter is long enough to be evidence and short enough to be current. */
const WINDOW_DAY_OPTIONS = [30, 60, 90, 180];

/** Stages and holders shown before the list stops — enough to see the shape, not a second table. */
const MAX_ROWS_SHOWN = 8;

/** Issues named in the "waiting longest" list. */
const MAX_ISSUES_SHOWN = 10;

/** A wait past this reads as a problem rather than a queue doing its job. */
const LONG_WAIT_DAY_THRESHOLD = 10;

/** What the dashboard drew, from one read. */
interface DeliveryHealthReport {
  queue: QueueScanResult;
  rework: ReworkScanResult;
  data: DeliveryHealthData;
}

/** The headline figures, in the order somebody reads them out. */
function buildHeadlineStats(report: DeliveryHealthReport): StatCardData[] {
  const constraintStage = readConstraintStage(report.queue);
  const medianRecovery = report.rework.medianSettledWorkingDays;

  return [
    {
      label: 'The constraint',
      value: constraintStage?.statusName ?? '—',
      context: constraintStage === null
        ? 'Nothing that has been started is waiting.'
        : `${constraintStage.issueCount} issue(s), ${constraintStage.totalWaitingDays} waiting days`,
      tone: constraintStage === null ? 'neutral' : 'bad',
    },
    {
      label: 'Started and waiting',
      value: String(report.queue.totalIssueCount - report.queue.notStartedCount),
      // The backlog rides in the context rather than the figure: it is a real number and a different
      // problem, and adding it in would put the flow's constraint back under a pile of inventory.
      context: `${report.queue.notStartedCount} more have not been started at all`,
    },
    {
      label: 'Came back after delivery',
      value: report.rework.deliveredCount === 0
        ? '—'
        : `${Math.round((report.rework.reworkedCount / report.rework.deliveredCount) * 100)}%`,
      context: report.rework.deliveredCount === 0
        ? 'Nothing reached delivery in this window.'
        : `${report.rework.reworkedCount} of ${report.rework.deliveredCount} that reached delivery`,
      tone: report.rework.reworkedCount > 0 ? 'warn' : 'good',
    },
    {
      label: 'Days to recover a return',
      value: medianRecovery === null ? '—' : String(medianRecovery),
      context: medianRecovery === null
        ? 'No return has been resolved yet.'
        : `median over ${report.rework.settledRounds} resolved return(s)`,
      tone: medianRecovery !== null && medianRecovery > LONG_WAIT_DAY_THRESHOLD ? 'bad' : 'neutral',
    },
  ];
}

/** Turns a set of stages into bars, coloured by how long the middle issue has been sitting. */
function buildStageRows(stages: readonly QueueStage[]): MeterRowData[] {
  return stages.slice(0, MAX_ROWS_SHOWN).map((stage): MeterRowData => ({
    name: stage.statusName,
    value: stage.totalWaitingDays,
    valueLabel: `${stage.issueCount} issue(s) · ${stage.totalWaitingDays}d total · ${stage.medianWaitingDays}d median`,
    // Tone reads the MEDIAN, not the total: a stage is bad because its issues sit a long time, not
    // because it happens to hold a lot of them.
    tone: stage.medianWaitingDays > LONG_WAIT_DAY_THRESHOLD ? 'bad' : 'neutral',
  }));
}

/** Turns the holders into bars on the same scale as each other. */
function buildHolderRows(queue: QueueScanResult): MeterRowData[] {
  return queue.holders.slice(0, MAX_ROWS_SHOWN).map((holder): MeterRowData => ({
    name: holder.holderName,
    value: holder.totalWaitingDays,
    valueLabel: `${holder.issueCount} issue(s) · ${holder.totalWaitingDays}d waiting`,
  }));
}

/**
 * What the assistant said about ONE part of the report, drawn inside that part.
 *
 * A reading collected at the bottom of the page is a second document somebody has to reconcile with
 * the first, and nobody reads it. Beside the figure it rests on, it is read at the moment the figure is.
 */
function PlanNotes({ plan, topic }: { plan: DeliveryHealthPlan | null; topic: DeliveryHealthTopic }) {
  if (plan === null) {
    return null;
  }
  const findings = plan.findings.filter((finding) => finding.topic === topic);
  const actions = plan.actions.filter((action) => action.topic === topic);
  if (findings.length === 0 && actions.length === 0) {
    return null;
  }

  return (
    <div className={styles.verdictSection}>
      {findings.map((finding) => (
        <p className={styles.captionText} key={finding.observation}>
          <strong>{finding.observation}</strong>
          {finding.evidence === '' ? '' : ` — ${finding.evidence}`}
          {' '}
          <span className={styles.statusBadge}>{finding.confidence}</span>
        </p>
      ))}
      {actions.map((action) => (
        <p className={styles.captionText} key={action.action}>
          {`→ ${action.action}`}
          {action.rationale === '' ? '' : ` — ${action.rationale}`}
          {' '}
          <span className={styles.statusBadge}>{action.effort}</span>
          {' '}
          <span className={styles.statusBadge}>{action.whoDecides}</span>
        </p>
      ))}
    </div>
  );
}

/** The dashboard: one scope, one read, four views of it. */
export default function DeliveryHealthTab() {
  const [projectKey, setProjectKey] = useState('');
  const [extraJql, setExtraJql] = useState('');
  const [windowDays, setWindowDays] = useState(90);
  const [report, setReport] = useState<DeliveryHealthReport | null>(null);
  const [scopeShown, setScopeShown] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const jiraBaseUrl = useConnectionStore((state) => state.proxyStatus?.jira?.baseUrl ?? null);
  // Restored on mount: it describes the TEAM rather than the run, so nobody should type it twice.
  const [teamContext, setTeamContext] = useState(() => readTeamContext());
  const [plan, setPlan] = useState<DeliveryHealthPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  async function handleRun(): Promise<void> {
    setIsLoading(true);
    setError(null);
    const scopeClause = buildScopeClause(projectKey, extraJql);
    try {
      const nowMs = Date.now();
      const data = await fetchDeliveryHealth(scopeClause, windowDays);
      setReport({ queue: scanQueues(data.queueIssues, nowMs), rework: scanRework(data.reworkIssues, nowMs), data });
      // A plan read from the previous run would describe figures no longer on the screen.
      setPlan(null);
      // Recorded at RUN time, so the line above the panels always describes what is drawn below it
      // rather than what the controls happen to say now.
      setScopeShown(scopeClause === '' ? 'every project you can see' : scopeClause);
    } catch (caughtError) {
      setReport(null);
      setError(describeFetchFailure(caughtError));
    } finally {
      setIsLoading(false);
    }
  }

  /** Reads a pasted plan, keeping the parse failure beside the panel that produced it. */
  function handleIngestPlan(responseText: string): void {
    try {
      setPlan(parseDeliveryHealthReply(responseText));
      setPlanError(null);
    } catch (caughtError) {
      setPlanError(caughtError instanceof Error ? caughtError.message : 'That reply could not be read.');
    }
  }

  return (
    <section aria-label="Delivery health">
      <p className={styles.tabPreamble}>
        One read of Jira, drawn four ways: where open work is piling up, who is holding it, what came
        back after reaching delivery, and which stage sent it back. Every figure is history &mdash;
        nothing here is estimated, and nothing is written.
      </p>

      <div className={styles.controlRow}>
        <JiraProjectPicker
          id="delivery-health-project"
          label="Project"
          onChange={setProjectKey}
          placeholder="Every project you can see"
          value={projectKey}
        />
        <label className={styles.controlLabel} htmlFor="delivery-health-jql">Narrow it further (optional JQL)</label>
        <input
          className={styles.textInput}
          id="delivery-health-jql"
          onChange={(changeEvent) => setExtraJql(changeEvent.target.value)}
          placeholder="issuetype in (Story, Task)"
          value={extraJql}
        />
        <label className={styles.controlLabel} htmlFor="delivery-health-window">Look back</label>
        <select
          className={styles.filterSelect}
          id="delivery-health-window"
          onChange={(changeEvent) => setWindowDays(Number(changeEvent.target.value))}
          value={windowDays}
        >
          {WINDOW_DAY_OPTIONS.map((dayCount) => (
            <option key={dayCount} value={dayCount}>{`${dayCount} days`}</option>
          ))}
        </select>
        <button className={styles.actionButton} disabled={isLoading} onClick={() => void handleRun()} type="button">
          {isLoading ? 'Reading history…' : 'Run'}
        </button>
      </div>

      {error ? <p className={styles.warningText}>{error}</p> : null}

      {report === null ? null : (
        <>
          {/* Says what was actually read, so nobody has to infer the scope from the controls. */}
          <p className={styles.captionText}>
            {`Showing ${report.data.issueCount} issue(s) from ${scopeShown}, updated in the last ${windowDays} days.`}
          </p>

          {report.data.wasTruncated ? (
            <p className={styles.warningText}>
              {`Stopped at ${MAX_DELIVERY_HEALTH_ISSUES} issues — this is a sample, not the whole scope. `}
              {'Narrow the project or shorten the window before quoting these numbers.'}
            </p>
          ) : null}

          <StatCards stats={buildHeadlineStats(report)} />

          <ReportPanel
            title="Where work is piling up"
            caption={describeConstraint(report.queue)}
          >
            {readInFlightStages(report.queue).length === 0
              ? <EmptyNote>Nothing that has been started is waiting anywhere.</EmptyNote>
              : (
                <MeterList
                  markerLabel={`${LONG_WAIT_DAY_THRESHOLD} days`}
                  rows={buildStageRows(readInFlightStages(report.queue))}
                />
              )}
            <PlanNotes plan={plan} topic="constraint" />
            {report.queue.undatedCount > 0 ? (
              <p className={styles.captionText}>
                {`${report.queue.undatedCount} issue(s) had no readable history, so they are not aged here `}
                {'rather than being counted as having waited no time at all.'}
              </p>
            ) : null}
          </ReportPanel>

          {/* Kept apart from the constraint on purpose. Ranked together the backlog wins every time and
              names itself the bottleneck, which is true and useless: inventory is a different problem
              with a different fix. */}
          <ReportPanel title="Not started yet" caption={describeBacklog(report.queue)}>
            {readBacklogStages(report.queue).length === 0
              ? <EmptyNote>Everything open has been started.</EmptyNote>
              : <MeterList rows={buildStageRows(readBacklogStages(report.queue))} />}
            <PlanNotes plan={plan} topic="backlog" />
          </ReportPanel>

          <ReportPanel
            title="Who is holding the waiting"
            caption="The same waiting days, by whoever the issue is assigned to. A queue with one server has a name on it."
          >
            {report.queue.holders.length === 0
              ? <EmptyNote>Nobody is holding open work in this scope.</EmptyNote>
              : <MeterList rows={buildHolderRows(report.queue)} />}
            <PlanNotes plan={plan} topic="holders" />
          </ReportPanel>

          <ReportPanel
            title="What came back after reaching delivery"
            caption={describeReworkScan(report.rework)}
          >
            {report.rework.returnsByStatus.length === 0
              ? <EmptyNote>Nothing that reached delivery came back in this window.</EmptyNote>
              : (
                <DistributionBar
                  slices={report.rework.returnsByStatus.map((entry) => ({
                    name: entry.statusName,
                    count: entry.count,
                  }))}
                />
              )}
            {describeReworkExclusions(report.rework) === '' ? null : (
              <p className={styles.captionText}>{describeReworkExclusions(report.rework)}</p>
            )}
            <PlanNotes plan={plan} topic="rework" />
          </ReportPanel>

          {/* The dashboard says WHERE work is stuck. It cannot say why, and it certainly cannot say
              what to do — that needs the shape of the team and the workflow it is bound by, neither of
              which is in a changelog. Gated, propose-only, and it writes nothing. */}
          <ReportAiPanel
            error={planError}
            ingestLabel="Read the plan"
            onIngest={handleIngestPlan}
            prompt={buildDeliveryHealthPrompt(report.queue, report.rework, teamContext)}
            title="Explain this, and propose a plan"
          >
            <label className={styles.controlLabel} htmlFor="delivery-health-context">
              What the assistant should know about your team (optional, but the numbers alone give a
              generic answer)
            </label>
            <textarea
              className={styles.aiTextarea}
              id="delivery-health-context"
              onChange={(changeEvent) => {
                setTeamContext(changeEvent.target.value);
                writeTeamContext(changeEvent.target.value);
              }}
              placeholder="e.g. nine developers, one shift-left tester, two-week sprints, dev stories stay open until release"
              rows={3}
              value={teamContext}
            />

            {plan === null ? null : (
              <div className={styles.verdictSection}>
                <p className={styles.coachingSummary}>{plan.diagnosis}</p>

                {/* Everything tagged to a panel is drawn there instead, beside its evidence. Only what
                    belongs to no single part of the report is left here. */}
                <PlanNotes plan={plan} topic="overall" />

                {plan.questionsToAsk.length === 0 ? null : (
                  <>
                    <h5 className={styles.coachingSectionTitle}>What the data cannot answer</h5>
                    <ul className={styles.coachingList}>
                      {plan.questionsToAsk.map((question) => <li key={question}>{question}</li>)}
                    </ul>
                  </>
                )}

                <p className={styles.captionText}>
                  The rest of this reading is drawn beside the figures it rests on, in the panels below.
                </p>
              </div>
            )}
          </ReportAiPanel>

          <ReportPanel
            title="Waiting longest right now"
            caption="The open issues that have sat in one place the longest. These are the ones to ask about by name."
          >
            {report.queue.issues.length === 0
              ? <EmptyNote>Nothing is waiting in this scope.</EmptyNote>
              : (
                <div className={styles.tableWrapper}>
                  <table className={styles.actionTable}>
                    <thead>
                      <tr>
                        <th scope="col">Issue</th>
                        <th scope="col">Sitting in</th>
                        <th scope="col">Held by</th>
                        <th scope="col">Days waiting</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.queue.issues.slice(0, MAX_ISSUES_SHOWN).map((issue) => (
                        <tr key={issue.key}>
                          <td>
                            <a href={buildJiraIssueNavigatorUrl([issue.key], jiraBaseUrl)} rel="noreferrer" target="_blank">
                              {issue.key}
                            </a>
                            {` ${issue.summary}`}
                          </td>
                          <td>{issue.statusName}</td>
                          <td>{issue.assigneeName}</td>
                          <td>{issue.waitingDays}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </ReportPanel>
        </>
      )}
    </section>
  );
}
