// MyIssuesView.tsx — My Issues view with source picker, persona filter, and multi-mode display.
//
// Provides two top-level tabs: Report (issue browsing) and Settings (defaults).
// The Report tab lets users switch between four issue sources (mine / JQL / filter / board),
// filter by persona, and view results in card, compact, or table layout.

import { useState } from 'react';

import type { JiraIssue } from '../../types/jira.ts';
import { useMyIssuesState } from './hooks/useMyIssuesState.ts';
import type { IssueSource, Persona, SortField, ViewMode } from './hooks/useMyIssuesState.ts';
import styles from './MyIssuesView.module.css';

// ── Named constants ──

const VIEW_TITLE = 'My Issues';
const VIEW_SUBTITLE = 'Track and manage your Jira issues from a single workspace.';

const PERSONA_OPTIONS: { key: Persona; label: string }[] = [
  { key: 'dev', label: 'Dev' },
  { key: 'qa', label: 'QA' },
  { key: 'sm', label: 'SM' },
  { key: 'po', label: 'PO' },
];

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

type MyIssuesTab = 'report' | 'settings';

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
}

/** Renders a full card with key, summary, status, assignee, and aging indicator. */
function renderIssueCard({ issue }: IssueCardProps) {
  const agingDays = calculateAgingDays(issue.fields.updated);
  const isAgedWarn = agingDays > AGING_WARN_DAYS && agingDays <= AGING_STALE_DAYS;
  const isAgedStale = agingDays > AGING_STALE_DAYS;

  const agingClassName = isAgedStale
    ? styles.agingStale
    : isAgedWarn
      ? styles.agingWarn
      : undefined;

  return (
    <div className={styles.issueCard} key={issue.key}>
      <div className={styles.cardHeader}>
        <a
          className={styles.issueKeyLink}
          href={`#${issue.key}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          {issue.key}
        </a>
        <span className={styles.statusBadge}>{issue.fields.status.name}</span>
        {issue.fields.priority && (
          <span className={styles.statusBadge}>{issue.fields.priority.name}</span>
        )}
      </div>
      <p className={styles.issueSummary}>{issue.fields.summary}</p>
      <div className={styles.cardMeta}>
        <span>{issue.fields.issuetype.name}</span>
        {issue.fields.assignee && <span>{issue.fields.assignee.displayName}</span>}
        {agingDays > 0 && (
          <span className={agingClassName}>{agingDays}d ago</span>
        )}
      </div>
    </div>
  );
}

/** Renders a single-line compact row for an issue. */
function renderCompactRow(issue: JiraIssue) {
  return (
    <div className={styles.compactRow} key={issue.key}>
      <a className={styles.issueKeyLink} href={`#${issue.key}`}>
        {issue.key}
      </a>
      <span>{issue.fields.summary}</span>
      <span>{issue.fields.status.name}</span>
      <span>{issue.fields.assignee?.displayName ?? '—'}</span>
      <span>{issue.fields.updated.slice(0, 10)}</span>
    </div>
  );
}

/** Renders a full-width table row for an issue. */
function renderTableRow(issue: JiraIssue) {
  return (
    <tr key={issue.key}>
      <td>
        <a className={styles.issueKeyLink} href={`#${issue.key}`}>
          {issue.key}
        </a>
      </td>
      <td>{issue.fields.summary}</td>
      <td>{issue.fields.status.name}</td>
      <td>{issue.fields.priority?.name ?? '—'}</td>
      <td>{issue.fields.assignee?.displayName ?? '—'}</td>
      <td>{issue.fields.updated.slice(0, 10)}</td>
    </tr>
  );
}

/** Renders the full issue list in the selected view mode. */
function renderIssueList(issues: JiraIssue[], viewMode: ViewMode) {
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
        {issues.map(renderCompactRow)}
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
        <tbody>{issues.map(renderTableRow)}</tbody>
      </table>
    );
  }

  // Default: card view
  return (
    <div className={styles.issueList}>
      {issues.map((issue) => renderIssueCard({ issue }))}
    </div>
  );
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
 */
