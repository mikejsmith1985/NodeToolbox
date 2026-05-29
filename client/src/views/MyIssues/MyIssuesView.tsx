// MyIssuesView.tsx — My Issues view with report, hygiene, and settings workflows in one place.
//
// Provides top-level tabs for Report, Hygiene, Time Tracking, Git Sync, and Settings.
// The Report tab lets users switch between four issue sources
// (mine / JQL / filter / board) and view results in card, compact, or table layout.
//
// This view also surfaces ServiceNow issues assigned to the current user alongside Jira
// issues, and highlights linked Jira Defect/Story ↔ SNow Problem pairs with a health badge.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import { PrimaryTabs } from '../../components/PrimaryTabs/PrimaryTabs.tsx';
import IssueDetailPanel from '../../components/IssueDetailPanel/index.tsx';
import { useConnectionStore } from '../../store/connectionStore.ts';
import { useSettingsStore } from '../../store/settingsStore.ts';
import type { JiraIssue } from '../../types/jira.ts';
import { detectLinkedPairs, collectLinkedSnowSysIds } from '../../utils/issueLinkCalculator.ts';
import { EmbeddedGitSyncPanel, EmbeddedTimeTrackingPanel } from './EmbeddedWorkspacePanels.tsx';
import HygieneView from '../Hygiene/HygieneView.tsx';
import { LinkedIssuePair } from './LinkedIssuePair.tsx';
import { SnowIssueRow } from './SnowIssueRow.tsx';
import { StatusMappingEditor } from './StatusMappingEditor.tsx';
import { useMyIssuesState } from './hooks/useMyIssuesState.ts';
import { useSnowIssues } from './hooks/useSnowIssues.ts';
import type { IssueSource, SortField, ViewMode } from './hooks/useMyIssuesState.ts';
import type { ExtendedJiraIssue } from './myIssuesExtendedTypes.ts';
import SwimlaneCardView from './SwimlaneCardView.tsx';
import BulkCommentPanel from './BulkCommentPanel.tsx';
import BoardPillAndFilters from './BoardPillAndFilters.tsx';
import styles from './MyIssuesView.module.css';

// ── Named constants ──

const VIEW_TITLE = 'My Issues';
const VIEW_SUBTITLE = 'Track and manage your Jira issues from a single workspace.';

const SOURCE_OPTIONS: { key: IssueSource; label: string }[] = [
  { key: 'mine', label: 'My Issues' },
  { key: 'jql', label: 'JQL' },
  { key: 'filter', label: 'Saved Filter' },
  { key: 'board', label: 'Board' },
];

const VIEW_MODE_OPTIONS: { key: ViewMode; label: string }[] = [
  { key: 'cards', label: 'Cards' },
  { key: 'compact', label: 'Compact' },
  { key: 'table', label: 'Table' },
];

const SORT_OPTIONS: { key: SortField; label: string }[] = [
  { key: 'updated', label: 'Last Updated' },
  { key: 'priority', label: 'Priority' },
  { key: 'created', label: 'Created' },
  { key: 'project', label: 'Project' },
];

// Status zone bucket constants — used to classify issues into dashboard chips.
const ATTENTION_STATUSES = ['blocked', 'impeded', 'on hold'];
const IN_PROGRESS_STATUS_CATEGORY = 'indeterminate';
const IN_REVIEW_STATUSES = ['in review', 'code review', 'pr review', 'testing'];
const TODO_STATUS_CATEGORY = 'new';
const DONE_STATUS_CATEGORY = 'done';

const AGING_WARN_DAYS = 5;
const AGING_STALE_DAYS = 10;
const MS_PER_DAY = 86_400_000;

type MyIssuesTab = 'report' | 'hygiene' | 'time' | 'gitsync' | 'settings';

const MY_ISSUES_TABS: { key: MyIssuesTab; label: string }[] = [
  { key: 'report', label: 'Report' },
  { key: 'hygiene', label: 'Hygiene' },
  { key: 'time', label: 'Time Tracking' },
  { key: 'gitsync', label: 'Git Sync' },
  { key: 'settings', label: 'Settings' },
];

// ── Helper functions ──

/** Calculates the number of days since a date string from Jira. */
function calculateAgingDays(updatedDateString: string): number {
  const updatedMs = new Date(updatedDateString).getTime();
  return Math.floor((Date.now() - updatedMs) / MS_PER_DAY);
}

