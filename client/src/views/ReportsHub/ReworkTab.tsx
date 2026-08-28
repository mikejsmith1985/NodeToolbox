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
import styles from './ReportsHubView.module.css';

/** How far back to look. A quarter is long enough to be evidence and short enough to be current. */
const WINDOW_DAY_OPTIONS = [30, 60, 90, 180];

/** Rows shown before the table stops. The worst are first, and nobody reads past twenty-five. */
const MAX_ROWS_SHOWN = 25;

/** Formats a working-day count the way somebody says it aloud. */
function formatWorkingDays(workingDays: number): string {
  return workingDays === 1 ? '1 working day' : `${workingDays} working days`;
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
              <div className={styles.summaryBar}>
                {result.medianSettledWorkingDays === null ? null : (
                  <span className={styles.summaryBarItem}>
                    {`${result.medianSettledWorkingDays} working days to recover (median)`}
                  </span>
                )}
                <span className={styles.summaryBarItem}>{`${result.reworkedCount} issues came back`}</span>
                <span className={styles.summaryBarItem}>{`${result.settledRounds} returns resolved`}</span>
                {result.stillOutRounds > 0 ? (
                  <span className={styles.summaryBarItem}>
                    {`${result.stillOutRounds} still out · ${formatWorkingDays(result.stillOutWorkingDays)}`}
                  </span>
                ) : null}
              </div>

              {/* Stated, never silently applied: an exclusion nobody can see is a number nobody can check. */}
              {describeReworkExclusions(result) === '' ? null : (
                <p className={styles.captionText}>{describeReworkExclusions(result)}</p>
              )}

              <h4 className={styles.tabSectionHeading}>Which stage sent work back</h4>
              <p className={styles.captionText}>
                The status each issue fell INTO &mdash; the closest the changelog gets to naming who
                returned it. A stage that appears often is where defects are being found late.
              </p>
              <div className={styles.tableWrapper}>
                <table className={styles.actionTable}>
                  <thead>
                    <tr><th scope="col">Fell back into</th><th scope="col">Returns</th></tr>
                  </thead>
                  <tbody>
                    {result.returnsByStatus.map((entry) => (
                      <tr key={entry.statusName}>
                        <td>{entry.statusName}</td>
                        <td>{entry.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h4 className={styles.tabSectionHeading}>Worst round trips</h4>
              <div className={styles.tableWrapper}>
                <table className={styles.actionTable}>
                  <thead>
                    <tr>
                      <th scope="col">Issue</th>
                      <th scope="col">Assignee</th>
                      <th scope="col">Points</th>
                      <th scope="col">Returns</th>
                      <th scope="col">Working days out</th>
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
                          {` ${issue.summary}`}
                        </td>
                        <td>{issue.assigneeName ?? 'Unassigned'}</td>
                        <td>{issue.storyPoints ?? '—'}</td>
                        <td>{issue.rounds.length}</td>
                        <td>
                          {issue.totalWorkingDays}
                          {/* An issue still out has an OPEN cost, and saying so stops it reading as settled. */}
                          {issue.rounds.some((round) => round.isStillOut) ? ' (still out)' : ''}
                        </td>
                        <td>{[...new Set(issue.rounds.map((round) => round.fellBackToStatus))].join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

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
