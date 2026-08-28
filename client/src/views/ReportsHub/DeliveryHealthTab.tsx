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
import { describeConstraint, scanQueues, type QueueScanResult } from './queueScan.ts';
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
  const constraintStage = report.queue.stages[0];
  const medianRecovery = report.rework.medianSettledWorkingDays;

  return [
    {
      label: 'The constraint',
      value: constraintStage?.statusName ?? '—',
      context: constraintStage === undefined
        ? 'Nothing is waiting in this scope.'
        : `${constraintStage.issueCount} issue(s), ${constraintStage.totalWaitingDays} waiting days`,
      tone: constraintStage === undefined ? 'neutral' : 'bad',
    },
    {
      label: 'Open work waiting',
      value: String(report.queue.totalIssueCount),
      context: `${report.queue.totalWaitingDays} days of waiting in total`,
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

/** Turns the ranked stages into bars, coloured by how long the middle issue has been sitting. */
function buildStageRows(queue: QueueScanResult): MeterRowData[] {
  return queue.stages.slice(0, MAX_ROWS_SHOWN).map((stage): MeterRowData => ({
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

  async function handleRun(): Promise<void> {
    setIsLoading(true);
    setError(null);
    const scopeClause = buildScopeClause(projectKey, extraJql);
    try {
      const nowMs = Date.now();
      const data = await fetchDeliveryHealth(scopeClause, windowDays);
      setReport({ queue: scanQueues(data.queueIssues, nowMs), rework: scanRework(data.reworkIssues, nowMs), data });
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
            {report.queue.stages.length === 0
              ? <EmptyNote>No open work was found, so nothing is waiting anywhere.</EmptyNote>
              : (
                <MeterList
                  markerLabel={`${LONG_WAIT_DAY_THRESHOLD} days`}
                  rows={buildStageRows(report.queue)}
                />
              )}
            {report.queue.undatedCount > 0 ? (
              <p className={styles.captionText}>
                {`${report.queue.undatedCount} issue(s) had no readable history, so they are not aged here `}
                {'rather than being counted as having waited no time at all.'}
              </p>
            ) : null}
          </ReportPanel>

          <ReportPanel
            title="Who is holding the waiting"
            caption="The same waiting days, by whoever the issue is assigned to. A queue with one server has a name on it."
          >
            {report.queue.holders.length === 0
              ? <EmptyNote>Nobody is holding open work in this scope.</EmptyNote>
              : <MeterList rows={buildHolderRows(report.queue)} />}
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
          </ReportPanel>

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
