// ReworkTab.tsx — What the work that was done twice actually cost.
//
// A story that stays open until the whole downstream chain finishes absorbs its own rework for free.
// A defect comes back from testing, the developer fixes it inside the open ticket, and no points are
// added. The round trip is recorded nowhere, so the team cannot say what late defect discovery costs
// them — and an argument for testing capacity that has no number attached is not an argument.
//
// This reads it out of the changelog, which had it all along: every issue that reached the team's
// delivery line and then fell back out of it, how long it spent away, and which status sent it back.
//
// Read-only. Nothing here writes to Jira and no assistant is involved — the number comes from history.

import { useState } from 'react';

import { buildJiraIssueNavigatorUrl } from '../Hygiene/utils/buildHygieneJqlUrl.ts';
import { useConnectionStore } from '../../store/connectionStore.ts';
import JiraProjectPicker from '../../components/JiraProjectPicker/index.tsx';
import { buildScopeClause, describeFetchFailure } from './reworkScope.ts';
import { fetchReworkIssues, MAX_REWORK_ISSUES } from './reworkFetch.ts';
import {
  describeReworkExclusions,
  describeReworkScan,
  scanRework,
  type ReworkScanResult,
} from './reworkScan.ts';
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

/** How far back to look. A quarter is long enough to be evidence and short enough to be current. */
const WINDOW_DAY_OPTIONS = [30, 60, 90, 180];

/** Rows shown before the table stops. The worst are first, and nobody reads past twenty-five. */
const MAX_ROWS_SHOWN = 25;

/** A wait past this reads as a problem rather than a round trip doing its job. */
const LONG_RECOVERY_DAY_THRESHOLD = 10;

/** The headline figures, in the order somebody reads them out. */
function buildReworkStats(result: ReworkScanResult): StatCardData[] {
  const returnRate = result.deliveredCount === 0
    ? null
    : Math.round((result.reworkedCount / result.deliveredCount) * 100);

  return [
    {
      label: 'Came back after delivery',
      value: returnRate === null ? '—' : `${returnRate}%`,
      context: returnRate === null
        ? 'Nothing reached delivery in this window.'
        : `${result.reworkedCount} of ${result.deliveredCount} that reached delivery`,
      tone: result.reworkedCount > 0 ? 'warn' : 'good',
    },
    {
      label: 'Days to recover a return',
      value: result.medianSettledWorkingDays === null ? '—' : String(result.medianSettledWorkingDays),
      context: result.medianSettledWorkingDays === null
        ? 'No return has been resolved yet.'
        : `median over ${result.settledRounds} resolved return(s)`,
      tone: result.medianSettledWorkingDays !== null
        && result.medianSettledWorkingDays > LONG_RECOVERY_DAY_THRESHOLD ? 'bad' : 'neutral',
    },
    {
      label: 'Return trips',
      value: String(result.totalRounds),
      context: `${result.totalWorkingDays} working days out of delivery in total`,
    },
    {
      label: 'Still out',
      value: String(result.stillOutRounds),
      // The open cost, kept apart from the settled one: its clock has not stopped.
      context: result.stillOutRounds === 0
        ? 'Everything that came back has been resolved.'
        : `${result.stillOutWorkingDays} working days so far, and counting`,
      tone: result.stillOutRounds > 0 ? 'bad' : 'good',
    },
  ];
}

/** Turns the worst round trips into bars on one shared scale. */
function buildReworkRows(result: ReworkScanResult): MeterRowData[] {
  return result.issues.slice(0, MAX_ROWS_SHOWN).map((issue): MeterRowData => ({
    name: `${issue.key} — ${issue.summary}`,
    value: issue.totalWorkingDays,
    valueLabel: `${issue.rounds.length} return(s) · ${issue.totalWorkingDays}d`
      + `${issue.rounds.some((round) => round.isStillOut) ? ' · still out' : ''}`,
    tone: issue.rounds.some((round) => round.isStillOut) ? 'bad' : 'neutral',
  }));
}

