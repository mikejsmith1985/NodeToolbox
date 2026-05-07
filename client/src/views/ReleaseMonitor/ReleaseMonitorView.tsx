// ReleaseMonitorView.tsx — Standalone Jira fixVersion release readiness monitor.
//
// This lightweight port keeps only the Jira release-health workflow: teams enter a
// project and fixVersion, optionally fetch Jira versions, then review grouped work
// and risk counts without legacy ServiceNow or GitHub automation.

import { useMemo, type CSSProperties } from 'react';

import {
  useReleaseMonitorState,
  type UseReleaseMonitorState,
} from './hooks/useReleaseMonitorState.ts';
import type { ReleaseIssue, ReleaseStatus, ReleaseStatusCategoryKey } from './utils/releaseStats.ts';
import styles from './ReleaseMonitorView.module.css';

const VIEW_TITLE = 'Release Monitor';
const VIEW_SUBTITLE = 'Track a Jira fixVersion by completion, blockers, overdue work, and release date risk.';
const EMPTY_STATE_MESSAGE = 'Enter a Jira project key and fixVersion to monitor a release.';
const LOADING_MESSAGE = 'Loading release monitor data…';
const NO_ISSUES_MESSAGE = 'No Jira issues were returned for this fixVersion.';
const NO_ASSIGNEE_LABEL = 'Unassigned';
const NO_DUE_DATE_LABEL = 'No due date';
const PERCENT_TOTAL = 100;
const EMPTY_COUNT = 0;

const STATUS_GROUPS: Array<{ key: ReleaseStatusCategoryKey; label: string; accent: string }> = [
  { key: 'new', label: 'To Do', accent: '#64748b' },
  { key: 'indeterminate', label: 'In Progress', accent: '#3b82f6' },
  { key: 'done', label: 'Done', accent: '#22c55e' },
];

const RELEASE_STATUS_LABELS: Record<ReleaseStatus, string> = {
  'on-track': 'ON TRACK',
  overdue: 'OVERDUE',
  released: 'RELEASED',
  unknown: 'UNKNOWN',
};

/** Renders the simplified Release Monitor and delegates Jira state to its hook. */
export default function ReleaseMonitorView() {
  const releaseMonitorState = useReleaseMonitorState();
  const groupedIssues = useMemo(() => groupIssuesByStatus(releaseMonitorState.issues), [releaseMonitorState.issues]);
  const hasRequiredInputs = Boolean(releaseMonitorState.projectKey.trim() && releaseMonitorState.fixVersion.trim());
  const hasIssues = releaseMonitorState.issues.length > EMPTY_COUNT;

  return (
    <section className={styles.releaseMonitorView} aria-label={VIEW_TITLE}>
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
          <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
        </div>
        {renderReleaseStatusChip(releaseMonitorState.releaseStatus)}
      </header>

      {renderControls(releaseMonitorState)}
      {renderStatsBar(releaseMonitorState)}

      {releaseMonitorState.errorMessage && (
        <p className={styles.errorMessage} role="alert">
          ⚠ {releaseMonitorState.errorMessage}
        </p>
      )}

      {releaseMonitorState.isLoading && <div className={styles.emptyState}>{LOADING_MESSAGE}</div>}
      {!releaseMonitorState.isLoading && !hasRequiredInputs && <div className={styles.emptyState}>{EMPTY_STATE_MESSAGE}</div>}
      {!releaseMonitorState.isLoading && hasRequiredInputs && !hasIssues && <div className={styles.emptyState}>{NO_ISSUES_MESSAGE}</div>}
      {!releaseMonitorState.isLoading && hasIssues && renderIssueGroups(groupedIssues, releaseMonitorState.issues.length)}
    </section>
  );
}

