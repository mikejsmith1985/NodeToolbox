// HygieneView.tsx — Standalone Jira issue health checker view.
//
// The view renders a focused port of the legacy Hygiene issue-health workflow: users
// enter a Jira project, optionally append more JQL, run one active-issue search, and
// drill into flagged issues by check type without depending on legacy ToolBox state.

import {
  HYGIENE_CHECK_IDS,
  HYGIENE_CHECK_LABELS,
  type HygieneCheckId,
  type HygieneFinding,
  type HygieneFlag,
} from './checks/hygieneChecks.ts';
import { useEffect, useRef } from 'react';
import { useHygieneState } from './hooks/useHygieneState.ts';
import styles from './HygieneView.module.css';

const VIEW_TITLE = 'Hygiene';
const VIEW_SUBTITLE = 'Check active Jira issues for missing ownership, stale work, and planning gaps.';
const PROJECT_PLACEHOLDER = 'TBX';
const EXTRA_JQL_PLACEHOLDER = 'AND labels = hygiene ORDER BY updated DESC';
const EMPTY_STATE_MESSAGE = 'Enter a project key and run Hygiene to find issue-health flags.';
const NO_FLAGS_MESSAGE = 'No Hygiene flags found for the current project and filter.';
const NO_VALUE_LABEL = '—';
const JIRA_BROWSE_PREFIX = '/browse/';
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_HYGIENE_SCORE = 100;
const HYGIENE_SCORE_FLAG_PENALTY = 5;

/** Renders the standalone Hygiene checker and delegates stateful Jira work to `useHygieneState`. */
export default function HygieneView() {
  const hygieneState = useHygieneState();
  const hasAutoRunTriggeredRef = useRef(false);
  const isHygieneLoading = hygieneState.isLoading;
  const loadHygiene = hygieneState.loadHygiene;
  const hygieneScore = Math.max(
    0,
    MAX_HYGIENE_SCORE - hygieneState.summary.totalFlags * HYGIENE_SCORE_FLAG_PENALTY,
  );
  const hasLoadedFindings = hygieneState.findings.length > 0;
  const hasVisibleFindings = hygieneState.filteredFindings.length > 0;
  const hasProjectKey = hygieneState.projectKey.trim().length > 0;
  const shouldShowNoFlags = !hygieneState.isLoading && hasProjectKey && !hasVisibleFindings;

  useEffect(() => {
    if (hasAutoRunTriggeredRef.current || !hasProjectKey || isHygieneLoading) {
      return;
    }
    hasAutoRunTriggeredRef.current = true;
    void loadHygiene();
  }, [hasProjectKey, isHygieneLoading, loadHygiene]);

  return (
    <section className={styles.hygieneView} aria-label={VIEW_TITLE}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
        <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
      </header>

      <div className={styles.controlsPanel}>
        <label className={styles.fieldLabel}>
          Project key
          <input
            className={styles.textInput}
            aria-label="Project key"
            placeholder={PROJECT_PLACEHOLDER}
            value={hygieneState.projectKey}
            onChange={(changeEvent) => hygieneState.setProjectKey(changeEvent.target.value)}
          />
        </label>
        <label className={styles.fieldLabel}>
          Extra JQL (optional)
          <input
            className={styles.textInput}
            aria-label="Extra JQL"
            placeholder={EXTRA_JQL_PLACEHOLDER}
            value={hygieneState.extraJql}
            onChange={(changeEvent) => hygieneState.setExtraJql(changeEvent.target.value)}
          />
        </label>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={hygieneState.isLoading || !hygieneState.projectKey.trim()}
          onClick={() => {
            void hygieneState.loadHygiene();
          }}
        >
          {hygieneState.isLoading ? 'Loading…' : 'Run Hygiene'}
        </button>
      </div>

      {hygieneState.loadError && (
        <p className={styles.errorMessage} role="alert">
          ⚠ {hygieneState.loadError}
        </p>
      )}

      <div className={styles.summaryGrid} aria-label="Hygiene summary tiles">
        <div className={styles.summaryTile} aria-label="Hygiene score tile">
          <strong>{hygieneScore}/100</strong>
          <span>Hygiene Score</span>
        </div>
        <button
          type="button"
          className={hygieneState.selectedFilter === null ? styles.summaryTileSelected : styles.summaryTile}
          onClick={() => hygieneState.selectFilter(null)}
        >
          <strong>{hygieneState.summary.totalIssues} issues</strong>
          <span>{hygieneState.summary.totalFlags} flags total</span>
        </button>
        {HYGIENE_CHECK_IDS.map((checkId) => renderSummaryTile(checkId, hygieneState))}
      </div>

      {hygieneState.isLoading && <div className={styles.emptyState}>Loading Hygiene results…</div>}
      {!hygieneState.isLoading && !hasLoadedFindings && !hygieneState.projectKey.trim() && (
        <div className={styles.emptyState}>{EMPTY_STATE_MESSAGE}</div>
      )}
      {shouldShowNoFlags && <div className={styles.emptyState}>{NO_FLAGS_MESSAGE}</div>}
      {!hygieneState.isLoading && hasVisibleFindings && (
        <div className={styles.findingsList} aria-label="Hygiene findings">
          {hygieneState.filteredFindings.map(renderFindingRow)}
        </div>
      )}
    </section>
  );
}

