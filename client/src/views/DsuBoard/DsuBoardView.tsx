// DsuBoardView.tsx — Daily Standup board view with 8 sections, cards/table mode, and assignee filters.

import { useDsuBoardState } from './hooks/useDsuBoardState.ts';
import type { DsuBoardSection, DsuViewMode } from './hooks/useDsuBoardState.ts';
import type { JiraIssue } from '../../types/jira.ts';
import styles from './DsuBoardView.module.css';

const STALE_DAY_OPTIONS = [3, 5, 7, 10, 14] as const;

/** Main DSU Board view rendering 8 board sections with project controls and filter bar. */
export default function DsuBoardView() {
  const { state, actions } = useDsuBoardState();

  // Collect unique assignee names from all sections for the filter bar
  const allAssignees = Array.from(
    new Set(
      state.sections.flatMap((section) =>
        section.issues
          .map((issue) => issue.fields.assignee?.displayName)
          .filter((name): name is string => Boolean(name)),
      ),
    ),
  );

  return (
    <div className={styles.dsuBoard}>
      <div className={styles.controlBar}>
        <input
          type="text"
          className={styles.projectKeyInput}
          value={state.projectKey}
          onChange={(event) => actions.setProjectKey(event.target.value)}
          placeholder="Project key e.g. TBX"
        />
        <select
          className={styles.staleDaysSelect}
          value={state.staleDays}
          onChange={(event) => actions.setStaleDays(Number(event.target.value))}
        >
          {STALE_DAY_OPTIONS.map((days) => (
            <option key={days} value={days}>
              Stale: {days}d
            </option>
          ))}
        </select>
        <div className={styles.viewModeToggle}>
          <ViewModeButton label="Cards" modeKey="cards" activeMode={state.viewMode} onSelect={actions.setViewMode} />
          <ViewModeButton label="Table" modeKey="table" activeMode={state.viewMode} onSelect={actions.setViewMode} />
        </div>
        <button className={styles.refreshBtn} onClick={() => actions.loadBoard()}>
          🔄 Refresh
        </button>
      </div>

      {(allAssignees.length > 0 || state.activeFilters.length > 0) && (
        <div className={styles.filterBar}>
          <span className={styles.filterLabel}>Filter by assignee:</span>
          {allAssignees.map((assigneeName) => (
            <button
              key={assigneeName}
              className={`${styles.filterPill} ${state.activeFilters.includes(assigneeName) ? styles.filterPillActive : ''}`}
              onClick={() => actions.toggleFilter(assigneeName)}
            >
              {assigneeName}
            </button>
          ))}
          {state.activeFilters.map((filterName) =>
            allAssignees.includes(filterName) ? null : (
              <button
                key={filterName}
                className={`${styles.filterPill} ${styles.filterPillActive}`}
                onClick={() => actions.toggleFilter(filterName)}
              >
                {filterName} ✕
              </button>
            ),
          )}
        </div>
      )}

      <div className={styles.sectionsContainer}>
        {state.sections.map((section) => (
          <BoardSection
            key={section.key}
            section={section}
            viewMode={state.viewMode}
            activeFilters={state.activeFilters}
            onToggleCollapse={actions.toggleSectionCollapse}
          />
        ))}
      </div>
    </div>
  );
}

interface ViewModeButtonProps {
  label: string;
  modeKey: DsuViewMode;
  activeMode: DsuViewMode;
  onSelect: (mode: DsuViewMode) => void;
}

/** Renders a view mode toggle button (Cards or Table). */
function ViewModeButton({ label, modeKey, activeMode, onSelect }: ViewModeButtonProps) {
  const isActive = activeMode === modeKey;
  return (
    <button
      className={`${styles.viewModeBtn} ${isActive ? styles.viewModeBtnActive : ''}`}
      onClick={() => onSelect(modeKey)}
    >
      {label}
    </button>
  );
}