/** Returns true if the issue is in a "blocked / attention" state. */
function isAttentionIssue(issue: JiraIssue): boolean {
  const lowerStatusName = issue.fields.status.name.toLowerCase();
  return ATTENTION_STATUSES.some((attentionStatus) => lowerStatusName.includes(attentionStatus));
}

/** Returns true if the issue is under review. */
function isInReviewIssue(issue: JiraIssue): boolean {
  const lowerStatusName = issue.fields.status.name.toLowerCase();
  return IN_REVIEW_STATUSES.some((reviewStatus) => lowerStatusName === reviewStatus);
}

/** Returns the CSS module class name that color-codes a status badge by its Jira status. */
function resolveStatusBadgeClassName(statusName: string, statusCategoryKey: string): string {
  const lowerStatus = statusName.toLowerCase();
  if (ATTENTION_STATUSES.some((s) => lowerStatus.includes(s))) return styles.statusBlocked;
  if (IN_REVIEW_STATUSES.some((s) => lowerStatus === s)) return styles.statusInReview;
  if (statusCategoryKey === IN_PROGRESS_STATUS_CATEGORY) return styles.statusInProgress;
  if (statusCategoryKey === DONE_STATUS_CATEGORY) return styles.statusDone;
  if (statusCategoryKey === TODO_STATUS_CATEGORY) return styles.statusTodo;
  return styles.statusDefault;
}

/** Returns the CSS module class name that color-codes a priority badge by its Jira priority name. */
function resolvePriorityBadgeClassName(priorityName: string): string {
  const lowerPriority = priorityName.toLowerCase();
  if (lowerPriority === 'highest' || lowerPriority === 'critical') return styles.priorityHighest;
  if (lowerPriority === 'high') return styles.priorityHigh;
  if (lowerPriority === 'medium') return styles.priorityMedium;
  if (lowerPriority === 'low') return styles.priorityLow;
  if (lowerPriority === 'lowest') return styles.priorityLowest;
  return styles.priorityDefault;
}

/** Groups issues into the five status zones for the dashboard chips. */
function calculateStatusZoneCounts(issues: JiraIssue[]) {
  let attentionCount = 0;
  let inProgressCount = 0;
  let inReviewCount = 0;
  let toDoCount = 0;
  let doneCount = 0;

  for (const issue of issues) {
    const statusCategory = issue.fields.status.statusCategory.key;

    if (isAttentionIssue(issue)) {
      attentionCount++;
    } else if (isInReviewIssue(issue)) {
      inReviewCount++;
    } else if (statusCategory === IN_PROGRESS_STATUS_CATEGORY) {
      inProgressCount++;
    } else if (statusCategory === TODO_STATUS_CATEGORY) {
      toDoCount++;
    } else if (statusCategory === DONE_STATUS_CATEGORY) {
      doneCount++;
    }
  }

  return { attentionCount, inProgressCount, inReviewCount, toDoCount, doneCount };
}

/** Filters issues to only those matching the active status zone chip. */
function filterIssuesByStatusZone(
  issues: JiraIssue[],
  activeStatusZone: string | null,
): JiraIssue[] {
  if (!activeStatusZone) {
    return issues;
  }

  if (activeStatusZone === 'attention') {
    return issues.filter(isAttentionIssue);
  }

  if (activeStatusZone === 'inreview') {
    return issues.filter(isInReviewIssue);
  }

  if (activeStatusZone === 'inprogress') {
    return issues.filter(
      (issue) =>
        issue.fields.status.statusCategory.key === IN_PROGRESS_STATUS_CATEGORY &&
        !isInReviewIssue(issue) &&
        !isAttentionIssue(issue),
    );
  }

  if (activeStatusZone === 'todo') {
    return issues.filter(
      (issue) => issue.fields.status.statusCategory.key === TODO_STATUS_CATEGORY,
    );
  }

  if (activeStatusZone === 'done') {
    return issues.filter(
      (issue) => issue.fields.status.statusCategory.key === DONE_STATUS_CATEGORY,
    );
  }

  return issues;
}

// ── Sub-renderers ──

interface IssueCardProps {
  issue: JiraIssue;
  onIssueClick: (issue: JiraIssue) => void;
}