function renderSummaryTile(checkId: HygieneCheckId, hygieneState: ReturnType<typeof useHygieneState>) {
  const isTileSelected = hygieneState.selectedFilter === checkId;
  return (
    <button
      key={checkId}
      type="button"
      className={isTileSelected ? styles.summaryTileSelected : styles.summaryTile}
      aria-pressed={isTileSelected}
      onClick={() => hygieneState.selectFilter(checkId)}
    >
      <strong>{hygieneState.summary.countByCheck[checkId]}</strong>
      <span>{HYGIENE_CHECK_LABELS[checkId]}</span>
    </button>
  );
}

function renderFindingRow(finding: HygieneFinding) {
  return (
    <article key={finding.issue.key} className={styles.findingRow}>
      <div className={styles.issueMain}>
        <a className={styles.issueKey} href={buildJiraBrowseUrl(finding.issue.key)} target="_blank" rel="noreferrer">
          {finding.issue.key}
        </a>
        <h2 className={styles.issueSummary}>{readIssueSummary(finding)}</h2>
      </div>
      <div className={styles.flagList}>{finding.flags.map(renderFlagChip)}</div>
      <dl className={styles.issueMeta}>
        <div>
          <dt>Assignee</dt>
          <dd>{readAssigneeName(finding)}</dd>
        </div>
        <div>
          <dt>Age</dt>
          <dd>{formatIssueAge(finding.issue.fields.created)}</dd>
        </div>
      </dl>
    </article>
  );
}

function renderFlagChip(flag: HygieneFlag) {
  const flagClassName = flag.severity === 'error' ? styles.flagChipError : styles.flagChipWarn;
  return (
    <span key={flag.checkId} className={flagClassName}>
      {flag.label}
    </span>
  );
}

function readIssueSummary(finding: HygieneFinding): string {
  return finding.issue.fields.summary || 'Untitled Jira issue';
}

function readAssigneeName(finding: HygieneFinding): string {
  return finding.issue.fields.assignee?.displayName || NO_VALUE_LABEL;
}

function formatIssueAge(createdDateText: string | undefined): string {
  if (!createdDateText) return NO_VALUE_LABEL;
  const createdTimestamp = new Date(createdDateText).getTime();
  if (!Number.isFinite(createdTimestamp)) return NO_VALUE_LABEL;
  const dayCount = Math.max(0, Math.floor((Date.now() - createdTimestamp) / MILLISECONDS_PER_DAY));
  return `${dayCount}d`;
}

function buildJiraBrowseUrl(issueKey: string): string {
  return `${JIRA_BROWSE_PREFIX}${encodeURIComponent(issueKey)}`;
}
