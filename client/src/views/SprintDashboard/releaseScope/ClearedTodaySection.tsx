// ClearedTodaySection.tsx — "Show me everything whose fix version was removed today."
//
// The version trace answers "where did THIS release's work go", which needs a release in mind. This
// answers the question you arrive with before you have one: something cleared a batch of fix
// versions this morning and you want the batch, not a release-by-release hunt.
//
// It asks Jira only for issues UPDATED since a moment — a clause every deployment supports — so it
// works even where the history operators the version trace relies on are not exposed.

import { useState } from 'react';

import { buildJiraIssueNavigatorUrl } from '../../Hygiene/utils/buildHygieneJqlUrl.ts';
import { useConnectionStore } from '../../../store/connectionStore.ts';
import {
  groupRemovalsByAuthor,
  summariseRemovalCauses,
  type FixVersionRemoval,
} from './recentVersionChanges.ts';
import { loadFixVersionRemovalsSince } from './versionMovementFetch.ts';
import styles from '../SprintDashboardView.module.css';

/** Windows offered as one-click choices, because these are the ones anybody actually asks for. */
const LOOKBACK_CHOICES: Array<{ id: string; label: string; readSince: (now: Date) => Date }> = [
  {
    id: 'today',
    label: 'Today',
    readSince: (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate()),
  },
  {
    id: 'yesterday',
    label: 'Since yesterday',
    readSince: (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
  },
  {
    id: 'week',
    label: 'Last 7 days',
    readSince: (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7),
  },
];

/** A timestamp as a reader would say it, without pretending to a precision Jira did not give. */
function describeInstant(atIso: string): string {
  return new Date(atIso).toLocaleString();
}

/** One person's batch, which is usually the whole story. */
function AuthorBatchTable({ removals, jiraBaseUrl }: {
  removals: readonly FixVersionRemoval[];
  jiraBaseUrl: string | null;
}) {
  const batches = groupRemovalsByAuthor(removals);

  return (
    <table className={styles.forecastTable}>
      <thead>
        <tr>
          <th scope="col">Cleared by</th>
          <th scope="col">How many</th>
          <th scope="col">Which</th>
        </tr>
      </thead>
      <tbody>
        {batches.map((batch) => (
          <tr key={batch.byDisplayName}>
            <td>{batch.byDisplayName}</td>
            <td>{batch.removals.length}</td>
            <td>
              <a
                href={buildJiraIssueNavigatorUrl(batch.removals.map((removal) => removal.issueKey), jiraBaseUrl)}
                rel="noreferrer"
                target="_blank"
              >
                {batch.removals.map((removal) => removal.issueKey).join(', ')}
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Every removal in the window, newest first. */
function RemovalTable({ removals, jiraBaseUrl }: {
  removals: readonly FixVersionRemoval[];
  jiraBaseUrl: string | null;
}) {
  return (
    <table className={styles.forecastTable}>
      <thead>
        <tr>
          <th scope="col">Issue</th>
          <th scope="col">Summary</th>
          <th scope="col">Lost</th>
          <th scope="col">Now on</th>
          <th scope="col">Cleared by</th>
          <th scope="col">When</th>
          <th scope="col">What did it</th>
        </tr>
      </thead>
      <tbody>
        {removals.map((removal) => (
          <tr key={`${removal.issueKey}-${removal.atIso}`}>
            <td>
              <a href={buildJiraIssueNavigatorUrl([removal.issueKey], jiraBaseUrl)} rel="noreferrer" target="_blank">
                {removal.issueKey}
              </a>
            </td>
            <td>{removal.summary}</td>
            <td>{removal.removedVersionNames.join(', ')}</td>
            {/* The distinction that matters: moved to another release, or left on none at all. */}
            <td>
              {removal.currentVersionNames.length > 0
                ? removal.currentVersionNames.join(', ')
                : 'no fix version at all'}
            </td>
            <td>{removal.byDisplayName ?? 'unattributed'}</td>
            <td>{describeInstant(removal.atIso)}</td>
            {/* The decisive column. Jira records one action as one changelog entry, so a version
                that vanished alongside a status change was cleared BY that transition — a workflow
                post-function or a transition screen — not typed away by hand. */}
            <td>
              {removal.statusChangeInSameAction === null
                ? 'a field edit'
                : `the move ${removal.statusChangeInSameAction.fromStatus} → ${removal.statusChangeInSameAction.toStatus}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Whether these removals rode along with a status change, or were plain field edits.
 *
 * The question every one of these reports turns into: "is the automation clearing our fix
 * versions?" Nothing in our own code names that field, so reading the code cannot answer it — but a
 * transition clears whatever its workflow is configured to clear, whoever fires it. Jira records one
 * action as one changelog entry, so this is the only place the two can be told apart.
 */
function RemovalCauseSummary({ removals }: { removals: readonly FixVersionRemoval[] }) {
  const causes = summariseRemovalCauses(removals);

  return (
    <p className={causes.withStatusChange > 0 ? styles.forecastAlert : styles.forecastSectionNote} role="status">
      {causes.withStatusChange === 0
        ? `All ${causes.fieldEditOnly} were plain field edits — somebody changed the field itself. `
          + 'No status change happened in the same action, so no workflow transition cleared them.'
        : `${causes.withStatusChange} of ${removals.length} happened in the SAME action as a status change. `
          + 'A transition cleared those, not a person editing the field — which means a workflow '
          + 'post-function or a transition screen on that move. It clears them for anybody who makes '
          + `that move, automation or not. ${causes.fieldEditOnly} were plain field edits.`}
    </p>
  );
}

export interface ClearedTodaySectionProps {
  projectKey: string;
}

/** Lists every issue in the project whose fix version was taken off within a chosen window. */
export function ClearedTodaySection({ projectKey }: ClearedTodaySectionProps) {
  const jiraBaseUrl = useConnectionStore((connectionState) => connectionState.proxyStatus?.jira?.baseUrl ?? null);
  const [removals, setRemovals] = useState<FixVersionRemoval[] | null>(null);
  const [runningChoiceId, setRunningChoiceId] = useState<string | null>(null);
  const [ranChoiceLabel, setRanChoiceLabel] = useState<string | null>(null);
  const [sweepError, setSweepError] = useState<string | null>(null);

  async function runSweep(choice: typeof LOOKBACK_CHOICES[number]): Promise<void> {
    setRunningChoiceId(choice.id);
    setSweepError(null);
    setRemovals(null);
    try {
      setRemovals(await loadFixVersionRemovalsSince(projectKey, choice.readSince(new Date())));
      setRanChoiceLabel(choice.label);
    } catch (caughtError) {
      setSweepError(caughtError instanceof Error ? caughtError.message : 'Could not read recent changes.');
    } finally {
      setRunningChoiceId(null);
    }
  }

  return (
    <div className={styles.forecastSection}>
      <h4 className={styles.forecastSectionTitle}>Fix versions cleared recently</h4>
      <p className={styles.forecastSectionNote}>
        Every issue in this project that LOST a fix version, whoever did it and whichever release it
        came off. No release needs picking — this is the sweep for when you know something changed
        but not where.
      </p>

      <div className={styles.forecastFigureRow}>
        {LOOKBACK_CHOICES.map((choice) => (
          <button
            className={styles.actionButton}
            disabled={runningChoiceId !== null}
            key={choice.id}
            onClick={() => void runSweep(choice)}
            type="button"
          >
            {runningChoiceId === choice.id ? 'Reading Jira…' : choice.label}
          </button>
        ))}
      </div>

      {sweepError !== null && <p className={styles.forecastAlert} role="alert">{sweepError}</p>}

      {removals !== null && removals.length === 0 && (
        <p className={styles.forecastSectionNote} role="status">
          {`No fix version was taken off any issue in this project — ${(ranChoiceLabel ?? '').toLowerCase()}.`}
        </p>
      )}

      {removals !== null && removals.length > 0 && (
        <>
          <p className={styles.forecastSectionNote} role="status">
            {`${removals.length} fix-version removal${removals.length === 1 ? '' : 's'} — ${(ranChoiceLabel ?? '').toLowerCase()}.`}
          </p>
          {/* Answers the question people argue about. No code that never names `fixVersions` can be
              ruled in or out by reading it — a transition clears whatever its workflow tells it to,
              and only the changelog can say which happened. */}
          <RemovalCauseSummary removals={removals} />
          {/* Grouped first: the answer is almost never "twelve issues each lost their release", it
              is "one person cleared twelve while doing something else". */}
          <AuthorBatchTable removals={removals} jiraBaseUrl={jiraBaseUrl} />
          <RemovalTable removals={removals} jiraBaseUrl={jiraBaseUrl} />
        </>
      )}
    </div>
  );
}
