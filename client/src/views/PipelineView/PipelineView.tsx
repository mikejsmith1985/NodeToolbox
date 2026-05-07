// PipelineView.tsx — Standalone Jira epic pipeline visualization for one project.
//
// The view presents epics as status-category swimlanes with compact cards. Child
// issues are shown only after a card expands, matching the legacy performance
// pattern where large projects do not fetch every child issue upfront.

import { useMemo, useState } from 'react';

import {
  usePipelineState,
  type EpicSummary,
} from './hooks/usePipelineState.ts';
import styles from './PipelineView.module.css';
import { countCompletedChildren, type ChildIssue, type StatusCategoryKey } from './utils/rollup.ts';

const VIEW_TITLE = 'Pipeline View';
const VIEW_SUBTITLE = 'Track Jira epics by status category, ownership, story-point rollup, and child completion.';
const PROJECT_INPUT_PLACEHOLDER = 'Project key (required, e.g. TBX)';
const ASSIGNEE_INPUT_PLACEHOLDER = 'Filter assignee name…';
const NO_VALUE_LABEL = '—';

const STATUS_CATEGORY_OPTIONS: Array<{ key: StatusCategoryKey; label: string }> = [
  { key: 'new', label: 'To Do' },
  { key: 'indeterminate', label: 'In Progress' },
  { key: 'done', label: 'Done' },
];