/** The rework report: what came back, how often, from where, and for how long. */
export default function ReworkTab() {
  // Picked, not typed: a project key has to match Jira exactly, and a box that accepts anything
  // accepts a typo that fails confusingly at the far end.
  const [projectKey, setProjectKey] = useState('');
  const [extraJql, setExtraJql] = useState('');
  const [windowDays, setWindowDays] = useState(90);
  const [result, setResult] = useState<ReworkScanResult | null>(null);
  const [wasTruncated, setWasTruncated] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Without a base url the helper hands back the JQL instead of a link; the row then reads as plain
  // text rather than breaking, which is the right failure for a report somebody is reading aloud.
  const jiraBaseUrl = useConnectionStore((state) => state.proxyStatus?.jira?.baseUrl ?? null);

  async function handleRun(): Promise<void> {
    setIsLoading(true);
    setError(null);
    try {
      const fetched = await fetchReworkIssues(buildScopeClause(projectKey, extraJql), windowDays);
      setResult(scanRework(fetched.issues, Date.now()));
      setWasTruncated(fetched.wasTruncated);
    } catch (caughtError) {
      setResult(null);
      setError(describeFetchFailure(caughtError));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section aria-label="Rework report">
      <p className={styles.tabPreamble}>
        Every issue that reached the team&rsquo;s delivery line &mdash; &ldquo;Ready for QA&rdquo; or
        beyond &mdash; and then moved back out of it was worked a second time. That second pass is
        almost never re-estimated, so it costs nothing on paper. This reads it out of the changelog,
        which recorded it all along.
      </p>

      <div className={styles.controlRow}>
        <JiraProjectPicker
          id="rework-project"
          label="Project"
          onChange={setProjectKey}
          placeholder="Every project you can see"
          value={projectKey}
        />
        <label className={styles.controlLabel} htmlFor="rework-extra-jql">
          Narrow it further (optional JQL)
        </label>
        <input
          className={styles.textInput}
          id="rework-extra-jql"
          onChange={(changeEvent) => setExtraJql(changeEvent.target.value)}
          placeholder="issuetype in (Story, Task)"
          value={extraJql}
        />
        <label className={styles.controlLabel} htmlFor="rework-window">Look back</label>
        <select
          className={styles.filterSelect}
          id="rework-window"
          onChange={(changeEvent) => setWindowDays(Number(changeEvent.target.value))}
          value={windowDays}
        >
          {WINDOW_DAY_OPTIONS.map((dayCount) => (
            <option key={dayCount} value={dayCount}>{`${dayCount} days`}</option>
          ))}
        </select>
        <button className={styles.actionButton} type="button" disabled={isLoading} onClick={() => void handleRun()}>
          {isLoading ? 'Reading history…' : 'Run'}
        </button>
      </div>

      {error ? <p className={styles.warningText}>{error}</p> : null}

      {wasTruncated ? (
        <p className={styles.warningText}>
          {`Stopped at ${MAX_REWORK_ISSUES} issues — this is a sample, not the whole scope. Narrow the JQL `}
          {'or shorten the window before quoting these numbers.'}
        </p>
      ) : null}

      {result === null ? null : (
        <>
          {/* The one sentence somebody reads out. It states the rate against the issues that COULD
              have come back, and says plainly that the points are a scale rather than a measurement. */}
          <p className={styles.coachingSummary}>{describeReworkScan(result)}</p>

          {result.reworkedCount === 0 ? null : (
            <>
              {/* The median settled return leads, because that is the figure the report exists to
                  produce: what coming back costs to recover. */}
              <StatCards stats={buildReworkStats(result)} />

              <ReportPanel
                title="Which stage sent work back"
                caption={'The status each issue fell INTO — the closest the changelog gets to naming who '
                  + 'returned it. A stage that appears often is where defects are being found late.'}
              >
                <DistributionBar
                  slices={result.returnsByStatus.map((entry) => ({ name: entry.statusName, count: entry.count }))}
                />
                {describeReworkExclusions(result) === '' ? null : (
                  <p className={styles.captionText}>{describeReworkExclusions(result)}</p>
                )}
              </ReportPanel>

              <ReportPanel
                title="Worst round trips"
                caption="Longest first. An issue still out has an open cost, and its bar says so."
              >
                {result.issues.length === 0
                  ? <EmptyNote>Nothing came back in this window.</EmptyNote>
                  : (
                    <MeterList
                      markerLabel={`${LONG_RECOVERY_DAY_THRESHOLD} working days`}
                      markerValue={LONG_RECOVERY_DAY_THRESHOLD}
                      rows={buildReworkRows(result)}
                    />
                  )}
                <div className={styles.tableWrapper}>
                  <table className={styles.actionTable}>
                    <thead>
                      <tr>
                        <th scope="col">Issue</th>
                        <th scope="col">Assignee</th>
                        <th scope="col">Points</th>
                        <th scope="col">Sent back from</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.issues.slice(0, MAX_ROWS_SHOWN).map((issue) => (
                        <tr key={issue.key}>
                          <td>
                            <a href={buildJiraIssueNavigatorUrl([issue.key], jiraBaseUrl)} rel="noreferrer" target="_blank">
                              {issue.key}
                            </a>
                          </td>
                          <td>{issue.assigneeName ?? 'Unassigned'}</td>
                          <td>{issue.storyPoints ?? '—'}</td>
                          <td>{[...new Set(issue.rounds.map((round) => round.fellBackToStatus))].join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ReportPanel>

              {result.issues.length > MAX_ROWS_SHOWN ? (
                <p className={styles.captionText}>
                  {`Showing the ${MAX_ROWS_SHOWN} worst of ${result.issues.length}. The totals above cover all of them.`}
                </p>
              ) : null}
            </>
          )}
        </>
      )}
    </section>
  );
}