/** Renders a full card with key, summary, status, assignee, and aging indicator. */
function renderIssueCard({ issue, onIssueClick }: IssueCardProps) {
  const agingDays = calculateAgingDays(issue.fields.updated);
  const isAgedWarn = agingDays > AGING_WARN_DAYS && agingDays <= AGING_STALE_DAYS;
  const isAgedStale = agingDays > AGING_STALE_DAYS;

  const agingClassName = isAgedStale
    ? styles.agingStale
    : isAgedWarn
      ? styles.agingWarn
      : undefined;

  function handleKeyDown(keyEvent: React.KeyboardEvent) {
    if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
      onIssueClick(issue);
    }
  }

  return (
    <div
      className={styles.issueCard}
      key={issue.key}
      onClick={() => onIssueClick(issue)}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
    >
      <div className={styles.cardHeader}>
        <span className={styles.issueKeyLink}>
          {issue.key}
        </span>
        <span className={`${styles.statusBadge} ${resolveStatusBadgeClassName(issue.fields.status.name, issue.fields.status.statusCategory.key)}`}>
          {issue.fields.status.name}
        </span>
        {issue.fields.priority && (
          <span className={`${styles.priorityBadge} ${resolvePriorityBadgeClassName(issue.fields.priority.name)}`}>
            {issue.fields.priority.name}
          </span>
        )}
      </div>
      <p className={styles.issueSummary}>{issue.fields.summary}</p>
      <div className={styles.cardMeta}>
        <span>{issue.fields.issuetype.name}</span>
        {agingDays > 0 && (
          <span className={agingClassName}>{agingDays}d ago</span>
        )}
      </div>
    </div>
  );
}

void renderIssueCard;

interface InlineIssueExpansionProps {
  expandedIssueKey: string | null;
  onIssueUpdated: () => void;
  onToggleIssueExpand: (issueKey: string) => void;
}

/** Renders a single-line compact row for an issue with inline detail expansion. */
function renderCompactRow(issue: JiraIssue, inlineIssueExpansion: InlineIssueExpansionProps) {
  const isExpanded = inlineIssueExpansion.expandedIssueKey === issue.key;

  function handleKeyDown(keyEvent: React.KeyboardEvent) {
    if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
      inlineIssueExpansion.onToggleIssueExpand(issue.key);
    }
  }

  return (
    <div className={styles.issueCardWrapper} key={issue.key}>
      <div
        aria-expanded={isExpanded}
        className={styles.compactRow}
        onClick={() => inlineIssueExpansion.onToggleIssueExpand(issue.key)}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
      >
        <span className={styles.issueKeyCell}>
          <span className={styles.issueKeyLink}>{issue.key}</span>
          <span className={styles.expandHint}>{isExpanded ? '▲ Less' : '▼ Details'}</span>
        </span>
        <span>{issue.fields.summary}</span>
        <span>
          <span className={`${styles.statusBadge} ${resolveStatusBadgeClassName(issue.fields.status.name, issue.fields.status.statusCategory.key)}`}>
            {issue.fields.status.name}
          </span>
        </span>
        <span>{issue.fields.assignee?.displayName ?? '—'}</span>
        <span>{issue.fields.updated.slice(0, 10)}</span>
      </div>
      {isExpanded && (
        <div className={styles.issueDetailCell}>
          <IssueDetailPanel isEmbedded issue={issue} onIssueUpdated={inlineIssueExpansion.onIssueUpdated} />
        </div>
      )}
    </div>
  );
}

