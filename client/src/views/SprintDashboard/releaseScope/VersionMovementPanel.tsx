// VersionMovementPanel.tsx — "This release had 27 issues and now has 15. Where did twelve go?"
//
// Jira answers what is in a version today and is silent about what left it, so the only way to
// answer that was to remember. This asks the history, compares it with the present, and names every
// departure and where it landed.
//
// It also lists every version in the project, filterable, because the other half of the problem is
// not remembering the name — a release renamed to something like
// "08/27/2026 B (scope pushed from july)" is unfindable if you have to type it exactly.

import { useEffect, useMemo, useState } from 'react';

import { fetchPiWindowFixVersions, type RawJiraVersion } from '../../ArtView/piPlan/piPlanReleaseSchedule.ts';
import { buildJiraIssueNavigatorUrl } from '../../Hygiene/utils/buildHygieneJqlUrl.ts';
import { useConnectionStore } from '../../../store/connectionStore.ts';
import { groupDeparturesByDestination, type VersionSnapshot } from './versionMovement.ts';
import { loadVersionMovement, readVersionSnapshotAt, type VersionMovementOutcome } from './versionMovementFetch.ts';
import styles from '../SprintDashboardView.module.css';

/** Said rather than shown as an empty list — the two mean opposite things. */
const HISTORY_UNAVAILABLE_NOTE =
  'This Jira would not answer the history query, so nothing below claims to know what left this '
  + 'version. What it holds today is still accurate.';

/** One version row in the finder: when it ships, and whether it is still open. */
function describeVersion(version: RawJiraVersion): string {
  const releaseDate = version.releaseDate ? version.releaseDate.slice(0, 10) : 'no release date';
  if (version.released) return `${releaseDate} · released`;
  return version.archived ? `${releaseDate} · archived` : `${releaseDate} · open`;
}

/**
 * The version finder: every version in the project, filtered by whatever you can remember of it.
 *
 * Released and archived versions are deliberately INCLUDED. The version somebody is hunting for is
 * usually an old one — the July release that was renamed and pushed — and the open-versions list
 * every other surface uses is exactly the list it will not be in.
 */