export default function PipelineView() {
  const pipelineState = usePipelineState();
  const [expandedEpicKeys, setExpandedEpicKeys] = useState<Set<string>>(() => new Set<string>());

  const groupedEpics = useMemo(() => {
    return STATUS_CATEGORY_OPTIONS.map((statusCategoryOption) => ({
      ...statusCategoryOption,
      epics: pipelineState.epics.filter(
        (epicSummary) => epicSummary.statusCategoryKey === statusCategoryOption.key,
      ),
    }));
  }, [pipelineState.epics]);

  const toggleEpicExpansion = (epicSummary: EpicSummary) => {
    const isExpanded = expandedEpicKeys.has(epicSummary.key);
    setExpandedEpicKeys((previousExpandedKeys) => {
      const nextExpandedKeys = new Set(previousExpandedKeys);
      if (isExpanded) nextExpandedKeys.delete(epicSummary.key);
      if (!isExpanded) nextExpandedKeys.add(epicSummary.key);
      return nextExpandedKeys;
    });

    if (!isExpanded && epicSummary.children === null) {
      void pipelineState.loadChildren(epicSummary.key);
    }
  };

  return (
    <section className={styles.pipelineView} aria-label={VIEW_TITLE}>
      <header className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{VIEW_TITLE}</h1>
        <p className={styles.pageSubtitle}>{VIEW_SUBTITLE}</p>
      </header>

      <div className={styles.controlsPanel}>
        <input
          className={styles.controlInput}
          aria-label="Jira project key"
          placeholder={PROJECT_INPUT_PLACEHOLDER}
          value={pipelineState.projectKey}
          onChange={(changeEvent) => pipelineState.setProjectKey(changeEvent.target.value)}
        />
        <button
          type="button"
          className={styles.buttonPrimary}
          disabled={pipelineState.isLoading}
          onClick={() => {
            void pipelineState.reload();
          }}
        >
          {pipelineState.isLoading ? 'Loading…' : '↻ Load Pipeline'}
        </button>
        <input
          className={styles.controlInput}
          aria-label="Filter by assignee"
          placeholder={ASSIGNEE_INPUT_PLACEHOLDER}
          value={pipelineState.assigneeFilter}
          onChange={(changeEvent) => pipelineState.setAssigneeFilter(changeEvent.target.value)}
        />
        <fieldset className={styles.statusFilters} aria-label="Status category filters">
          {STATUS_CATEGORY_OPTIONS.map((statusCategoryOption) => (
            <label key={statusCategoryOption.key} className={styles.statusFilterLabel}>
              <input
                type="checkbox"
                checked={pipelineState.statusCategoryFilter.includes(statusCategoryOption.key)}
                onChange={() => pipelineState.toggleStatusCategory(statusCategoryOption.key)}
              />
              {statusCategoryOption.label}
            </label>
          ))}
        </fieldset>
      </div>

      <div className={styles.summaryBar} aria-live="polite">
        {pipelineState.epics.length} epic{pipelineState.epics.length === 1 ? '' : 's'} displayed
      </div>

      {pipelineState.errorMessage && (
        <p className={styles.errorMessage} role="alert">
          ⚠ {pipelineState.errorMessage}
        </p>
      )}

      {pipelineState.isLoading ? (
        <div className={styles.emptyState}>Loading pipeline epics…</div>
      ) : pipelineState.epics.length === 0 ? (
        <div className={styles.emptyState}>Load a project pipeline or adjust filters to see epics.</div>
      ) : (
        <div className={styles.swimlanes}>
          {groupedEpics.map((statusCategoryGroup) => (
            <section key={statusCategoryGroup.key} className={styles.swimlane} aria-label={statusCategoryGroup.label}>
              <h2 className={styles.swimlaneTitle}>
                {statusCategoryGroup.label} <span>{statusCategoryGroup.epics.length}</span>
              </h2>
              <div className={styles.cardStack}>
                {statusCategoryGroup.epics.map((epicSummary) => (
                  <EpicCard
                    key={epicSummary.key}
                    epicSummary={epicSummary}
                    isExpanded={expandedEpicKeys.has(epicSummary.key)}
                    onToggle={() => toggleEpicExpansion(epicSummary)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function EpicCard({
  epicSummary,
  isExpanded,
  onToggle,
}: {
  epicSummary: EpicSummary;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const childCount = epicSummary.children?.length ?? 0;
  const completedChildCount = countCompletedChildren(epicSummary.children);

  return (
    <article className={styles.epicCard}>
      <div className={styles.epicHeader}>
        <span className={styles.epicKey}>{epicSummary.key}</span>
        <span className={styles.statusBadge}>{epicSummary.status || NO_VALUE_LABEL}</span>
      </div>
      <h3 className={styles.epicSummary}>{epicSummary.summary}</h3>
      <dl className={styles.metadataGrid}>
        <div>
          <dt>Assignee</dt>
          <dd>{epicSummary.assignee || NO_VALUE_LABEL}</dd>
        </div>
        <div>
          <dt>Story points</dt>
          <dd>{epicSummary.rolledUpStoryPoints}</dd>
        </div>
        <div>
          <dt>Children</dt>
          <dd>{childCount}</dd>
        </div>
        <div>
          <dt>Complete</dt>
          <dd>{epicSummary.completionPercent}%</dd>
        </div>
      </dl>
      <div className={styles.progressTrack} aria-label={`${epicSummary.key} completion`}>
        <span className={styles.progressFill} style={{ width: `${epicSummary.completionPercent}%` }} />
      </div>
      <button type="button" className={styles.button} onClick={onToggle}>
        {isExpanded ? `Collapse ${epicSummary.key}` : `Expand ${epicSummary.key}`}
      </button>
      {isExpanded && (
        <ChildPanel
          childrenList={epicSummary.children}
          completedChildCount={completedChildCount}
          isLoadingChildren={epicSummary.isLoadingChildren}
        />
      )}
    </article>
  );
}

function ChildPanel({
  childrenList,
  completedChildCount,
  isLoadingChildren,
}: {
  childrenList: ChildIssue[] | null;
  completedChildCount: number;
  isLoadingChildren: boolean;
}) {
  if (isLoadingChildren) {
    return <div className={styles.childPanel}>Loading children…</div>;
  }

  if (!childrenList || childrenList.length === 0) {
    return <div className={styles.childPanel}>No child issues were returned for this epic.</div>;
  }

  return (
    <div className={styles.childPanel}>
      <strong>
        {completedChildCount} of {childrenList.length} children done
      </strong>
      <ul className={styles.childList}>
        {childrenList.map((childIssue) => (
          <li key={childIssue.key} className={styles.childItem}>
            <span className={styles.childKey}>{childIssue.key}</span>
            <span>{childIssue.summary}</span>
            <span className={styles.childStatus}>{childIssue.status || NO_VALUE_LABEL}</span>
            <span>{childIssue.storyPoints ?? NO_VALUE_LABEL} pts</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