export default function MyIssuesView() {
  const { state, actions } = useMyIssuesState();
  const [activeTab, setActiveTab] = useState<MyIssuesTab>('report');

  const zoneCounts = calculateStatusZoneCounts(state.issues);
  const filteredIssues = filterIssuesByStatusZone(state.issues, state.activeStatusZone);

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
        <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
        <p>{VIEW_SUBTITLE}</p>
      </header>

      {/* Top-level Report / Settings tabs */}
      <div aria-label="My Issues tabs" className={styles.tabList} role="tablist">
        {(['report', 'settings'] as MyIssuesTab[]).map((tabKey) => {
          const isActiveTab = tabKey === activeTab;
          const tabLabel = tabKey === 'report' ? 'Report' : 'Settings';
          return (
            <button
              aria-controls={`${tabKey}-panel`}
              aria-selected={isActiveTab}
              className={`${styles.tabButton} ${isActiveTab ? styles.activeTab : ''}`}
              id={`${tabKey}-tab`}
              key={tabKey}
              onClick={() => setActiveTab(tabKey)}
              role="tab"
              type="button"
            >
              {tabLabel}
            </button>
          );
        })}
      </div>

      {/* ── Report tab ── */}
      {activeTab === 'report' && (
        <section id="report-panel" role="tabpanel" aria-labelledby="report-tab">
          {/* Persona strip */}
          <div className={styles.personaStrip}>
            {PERSONA_OPTIONS.map((personaOption) => (
              <button
                className={`${styles.pillButton} ${state.persona === personaOption.key ? styles.activePill : ''}`}
                key={personaOption.key}
                onClick={() => actions.setPersona(personaOption.key)}
                type="button"
              >
                {personaOption.label}
              </button>
            ))}
          </div>

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
                onRunBoard={actions.runBoardIssues}
                onRunFilter={actions.runSavedFilter}
                onRunJql={actions.runJqlQuery}
                savedFilters={state.savedFilters}
                selectedBoardId={state.selectedBoardId}
                selectedFilterId={state.selectedFilterId}
                source={state.source}
              />
            </div>
          )}

          {/* Toolbar */}
          <div className={styles.toolbar} style={{ marginTop: 'var(--spacing-sm)' }}>
            {state.source === 'mine' && (
              <button
                className={styles.toolbarButton}
                onClick={actions.fetchMyIssues}
                type="button"
              >
                Fetch Issues
              </button>
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
          </div>

          {/* Error display */}
          {state.fetchError && (
            <p className={styles.errorMessage}>{state.fetchError}</p>
          )}

          {/* Status zone dashboard chips */}
          <div className={styles.statusZoneDashboard} style={{ marginTop: 'var(--spacing-sm)' }}>
            {STATUS_ZONE_CHIPS.map((chip) => (
              <button
                className={`${styles.statusChip} ${state.activeStatusZone === chip.key ? styles.activeChip : ''}`}
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

          {/* Issues list */}
          <div style={{ marginTop: 'var(--spacing-md)' }}>
            {state.isFetching ? (
              <p>Loading issues…</p>
            ) : filteredIssues.length === 0 ? (
              <p style={{ color: 'var(--color-text-secondary)' }}>No issues to display.</p>
            ) : (
              renderIssueList(filteredIssues, state.viewMode)
            )}
          </div>
        </section>
      )}

      {/* ── Settings tab ── */}
      {activeTab === 'settings' && (
        <section id="settings-panel" role="tabpanel" aria-labelledby="settings-tab">
          <div className={styles.settingsPanel}>
            <div className={styles.settingsSection}>
              <h2 className={styles.settingsSectionTitle}>Default persona</h2>
              <div className={styles.radioGroup}>
                {PERSONA_OPTIONS.map((personaOption) => (
                  <label className={styles.radioLabel} key={personaOption.key}>
                    <input
                      checked={state.persona === personaOption.key}
                      name="default-persona"
                      onChange={() => actions.setPersona(personaOption.key)}
                      type="radio"
                      value={personaOption.key}
                    />
                    {personaOption.label}
                  </label>
                ))}
              </div>
            </div>

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
          </div>
        </section>
      )}
    </div>
  );
}
