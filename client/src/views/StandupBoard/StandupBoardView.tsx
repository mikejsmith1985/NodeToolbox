// StandupBoardView.tsx — Standalone Jira Standup Board with a 15-minute facilitation timer.
//
// The view ports the legacy board-walk behavior into React without depending on
// Sprint Dashboard state: users provide JQL, review flow metrics, and walk cards
// from closest-to-done through earliest workflow states.

import { useMemo, useState, type CSSProperties, type Dispatch, type SetStateAction } from 'react';

import { useStandupBoardState } from './hooks/useStandupBoardState.ts';
import { STANDUP_TIMER_TOTAL_SECONDS, useStandupTimer } from './hooks/useStandupTimer.ts';
import { classifyAge, type StandupIssue, type StatusCategoryKey } from './utils/boardStats.ts';
import styles from './StandupBoardView.module.css';

const VIEW_TITLE = 'Standup Board';
const VIEW_SUBTITLE = 'Walk Jira work by flow state, surface blockers, and keep the daily standup timeboxed.';
const EMPTY_STATE_MESSAGE = 'No Jira issues match the current standup JQL.';
const LOADING_MESSAGE = 'Loading Standup Board issues…';
const SUMMARY_MAX_LENGTH = 80;
const TIMER_WARN_SECONDS = 5 * 60;
const TIMER_URGENT_SECONDS = 2 * 60;
const SECONDS_PER_MINUTE = 60;
const DOUBLE_DIGIT_WIDTH = 2;
const COLUMN_DEFINITIONS: Array<{ key: StatusCategoryKey; label: string; accent: string }> = [
  { key: 'done', label: '✅ Done', accent: '#22c55e' },
  { key: 'indeterminate', label: '🔄 In Progress', accent: '#3b82f6' },
  { key: 'new', label: '📋 To Do', accent: '#6b7280' },
];
const NO_ASSIGNEE_LABEL = 'Unassigned';

/** Renders the standalone Standup Board and delegates Jira/timer state to focused hooks. */
export default function StandupBoardView() {
  const boardState = useStandupBoardState();
  const timerState = useStandupTimer();
  const [statusFilters, setStatusFilters] = useState<Record<string, boolean>>({});
  const [expandedIssueKeys, setExpandedIssueKeys] = useState<Set<string>>(() => new Set<string>());
  const visibleColumns = useMemo(
    () => COLUMN_DEFINITIONS.filter((columnDefinition) => !(boardState.hideDone && columnDefinition.key === 'done')),
    [boardState.hideDone],
  );
  const hasIssues = boardState.issues.length > 0;

  return (
    <section className={styles.standupBoardView} aria-label={VIEW_TITLE}>
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
          <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
        </div>
        {renderTimer(timerState)}
      </header>

      {renderControls(boardState)}
      {renderFlowStats(boardState.flowStats)}

      {boardState.errorMessage && (
        <p className={styles.errorMessage} role="alert">
          ⚠ {boardState.errorMessage}
        </p>
      )}
      {boardState.isLoading && <div className={styles.emptyState}>{LOADING_MESSAGE}</div>}
      {!boardState.isLoading && !hasIssues && <div className={styles.emptyState}>{EMPTY_STATE_MESSAGE}</div>}
      {!boardState.isLoading && hasIssues && (
        <div className={styles.boardGrid} aria-label="Standup board columns">
          {visibleColumns.map((columnDefinition) => renderColumn({
            columnDefinition,
            issues: boardState.issues,
            statusFilters,
            expandedIssueKeys,
            setStatusFilters,
            setExpandedIssueKeys,
          }))}
        </div>
      )}
    </section>
  );
}

function renderTimer(timerState: ReturnType<typeof useStandupTimer>) {
  const timerClassName = readTimerClassName(timerState.remainingSeconds);
  const actionLabel = readTimerActionLabel(timerState);

  return (
    <aside className={styles.timerPanel} aria-label="Standup timer">
      <span className={timerClassName}>{formatTime(timerState.remainingSeconds)}</span>
      <div className={styles.timerControls}>
        <button type="button" className={styles.buttonPrimary} onClick={timerState.isRunning ? timerState.pause : timerState.start}>
          {actionLabel}
        </button>
        <button type="button" className={styles.button} onClick={timerState.reset}>
          Reset
        </button>
      </div>
    </aside>
  );
}

function renderControls(boardState: ReturnType<typeof useStandupBoardState>) {
  return (
    <div className={styles.controlsPanel}>
      <label className={styles.fieldLabel}>
        Standup JQL
        <textarea
          className={styles.jqlInput}
          aria-label="Standup JQL"
          value={boardState.jql}
          onChange={(changeEvent) => boardState.setJql(changeEvent.target.value)}
        />
      </label>
      <div className={styles.controlButtons}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={boardState.hideDone}
            onChange={(changeEvent) => boardState.setHideDone(changeEvent.target.checked)}
          />
          Hide Done
        </label>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={boardState.isLoading || !boardState.jql.trim()}
          onClick={() => {
            void boardState.reload();
          }}
        >
          {boardState.isLoading ? 'Loading…' : '↻ Load Board'}
        </button>
      </div>
    </div>
  );
}

function renderFlowStats(flowStats: ReturnType<typeof useStandupBoardState>['flowStats']) {
  return (
    <div className={styles.flowStatsBar} aria-label="Flow stats">
      {renderFlowStat('WIP', flowStats.wip)}
      {renderFlowStat('Stale', flowStats.stale)}
      {renderFlowStat('Blocked', flowStats.blocked)}
      {renderFlowStat('Avg Age', `${flowStats.avgAgeDays}d`)}
    </div>
  );
}

