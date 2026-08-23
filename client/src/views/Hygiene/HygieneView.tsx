// HygieneView.tsx — Standalone Jira issue health checker view.
//
// The view renders a focused port of the legacy Hygiene issue-health workflow: users
// enter a Jira project, optionally append more JQL, run one active-issue search, and
// drill into flagged issues by check type without depending on legacy ToolBox state.

import {
  resolveHygieneFieldConfig,
  type HygieneFieldConfig,
  type HygieneFinding,
  type HygieneFlag,
} from './checks/hygieneChecks.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildHygieneDiagnosticsReport } from './hygieneDiagnostics.ts';
import {
  buildDerivedDateForecastContext,
  describeTargetStartBases,
} from '../SprintDashboard/forecast/derivedDateForecastContext.ts';
import { resolveStoryPointsFieldIds } from './checks/storyPointsField.ts';
import {
  applyDerivedDates,
  readDeterministicDateFixCandidates,
  summariseUndecidedDates,
} from './derivedDateFix.ts';
import { AgeBadge } from '../../components/IssueMeta/AgeBadge.tsx';
import { AssigneeAvatar } from '../../components/IssueMeta/AssigneeAvatar.tsx';
import { IssueTypeIcon } from '../../components/IssueMeta/IssueTypeIcon.tsx';
import { StatusChip } from '../../components/IssueMeta/StatusChip.tsx';
import { loadDashboardConfigFromStorage } from '../SprintDashboard/hooks/useDashboardConfig.ts';
import { useSettingsStore } from '../../store/settingsStore.ts';
import { useAiAssistStore } from '../../store/aiAssistStore.ts';
import { HygieneFixControl } from './HygieneFixControl.tsx';
import { PlanningDateFields } from './PlanningDateFields.tsx';
import { buildHygieneStatBand } from './hygieneStatBand.ts';
import { HygieneAiPanel } from './ai/HygieneAiPanel.tsx';
import { parseHygieneFilterCheckIds, useHygieneState } from './hooks/useHygieneState.ts';
import { useHygieneSession, type HygieneSessionOutcome } from './hooks/useHygieneSession.ts';
import { HYGIENE_SORT_OPTIONS, sortHygieneFindings, type HygieneSortKey } from './hygieneSort.ts';
import {
  buildCheckIssueKeys,
  buildHygieneCheckJql,
  buildJiraIssueNavigatorUrl,
  buildJiraSearchUrl,
} from './utils/buildHygieneJqlUrl.ts';
import IssueDetailPanel from '../../components/IssueDetailPanel/index.tsx';
import { useConnectionStore } from '../../store/connectionStore.ts';
import type { JiraIssue as RealJiraIssue } from '../../types/jira.ts';
import styles from './HygieneView.module.css';

const VIEW_TITLE = 'Hygiene';
const VIEW_SUBTITLE = 'Check active Jira issues for missing ownership, stale work, and planning gaps.';
const PROJECT_PLACEHOLDER = 'TBX';
const ALL_PROJECTS_PROJECT_PLACEHOLDER = 'All my projects';
const EXTRA_JQL_PLACEHOLDER = 'AND labels = hygiene ORDER BY updated DESC';
const EMPTY_STATE_MESSAGE = 'Enter a project key and run Hygiene to find issue-health flags.';
const NO_FLAGS_MESSAGE = 'No Hygiene flags found for the current project and filter.';
// Shown when the search ran but matched zero issues. Distinct from NO_FLAGS_MESSAGE on purpose:
// "everything is clean" and "the scope found nothing to check" must never look the same, or a wrong
// project key / PI silently renders as a perfect score (GH #167).
const EMPTY_SCOPE_MESSAGE =
  'The current scope matched no Jira issues — check the project key, PI, and extra JQL. '
  + 'No score is shown for an empty scope.';
const EMPTY_SCOPE_SCORE_LABEL = '—';
// Shown before the FIRST run for a scope. Distinct from both messages above, because "not run yet",
// "ran and matched nothing" and "everything is clean" render almost identically otherwise — a grid
// of zeros and a dash — and a panel merely awaiting a button press was reported as a broken one.
const NEVER_RUN_MESSAGE =
  'Hygiene has not been run for this scope yet — the zeros below are not results. '
  + 'Press Run Hygiene to check it.';
// The checks that have NO default field and silently skip themselves when the instance has no
// matching field. Their tiles must say "not configured", because a bare 0 from a check that never
// ran reads exactly like a clean result — the same lie as the empty-scope perfect score (GH #167).
const FIELD_DEPENDENT_CHECKS: ReadonlyArray<{ checkId: string; fieldConfigKey: keyof HygieneFieldConfig }> = [
  { checkId: 'missing-product-owner', fieldConfigKey: 'productOwnerFieldIds' },
  { checkId: 'missing-initiative-type', fieldConfigKey: 'initiativeTypeFieldIds' },
  { checkId: 'missing-application', fieldConfigKey: 'applicationFieldIds' },
];
const NOT_CONFIGURED_TILE_LABEL = 'not checked — no matching Jira field';
// Visible marks for findings settled during a cleanup session; untouched rows carry none.
const SESSION_OUTCOME_MARKS: Record<HygieneSessionOutcome, string> = {
  fixed: '✓ fixed',
  commented: '💬 commented',
  skipped: '⤼ skipped',
};
// Plain-language explanations rendered above each flag's fix controls (spec 019 FR-015).
const CHECK_EXPLANATION_BY_ID: Record<string, string> = {
  'missing-sp': 'Missing story points — set the estimate so planning can size this work.',
  'no-ac': 'Missing acceptance criteria — capture how this work will be verified.',
  'no-assignee': 'Nobody owns this issue — assign it so it can move.',
  'missing-fix-version': 'No fix version — tag the release this work lands in.',
  'missing-due-date': 'No due date — set when this is expected to finish.',
  'missing-pi': 'No Program Increment — attach this to the PI it belongs to.',
  'missing-feature-link': 'Not linked to a Feature — connect it to the initiative it supports.',
};
const DIAGNOSTICS_TOGGLE_LABEL = '🔧 Diagnostics';
const DIAGNOSTICS_COPY_LABEL = 'Copy report';
const DIAGNOSTICS_COPIED_LABEL = '✓ Copied';
const JIRA_BROWSE_PREFIX = 'https://jira.healthspring-jira-prod.aws.zilverton.com/browse/';
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_HYGIENE_SCORE = 100;
const HYGIENE_SCORE_FLAG_PENALTY = 5;
// How long the "copied" confirmation label stays on the tile copy button before reverting.
const COPY_CONFIRMATION_TIMEOUT_MS = 2000;
// Tooltip text is built from the constants so the explanation stays in sync if the formula changes.
const HYGIENE_SCORE_TOOLTIP =
  `Score = ${MAX_HYGIENE_SCORE} − (total flags × ${HYGIENE_SCORE_FLAG_PENALTY}), minimum 0.\n` +
  `Every flagged issue deducts ${HYGIENE_SCORE_FLAG_PENALTY} points regardless of severity — ` +
  `both ⚠ warn and ✕ error flags count equally. Fix flags to raise the score.`;

