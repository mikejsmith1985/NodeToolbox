// DefectManagementView.tsx — Standalone Jira defect triage view for recent Bug and Defect issues.

import {
  type DefectIssue,
  type DefectPriorityFilter,
  type DefectSort,
  type DefectStatusCategoryFilter,
  useDefectManagementState,
} from './hooks/useDefectManagementState.ts';
import styles from './DefectManagementView.module.css';

const VIEW_TITLE = 'Defect Management';
const VIEW_SUBTITLE = 'Load recent Bug and Defect issues by Jira project, then triage them with legacy filters and sorts.';
const PROJECT_INPUT_PLACEHOLDER = 'Project key (e.g. TBX)';
const EXTRA_JQL_PLACEHOLDER = 'Optional extra JQL (e.g. statusCategory != Done)';
const EMPTY_PROJECT_MESSAGE = 'Enter a Jira project key to load recent defects.';
const EMPTY_RESULT_MESSAGE = 'No defects match the current query and filters.';
const NO_VALUE_LABEL = '—';
const UNASSIGNED_LABEL = 'UNASSIGNED';
const JIRA_BROWSE_PREFIX = '/browse/';

const PRIORITY_FILTER_OPTIONS: DefectPriorityFilter[] = ['', 'Highest', 'High', 'Medium', 'Low', 'Lowest'];
const STATUS_FILTER_OPTIONS: DefectStatusCategoryFilter[] = ['', 'new', 'indeterminate', 'done'];
const SORT_OPTIONS: Array<{ value: DefectSort; label: string }> = [
  { value: 'priority-age', label: 'Priority, then age' },
  { value: 'age', label: 'Age' },
  { value: 'updated', label: 'Updated' },
];
const TABLE_COLUMN_LABELS = ['Key', 'Summary', 'Priority', 'Status', 'Assignee', 'Age', 'Updated'];

/** Renders the standalone defect triage table and delegates stateful Jira work to `useDefectManagementState`. */
export default function DefectManagementView() {
  const defectState = useDefectManagementState();
  const hasProjectKey = defectState.projectKey.trim().length > 0;

  return (
    <section className={styles.defectManagementView} aria-label={VIEW_TITLE}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
        <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
      </header>

      <div className={styles.controlsPanel}>
        <input
          className={styles.controlInput}
          aria-label="Jira project key"
          placeholder={PROJECT_INPUT_PLACEHOLDER}
          value={defectState.projectKey}
          onChange={(changeEvent) => defectState.setProjectKey(changeEvent.target.value)}
        />
        <input
          className={styles.controlInput}
          aria-label="Extra JQL"
          placeholder={EXTRA_JQL_PLACEHOLDER}
          value={defectState.extraJql}
          onChange={(changeEvent) => defectState.setExtraJql(changeEvent.target.value)}
        />
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={defectState.isLoading || !hasProjectKey}
          onClick={() => {
            void defectState.reload();
          }}
        >
          {defectState.isLoading ? 'Loading…' : '↻ Load Defects'}
        </button>
      </div>

      <div className={styles.filtersPanel}>
        <label className={styles.controlLabel}>
          Priority
          <select
            className={styles.controlSelect}
            aria-label="Priority filter"
            value={defectState.filter.priority}
            onChange={(changeEvent) => defectState.setFilter('priority', changeEvent.target.value as DefectPriorityFilter)}
          >
            {PRIORITY_FILTER_OPTIONS.map((priorityOption) => (
              <option key={priorityOption || 'all-priorities'} value={priorityOption}>
                {priorityOption || 'All priorities'}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.controlLabel}>
          Status category
          <select
            className={styles.controlSelect}
            aria-label="Status category filter"
            value={defectState.filter.statusCat}
            onChange={(changeEvent) =>
              defectState.setFilter('statusCat', changeEvent.target.value as DefectStatusCategoryFilter)
            }
          >
            {STATUS_FILTER_OPTIONS.map((statusCategoryOption) => (
              <option key={statusCategoryOption || 'all-statuses'} value={statusCategoryOption}>
                {statusCategoryOption || 'All statuses'}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            aria-label="Unassigned defects only"
            checked={defectState.filter.unassignedOnly}
            onChange={(changeEvent) => defectState.setFilter('unassignedOnly', changeEvent.target.checked)}
          />
          Unassigned only
        </label>
        <label className={styles.controlLabel}>
          Sort
          <select
            className={styles.controlSelect}
            aria-label="Sort defects"
            value={defectState.sort}
            onChange={(changeEvent) => defectState.setSort(changeEvent.target.value as DefectSort)}
          >
            {SORT_OPTIONS.map((sortOption) => (
              <option key={sortOption.value} value={sortOption.value}>
                {sortOption.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.summaryBar} aria-live="polite">
        Showing {defectState.defects.length} of {defectState.rawIssueCount} defects
      </div>

      {defectState.isLoading && (
        <p className={styles.statusMessage} role="status">
          Loading defects…
        </p>
      )}
      {defectState.errorMessage && (
        <p className={styles.errorMessage} role="alert">
          ⚠ {defectState.errorMessage}
        </p>
      )}

      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr className={styles.tableHeader}>
              {TABLE_COLUMN_LABELS.map((columnLabel) => (
                <th key={columnLabel}>{columnLabel}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {defectState.defects.length === 0 ? (
              <tr>
                <td colSpan={TABLE_COLUMN_LABELS.length} className={styles.emptyState}>
                  {hasProjectKey ? EMPTY_RESULT_MESSAGE : EMPTY_PROJECT_MESSAGE}
                </td>
              </tr>
            ) : (
              defectState.defects.map((defectIssue) => renderDefectRow(defectIssue))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function renderDefectRow(defectIssue: DefectIssue) {
  return (
    <tr key={defectIssue.key} className={styles.tableRow}>
      <td className={styles.cellMonospace}>
        <a
          className={styles.issueLink}
          href={buildJiraBrowseUrl(defectIssue.key)}
          target="_blank"
          rel="noreferrer"
        >
          {defectIssue.key}
        </a>
      </td>
      <td className={styles.cellSummary} title={defectIssue.summary}>
        {defectIssue.summary || NO_VALUE_LABEL}
      </td>
      <td className={styles.tableCell}>
        <span className={styles.priorityBadge}>{defectIssue.priority || NO_VALUE_LABEL}</span>
      </td>
      <td className={styles.tableCell}>{defectIssue.status || NO_VALUE_LABEL}</td>
      <td className={styles.tableCell}>{renderAssignee(defectIssue.assignee)}</td>
      <td className={styles.tableCell}>{formatDayCount(defectIssue.ageDays)}</td>
      <td className={styles.tableCell}>{formatDayCount(defectIssue.updatedDays)}</td>
    </tr>
  );
}

function renderAssignee(assigneeName: string) {
  return assigneeName ? assigneeName : <span className={styles.unassignedBadge}>{UNASSIGNED_LABEL}</span>;
}

function buildJiraBrowseUrl(issueKey: string): string {
  return `${JIRA_BROWSE_PREFIX}${encodeURIComponent(issueKey)}`;
}

function formatDayCount(dayCount: number): string {
  return `${dayCount}d`;
}