interface BoardSectionProps {
  section: DsuBoardSection;
  viewMode: DsuViewMode;
  activeFilters: string[];
  onToggleCollapse: (key: string) => void;
}

/** Renders a single DSU board section with its issues in cards or table mode. */
function BoardSection({ section, viewMode, activeFilters, onToggleCollapse }: BoardSectionProps) {
  // Apply assignee filter if any filters are active
  const visibleIssues =
    activeFilters.length > 0
      ? section.issues.filter(
          (issue) =>
            issue.fields.assignee !== null &&
            activeFilters.includes(issue.fields.assignee.displayName),
        )
      : section.issues;

  return (
    <div className={styles.boardSection}>
      <button
        className={styles.sectionHeader}
        onClick={() => onToggleCollapse(section.key)}
        aria-expanded={!section.isCollapsed}
      >
        <span className={styles.sectionIcon}>{section.icon}</span>
        <span className={styles.sectionLabel}>{section.label}</span>
        <span className={styles.sectionCount}>({visibleIssues.length})</span>
        <span className={styles.collapseIndicator}>{section.isCollapsed ? '▶' : '▼'}</span>
      </button>

      {!section.isCollapsed && (
        <div className={styles.sectionBody}>
          {section.isLoading && <p className={styles.loadingText}>Loading…</p>}
          {section.loadError && <p className={styles.errorText}>{section.loadError}</p>}
          {!section.isLoading && !section.loadError && visibleIssues.length === 0 && (
            <p className={styles.emptyState}>No issues in this section.</p>
          )}
          {!section.isLoading && viewMode === 'cards' && (
            <div className={styles.cardGrid}>
              {visibleIssues.map((issue) => (
                <IssueCard key={issue.key} issue={issue} />
              ))}
            </div>
          )}
          {!section.isLoading && viewMode === 'table' && visibleIssues.length > 0 && (
            <IssueTable issues={visibleIssues} />
          )}
        </div>
      )}
    </div>
  );
}

interface IssueCardProps {
  issue: JiraIssue;
}

/** Renders a single issue as a compact card. */
function IssueCard({ issue }: IssueCardProps) {
  return (
    <div className={styles.issueCard}>
      <div className={styles.issueCardHeader}>
        <span className={styles.issueKey}>{issue.key}</span>
        <span className={styles.issueType}>{issue.fields.issuetype.name}</span>
      </div>
      <p className={styles.issueSummary}>{issue.fields.summary}</p>
      <div className={styles.issueMeta}>
        <span className={`${styles.statusBadge} ${getStatusClass(issue.fields.status.statusCategory.key)}`}>
          {issue.fields.status.name}
        </span>
        {issue.fields.assignee && (
          <span className={styles.assigneeName}>{issue.fields.assignee.displayName}</span>
        )}
      </div>
    </div>
  );
}

interface IssueTableProps {
  issues: JiraIssue[];
}

/** Renders issues in a compact table with key, summary, status, assignee, and updated date. */
function IssueTable({ issues }: IssueTableProps) {
  return (
    <table className={styles.issueTable}>
      <thead>
        <tr>
          <th scope="col">Key</th>
          <th scope="col">Summary</th>
          <th scope="col">Status</th>
          <th scope="col">Assignee</th>
          <th scope="col">Updated</th>
        </tr>
      </thead>
      <tbody>
        {issues.map((issue) => (
          <tr key={issue.key}>
            <td className={styles.issueKey}>{issue.key}</td>
            <td>{issue.fields.summary}</td>
            <td>{issue.fields.status.name}</td>
            <td>{issue.fields.assignee?.displayName ?? '—'}</td>
            <td>{issue.fields.updated.slice(0, 10)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Maps a Jira status category key to a CSS module class name. */
function getStatusClass(statusCategoryKey: string): string {
  if (statusCategoryKey === 'done') return styles.statusDone;
  if (statusCategoryKey === 'indeterminate') return styles.statusInProgress;
  return styles.statusTodo;
}