function VersionFinder({ versions, onPick }: {
  versions: readonly RawJiraVersion[];
  onPick: (versionName: string) => void;
}) {
  const [filterText, setFilterText] = useState('');

  const matches = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    // Newest release date first: a version being hunted for is far more often recent than ancient.
    const sorted = [...versions].sort((left, right) =>
      (right.releaseDate ?? '').localeCompare(left.releaseDate ?? ''));
    return needle === ''
      ? sorted
      : sorted.filter((version) => (version.name ?? '').toLowerCase().includes(needle));
  }, [versions, filterText]);

  return (
    <div className={styles.forecastSection}>
      <h4 className={styles.forecastSectionTitle}>Find a version</h4>
      <p className={styles.forecastSectionNote}>
        Every version in this project, newest release date first — released and archived ones too,
        because the one you are hunting for is usually an old one. Type any part of the name.
      </p>
      <input
        aria-label="Filter versions"
        className={styles.inputField}
        onChange={(changeEvent) => setFilterText(changeEvent.target.value)}
        placeholder="july, 08/27, pushed…"
        type="text"
        value={filterText}
      />
      {matches.length === 0 && (
        <p className={styles.forecastSectionNote} role="status">No version name contains that.</p>
      )}
      {matches.length > 0 && (
        <table className={styles.forecastTable}>
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">Release date and state</th>
              <th scope="col">Trace</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((version) => (
              <tr key={version.name}>
                <td>{version.name}</td>
                <td>{describeVersion(version)}</td>
                <td>
                  <button className={styles.actionButton} onClick={() => onPick(version.name)} type="button">
                    Trace this version
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** The departures, grouped by where they landed — the answer said once rather than twelve times. */
function DepartureSummary({ outcome, jiraBaseUrl }: { outcome: VersionMovementOutcome; jiraBaseUrl: string | null }) {
  const groups = groupDeparturesByDestination(outcome.movement.departed);

  if (outcome.isHistoryUnavailable) {
    return (
      <p className={styles.forecastAlert} role="status">
        {outcome.historyErrorMessage === null
          ? HISTORY_UNAVAILABLE_NOTE
          : `${HISTORY_UNAVAILABLE_NOTE} Jira said: ${outcome.historyErrorMessage}`}
      </p>
    );
  }

  if (groups.length === 0) {
    return (
      <p className={styles.forecastSectionNote} role="status">
        Nothing has left this version. Every issue that was ever in it is still in it.
      </p>
    );
  }

  return (
    <table className={styles.forecastTable}>
      <thead>
        <tr>
          <th scope="col">Went to</th>
          <th scope="col">How many</th>
          <th scope="col">Which</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <tr key={group.destination}>
            <td>{group.destination}</td>
            <td>{group.issueKeys.length}</td>
            <td>
              <a href={buildJiraIssueNavigatorUrl(group.issueKeys, jiraBaseUrl)} rel="noreferrer" target="_blank">
                {group.issueKeys.join(', ')}
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The three figures: what it holds, what left, and what was ever in it. */
function MovementFigures({ outcome }: { outcome: VersionMovementOutcome }) {
  const inItNow = outcome.movement.stillIn.length + outcome.movement.arrived.length;
  const departedCount = outcome.movement.departed.length;

  return (
    <div className={styles.forecastFigureRow}>
      <div className={styles.forecastFigure}>
        <span className={styles.forecastFigureLabel}>IN IT NOW</span>
        <span className={styles.forecastFigureValue}>{inItNow}</span>
      </div>
      <div className={styles.forecastFigure}>
        <span className={styles.forecastFigureLabel}>LEFT IT</span>
        {/* "unknown" rather than 0 when the history was refused: those are opposite answers. */}
        <span className={departedCount > 0 ? styles.forecastFigureValueAlert : styles.forecastFigureValue}>
          {outcome.isHistoryUnavailable ? 'unknown' : departedCount}
        </span>
      </div>
      <div className={styles.forecastFigure}>
        <span className={styles.forecastFigureLabel}>EVER IN IT</span>
        <span className={styles.forecastFigureValue}>
          {outcome.isHistoryUnavailable ? 'unknown' : inItNow + departedCount}
        </span>
      </div>
    </div>
  );
}

/** Every issue that left, with where it is now. */
function DepartedIssueTable({ outcome, jiraBaseUrl }: { outcome: VersionMovementOutcome; jiraBaseUrl: string | null }) {
  return (
    <table className={styles.forecastTable}>
      <thead>
        <tr>
          <th scope="col">Issue</th>
          <th scope="col">Summary</th>
          <th scope="col">Status</th>
          <th scope="col">Owner</th>
          <th scope="col">Now in</th>
          <th scope="col">Taken off by</th>
        </tr>
      </thead>
      <tbody>
        {outcome.movement.departed.map((issue) => (
          <tr key={issue.key}>
            <td>
              <a href={buildJiraIssueNavigatorUrl([issue.key], jiraBaseUrl)} rel="noreferrer" target="_blank">
                {issue.key}
              </a>
            </td>
            <td>{issue.summary}</td>
            <td>{issue.statusName ?? 'unknown'}</td>
            <td>{issue.assigneeDisplayName ?? 'Unassigned'}</td>
            <td>
              {issue.movedToVersionNames.length > 0
                ? issue.movedToVersionNames.join(', ')
                : 'no fix version at all'}
            </td>
            {/* The most useful column: a release losing a dozen issues is usually ONE person doing
                one thing that cleared the field as a side effect, and this is what shows that. */}
            <td>
              {issue.departure === null
                ? 'history does not say'
                : `${issue.departure.byDisplayName ?? 'somebody'} · ${issue.departure.atIso.slice(0, 16).replace('T', ' ')}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Converts a `datetime-local` value into an instant.
 *
 * `datetime-local` carries WALL time with no zone, and `new Date(...)` on it resolves in the
 * viewer's own zone — which is what somebody typing "Friday 1:00 PM" means. Returns null for a
 * half-typed value rather than an Invalid Date that would silently reconstruct nothing.
 */
function readLocalInstant(localDateTimeValue: string): string | null {
  if (localDateTimeValue.trim() === '') return null;
  const instant = new Date(localDateTimeValue);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

/** A compact list of issue keys, linked into Jira. */
function IssueKeyList({ issueKeys, jiraBaseUrl }: { issueKeys: string[]; jiraBaseUrl: string | null }) {
  if (issueKeys.length === 0) {
    return <span>none</span>;
  }
  return (
    <a href={buildJiraIssueNavigatorUrl(issueKeys, jiraBaseUrl)} rel="noreferrer" target="_blank">
      {issueKeys.join(', ')}
    </a>
  );
}

/**
 * What the release held at a chosen moment.
 *
 * Jira cannot be asked this, and it is the question that turns "twelve issues vanished" into
 * "these twelve, between Friday and now". Answered from the change histories already fetched, so
 * every date typed here is instant and costs nothing.
 */
function SnapshotSection({ outcome, jiraBaseUrl }: { outcome: VersionMovementOutcome; jiraBaseUrl: string | null }) {
  const [localDateTimeValue, setLocalDateTimeValue] = useState('');

  const snapshot = useMemo<VersionSnapshot | null>(() => {
    const atIso = readLocalInstant(localDateTimeValue);
    return atIso === null ? null : readVersionSnapshotAt(outcome, atIso);
  }, [outcome, localDateTimeValue]);

  return (
    <div className={styles.forecastSection}>
      <h4 className={styles.forecastSectionTitle}>What this release looked like at a moment</h4>
      <p className={styles.forecastSectionNote}>
        Pick a date and time in your own time zone — Jira cannot be asked this, and it is what turns
        &quot;issues vanished&quot; into &quot;these ones, between then and now&quot;.
      </p>
      <input
        aria-label="Release contents as of"
        className={styles.inputField}
        onChange={(changeEvent) => setLocalDateTimeValue(changeEvent.target.value)}
        type="datetime-local"
        value={localDateTimeValue}
      />

      {outcome.isHistoryUnavailable && (
        <p className={styles.forecastAlert} role="status">
          Without the history this cannot be reconstructed, so nothing below would be true.
        </p>
      )}

      {!outcome.isHistoryUnavailable && snapshot !== null && (
        <>
          <div className={styles.forecastFigureRow}>
            <div className={styles.forecastFigure}>
              <span className={styles.forecastFigureLabel}>IN IT THEN</span>
              <span className={styles.forecastFigureValue}>{snapshot.membersAt.length}</span>
            </div>
            <div className={styles.forecastFigure}>
              <span className={styles.forecastFigureLabel}>REMOVED SINCE</span>
              <span className={snapshot.removedSince.length > 0
                ? styles.forecastFigureValueAlert
                : styles.forecastFigureValue}
              >
                {snapshot.removedSince.length}
              </span>
            </div>
            <div className={styles.forecastFigure}>
              <span className={styles.forecastFigureLabel}>ADDED SINCE</span>
              <span className={styles.forecastFigureValue}>{snapshot.addedSince.length}</span>
            </div>
          </div>
          <table className={styles.forecastTable}>
            <tbody>
              <tr>
                <th scope="row">In it then</th>
                <td><IssueKeyList issueKeys={snapshot.membersAt.map((issue) => issue.key)} jiraBaseUrl={jiraBaseUrl} /></td>
              </tr>
              <tr>
                <th scope="row">Removed since</th>
                <td><IssueKeyList issueKeys={snapshot.removedSince.map((issue) => issue.key)} jiraBaseUrl={jiraBaseUrl} /></td>
              </tr>
              <tr>
                <th scope="row">Added since</th>
                <td><IssueKeyList issueKeys={snapshot.addedSince.map((issue) => issue.key)} jiraBaseUrl={jiraBaseUrl} /></td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export interface VersionMovementPanelProps {
  projectKey: string;
}

/** Traces one fix version: what it holds, what left it, and where each departure went. */
export function VersionMovementPanel({ projectKey }: VersionMovementPanelProps) {
  // Nothing is rendered or fetched until somebody opens it. `<details>` alone would still put the
  // whole version list in the DOM, where it collides with the release cards below that carry the
  // same names — and it would cost a Jira request on every visit to a tab this is not the point of.
  const [isPanelOpen, setPanelOpen] = useState(false);
  // Read here rather than threaded through: the links are this panel's own concern, and the same
  // store is where every other Jira link on the tool gets its base URL.
  const jiraBaseUrl = useConnectionStore((connectionState) => connectionState.proxyStatus?.jira?.baseUrl ?? null);
  const [versions, setVersions] = useState<RawJiraVersion[] | null>(null);
  const [tracedVersionName, setTracedVersionName] = useState('');
  const [outcome, setOutcome] = useState<VersionMovementOutcome | null>(null);
  const [isTracing, setIsTracing] = useState(false);
  const [traceError, setTraceError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (!isPanelOpen || projectKey.trim() === '') {
      return;
    }
    void fetchPiWindowFixVersions(projectKey)
      .then((loadedVersions) => { if (isMounted) setVersions(loadedVersions); })
      .catch(() => { if (isMounted) setVersions([]); });
    return () => { isMounted = false; };
  }, [isPanelOpen, projectKey]);

  async function traceVersion(versionName: string): Promise<void> {
    setTracedVersionName(versionName);
    setIsTracing(true);
    setTraceError(null);
    setOutcome(null);
    try {
      setOutcome(await loadVersionMovement(projectKey, versionName));
    } catch (caughtError) {
      setTraceError(caughtError instanceof Error ? caughtError.message : 'Could not read this version.');
    } finally {
      setIsTracing(false);
    }
  }

  return (
    <details onToggle={(toggleEvent) => setPanelOpen(toggleEvent.currentTarget.open)}>
      <summary className={styles.forecastSectionTitle}>
        Scope movement — where did this release&apos;s issues go?
      </summary>

      {isPanelOpen && versions === null && (
        <p className={styles.forecastSectionNote} role="status">Reading this project&apos;s versions…</p>
      )}
      {isPanelOpen && versions !== null && (
        <VersionFinder versions={versions} onPick={(versionName) => void traceVersion(versionName)} />
      )}

      {tracedVersionName !== '' && (
        <div className={styles.forecastSection}>
          <h4 className={styles.forecastSectionTitle}>
            {`Where the work in ${tracedVersionName} went`}
          </h4>
          {isTracing && <p className={styles.forecastSectionNote} role="status">Reading Jira…</p>}
          {traceError !== null && <p className={styles.forecastAlert} role="alert">{traceError}</p>}

          {outcome !== null && (
            <>
              <MovementFigures outcome={outcome} />
              <DepartureSummary outcome={outcome} jiraBaseUrl={jiraBaseUrl} />
              {outcome.movement.departed.length > 0 && (
                <DepartedIssueTable outcome={outcome} jiraBaseUrl={jiraBaseUrl} />
              )}
              <SnapshotSection outcome={outcome} jiraBaseUrl={jiraBaseUrl} />
            </>
          )}
        </div>
      )}
    </details>
  );
}
