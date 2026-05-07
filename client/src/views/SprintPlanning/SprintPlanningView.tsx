// SprintPlanningView.tsx — Sprint Planning backlog editor.
//
// Lets a user pull an open backlog from any Jira project, edit story points inline
// using small numeric inputs, and persist all pending edits with a single
// "Save Changes" action. The view is intentionally minimal — heavy state work
// lives inside `useSprintPlanningState`.

import { useMemo } from 'react';

import {
  issueTypeToEmoji,
  priorityToColorHex,
  useSprintPlanningState,
  type SprintPlanningIssue,
} from './hooks/useSprintPlanningState.ts';
import styles from './SprintPlanningView.module.css';

const VIEW_TITLE = 'Sprint Planning';
const VIEW_SUBTITLE =
  'Pull the open backlog for any Jira project, point stories inline, and persist your edits in one click.';

const PROJECT_INPUT_PLACEHOLDER = 'Project key (e.g. TBX) — leave blank for cross-project default';
const SEARCH_INPUT_PLACEHOLDER = 'Filter loaded backlog by key or summary…';

const TABLE_COLUMN_LABELS = ['', 'Key', 'Summary', 'Priority', 'Assignee', 'Points'];

export default function SprintPlanningView() {
  const planningState = useSprintPlanningState();

  const filteredBacklog: SprintPlanningIssue[] = useMemo(() => {
    const lowercaseSearch = planningState.searchText.trim().toLowerCase();
    if (!lowercaseSearch) {
      return planningState.backlog;
    }
    return planningState.backlog.filter(
      (backlogRow) =>
        backlogRow.key.toLowerCase().includes(lowercaseSearch) ||
        backlogRow.summary.toLowerCase().includes(lowercaseSearch),
    );
  }, [planningState.backlog, planningState.searchText]);

  const totalDisplayedPoints = useMemo(
    () =>
      filteredBacklog.reduce((runningTotal, backlogRow) => {
        const pendingValue = planningState.pendingChanges[backlogRow.key];
        const effectivePoints = pendingValue ?? backlogRow.storyPoints;
        return runningTotal + effectivePoints;
      }, 0),
    [filteredBacklog, planningState.pendingChanges],
  );

  const hasPendingChanges = Object.keys(planningState.pendingChanges).length > 0;

  return (
    <section className={styles.sprintPlanningView} aria-label={VIEW_TITLE}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
        <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
      </header>

      <div className={styles.controlsRow}>
        <input
          className={styles.controlInput}
          aria-label="Jira project key"
          placeholder={PROJECT_INPUT_PLACEHOLDER}
          value={planningState.projectKey}
          onChange={(changeEvent) => planningState.setProjectKey(changeEvent.target.value)}
        />
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={planningState.isLoading}
          onClick={() => {
            void planningState.loadBacklog();
          }}
        >
          {planningState.isLoading ? 'Loading…' : '↻ Load Backlog'}
        </button>
        <input
          className={styles.controlInput}
          aria-label="Filter loaded backlog"
          placeholder={SEARCH_INPUT_PLACEHOLDER}
          value={planningState.searchText}
          onChange={(changeEvent) => planningState.setSearchText(changeEvent.target.value)}
        />
        <button
          type="button"
          className={styles.button}
          disabled={!hasPendingChanges || planningState.isSaving}
          onClick={planningState.resetPendingChanges}
        >
          ✕ Discard
        </button>
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={!hasPendingChanges || planningState.isSaving}
          onClick={() => {
            void planningState.saveChanges();
          }}
        >
          {planningState.isSaving ? 'Saving…' : '💾 Save Changes'}
        </button>
      </div>

      <div className={styles.summaryBar}>
        <span>
          {filteredBacklog.length} issue{filteredBacklog.length === 1 ? '' : 's'} · {totalDisplayedPoints} pts
        </span>
        {hasPendingChanges && (
          <span aria-label="Pending changes count">
            {Object.keys(planningState.pendingChanges).length} pending edit{Object.keys(planningState.pendingChanges).length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {planningState.loadError && (
        <p className={styles.errorMessage} role="alert">
          ⚠ {planningState.loadError}
        </p>
      )}
      {planningState.saveStatusMessage && (
        <p className={styles.statusMessage} aria-live="polite">
          {planningState.saveStatusMessage}
        </p>
      )}

      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr className={styles.tableHeader}>
              {TABLE_COLUMN_LABELS.map((columnLabel, columnIndex) => (
                <th key={columnLabel || `column-${columnIndex}`}>{columnLabel}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredBacklog.length === 0 ? (
              <tr>
                <td colSpan={TABLE_COLUMN_LABELS.length} className={styles.emptyState}>
                  {planningState.backlog.length === 0
                    ? 'Load a backlog to start planning.'
                    : 'No issues match your filter.'}
                </td>
              </tr>
            ) : (
              filteredBacklog.map((backlogRow) => {
                const pendingPoints = planningState.pendingChanges[backlogRow.key];
                const effectivePoints = pendingPoints ?? backlogRow.storyPoints;
                const isRowChanged = pendingPoints !== undefined;
                const priorityColor = priorityToColorHex(backlogRow.priority);
                return (
                  <tr
                    key={backlogRow.key}
                    className={isRowChanged ? styles.tableRowChanged : styles.tableRow}
                  >
                    <td className={styles.tableCell}>{issueTypeToEmoji(backlogRow.issueType)}</td>
                    <td className={styles.cellMonospace}>{backlogRow.key}</td>
                    <td className={styles.cellSummary} title={backlogRow.summary}>
                      {backlogRow.summary}
                    </td>
                    <td className={styles.tableCell}>
                      <span
                        className={styles.priorityBadge}
                        style={{
                          background: `${priorityColor}22`,
                          color: priorityColor,
                          border: `1px solid ${priorityColor}44`,
                        }}
                      >
                        {backlogRow.priority || '—'}
                      </span>
                    </td>
                    <td className={styles.tableCell}>{backlogRow.assignee || '—'}</td>
                    <td className={styles.tableCell}>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className={styles.pointsInput}
                        aria-label={`Story points for ${backlogRow.key}`}
                        value={effectivePoints}
                        onChange={(changeEvent) =>
                          planningState.setStoryPoints(backlogRow.key, changeEvent.target.value)
                        }
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