function renderFlowStat(label: string, value: string | number) {
  return (
    <div className={styles.flowStat}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

interface RenderColumnOptions {
  columnDefinition: { key: StatusCategoryKey; label: string; accent: string };
  issues: StandupIssue[];
  statusFilters: Record<string, boolean>;
  expandedIssueKeys: Set<string>;
  setStatusFilters: Dispatch<SetStateAction<Record<string, boolean>>>;
  setExpandedIssueKeys: Dispatch<SetStateAction<Set<string>>>;
}

function renderColumn(options: RenderColumnOptions) {
  const columnIssues = options.issues.filter((issue) => issue.statusCategoryKey === options.columnDefinition.key);
  const statusNames = readUniqueStatusNames(columnIssues);
  const filteredIssues = columnIssues.filter((issue) => options.statusFilters[issue.status] !== false);

  return (
    <section key={options.columnDefinition.key} className={styles.boardColumn} style={{ '--column-accent': options.columnDefinition.accent } as CSSProperties}>
      <div className={styles.columnHeader}>
        <h2>{options.columnDefinition.label}</h2>
        <span className={styles.columnCount}>{filteredIssues.length}</span>
      </div>
      {statusNames.length > 1 && renderStatusFilters(statusNames, options.statusFilters, options.setStatusFilters)}
      <div className={styles.issueList}>{filteredIssues.map((issue) => renderIssueCard(issue, options.expandedIssueKeys, options.setExpandedIssueKeys))}</div>
    </section>
  );
}

function renderStatusFilters(statusNames: string[], statusFilters: Record<string, boolean>, setStatusFilters: Dispatch<SetStateAction<Record<string, boolean>>>) {
  return (
    <div className={styles.statusFilters} aria-label="Status filters">
      {statusNames.map((statusName) => {
        const isStatusEnabled = statusFilters[statusName] !== false;
        return (
          <button
            key={statusName}
            type="button"
            className={isStatusEnabled ? styles.statusFilterActive : styles.statusFilter}
            aria-pressed={isStatusEnabled}
            onClick={() => setStatusFilters((currentFilters) => ({ ...currentFilters, [statusName]: !isStatusEnabled }))}
          >
            {statusName}
          </button>
        );
      })}
    </div>
  );
}

function renderIssueCard(issue: StandupIssue, expandedIssueKeys: Set<string>, setExpandedIssueKeys: Dispatch<SetStateAction<Set<string>>>) {
  const isExpanded = expandedIssueKeys.has(issue.key);
  const cardClassName = isExpanded ? styles.issueCardExpanded : styles.issueCard;

  return (
    <button key={issue.key} type="button" className={cardClassName} onClick={() => toggleExpandedIssue(issue.key, setExpandedIssueKeys)}>
      <span className={styles.cardHeader}>
        <span className={styles.issueKey}>{issue.key}</span>
        {issue.isBlocked && <span className={styles.blockedIndicator} aria-label="Blocked issue">🔴</span>}
      </span>
      <span className={styles.issueSummary}>{truncateSummary(issue.summary)}</span>
      <span className={styles.cardMeta}>
        <span className={readAgeBadgeClassName(issue.ageDays)}>{issue.ageDays}d</span>
        <span className={styles.assigneeBadge}>🧑 {issue.assignee ?? NO_ASSIGNEE_LABEL}</span>
        <span className={styles.statusBadge}>{issue.status}</span>
      </span>
    </button>
  );
}

function toggleExpandedIssue(issueKey: string, setExpandedIssueKeys: Dispatch<SetStateAction<Set<string>>>): void {
  setExpandedIssueKeys((currentIssueKeys) => {
    const nextIssueKeys = new Set(currentIssueKeys);
    if (nextIssueKeys.has(issueKey)) {
      nextIssueKeys.delete(issueKey);
      return nextIssueKeys;
    }

    nextIssueKeys.add(issueKey);
    return nextIssueKeys;
  });
}

function readUniqueStatusNames(issues: StandupIssue[]): string[] {
  return Array.from(new Set(issues.map((issue) => issue.status))).sort((firstStatus, secondStatus) => firstStatus.localeCompare(secondStatus));
}

function truncateSummary(summary: string): string {
  if (summary.length <= SUMMARY_MAX_LENGTH) return summary;
  return `${summary.slice(0, SUMMARY_MAX_LENGTH)}…`;
}

function readAgeBadgeClassName(ageDays: number): string {
  const ageClass = classifyAge(ageDays);
  if (ageClass === 'old') return styles.ageBadgeOld;
  if (ageClass === 'warn') return styles.ageBadgeWarn;
  return styles.ageBadgeOk;
}

function readTimerClassName(remainingSeconds: number): string {
  if (remainingSeconds <= TIMER_URGENT_SECONDS) return styles.timerDisplayUrgent;
  if (remainingSeconds <= TIMER_WARN_SECONDS) return styles.timerDisplayWarn;
  return styles.timerDisplay;
}

function readTimerActionLabel(timerState: ReturnType<typeof useStandupTimer>): string {
  if (timerState.isRunning) return '⏸ Pause';
  if (timerState.remainingSeconds === STANDUP_TIMER_TOTAL_SECONDS) return '▶ Start';
  if (timerState.remainingSeconds === 0) return 'Done';
  return '▶ Resume';
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}:${String(seconds).padStart(DOUBLE_DIGIT_WIDTH, '0')}`;
}