function renderControls(releaseMonitorState: UseReleaseMonitorState) {
  return (
    <div className={styles.controlsPanel}>
      <label className={styles.fieldLabel}>
        Project key
        <input
          className={styles.controlInput}
          aria-label="Project key"
          placeholder="Project key (e.g. TBX)"
          value={releaseMonitorState.projectKey}
          onChange={(changeEvent) => releaseMonitorState.setProjectKey(changeEvent.target.value)}
        />
      </label>
      <label className={styles.fieldLabel}>
        FixVersion
        <input
          className={styles.controlInput}
          aria-label="FixVersion"
          placeholder="FixVersion name (e.g. 0.6.1)"
          value={releaseMonitorState.fixVersion}
          onChange={(changeEvent) => releaseMonitorState.setFixVersion(changeEvent.target.value)}
        />
      </label>
      {releaseMonitorState.versions.length > EMPTY_COUNT && renderVersionSelect(releaseMonitorState)}
      <div className={styles.buttonRow}>
        <button type="button" className={styles.button} disabled={releaseMonitorState.isLoading} onClick={() => { void releaseMonitorState.loadVersions(); }}>
          Auto-fetch fixVersions for project
        </button>
        <button type="button" className={styles.buttonPrimary} disabled={releaseMonitorState.isLoading} onClick={() => { void releaseMonitorState.loadIssues(); }}>
          {releaseMonitorState.isLoading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}

function renderVersionSelect(releaseMonitorState: UseReleaseMonitorState) {
  return (
    <label className={styles.fieldLabel}>
      Available fixVersions
      <select
        className={styles.controlInput}
        aria-label="Available fixVersions"
        value={releaseMonitorState.fixVersion}
        onChange={(changeEvent) => releaseMonitorState.setFixVersion(changeEvent.target.value)}
      >
        <option value="">Select a fixVersion…</option>
        {releaseMonitorState.versions.map((jiraVersion) => (
          <option key={jiraVersion.id} value={jiraVersion.name}>
            {jiraVersion.name} — {jiraVersion.releaseDate ?? 'No release date'} — {jiraVersion.released ? 'released' : 'unreleased'}
          </option>
        ))}
      </select>
    </label>
  );
}

function renderStatsBar(releaseMonitorState: UseReleaseMonitorState) {
  return (
    <div className={styles.statsBar} aria-label="Release stats">
      {renderStatTile('Total issues', releaseMonitorState.stats.total)}
      {renderStatTile('Done', `${releaseMonitorState.stats.done} (${releaseMonitorState.stats.completionPct}%)`)}
      {renderStatTile('Blockers', releaseMonitorState.stats.blockers)}
      {renderStatTile('Overdue', releaseMonitorState.stats.overdue)}
    </div>
  );
}

function renderStatTile(label: string, value: string | number) {
  return (
    <div className={styles.statTile}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function renderReleaseStatusChip(releaseStatus: ReleaseStatus) {
  return <span className={readReleaseStatusClassName(releaseStatus)}>{RELEASE_STATUS_LABELS[releaseStatus]}</span>;
}

function renderIssueGroups(groupedIssues: Array<{ key: ReleaseStatusCategoryKey; label: string; accent: string; issues: ReleaseIssue[] }>, totalIssueCount: number) {
  return (
    <div className={styles.boardGrid} aria-label="Release status groups">
      {groupedIssues.map((statusGroup) => (
        <section key={statusGroup.key} className={styles.boardColumn} style={{ '--column-accent': statusGroup.accent } as CSSProperties} aria-label={statusGroup.label}>
          <header className={styles.columnHeader}>
            <h2>{statusGroup.label}</h2>
            <span>{statusGroup.issues.length} · {calculateGroupPercent(statusGroup.issues.length, totalIssueCount)}%</span>
          </header>
          <div className={styles.issueList}>{statusGroup.issues.map((issue) => renderIssueRow(issue))}</div>
        </section>
      ))}
    </div>
  );
}

function renderIssueRow(issue: ReleaseIssue) {
  return (
    <article key={issue.key} className={styles.issueCard}>
      <div className={styles.issueHeader}>
        <span className={styles.issueKey}>{issue.key}</span>
        <span className={styles.statusBadge}>{issue.statusName}</span>
      </div>
      <h3 className={styles.issueSummary}>{issue.summary}</h3>
      <div className={styles.issueMeta}>
        <span>🧑 {issue.assigneeName ?? NO_ASSIGNEE_LABEL}</span>
        <span>{issue.priorityName}</span>
        <span>{issue.duedate ?? NO_DUE_DATE_LABEL}</span>
      </div>
      {(issue.isBlocker || issue.isOverdue) && (
        <div className={styles.riskRow}>
          {issue.isBlocker && <span className={styles.blockerBadge}>Blocker</span>}
          {issue.isOverdue && <span className={styles.overdueBadge}>Overdue</span>}
        </div>
      )}
    </article>
  );
}

function groupIssuesByStatus(issues: ReleaseIssue[]): Array<{ key: ReleaseStatusCategoryKey; label: string; accent: string; issues: ReleaseIssue[] }> {
  return STATUS_GROUPS.map((statusGroup) => ({
    ...statusGroup,
    issues: issues.filter((issue) => readGroupKey(issue.statusCategoryKey) === statusGroup.key),
  }));
}

function readGroupKey(statusCategoryKey: ReleaseStatusCategoryKey): ReleaseStatusCategoryKey {
  if (statusCategoryKey === 'unknown') return 'new';
  return statusCategoryKey;
}

function calculateGroupPercent(groupCount: number, totalCount: number): number {
  if (totalCount === EMPTY_COUNT) return EMPTY_COUNT;
  return Math.round((groupCount / totalCount) * PERCENT_TOTAL);
}

function readReleaseStatusClassName(releaseStatus: ReleaseStatus): string {
  if (releaseStatus === 'released') return styles.statusReleased;
  if (releaseStatus === 'overdue') return styles.statusOverdue;
  if (releaseStatus === 'on-track') return styles.statusOnTrack;
  return styles.statusUnknown;
}
