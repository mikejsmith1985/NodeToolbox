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
import { useEffect, useRef, useState } from 'react';
import { useAiAssistStore } from '../../store/aiAssistStore.ts';
import { HygieneFixControl } from './HygieneFixControl.tsx';
import { HygieneAiPanel } from './ai/HygieneAiPanel.tsx';
import { useHygieneState } from './hooks/useHygieneState.ts';
import { buildCheckIssueKeys, buildJiraIssueNavigatorUrl } from './utils/buildHygieneJqlUrl.ts';
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
// The checks that have NO default field and silently skip themselves when the instance has no
// matching field. Their tiles must say "not configured", because a bare 0 from a check that never
// ran reads exactly like a clean result — the same lie as the empty-scope perfect score (GH #167).
const FIELD_DEPENDENT_CHECKS: ReadonlyArray<{ checkId: string; fieldConfigKey: keyof HygieneFieldConfig }> = [
  { checkId: 'missing-product-owner', fieldConfigKey: 'productOwnerFieldIds' },
  { checkId: 'missing-initiative-type', fieldConfigKey: 'initiativeTypeFieldIds' },
  { checkId: 'missing-application', fieldConfigKey: 'applicationFieldIds' },
];
const NOT_CONFIGURED_TILE_LABEL = 'not checked — no matching Jira field';
const NO_VALUE_LABEL = '—';
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
}

/** Renders the standalone Hygiene checker and delegates stateful Jira work to `useHygieneState`. */
export default function HygieneView({
  isTeamMode = false,
  initialExtraJql = '',
  projectKey,
  initialAllProjects = false,
  initialFilter,
}: HygieneViewProps = {}) {
  const hygieneState = useHygieneState({
    isTeamMode,
    initialExtraJql,
    projectKey,
    initialAllProjects,
    initialSelectedFilter: initialFilter,
  });
  const isAiAssistUnlocked = useAiAssistStore((storeState) => storeState.isAiAssistUnlocked);
  const jiraBaseUrl = useConnectionStore((state) => state.proxyStatus?.jira?.baseUrl ?? null);
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
  const shouldShowNoFlags = !hygieneState.isLoading
    && hasRunnableScope
    && !hasVisibleFindings
    && hasScoreData;
  const [expandedIssueKey, setExpandedIssueKey] = useState<string | null>(null);
  const [copiedCheckId, setCopiedCheckId] = useState<string | null>(null);
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
    if (hasAutoRunTriggeredRef.current || !hasRunnableScope || isHygieneLoading) {
      return;
    }
    hasAutoRunTriggeredRef.current = true;
    void loadHygiene();
  }, [hasRunnableScope, isHygieneLoading, loadHygiene]);

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
            {hygieneState.scannedIssueCount !== null ? ` · ${hygieneState.scannedIssueCount} scanned` : ' total'}
          </span>
        </button>
        {hygieneState.availableCheckIds.map((checkId) =>
          renderSummaryTile(checkId, hygieneState, copiedCheckId, handleCopyCheckJql),
        )}
      </div>

      {hygieneState.isLoading && <div className={styles.emptyState}>Loading Hygiene results…</div>}
      {!hygieneState.isLoading && !hasLoadedFindings && !hasRunnableScope && (
        <div className={styles.emptyState}>{EMPTY_STATE_MESSAGE}</div>
      )}
      {isScopeEmpty && (
        <div className={styles.emptyScopeWarning} role="status">
          ⚠ {EMPTY_SCOPE_MESSAGE}
        </div>
      )}
      {shouldShowNoFlags && <div className={styles.emptyState}>{NO_FLAGS_MESSAGE}</div>}
      {!hygieneState.isLoading && hasVisibleFindings && (
        <div className={styles.findingsList} aria-label="Hygiene findings">
          {hygieneState.filteredFindings.map((finding) => (
            <FindingRow
              key={finding.issue.key}
              finding={finding}
              fieldConfig={fixFieldConfig}
              isExpanded={expandedIssueKey === finding.issue.key}
              onToggleExpand={() => handleToggleIssueExpand(finding.issue.key)}
              onIssueUpdated={() => {
                void hygieneState.loadHygiene();
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
          findings={hygieneState.findings}
          onIssueFixed={() => {
            void hygieneState.loadHygiene();
          }}
        />
      )}
    </section>
  );
}

function renderSummaryTile(
  checkId: string,
  hygieneState: ReturnType<typeof useHygieneState>,
  copiedCheckId: string | null,
  onCopyJql: (checkId: string) => void,
) {
  const isTileSelected = hygieneState.selectedFilter === checkId;
  const issueCount = hygieneState.summary.countByCheck[checkId] ?? 0;
  const checkLabel = hygieneState.checkLabelsById[checkId] ?? checkId;
  const hasCopyableIssues = issueCount > 0;
  const justCopied = copiedCheckId === checkId;
  // A check whose instance field does not exist never ran — its tile must not show a clean 0.
  const fieldDependency = FIELD_DEPENDENT_CHECKS.find((dependency) => dependency.checkId === checkId);
  const isCheckUnconfigured = fieldDependency !== undefined
    && hygieneState.fieldConfig[fieldDependency.fieldConfigKey].length === 0;

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
  isExpanded: boolean;
  onToggleExpand: () => void;
  onIssueUpdated: () => void;
}

function FindingRow({ finding, fieldConfig, isExpanded, onToggleExpand, onIssueUpdated }: FindingRowProps) {
  function handleKeyDown(keyEvent: React.KeyboardEvent) {
    if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
      keyEvent.preventDefault();
      onToggleExpand();
    }
  }

  return (
    <div className={styles.findingRowWrapper}>
      <div
        className={styles.findingRow}
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
              <HygieneFixControl issue={finding.issue} flag={flag} fieldConfig={fieldConfig} onFixed={onIssueUpdated} />
            </div>
          ))}
        </div>
        <dl className={styles.issueMeta}>
          <div>
            <dt>Type</dt>
            <dd>{finding.issue.fields.issuetype?.name || '—'}</dd>
          </div>
          <div>
            <dt>PI</dt>
            <dd>{finding.programIncrement || '—'}</dd>
          </div>
          <div>
            <dt>Assignee</dt>
            <dd>{readAssigneeName(finding)}</dd>
          </div>
          <div>
            <dt>Age</dt>
            <dd>{formatIssueAge(finding.issue.fields.created)}</dd>
          </div>
        </dl>
      </div>
      {isExpanded && (
        <div className={styles.issueDetailCell}>
          <IssueDetailPanel isEmbedded issue={finding.issue as unknown as RealJiraIssue} onIssueUpdated={onIssueUpdated} />
        </div>
      )}
    </div>
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