interface HygieneViewProps {
  isTeamMode?: boolean;
  /** Pre-populated extra JQL clause injected from the Sprint Dashboard scope (PI, sprint, fix version). */
  initialExtraJql?: string;
  /** Team-supplied project key. When set, it is authoritative and follows the active team selection. */
  projectKey?: string;
  /** Open in the cross-project "All my projects" scope (standalone only) — see useHygieneState. */
  initialAllProjects?: boolean;
  /** Preselect one check filter on arrival (e.g. 'stale' when deep-linked from the Today card). */
  initialFilter?: string;
  /** Standalone assignee clause — My Issues passes the tool-wide persona clause so Hygiene follows "simulate as". */
  assigneeClause?: string;
}

/** Renders the standalone Hygiene checker and delegates stateful Jira work to `useHygieneState`. */
export default function HygieneView({
  isTeamMode = false,
  initialExtraJql = '',
  projectKey,
  initialAllProjects = false,
  initialFilter,
  assigneeClause,
}: HygieneViewProps = {}) {
  const hygieneState = useHygieneState({
    isTeamMode,
    initialExtraJql,
    projectKey,
    initialAllProjects,
    initialSelectedFilter: initialFilter,
    assigneeClause,
  });
  const isAiAssistUnlocked = useAiAssistStore((storeState) => storeState.isAiAssistUnlocked);
  // Memoised because it is a new array on every render otherwise, and the AI panel rebuilds its
  // prompt (and re-fetches comment context) whenever this identity changes.
  const aiRestrictToCheckIds = useMemo(
    () => parseHygieneFilterCheckIds(hygieneState.selectedFilter),
    [hygieneState.selectedFilter],
  );
  const jiraBaseUrl = useConnectionStore((state) => state.proxyStatus?.jira?.baseUrl ?? null);
  // The same stale threshold the scan grades with — the AgeBadge heat derives from it (spec 019 FR-005).
  const activeTeamProfileId = useSettingsStore((storeState) => storeState.sprintDashboardActiveTeamProfileId);
  const staleDaysThreshold = loadDashboardConfigFromStorage(activeTeamProfileId).staleDaysThreshold;
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
  // The view is runnable with a project key OR in the all-projects scope (which needs none).
  const hasRunnableScope = hasProjectKey || hygieneState.isAllProjectsScope;
  // "Ran and matched nothing" — the state that must never masquerade as a clean bill of health.
  const isScopeEmpty = !hygieneState.isLoading
    && hygieneState.loadError === null
    && hygieneState.scannedIssueCount === 0;
  // A score exists only when a run actually scanned issues. Before the first run, after a failed
  // run (scannedIssueCount is null), or on an empty scope, the tile shows a dash — a failed search
  // rendering a green 100/100 next to its own error message was half of GH #167's confusion.
  const hasScoreData = (hygieneState.scannedIssueCount ?? 0) > 0;
  // No run has produced a count for this scope. Either it has never been run, or the last attempt
  // failed — the error is shown separately, and in both cases the tiles below describe nothing.
  const hasNeverRun = !hygieneState.isLoading && hygieneState.scannedIssueCount === null;
  const shouldShowNoFlags = !hygieneState.isLoading
    && hasRunnableScope
    && !hasVisibleFindings
    && hasScoreData;
  /**
   * A filter is hiding findings that genuinely exist.
   *
   * The filter is PERSISTED, so one clicked days ago silently survives into every later scan. The
   * result is a page reporting a score of 70 over six flags with an empty list underneath — which
   * reads as broken software, not as a filter, because nothing on screen named the filter or
   * offered to clear it.
   */
  const isFilterHidingEverything = shouldShowNoFlags
    && hygieneState.selectedFilter !== null
    && hygieneState.findings.length > 0;
  const activeFilterLabel = (hygieneState.selectedFilter ?? '')
    .split(',')
    .map((checkId) => hygieneState.checkLabelsById[checkId.trim()] ?? checkId.trim())
    .filter((label) => label !== '')
    .join(' or ');
  const [expandedIssueKey, setExpandedIssueKey] = useState<string | null>(null);
  const [copiedCheckId, setCopiedCheckId] = useState<string | null>(null);
  // Optional list ordering (status / assignee / issue type / age); scan order by default.
  const [sortKey, setSortKey] = useState<HygieneSortKey>('scan');
  // Guided cleanup session over the CURRENT filtered findings (spec 019 US3) — ephemeral by design.
  const session = useHygieneSession();
  const { syncWithKeys, endedSummary } = session;
  // The list as displayed — filter first, then the chosen sort. The session walks THIS order.
  const displayedFindings = sortHygieneFindings(hygieneState.filteredFindings, sortKey);
  const filteredFindingKeysJoined = displayedFindings
    .map((finding) => finding.issue.key)
    .join('|');

  // A changed filter/list underneath an active session ends it (fresh list ⇒ fresh session).
  useEffect(() => {
    syncWithKeys(filteredFindingKeysJoined === '' ? [] : filteredFindingKeysJoined.split('|'));
  }, [syncWithKeys, filteredFindingKeysJoined]);

  // Fixes applied during a session defer the rescan (so the cursor never jumps — FR-014);
  // the deferred reload runs once the session ends, if anything was actually fixed.
  useEffect(() => {
    if (endedSummary && endedSummary.fixedCount > 0) {
      void loadHygiene();
    }
  }, [endedSummary, loadHygiene]);
  // Fall back to defaults so the inline fix controls still resolve system fields before the first
  // Jira-name-resolved config lands (and so tests that stub the hook without a config keep working).
  const fixFieldConfig = hygieneState.fieldConfig ?? resolveHygieneFieldConfig();

  function handleToggleIssueExpand(issueKey: string) {
    setExpandedIssueKey((currentKey) => (currentKey === issueKey ? null : issueKey));
  }

  function handleCopyCheckJql(checkId: string): void {
    const issueKeys = buildCheckIssueKeys(checkId, hygieneState.findings);
    if (issueKeys.length === 0) return;
    const urlOrJql = buildJiraIssueNavigatorUrl(issueKeys, jiraBaseUrl);
    navigator.clipboard.writeText(urlOrJql).then(() => {
      setCopiedCheckId(checkId);
      setTimeout(() => setCopiedCheckId(null), COPY_CONFIRMATION_TIMEOUT_MS);
    }).catch(() => {
      // Clipboard API unavailable in non-secure contexts — proceed silently
    });
  }

  useEffect(() => {
    // In team mode the team dropdown is the primary driver: selecting a team seeds the Project Key and
    // Extra JQL, but the scan is MANUAL — nothing runs until the user clicks "Run Hygiene". The one
    // exception is a Today-card drill-through, which arrives with a deep-linked filter because the user
    // clicked a specific count and expects those exact issues immediately. Standalone Hygiene keeps its
    // auto-run on its persisted project. (Editing Project Key / Extra JQL never scans on its own — only
    // the button does — so this effect is the only place that could auto-execute.)
    const isDeepLinkedArrival = (initialFilter ?? '') !== '';
    const shouldAutoRun = isDeepLinkedArrival || !isTeamMode;
    if (hasAutoRunTriggeredRef.current || !shouldAutoRun || !hasRunnableScope || isHygieneLoading) {
      return;
    }
    hasAutoRunTriggeredRef.current = true;
    void loadHygiene();
  }, [initialFilter, isTeamMode, hasRunnableScope, isHygieneLoading, loadHygiene]);

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
            disabled={hygieneState.isAllProjectsScope}
            placeholder={hygieneState.isAllProjectsScope ? ALL_PROJECTS_PROJECT_PLACEHOLDER : PROJECT_PLACEHOLDER}
            value={hygieneState.isAllProjectsScope ? '' : hygieneState.projectKey}
            onChange={(changeEvent) => hygieneState.setProjectKey(changeEvent.target.value)}
          />
        </label>
        {/* Standalone only: the cross-project personal scope the Today cards count with. Team mode
            audits one team's project, so the toggle is not offered there. */}
        {!isTeamMode && (
          <label className={styles.scopeToggleLabel}>
            <input
              type="checkbox"
              aria-label="All my projects"
              checked={hygieneState.isAllProjectsScope}
              onChange={(changeEvent) => hygieneState.setAllProjectsScope(changeEvent.target.checked)}
            />
            All my projects
          </label>
        )}
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
          disabled={hygieneState.isLoading || !hasRunnableScope}
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
        <div className={styles.scoreTile} aria-label="Hygiene score tile">
          {/* No scan data (never ran, failed, or matched nothing) has no health to score — a dash,
              never a perfect 100. */}
          <strong>{hasScoreData ? `${hygieneScore}/100` : EMPTY_SCOPE_SCORE_LABEL}</strong>
          <span className={styles.scoreLabel}>
            Hygiene Score
            <span className={styles.scoreInfoWrapper}>
              <button
                type="button"
                className={styles.scoreInfoButton}
                aria-label="How is the hygiene score calculated?"
              >
                ℹ
              </button>
              <span role="tooltip" className={styles.scoreTooltip}>
                {HYGIENE_SCORE_TOOLTIP}
              </span>
            </span>
          </span>
        </div>
        <button
          type="button"
          className={hygieneState.selectedFilter === null ? styles.summaryTileSelected : styles.summaryTile}
          onClick={() => hygieneState.selectFilter(null)}
        >
          <strong>{hygieneState.summary.totalIssues} issues</strong>
          <span>
            {hygieneState.summary.totalFlags} flags
            {hygieneState.scannedIssueCount !== null
              ? ` · ${hygieneState.scannedIssueCount}${hygieneState.isTruncated ? ` of ${hygieneState.totalMatchingCount}` : ''} scanned`
              : ' total'}
          </span>
        </button>
        {hygieneState.availableCheckIds.map((checkId) =>
          renderSummaryTile(checkId, hygieneState, copiedCheckId, handleCopyCheckJql, jiraBaseUrl),
        )}
      </div>

      {/* A scan that could not reach the end of its own scope says so, in place, above the results.
          Every number below it is a floor, and a reader who is not told that will read them as totals. */}
      {hygieneState.isTruncated && (
        <div className={styles.emptyState} role="status">
          {`Only the first ${hygieneState.scannedIssueCount} of ${hygieneState.totalMatchingCount} issues in scope were scanned — `}
          {'every count below is a minimum. Narrow the project or Extra JQL to see the whole picture.'}
        </div>
      )}

      {/* The four figures somebody acts on, before any list. Twenty equal tiles is the counting job
          the reader came here to avoid; this says what is broken, what is untidy, what one click
          clears, and how much of the board is fine. */}
      {hasLoadedFindings && (
        <div className={styles.statBand} data-testid="hygiene-stat-band">
          {buildHygieneStatBand(hygieneState.findings, hygieneState.scannedIssueCount ?? 0).map((stat) => (
            <div className={styles[`statCard_${stat.tone}`]} key={stat.id}>
              <span className={styles.statCardLabel}>{stat.label}</span>
              <strong className={styles.statCardValue}>{stat.count}</strong>
              <span className={styles.statCardNote}>{stat.note}</span>
            </div>
          ))}
        </div>
      )}

      <BulkDateFixButton hygieneState={hygieneState} />

      <HygieneDiagnosticsPanel hygieneState={hygieneState} />

      {hygieneState.isLoading && <div className={styles.emptyState}>Loading Hygiene results…</div>}
      {!hygieneState.isLoading && !hasLoadedFindings && !hasRunnableScope && (
        <div className={styles.emptyState}>{EMPTY_STATE_MESSAGE}</div>
      )}
      {/* Rendered only when the last attempt did not fail: an error already says what happened, and
          two notices about one situation is how people learn to read neither. */}
      {hasNeverRun && hygieneState.loadError === null && (
        <div className={styles.emptyScopeWarning} role="status">
          ⚠ {NEVER_RUN_MESSAGE}
        </div>
      )}
      {isScopeEmpty && (
        <div className={styles.emptyScopeWarning} role="status">
          ⚠ {EMPTY_SCOPE_MESSAGE}
        </div>
      )}
      {isFilterHidingEverything && (
        // Names the filter and clears it in one click. "No flags found for the current project and
        // filter" is true and useless: it never said WHICH filter, and the only control that cleared
        // one was an unlabelled tile at the far left of a row of twenty.
        <div className={styles.emptyScopeWarning} role="status">
          {`⚠ ${hygieneState.findings.length} finding${hygieneState.findings.length === 1 ? '' : 's'} `}
          {`${hygieneState.findings.length === 1 ? 'is' : 'are'} hidden by the “${activeFilterLabel}” filter, `}
          {'which matches none of them.'}
          <button
            className={styles.actionButton}
            onClick={() => hygieneState.selectFilter(null)}
            type="button"
          >
            {`Show all ${hygieneState.findings.length}`}
          </button>
        </div>
      )}
      {shouldShowNoFlags && !isFilterHidingEverything && (
        <div className={styles.emptyState}>{NO_FLAGS_MESSAGE}</div>
      )}

      {/* End-of-session report — informational only, all four buckets, never overstates progress. */}
      {session.endedSummary && (
        <div className={styles.sessionSummary} role="status">
          <span>
            {`${session.endedSummary.totalCount} findings — ${session.endedSummary.fixedCount} fixed, `
              + `${session.endedSummary.commentedCount} commented, ${session.endedSummary.skippedCount} skipped, `
              + `${session.endedSummary.untouchedCount} untouched`}
          </span>
          <button className={styles.sessionButton} type="button" onClick={session.dismissSummary}>
            Dismiss
          </button>
        </div>
      )}

      {!hygieneState.isLoading && hasVisibleFindings && (
        <div className={styles.listToolbar}>
          {!session.isSessionActive && (
            <button
              className={styles.buttonPrimary}
              type="button"
              onClick={() => session.startSession(filteredFindingKeysJoined.split('|'))}
            >
              ▶ Review these findings
            </button>
          )}
          <label className={styles.sortLabel}>
            Sort findings
            <select
              className={styles.sortSelect}
              aria-label="Sort findings"
              value={sortKey}
              // Locked during a session: the session snapshots its order at start, and a reorder
              // underneath it would end the session mid-review.
              disabled={session.isSessionActive}
              title={session.isSessionActive ? 'Finish or end the session to change the sort.' : undefined}
              onChange={(changeEvent) => setSortKey(changeEvent.target.value as HygieneSortKey)}
            >
              {HYGIENE_SORT_OPTIONS.map((sortOption) => (
                <option key={sortOption.value} value={sortOption.value}>
                  {sortOption.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {session.isSessionActive && (
        <div className={styles.sessionBar} role="status" aria-label="Cleanup session">
          <span className={styles.sessionPosition}>
            {`Reviewing ${session.cursorIndex + 1} of ${session.orderedKeys.length}`}
          </span>
          <button className={styles.sessionButton} type="button" onClick={session.goPrevious}>◀ Previous</button>
          <button className={styles.sessionButton} type="button" onClick={session.goNext}>Next ▶</button>
          <button className={styles.sessionButton} type="button" onClick={session.skipCurrent}>Skip (S)</button>
          <button className={styles.sessionButton} type="button" onClick={session.endSession}>End session (Esc)</button>
        </div>
      )}

      {!hygieneState.isLoading && hasVisibleFindings && (
        <div className={styles.findingsList} aria-label="Hygiene findings">
          {displayedFindings.map((finding) => (
            <FindingRow
              key={finding.issue.key}
              finding={finding}
              fieldConfig={fixFieldConfig}
              staleDaysThreshold={staleDaysThreshold}
              isExpanded={session.isSessionActive
                ? session.currentKey === finding.issue.key
                : expandedIssueKey === finding.issue.key}
              isSessionCurrent={session.isSessionActive && session.currentKey === finding.issue.key}
              sessionOutcome={session.outcomeByKey[finding.issue.key]}
              onToggleExpand={() => handleToggleIssueExpand(finding.issue.key)}
              onIssueUpdated={() => {
                // In a session the rescan is deferred so the cursor holds its place (FR-014);
                // the outcome is recorded instead and the reload runs at session end.
                if (session.isSessionActive) {
                  session.markFixed(finding.issue.key);
                  return;
                }
                void hygieneState.loadHygiene();
              }}
              onCommentPosted={() => {
                if (session.isSessionActive) {
                  session.markCommented(finding.issue.key);
                }
              }}
            />
          ))}
        </div>
      )}

      {/* AI Assist hygiene fixes — only visible after Ctrl+Alt+Z unlock. Propose-only: the panel
          builds a prompt, ingests the agent's structured reply, and every proposed fix is accepted
          or declined individually before anything is written to Jira. */}
      {isAiAssistUnlocked && (
        <HygieneAiPanel
          fieldConfig={fixFieldConfig}
          // The page's filter, not the whole scan: someone reading the stale list is working on
          // stale issues, and asking about every other flag as well is what pushed one prompt to
          // 181,411 characters against a 128,000-character input box (GH #375).
          findings={hygieneState.filteredFindings}
          restrictToCheckIds={aiRestrictToCheckIds}
          onIssueFixed={() => {
            void hygieneState.loadHygiene();
          }}
        />
      )}
    </section>
  );
}

/** Builds the "open in Jira" URL for a check: its semantic family JQL when expressible, else the found-key list. */
function buildTileJiraUrl(
  checkId: string,
  hygieneState: ReturnType<typeof useHygieneState>,
  jiraBaseUrl: string | null,
): string {
  const checkJql = buildHygieneCheckJql(checkId, hygieneState.scopeJql, hygieneState.fieldConfig);
  if (checkJql) {
    return buildJiraSearchUrl(checkJql, jiraBaseUrl);
  }
  return buildJiraIssueNavigatorUrl(buildCheckIssueKeys(checkId, hygieneState.findings), jiraBaseUrl);
}

function renderSummaryTile(
  checkId: string,
  hygieneState: ReturnType<typeof useHygieneState>,
  copiedCheckId: string | null,
  onCopyJql: (checkId: string) => void,
  jiraBaseUrl: string | null,
) {
  // A deep-linked filter can carry several comma-separated checks (e.g. 'missing-sp,no-ac' from
  // the Today commitment-gaps card) — every check in the active filter shows as selected.
  const isTileSelected = parseHygieneFilterCheckIds(hygieneState.selectedFilter).includes(checkId);
  const issueCount = hygieneState.summary.countByCheck[checkId] ?? 0;
  const checkLabel = hygieneState.checkLabelsById[checkId] ?? checkId;
  const hasCopyableIssues = issueCount > 0;
  const justCopied = copiedCheckId === checkId;
  // A check whose instance field does not exist never ran — its tile must not show a clean 0.
  const fieldDependency = FIELD_DEPENDENT_CHECKS.find((dependency) => dependency.checkId === checkId);
  const isCheckUnconfigured = fieldDependency !== undefined
    && (hygieneState.fieldConfig[fieldDependency.fieldConfigKey] ?? []).length === 0;

  if (isCheckUnconfigured) {
    return (
      <div key={checkId} className={styles.summaryTile} aria-label={`${checkLabel} not configured`}>
        <strong>{EMPTY_SCOPE_SCORE_LABEL}</strong>
        <span>{checkLabel}</span>
        <span className={styles.tileHint}>{NOT_CONFIGURED_TILE_LABEL}</span>
      </div>
    );
  }

  function handleTileKeyDown(keyEvent: React.KeyboardEvent) {
    // Same guard as the finding row: the tile holds an "open in Jira" link, and Enter on that link
    // must follow it rather than being cancelled and re-read as a filter click.
    if (keyEvent.target !== keyEvent.currentTarget) return;
    if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
      keyEvent.preventDefault();
      hygieneState.selectFilter(checkId);
    }
  }

  return (
    <div
      key={checkId}
      role="button"
      tabIndex={0}
      className={isTileSelected ? styles.summaryTileSelected : styles.summaryTile}
      aria-pressed={isTileSelected}
      onClick={() => hygieneState.selectFilter(checkId)}
      onKeyDown={handleTileKeyDown}
    >
      <strong>{issueCount}</strong>
      <span>{checkLabel}</span>
      {/* Open the exact Jira search behind this number (GH #200): the family's semantic JQL within the scan's
          scope, so a user can validate Toolbox's count against Jira. Present even at 0, so "0" is verifiable. */}
      <a
        className={styles.openInJiraLink}
        href={buildTileJiraUrl(checkId, hygieneState, jiraBaseUrl)}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${checkLabel} in Jira`}
        title="Open this check's issues in Jira"
        onClick={(clickEvent) => clickEvent.stopPropagation()}
      >
        ↗
      </a>
      {hasCopyableIssues && (
        <button
          type="button"
          className={justCopied ? styles.copyJqlButtonCopied : styles.copyJqlButton}
          aria-label={`Copy Jira link for ${checkLabel}`}
          title={justCopied ? 'Copied!' : 'Copy Jira issue navigator link'}
          onClick={(clickEvent) => {
            clickEvent.stopPropagation();
            onCopyJql(checkId);
          }}
        >
          {justCopied ? '✓' : '⎘'}
        </button>
      )}
    </div>
  );
}

interface FindingRowProps {
  finding: HygieneFinding;
  fieldConfig: HygieneFieldConfig;
  staleDaysThreshold: number;
  isExpanded: boolean;
  /** True when a cleanup session's cursor is on this finding — highlighted, auto-expanded. */
  isSessionCurrent?: boolean;
  /** How the current session settled this finding, if it did; untouched rows carry none. */
  sessionOutcome?: HygieneSessionOutcome;
  onToggleExpand: () => void;
  onIssueUpdated: () => void;
  onCommentPosted?: () => void;
}

function FindingRow({
  finding,
  fieldConfig,
  staleDaysThreshold,
  isExpanded,
  isSessionCurrent = false,
  sessionOutcome,
  onToggleExpand,
  onIssueUpdated,
  onCommentPosted,
}: FindingRowProps) {
  const idleDayCount = calculateDaysSince(finding.issue.fields.updated ?? finding.issue.fields.created);
  // The worst issues become findable while scrolling, instead of only after reading each flag.
  const hasErrorFlag = finding.flags.some((flag) => flag.severity === 'error');
  const rowClassName = [
    styles.findingRow,
    hasErrorFlag ? styles.findingRowError : styles.findingRowWarn,
    sessionOutcome ? styles.findingRowSettled : '',
    isSessionCurrent ? styles.findingRowCurrent : '',
  ].filter(Boolean).join(' ');

  function handleKeyDown(keyEvent: React.KeyboardEvent) {
    // The row is a button that CONTAINS text inputs, so every key typed into a fix control bubbles
    // through here. Acting on all of them meant a space typed into the Feature search box was eaten
    // by preventDefault() and collapsed the row on its way past — a multi-word Feature name could
    // never be typed and the dropdown never appeared (GH #375). A key raised inside the row belongs
    // to whatever holds focus; only a key raised ON the row is the row's to act on.
    if (keyEvent.target !== keyEvent.currentTarget) return;
    if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
      keyEvent.preventDefault();
      onToggleExpand();
    }
  }

  return (
    <div className={styles.findingRowWrapper}>
      <div
        className={rowClassName}
        onClick={onToggleExpand}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
      >
        <div className={styles.issueMain}>
          <div className={styles.issueKeyRow}>
            <a
              className={styles.issueKey}
              href={buildJiraBrowseUrl(finding.issue.key)}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              {finding.issue.key}
            </a>
            {sessionOutcome && (
              <span className={styles.sessionOutcomeMark}>{SESSION_OUTCOME_MARKS[sessionOutcome]}</span>
            )}
            <span className={styles.expandHint}>{isExpanded ? '▲ Less' : '▼ Details'}</span>
          </div>
          <h2 className={styles.issueSummary}>{readIssueSummary(finding)}</h2>
        </div>
        <div
          className={styles.flagList}
          onClick={(clickEvent) => clickEvent.stopPropagation()}
          role="presentation"
        >
          {finding.flags.map((flag) => (
            <div key={flag.checkId} className={styles.flagFixRow}>
              {renderFlagChip(flag)}
              {/* Say what is flagged and what fixing does — never a bare control (FR-015). */}
              <span className={styles.flagExplanation}>
                {buildFlagExplanation(flag, idleDayCount, finding, fieldConfig)}
              </span>
              <HygieneFixControl issue={finding.issue} flag={flag} fieldConfig={fieldConfig} onFixed={onIssueUpdated} />
            </div>
          ))}
        </div>
        {/* Chips rather than a grid of identical bordered cards. One hue per KIND of fact — blue is
            always the PI, violet always the person — so the eye goes to the field it wants instead of
            reading every box to find it. Same vocabulary as the daily forecast and PI Review. */}
        <div className={styles.metaChips}>
          {finding.issue.fields.issuetype?.name && (
            <span className={styles.metaChipType}>
              <IssueTypeIcon issueTypeName={finding.issue.fields.issuetype.name} />
            </span>
          )}
          {finding.issue.fields.status?.name && (
            <span className={styles.metaChipStatus}>
              <StatusChip
                statusName={finding.issue.fields.status.name}
                statusCategoryKey={finding.issue.fields.status.statusCategory?.key}
              />
            </span>
          )}
          {finding.programIncrement && <span className={styles.metaChipPi}>{finding.programIncrement}</span>}
          <span className={styles.metaChipOwner}>
            <AssigneeAvatar displayName={finding.issue.fields.assignee?.displayName ?? null} />
          </span>
          {idleDayCount !== null && (
            <span className={styles.metaChipAge}>
              <AgeBadge ageDays={idleDayCount} staleDaysThreshold={staleDaysThreshold} />
            </span>
          )}
          {/* The three dates every date flag on this page is about, editable here rather than in
              Jira. Stops propagation because a click meant for a date input must not also collapse
              the row it sits in. */}
          <div onClick={(clickEvent) => clickEvent.stopPropagation()} role="presentation">
            <PlanningDateFields
              fieldConfig={fieldConfig}
              issue={finding.issue}
              onDateSaved={onIssueUpdated}
            />
          </div>
        </div>
      </div>
      {isExpanded && (
        <div className={styles.issueDetailCell}>
          <IssueDetailPanel
            isEmbedded
            issue={finding.issue as unknown as RealJiraIssue}
            onIssueUpdated={onIssueUpdated}
            ageDays={idleDayCount ?? undefined}
            staleDaysThreshold={staleDaysThreshold}
            acceptanceCriteria={readAcceptanceCriteriaText(finding, fieldConfig)}
            programIncrement={finding.programIncrement}
            sprintName={parseSprintName(finding.issue.fields[SPRINT_FIELD_ID])}
            featureLinkKey={readFeatureLinkKey(finding, fieldConfig)}
            onCommentPosted={onCommentPosted}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Fills or corrects every issue's dates from the release it is committed to, in one action.
 *
 * The reason this is a bulk button rather than a row of inline fixes: the dates are DERIVED, so
 * there is nothing per-issue to decide. Once the policy is agreed, a hundred wrong issues are one
 * click, and asking somebody to press Apply a hundred times is how they stay wrong instead.
 *
 * It states the count before acting, reports what actually landed, and never claims a whole-run
 * success — one locked field on one ticket must not read as a failed run for the other ninety-nine.
 */
function BulkDateFixButton({ hygieneState }: { hygieneState: ReturnType<typeof useHygieneState> }) {
  const [isApplying, setIsApplying] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  // Every issue a derived write would change, not just the ones whose dates DISAGREE with the
  // release. Missing dates were the majority case and the button could never see them, so the
  // deterministic fix sat one click away from a hundred issues and was offered to almost none.
  const datedIssues = readDeterministicDateFixCandidates(hygieneState.findings);

  if (datedIssues.length === 0) {
    return null;
  }

  async function applyEveryDateFix(): Promise<void> {
    setIsApplying(true);
    setResultMessage(null);
    try {
      // Same context Feature Review builds, from the same settings — the two surfaces write the
      // same date for the same issue because they run one calculation, not two that agree today.
      const forecastContext = buildDerivedDateForecastContext(datedIssues, {
        storyPointsFieldIds: resolveStoryPointsFieldIds(''),
        subStatusFieldIds: hygieneState.fieldConfig.subStatusFieldIds ?? [],
        targetStartFieldIds: hygieneState.fieldConfig.targetStartFieldIds,
        // What makes the DEV → SL chain visible. Without the Feature link every issue is scheduled
        // on its own effort alone, which is what a dev story with a week of testing behind it
        // reads as right up until the Feature misses its deadline.
        featureLinkFieldIds: hygieneState.fieldConfig.featureLinkFieldIds ?? [],
      });
      const outcome = await applyDerivedDates(datedIssues, hygieneState.fieldConfig, forecastContext);
      const failureNote = outcome.failures.length > 0
        ? ` ${outcome.failures.length} could not be written: ${outcome.failures.map((failure) => failure.issueKey).join(', ')}.`
        : '';
      // Why nothing changed is the whole message when nothing changed. Reporting "Updated 0" alone
      // for a run of nineteen reads exactly like a broken button, and did.
      const undecidedSummary = summariseUndecidedDates(outcome.undecided);
      const undecidedNote = undecidedSummary === ''
        ? ''
        : ` ${outcome.undecided.length} could not be dated — ${undecidedSummary}.`;
      const basisNote = describeTargetStartBases(outcome.targetStartBasisCounts);
      setResultMessage(
        `Updated ${outcome.updatedIssueKeys.length} issue(s).${failureNote}${undecidedNote}${basisNote}`,
      );
      hygieneState.loadHygiene();
    } finally {
      setIsApplying(false);
    }
  }

  return (
    <div className={styles.bulkFixRow}>
      <button
        className={styles.actionButton}
        disabled={isApplying}
        type="button"
        onClick={() => void applyEveryDateFix()}
      >
        {isApplying ? 'Applying…' : `📅 Fix all ${datedIssues.length} date issue(s)`}
      </button>
      {resultMessage && <span className={styles.fixNote} role="status">{resultMessage}</span>}
    </div>
  );
}

/**
 * A collapsed, copyable account of what the scan actually did.
 *
 * Exists because two very different failures look identical on screen — the build on the machine is
 * older than the fix, or the scan never received the field it is judging — and neither can be told
 * apart from a screenshot. The version comes from the SERVER so it describes the running build
 * rather than anything the page could assume about itself.
 */
function HygieneDiagnosticsPanel({ hygieneState }: { hygieneState: ReturnType<typeof useHygieneState> }) {
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [runningVersion, setRunningVersion] = useState<string | null>(null);
  const [hasCopied, setHasCopied] = useState(false);

  useEffect(() => {
    if (!isPanelOpen) return;
    let isMounted = true;
    fetch('/api/version-check')
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { currentVersion?: string } | null) => {
        if (isMounted) setRunningVersion(payload?.currentVersion ?? null);
      })
      .catch(() => { if (isMounted) setRunningVersion(null); });
    return () => { isMounted = false; };
  }, [isPanelOpen]);

  const diagnosticsReport = buildHygieneDiagnosticsReport({
    appVersion: runningVersion,
    scopeJql: hygieneState.scopeJql,
    scannedIssueCount: hygieneState.scannedIssueCount,
    totalMatchingCount: hygieneState.totalMatchingCount,
    isTruncated: hygieneState.isTruncated,
    fieldConfig: hygieneState.fieldConfig,
    findings: hygieneState.findings,
    enabledCheckIds: hygieneState.availableCheckIds,
  });

  return (
    <div className={styles.diagnosticsPanel}>
      <button
        className={styles.diagnosticsToggle}
        onClick={() => setIsPanelOpen((wasOpen) => !wasOpen)}
        type="button"
      >
        {DIAGNOSTICS_TOGGLE_LABEL}
      </button>
      {isPanelOpen && (
        <>
          <button
            className={styles.diagnosticsToggle}
            onClick={() => {
              void navigator.clipboard?.writeText(diagnosticsReport);
              setHasCopied(true);
            }}
            type="button"
          >
            {hasCopied ? DIAGNOSTICS_COPIED_LABEL : DIAGNOSTICS_COPY_LABEL}
          </button>
          <pre className={styles.diagnosticsReport}>{diagnosticsReport}</pre>
        </>
      )}
    </div>
  );
}

/**
 * One plain-language sentence per flagged check, carrying the fact that caused it.
 *
 * The date flags used to fall through to a generic line that simply repeated the flag label, on a
 * card that never showed the date either — so a reader was told a due date had passed and given no
 * way to see which date, how long ago, or whether the flag was even fair.
 */
function buildFlagExplanation(
  flag: HygieneFlag,
  idleDayCount: number | null,
  finding: HygieneFinding,
  fieldConfig: HygieneFieldConfig,
): string {
  if (flag.checkId === 'stale') {
    const idleDaysText = idleDayCount === null ? 'a while' : `${idleDayCount} days`;
    return `No update in ${idleDaysText} — nudge with a comment, or Skip if the thread already explains the wait.`;
  }

  const dateFlagExplanation = buildDateFlagExplanation(flag, finding, fieldConfig);
  if (dateFlagExplanation !== null) {
    return dateFlagExplanation;
  }

  return CHECK_EXPLANATION_BY_ID[flag.checkId] ?? `${flag.label} — fix it inline here, or open the issue in Jira.`;
}

/** Which date each date-based flag is about, and how the sentence reads when it has passed. */
const DATE_FLAG_SOURCES: Record<string, { readDate: (finding: HygieneFinding, fieldConfig: HygieneFieldConfig) => string | null; describe: (dateText: string, daysText: string) => string }> = {
  'due-date-overdue': {
    readDate: (finding) => readDateFieldText(finding.issue.fields.duedate),
    describe: (dateText, daysText) =>
      `Due ${dateText} (${daysText}) and not finished — move it on, or reschedule the due date.`,
  },
  'target-end-overdue': {
    readDate: (finding, fieldConfig) => readConfiguredDateText(finding, fieldConfig.targetEndFieldIds),
    describe: (dateText, daysText) =>
      `Target End was ${dateText} (${daysText}) and it has not reached testing — move it on, or reschedule Target End.`,
  },
  'target-start-ready': {
    readDate: (finding, fieldConfig) => readConfiguredDateText(finding, fieldConfig.targetStartFieldIds),
    describe: (dateText, daysText) =>
      `Target Start was ${dateText} (${daysText}) and it is still To Do — start it, or reschedule Target Start.`,
  },
};

/** Builds the sentence for a date-based flag, or null when the flag is not one. */
function buildDateFlagExplanation(
  flag: HygieneFlag,
  finding: HygieneFinding,
  fieldConfig: HygieneFieldConfig,
): string | null {
  const dateFlagSource = DATE_FLAG_SOURCES[flag.checkId];
  if (!dateFlagSource) return null;

  const dateText = dateFlagSource.readDate(finding, fieldConfig);
  // No readable date behind a date flag should never happen, but saying so beats inventing one.
  if (dateText === null) return `${flag.label} — the date behind this flag could not be read.`;

  return dateFlagSource.describe(dateText, describeDaysSince(dateText));
}

/** Reads a Jira date field down to its calendar day, or null when it holds none. */
function readDateFieldText(rawValue: unknown): string | null {
  return typeof rawValue === 'string' && rawValue.trim() !== '' ? rawValue.trim().slice(0, 10) : null;
}

/** Reads the first configured field in a family as a calendar day. */
function readConfiguredDateText(finding: HygieneFinding, fieldIds: readonly string[]): string | null {
  for (const fieldId of fieldIds) {
    const dateText = readDateFieldText((finding.issue.fields as Record<string, unknown>)[fieldId]);
    if (dateText !== null) return dateText;
  }
  return null;
}

/** "3 days ago" / "today" — the elapsed half of the sentence, so the age is not left to arithmetic. */
function describeDaysSince(dateText: string): string {
  const elapsedDays = Math.floor((Date.now() - new Date(`${dateText}T00:00:00`).getTime()) / MILLISECONDS_PER_DAY);
  if (elapsedDays <= 0) return 'today';
  return elapsedDays === 1 ? '1 day ago' : `${elapsedDays} days ago`;
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

// Jira's sprint custom field — raw strings like "...[id=42,state=ACTIVE,name=ENCUC Sprint 26.3.4,...]".
const SPRINT_FIELD_ID = 'customfield_10020';
const SPRINT_NAME_PATTERN = /name=([^,\]]+)/;

/** Extracts the newest sprint's name from Jira's raw sprint-field payload, or null when absent. */
function parseSprintName(rawSprintValue: unknown): string | null {
  const sprintEntries = Array.isArray(rawSprintValue) ? rawSprintValue : [rawSprintValue];
  const newestSprintEntry = sprintEntries[sprintEntries.length - 1];
  if (typeof newestSprintEntry === 'string') {
    return newestSprintEntry.match(SPRINT_NAME_PATTERN)?.[1] ?? null;
  }
  if (newestSprintEntry && typeof newestSprintEntry === 'object') {
    const sprintName = (newestSprintEntry as { name?: string }).name;
    return sprintName?.trim() || null;
  }
  return null;
}

/** Reads the first non-empty acceptance-criteria field the instance config resolves. */
function readAcceptanceCriteriaText(finding: HygieneFinding, fieldConfig: HygieneFieldConfig): string | null {
  for (const acceptanceFieldId of fieldConfig.acceptanceCriteriaFieldIds) {
    // The description doubles as the AC fallback field in the default config; the panel already
    // renders the description itself, so repeating it as "Acceptance Criteria" would be noise.
    if (acceptanceFieldId === 'description') continue;
    const rawFieldValue = finding.issue.fields[acceptanceFieldId];
    if (typeof rawFieldValue === 'string' && rawFieldValue.trim() !== '') {
      return rawFieldValue.trim();
    }
  }
  return null;
}

/** Reads the linked feature/epic key from the configured link fields or the native parent. */
function readFeatureLinkKey(finding: HygieneFinding, fieldConfig: HygieneFieldConfig): string | null {
  for (const featureFieldId of fieldConfig.featureLinkFieldIds) {
    if (featureFieldId === 'parent') continue;
    const rawFieldValue = finding.issue.fields[featureFieldId];
    if (typeof rawFieldValue === 'string' && rawFieldValue.includes('-')) return rawFieldValue;
    if (rawFieldValue && typeof rawFieldValue === 'object') {
      const linkedKey = (rawFieldValue as { key?: string }).key;
      if (linkedKey) return linkedKey;
    }
  }
  return finding.issue.fields.parent?.key ?? null;
}

/** Days since the given timestamp, or null when the value is missing/unparseable. */
function calculateDaysSince(isoDateText: string | undefined): number | null {
  if (!isoDateText) return null;
  const parsedTimestamp = new Date(isoDateText).getTime();
  if (!Number.isFinite(parsedTimestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - parsedTimestamp) / MILLISECONDS_PER_DAY));
}

function buildJiraBrowseUrl(issueKey: string): string {
  return `${JIRA_BROWSE_PREFIX}${encodeURIComponent(issueKey)}`;
}