/** Renders a full-width table row for an issue with inline detail expansion. */
function renderTableRow(issue: JiraIssue, inlineIssueExpansion: InlineIssueExpansionProps) {
  const isExpanded = inlineIssueExpansion.expandedIssueKey === issue.key;

  function handleKeyDown(keyEvent: React.KeyboardEvent) {
    if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
      inlineIssueExpansion.onToggleIssueExpand(issue.key);
    }
  }

  return (
    <Fragment key={issue.key}>
      <tr
        aria-expanded={isExpanded}
        onClick={() => inlineIssueExpansion.onToggleIssueExpand(issue.key)}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
      >
        <td>
          <div className={styles.issueKeyCell}>
            <span className={styles.issueKeyLink}>{issue.key}</span>
            <span className={styles.expandHint}>{isExpanded ? '▲ Less' : '▼ Details'}</span>
          </div>
        </td>
        <td>{issue.fields.summary}</td>
        <td>
          <span className={`${styles.statusBadge} ${resolveStatusBadgeClassName(issue.fields.status.name, issue.fields.status.statusCategory.key)}`}>
            {issue.fields.status.name}
          </span>
        </td>
        <td>
          {issue.fields.priority ? (
            <span className={`${styles.priorityBadge} ${resolvePriorityBadgeClassName(issue.fields.priority.name)}`}>
              {issue.fields.priority.name}
            </span>
          ) : (
            <span className={styles.priorityBadge}>—</span>
          )}
        </td>
        <td>{issue.fields.assignee?.displayName ?? '—'}</td>
        <td>{issue.fields.updated.slice(0, 10)}</td>
      </tr>
      {isExpanded && (
        <tr>
          <td className={styles.issueDetailCell} colSpan={6}>
            <IssueDetailPanel isEmbedded issue={issue} onIssueUpdated={inlineIssueExpansion.onIssueUpdated} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

/** Renders the full issue list in the selected view mode. */
function renderIssueList(
  issues: JiraIssue[],
  viewMode: ViewMode,
  inlineIssueExpansion: InlineIssueExpansionProps,
) {
  if (viewMode === 'compact') {
    return (
      <div className={styles.compactList}>
        <div className={`${styles.compactRow} ${styles.issueTable}`}>
          <strong>Key</strong>
          <strong>Summary</strong>
          <strong>Status</strong>
          <strong>Assignee</strong>
          <strong>Updated</strong>
        </div>
        {issues.map((issue) => renderCompactRow(issue, inlineIssueExpansion))}
      </div>
    );
  }

  if (viewMode === 'table') {
    return (
      <table className={styles.issueTable}>
        <thead>
          <tr>
            <th>Key</th>
            <th>Summary</th>
            <th>Status</th>
            <th>Priority</th>
            <th>Assignee</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>{issues.map((issue) => renderTableRow(issue, inlineIssueExpansion))}</tbody>
      </table>
    );
  }

  return null;
}

/** Renders the source-specific configuration pane (JQL, filter, or board). */
function SourcePane({
  source,
  jqlQuery,
  jqlHistory,
  savedFilters,
  selectedFilterId,
  availableBoards,
  selectedBoardId,
  onJqlChange,
  onRunJql,
  onHistorySelect,
  onLoadFilters,
  onFilterSelect,
  onRunFilter,
  onBoardSearch,
  onBoardSelect,
  onRunBoard,
}: {
  source: IssueSource;
  jqlQuery: string;
  jqlHistory: string[];
  savedFilters: import('../../types/jira.ts').JiraFilter[];
  selectedFilterId: string | null;
  availableBoards: import('../../types/jira.ts').JiraBoard[];
  selectedBoardId: number | null;
  onJqlChange: (value: string) => void;
  onRunJql: () => void;
  onHistorySelect: (query: string) => void;
  onLoadFilters: () => void;
  onFilterSelect: (filterId: string) => void;
  onRunFilter: () => void;
  onBoardSearch: (term: string) => void;
  onBoardSelect: (boardId: number) => void;
  onRunBoard: () => void;
}) {
  const [boardSearchTerm, setBoardSearchTerm] = useState('');

  if (source === 'jql') {
    return (
      <div className={styles.sourcePane}>
        <label htmlFor="jql-query-input">JQL Query</label>
        <textarea
          className={styles.jqlTextarea}
          id="jql-query-input"
          onChange={(changeEvent) => onJqlChange(changeEvent.target.value)}
          placeholder="assignee = currentUser() ORDER BY updated DESC"
          value={jqlQuery}
        />
        {jqlHistory.length > 0 && (
          <div className={styles.historyRow}>
            <label htmlFor="jql-history-select">History</label>
            <select
              className={styles.sourceSelect}
              id="jql-history-select"
              onChange={(changeEvent) => onHistorySelect(changeEvent.target.value)}
              value=""
            >
              <option disabled value="">
                Select previous query…
              </option>
              {jqlHistory.map((historyQuery, historyIndex) => (
                <option key={historyIndex} value={historyQuery}>
                  {historyQuery}
                </option>
              ))}
            </select>
          </div>
        )}
        <button className={styles.panePrimaryButton} onClick={onRunJql} type="button">
          Run
        </button>
      </div>
    );
  }

  if (source === 'filter') {
    return (
      <div className={styles.sourcePane}>
        <select
          className={styles.sourceSelect}
          onChange={(changeEvent) => onFilterSelect(changeEvent.target.value)}
          value={selectedFilterId ?? ''}
        >
          <option disabled value="">
            Select a filter…
          </option>
          {savedFilters.map((savedFilter) => (
            <option key={savedFilter.id} value={savedFilter.id}>
              {savedFilter.name}
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
          <button className={styles.panePrimaryButton} onClick={onLoadFilters} type="button">
            Load Filters
          </button>
          <button className={styles.panePrimaryButton} onClick={onRunFilter} type="button">
            Run
          </button>
        </div>
      </div>
    );
  }

  if (source === 'board') {
    return (
      <div className={styles.sourcePane}>
        <div className={styles.historyRow}>
          <input
            className={styles.jqlTextarea}
            onChange={(changeEvent) => setBoardSearchTerm(changeEvent.target.value)}
            placeholder="Board name…"
            style={{ minHeight: 'unset', height: '36px' }}
            type="text"
            value={boardSearchTerm}
          />
          <button
            className={styles.panePrimaryButton}
            onClick={() => onBoardSearch(boardSearchTerm)}
            type="button"
          >
            Search
          </button>
        </div>
        {availableBoards.length > 0 && (
          <div className={styles.boardResultsList}>
            {availableBoards.map((board) => (
              <div
                className={`${styles.boardResultItem} ${selectedBoardId === board.id ? styles.selectedBoard : ''}`}
                key={board.id}
                onClick={() => onBoardSelect(board.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(keyEvent) => {
                  if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                    onBoardSelect(board.id);
                  }
                }}
              >
                <span>{board.name}</span>
                <span>{board.type}</span>
              </div>
            ))}
          </div>
        )}
        {selectedBoardId && (
          <button className={styles.panePrimaryButton} onClick={onRunBoard} type="button">
            Load Board Issues
          </button>
        )}
      </div>
    );
  }

  return null;
}

// ── Main component ──

/**
 * Renders the My Issues view so users can fetch, filter, and browse their Jira issues
 * in card, compact, or table format from a single configurable workspace.
 *
 * Also fetches ServiceNow issues and highlights linked Jira↔SNow Problem pairs
 * with a health badge showing whether statuses are in sync.
 */
export default function MyIssuesView() {
  const { state, actions } = useMyIssuesState();
  const { isSnowReady } = useConnectionStore();
  const [activeTab, setActiveTab] = useState<MyIssuesTab>('report');
  const [requestedExpandedIssueKey, setRequestedExpandedIssueKey] = useState<string | null>(null);
  const [isSnowSectionCollapsed, setIsSnowSectionCollapsed] = useState(false);
  const hasAutoLoadedJiraIssuesRef = useRef(false);
  const hasAutoLoadedSnowIssuesRef = useRef(false);

  // SNow issues hook — fetches all 4 record types assigned to the current user.
  const { snowIssues, isLoadingSnowIssues, snowFetchError, fetchSnowIssues } = useSnowIssues();

  useEffect(() => {
    if (hasAutoLoadedJiraIssuesRef.current) {
      return;
    }

    hasAutoLoadedJiraIssuesRef.current = true;
    void actions.fetchMyIssues();
  }, [actions]);

  useEffect(() => {
    if (!isSnowReady || hasAutoLoadedSnowIssuesRef.current) {
      return;
    }

    hasAutoLoadedSnowIssuesRef.current = true;
    void fetchSnowIssues();
  }, [fetchSnowIssues, isSnowReady]);

  // Status mappings from the settings store — used for health calculation.
  const { statusMappings } = useSettingsStore();

  // Compute linked Jira↔SNow Problem pairs whenever either issue list changes.
  // This is a pure calculation with no side effects — safe in useMemo.
  const linkedPairs = useMemo(
    () => detectLinkedPairs(state.issues, snowIssues, statusMappings),
    [state.issues, snowIssues, statusMappings],
  );

  // Collect sys_ids of SNow Problems already in a linked pair so we don't
  // render them a second time in the standalone SNow section.
  const linkedSnowSysIds = useMemo(
    () => collectLinkedSnowSysIds(linkedPairs),
    [linkedPairs],
  );

  // Unlinked SNow issues are everything that didn't match a Jira issue.
  const unlinkedSnowIssues = useMemo(
    () => snowIssues.filter((snowIssue) => !linkedSnowSysIds.has(snowIssue.sys_id)),
    [snowIssues, linkedSnowSysIds],
  );

  const zoneCounts = calculateStatusZoneCounts(state.issues);
  const filteredIssues = filterIssuesByStatusZone(state.issues, state.activeStatusZone);
  const extendedFilteredIssues = filteredIssues as ExtendedJiraIssue[];

  // Derive the selected board name for the board pill
  const selectedBoardName = state.selectedBoardId
    ? (state.availableBoards.find((board) => board.id === state.selectedBoardId)?.name ?? null)
    : null;

  // Collect bulk-selected issue keys for display in the panel
  const bulkSelectedKeysList = Object.keys(state.bulkSelectedKeys);

  const expandedIssueKey = useMemo(
    () => (state.issues.some((issue) => issue.key === requestedExpandedIssueKey) ? requestedExpandedIssueKey : null),
    [requestedExpandedIssueKey, state.issues],
  );

  function handleToggleIssueExpand(issueKey: string) {
    setRequestedExpandedIssueKey((previousIssueKey) =>
      previousIssueKey === issueKey ? null : issueKey,
    );
  }

  function handleIssueUpdated() {
    if (state.source === 'mine') {
      void actions.fetchMyIssues();
      return;
    }

    if (state.source === 'jql') {
      void actions.runJqlQuery();
      return;
    }

    if (state.source === 'filter') {
      void actions.runSavedFilter();
      return;
    }

    void actions.runBoardIssues();
  }

  function handleRefreshIssueSources() {
    void actions.fetchMyIssues();

    if (isSnowReady) {
      void fetchSnowIssues();
    }
  }

  const STATUS_ZONE_CHIPS = [
    { key: 'attention', label: 'Attention', count: zoneCounts.attentionCount },
    { key: 'inprogress', label: 'In Progress', count: zoneCounts.inProgressCount },
    { key: 'inreview', label: 'In Review', count: zoneCounts.inReviewCount },
    { key: 'todo', label: 'To Do', count: zoneCounts.toDoCount },
    { key: 'done', label: 'Done', count: zoneCounts.doneCount },
  ];

  return (
    <div className={styles.myIssuesView}>
      <header className={styles.pageHeader}>
        <div className={styles.headerText}>
          <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
          <p>{VIEW_SUBTITLE}</p>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.refreshButton}
            onClick={handleRefreshIssueSources}
            type="button"
          >
            {state.isFetching || isLoadingSnowIssues ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {/* Top-level Report / Settings tabs */}
      <PrimaryTabs
        ariaLabel="My Issues tabs"
        idPrefix="my-issues"
        tabs={MY_ISSUES_TABS}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {/* ── Report tab ── */}
      {activeTab === 'report' && (
        <section id="my-issues-report-panel" role="tabpanel" aria-labelledby="my-issues-report-tab">
          {/* Source strip */}
          <div className={styles.sourceStrip} style={{ marginTop: 'var(--spacing-sm)' }}>
            {SOURCE_OPTIONS.map((sourceOption) => (
              <button
                className={`${styles.pillButton} ${state.source === sourceOption.key ? styles.activePill : ''}`}
                key={sourceOption.key}
                onClick={() => actions.setSource(sourceOption.key)}
                type="button"
              >
                {sourceOption.label}
              </button>
            ))}
          </div>

          {/* Source-specific pane */}
          {state.source !== 'mine' && (
            <div style={{ marginTop: 'var(--spacing-sm)' }}>
              <SourcePane
                availableBoards={state.availableBoards}
                jqlHistory={state.jqlHistory}
                jqlQuery={state.jqlQuery}
                onBoardSearch={actions.loadBoards}
                onBoardSelect={actions.setSelectedBoardId}
                onFilterSelect={actions.setSelectedFilterId}
                onHistorySelect={actions.setJqlQuery}
                onJqlChange={actions.setJqlQuery}
                onLoadFilters={actions.loadSavedFilters}
                onRunBoard={() => {
                  void actions.runBoardIssues();
                  void actions.loadBoardQuickFilters();
                }}
                onRunFilter={actions.runSavedFilter}
                onRunJql={actions.runJqlQuery}
                savedFilters={state.savedFilters}
                selectedBoardId={state.selectedBoardId}
                selectedFilterId={state.selectedFilterId}
                source={state.source}
              />
            </div>
          )}

          {/* Board pill + quick filter chips (shown when a board is selected) */}
          {state.source === 'board' && selectedBoardName && (
            <div style={{ marginTop: 'var(--spacing-sm)' }}>
              <BoardPillAndFilters
                activeQuickFilterIds={state.activeQuickFilterIds}
                boardName={selectedBoardName}
                boardQuickFilters={state.boardQuickFilters}
                onClearBoard={actions.clearSelectedBoard}
                onToggleQuickFilter={actions.toggleQuickFilter}
              />
            </div>
          )}

          {/* Toolbar */}
          <div className={styles.toolbar} style={{ marginTop: 'var(--spacing-sm)' }}>
            {state.source === 'mine' && (
              <>
                {/* SNow fetch button — only meaningful when the relay is ready */}
                <button
                  className={styles.toolbarButton}
                  disabled={isLoadingSnowIssues}
                  onClick={() => { void fetchSnowIssues(); }}
                  type="button"
                  title="Fetch ServiceNow issues assigned to you"
                >
                  {isLoadingSnowIssues ? 'Fetching SNow…' : 'Fetch SNow Issues'}
                </button>
              </>
            )}

            {/* View mode toggle */}
            {VIEW_MODE_OPTIONS.map((viewModeOption) => (
              <button
                className={`${styles.toolbarButton} ${state.viewMode === viewModeOption.key ? styles.activeViewButton : ''}`}
                key={viewModeOption.key}
                onClick={() => actions.setViewMode(viewModeOption.key)}
                type="button"
              >
                {viewModeOption.label}
              </button>
            ))}

            {/* Sort selector */}
            <select
              className={styles.toolbarSelect}
              onChange={(changeEvent) =>
                actions.setSortBy(changeEvent.target.value as SortField)
              }
              value={state.sortBy}
            >
              {SORT_OPTIONS.map((sortOption) => (
                <option key={sortOption.key} value={sortOption.key}>
                  {sortOption.label}
                </option>
              ))}
            </select>

            <span className={styles.countLabel}>{state.issues.length} issues</span>

            {/* Bulk mode toggle — lets user select multiple issues for batch commenting */}
            {filteredIssues.length > 0 && (
              <button
                className={`${styles.toolbarButton} ${state.isBulkModeActive ? styles.activeViewButton : ''}`}
                onClick={actions.toggleBulkMode}
                type="button"
              >
                {state.isBulkModeActive ? `Bulk (${bulkSelectedKeysList.length})` : 'Bulk'}
              </button>
            )}

            {/* Export menu */}
            {state.issues.length > 0 && (
              <div className={styles.exportMenuWrapper}>
                <button
                  className={styles.toolbarButton}
                  onClick={() => actions.setExportMenuOpen(!state.isExportMenuOpen)}
                  type="button"
                >
                  Export
                </button>
                {state.isExportMenuOpen && (
                  <div className={styles.exportDropdown}>
                    <button
                      className={styles.exportDropdownItem}
                      onClick={() => { actions.exportAsCsv(); }}
                      type="button"
                    >
                      Copy as CSV
                    </button>
                    <button
                      className={styles.exportDropdownItem}
                      onClick={() => { actions.exportAsMarkdown(); }}
                      type="button"
                    >
                      Copy as Markdown Table
                    </button>
                    <button
                      className={styles.exportDropdownItem}
                      onClick={() => { actions.exportAsTsv(); }}
                      type="button"
                    >
                      Copy as TSV
                    </button>
                    <button
                      className={styles.exportDropdownItem}
                      onClick={() => { actions.exportAsXlsx(); }}
                      type="button"
                    >
                      Download as Excel (.xlsx)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Error display */}
          {state.fetchError && (
            <p className={styles.errorMessage}>{state.fetchError}</p>
          )}
          {snowFetchError && (
            <p className={styles.errorMessage}>SNow: {snowFetchError}</p>
          )}

          {/* Status zone dashboard chips */}
          <div className={styles.statusZoneDashboard} style={{ marginTop: 'var(--spacing-sm)' }}>
            {STATUS_ZONE_CHIPS.map((chip) => (
              <button
                className={`${styles.statusChip} ${state.activeStatusZone === chip.key ? styles.activeChip : ''}`}
                data-zone={chip.key}
                key={chip.key}
                onClick={() =>
                  actions.setActiveStatusZone(
                    state.activeStatusZone === chip.key ? null : chip.key,
                  )
                }
                type="button"
              >
                <span className={styles.chipCount}>{chip.count}</span>
                <span className={styles.chipLabel}>{chip.label}</span>
              </button>
            ))}
          </div>

          {/* ── Linked Jira↔SNow pairs (shown above the regular Jira list) ── */}
          {linkedPairs.length > 0 && (
            <div className={styles.linkedPairsSection} style={{ marginTop: 'var(--spacing-md)' }}>
              <h3 className={styles.snowSectionTitle}>
                🔗 Linked Jira ↔ SNow ({linkedPairs.length})
              </h3>
              {linkedPairs.map((linkedPair) => (
                <LinkedIssuePair key={linkedPair.pairId} pair={linkedPair} />
              ))}
            </div>
          )}

          {/* ── Jira issues list ── */}
          <div style={{ marginTop: 'var(--spacing-md)' }}>
            {state.isFetching ? (
              <p>Loading issues…</p>
            ) : state.viewMode === 'cards' ? (
              <SwimlaneCardView
                activeQuickFilterIds={state.activeQuickFilterIds}
                bulkSelectedKeys={state.bulkSelectedKeys}
                collapsedSwimlanes={state.collapsedSwimlanes}
                expandedIssueKey={expandedIssueKey}
                isBulkModeActive={state.isBulkModeActive}
                issues={extendedFilteredIssues}
                onIssueClick={(issue) => handleToggleIssueExpand(issue.key)}
                onIssueUpdated={handleIssueUpdated}
                onToggleBulkKey={actions.toggleBulkKey}
                onToggleSwimlane={actions.toggleSwimlaneCollapsed}
              />
            ) : (
              renderIssueList(filteredIssues, state.viewMode, {
                expandedIssueKey,
                onIssueUpdated: handleIssueUpdated,
                onToggleIssueExpand: handleToggleIssueExpand,
              })
            )}
          </div>

          {/* ── Unlinked ServiceNow issues section ── */}
          {unlinkedSnowIssues.length > 0 && (
            <div className={styles.snowSection} style={{ marginTop: 'var(--spacing-lg)' }}>
              <button
                className={styles.snowSectionToggle}
                onClick={() => setIsSnowSectionCollapsed((previouslyCollapsed) => !previouslyCollapsed)}
                type="button"
                aria-expanded={!isSnowSectionCollapsed}
              >
                <span>{isSnowSectionCollapsed ? '▶' : '▼'}</span>
                <h3 className={styles.snowSectionTitle}>
                  ServiceNow Issues ({unlinkedSnowIssues.length})
                </h3>
              </button>
              {!isSnowSectionCollapsed && (
                <div className={styles.snowIssueList}>
                  {unlinkedSnowIssues.map((snowIssue) => (
                    <SnowIssueRow key={snowIssue.sys_id} issue={snowIssue} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Bulk comment panel — sticky footer shown during bulk mode */}
          {state.isBulkModeActive && (
            <BulkCommentPanel
              bulkCommentError={state.bulkCommentError}
              isBulkPostingComment={state.isBulkPostingComment}
              onCancelBulk={actions.toggleBulkMode}
              onPostBulkComment={actions.postBulkComment}
              selectedCount={bulkSelectedKeysList.length}
              selectedKeys={bulkSelectedKeysList}
            />
          )}

          {/* Inline expansion has replaced the slide-in sidebar for default issue review. */}
        </section>
      )}

      {/* ── Hygiene tab ── */}
      {activeTab === 'hygiene' && (
        <section id="my-issues-hygiene-panel" role="tabpanel" aria-labelledby="my-issues-hygiene-tab">
          <HygieneView />
        </section>
      )}

      {/* ── Time Tracking tab ── */}
      {activeTab === 'time' && (
        <section id="my-issues-time-panel" role="tabpanel" aria-labelledby="my-issues-time-tab">
          <EmbeddedTimeTrackingPanel />
        </section>
      )}

      {/* ── Git Sync tab ── */}
      {activeTab === 'gitsync' && (
        <section id="my-issues-gitsync-panel" role="tabpanel" aria-labelledby="my-issues-gitsync-tab">
          <EmbeddedGitSyncPanel />
        </section>
      )}

      {/* ── Settings tab ── */}
      {activeTab === 'settings' && (
        <section id="my-issues-settings-panel" role="tabpanel" aria-labelledby="my-issues-settings-tab">
          <div className={styles.settingsPanel}>
            <div className={styles.settingsSection}>
              <h2 className={styles.settingsSectionTitle}>Default view mode</h2>
              <div className={styles.radioGroup}>
                {VIEW_MODE_OPTIONS.map((viewModeOption) => (
                  <label className={styles.radioLabel} key={viewModeOption.key}>
                    <input
                      checked={state.viewMode === viewModeOption.key}
                      name="default-view-mode"
                      onChange={() => actions.setViewMode(viewModeOption.key)}
                      type="radio"
                      value={viewModeOption.key}
                    />
                    {viewModeOption.label}
                  </label>
                ))}
              </div>
            </div>

            {/* Status mapping configuration for Jira↔SNow health checks */}
            <div className={styles.settingsSection}>
              <StatusMappingEditor />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
