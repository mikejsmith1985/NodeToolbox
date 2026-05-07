// DsuBoardView.tsx — Daily Standup board view with 8 sections, cards/table mode, and assignee filters.

import { useEffect, useState } from 'react';
import { useDsuBoardState } from './hooks/useDsuBoardState.ts';
import type { DsuBoardSection, DsuViewMode, JiraTransition, StandupNotes } from './hooks/useDsuBoardState.ts';
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

      <StandupNotesPanel
        notes={state.standupNotes}
        isCollapsed={state.isStandupPanelCollapsed}
        onUpdateNotes={actions.updateStandupNotes}
        onToggleCollapse={actions.setStandupPanelCollapsed}
        onCopyToClipboard={actions.copyStandupToClipboard}
      />

      <div className={styles.sectionsContainer}>
        {state.sections.map((section) => (
          <BoardSection
            key={section.key}
            section={section}
            viewMode={state.viewMode}
            activeFilters={state.activeFilters}
            onToggleCollapse={actions.toggleSectionCollapse}
            onIssueKeyClick={actions.openDetailOverlay}
          />
        ))}
      </div>

      {state.isDetailOverlayOpen && state.selectedIssue !== null && (
        <IssueDetailOverlay
          issue={state.selectedIssue}
          availableTransitions={state.availableTransitions}
          isLoadingTransitions={state.isLoadingTransitions}
          isTransitioning={state.isTransitioning}
          transitionError={state.transitionError}
          snowRootCauseUrl={state.snowRootCauseUrls[state.selectedIssue.key] ?? ''}
          onClose={actions.closeDetailOverlay}
          onLoadTransitions={actions.loadTransitions}
          onTransitionIssue={actions.transitionIssue}
          onPostComment={actions.postComment}
          onSetSnowRootCauseUrl={actions.setSnowRootCauseUrl}
        />
      )}
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
  onIssueKeyClick: (issue: JiraIssue) => void;
}

/** Renders a single DSU board section with its issues in cards or table mode. */
function BoardSection({ section, viewMode, activeFilters, onToggleCollapse, onIssueKeyClick }: BoardSectionProps) {
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
                <IssueCard key={issue.key} issue={issue} onIssueKeyClick={onIssueKeyClick} />
              ))}
            </div>
          )}
          {!section.isLoading && viewMode === 'table' && visibleIssues.length > 0 && (
            <IssueTable issues={visibleIssues} onIssueKeyClick={onIssueKeyClick} />
          )}
        </div>
      )}
    </div>
  );
}

interface IssueCardProps {
  issue: JiraIssue;
  onIssueKeyClick: (issue: JiraIssue) => void;
}

/** Renders a single issue as a compact card. */
function IssueCard({ issue, onIssueKeyClick }: IssueCardProps) {
  return (
    <div className={styles.issueCard}>
      <div className={styles.issueCardHeader}>
        <button
          className={styles.issueKeyBtn}
          onClick={() => onIssueKeyClick(issue)}
          aria-label={issue.key}
        >
          {issue.key}
        </button>
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
  onIssueKeyClick: (issue: JiraIssue) => void;
}

/** Renders issues in a compact table with key, summary, status, assignee, and updated date. */
function IssueTable({ issues, onIssueKeyClick }: IssueTableProps) {
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
            <td>
              <button
                className={styles.issueKeyBtn}
                onClick={() => onIssueKeyClick(issue)}
                aria-label={issue.key}
              >
                {issue.key}
              </button>
            </td>
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

// ── Standup Notes Panel ──────────────────────────────────────────────────────

interface StandupNotesPanelProps {
  notes: StandupNotes;
  isCollapsed: boolean;
  onUpdateNotes: (notes: Partial<StandupNotes>) => void;
  onToggleCollapse: (isCollapsed: boolean) => void;
  onCopyToClipboard: () => void;
}

/**
 * Collapsible panel for entering daily standup notes.
 * Notes are auto-saved to localStorage (debounced in the hook).
 */
function StandupNotesPanel({
  notes,
  isCollapsed,
  onUpdateNotes,
  onToggleCollapse,
  onCopyToClipboard,
}: StandupNotesPanelProps) {
  return (
    <div className={styles.standupPanel}>
      <button
        className={styles.standupHeader}
        onClick={() => onToggleCollapse(!isCollapsed)}
        aria-expanded={!isCollapsed}
      >
        <span>
          <span className={styles.sectionIcon}>📝</span>
          <span>Standup Notes</span>
        </span>
        <span className={styles.collapseIndicator}>{isCollapsed ? '▶' : '▼'}</span>
      </button>

      {!isCollapsed && (
        <div className={styles.standupBody}>
          <div className={styles.standupRow}>
            <label className={styles.standupLabel} htmlFor="standup-yesterday">Yesterday</label>
            <textarea
              id="standup-yesterday"
              className={styles.standupTextarea}
              value={notes.yesterday}
              onChange={(event) => onUpdateNotes({ yesterday: event.target.value })}
              placeholder="What did you complete yesterday?"
              rows={2}
            />
          </div>
          <div className={styles.standupRow}>
            <label className={styles.standupLabel} htmlFor="standup-today">Today</label>
            <textarea
              id="standup-today"
              className={styles.standupTextarea}
              value={notes.today}
              onChange={(event) => onUpdateNotes({ today: event.target.value })}
              placeholder="What will you work on today?"
              rows={2}
            />
          </div>
          <div className={styles.standupRow}>
            <label className={styles.standupLabel} htmlFor="standup-blockers">Blockers</label>
            <textarea
              id="standup-blockers"
              className={styles.standupTextarea}
              value={notes.blockers}
              onChange={(event) => onUpdateNotes({ blockers: event.target.value })}
              placeholder="Any blockers preventing progress?"
              rows={2}
            />
          </div>
          <div className={styles.standupRow}>
            <label className={styles.standupLabel} htmlFor="standup-snow-url">SNow URL</label>
            <input
              id="standup-snow-url"
              type="url"
              className={styles.standupInput}
              value={notes.snowUrl}
              onChange={(event) => onUpdateNotes({ snowUrl: event.target.value })}
              placeholder="Optional root cause ticket URL"
            />
          </div>
          <button className={styles.copyBtn} onClick={onCopyToClipboard}>
            📋 Copy to Clipboard
          </button>
        </div>
      )}
    </div>
  );
}

// ── Issue Detail Overlay ─────────────────────────────────────────────────────

interface IssueDetailOverlayProps {
  issue: JiraIssue;
  availableTransitions: JiraTransition[];
  isLoadingTransitions: boolean;
  isTransitioning: boolean;
  transitionError: string | null;
  snowRootCauseUrl: string;
  onClose: () => void;
  onLoadTransitions: (issueKey: string) => Promise<void>;
  onTransitionIssue: (issueKey: string, transitionId: string) => Promise<void>;
  onPostComment: (issueKey: string, commentBody: string) => Promise<void>;
  onSetSnowRootCauseUrl: (issueKey: string, url: string) => void;
}

/**
 * Full-screen overlay showing issue detail, status transitions, a comment box,
 * and a SNow root cause URL field. Closes on Escape key or close button.
 */
function IssueDetailOverlay({
  issue,
  availableTransitions,
  isLoadingTransitions,
  isTransitioning,
  transitionError,
  snowRootCauseUrl,
  onClose,
  onLoadTransitions,
  onTransitionIssue,
  onPostComment,
  onSetSnowRootCauseUrl,
}: IssueDetailOverlayProps) {
  const [selectedTransitionId, setSelectedTransitionId] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [isPostingComment, setIsPostingComment] = useState(false);

  // Load available transitions when the overlay mounts for this issue
  useEffect(() => {
    void onLoadTransitions(issue.key);
  }, [issue.key, onLoadTransitions]);

  // Allow closing the overlay with the Escape key
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); };
  }, [onClose]);

  const handleTransition = async () => {
    if (!selectedTransitionId) return;
    await onTransitionIssue(issue.key, selectedTransitionId);
  };

  const handlePostComment = async () => {
    if (!commentBody.trim()) return;
    setIsPostingComment(true);
    await onPostComment(issue.key, commentBody);
    setCommentBody('');
    setIsPostingComment(false);
  };

  const descriptionPreview =
    issue.fields.description
      ? issue.fields.description.slice(0, 300) + (issue.fields.description.length > 300 ? '…' : '')
      : '—';

  return (
    <div className={styles.overlayBackdrop} onClick={onClose}>
      {/* Stop propagation so clicks inside the panel don't close the overlay */}
      <div
        className={styles.overlayPanel}
        role="dialog"
        aria-label="Issue detail"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.overlayHeader}>
          <div className={styles.overlayTitleRow}>
            <span className={styles.overlayIssueKey}>{issue.key}</span>
            <span className={`${styles.statusBadge} ${getStatusClass(issue.fields.status.statusCategory.key)}`}>
              {issue.fields.status.name}
            </span>
          </div>
          <button className={styles.overlayCloseBtn} onClick={onClose} aria-label="Close overlay">✕</button>
        </div>

        <h2 className={styles.overlaySummary}>{issue.fields.summary}</h2>

        <div className={styles.overlayMeta}>
          {issue.fields.priority && (
            <span className={styles.overlayMetaItem}>Priority: {issue.fields.priority.name}</span>
          )}
          {issue.fields.assignee && (
            <span className={styles.overlayMetaItem}>Assignee: {issue.fields.assignee.displayName}</span>
          )}
          <span className={styles.overlayMetaItem}>Type: {issue.fields.issuetype.name}</span>
        </div>

        {issue.fields.description && (
          <p className={styles.overlayDescription}>{descriptionPreview}</p>
        )}

        {/* Status transition */}
        <div className={styles.overlaySection}>
          <label className={styles.overlayLabel} htmlFor="overlay-transition">Change Status</label>
          {isLoadingTransitions ? (
            <p className={styles.loadingText}>Loading transitions…</p>
          ) : (
            <div className={styles.overlayTransitionRow}>
              <select
                id="overlay-transition"
                className={styles.overlaySelect}
                value={selectedTransitionId}
                onChange={(event) => setSelectedTransitionId(event.target.value)}
                disabled={isTransitioning}
              >
                <option value="">Select transition…</option>
                {availableTransitions.map((transition) => (
                  <option key={transition.id} value={transition.id}>
                    {transition.name} → {transition.to.name}
                  </option>
                ))}
              </select>
              <button
                className={styles.overlayActionBtn}
                onClick={() => void handleTransition()}
                disabled={!selectedTransitionId || isTransitioning}
              >
                {isTransitioning ? 'Applying…' : 'Apply'}
              </button>
            </div>
          )}
          {transitionError && <p className={styles.errorText}>{transitionError}</p>}
        </div>

        {/* Post comment */}
        <div className={styles.overlaySection}>
          <label className={styles.overlayLabel} htmlFor="overlay-comment">Post Comment</label>
          <textarea
            id="overlay-comment"
            className={styles.overlayTextarea}
            value={commentBody}
            onChange={(event) => setCommentBody(event.target.value)}
            placeholder="Write a comment…"
            rows={3}
          />
          <button
            className={styles.overlayActionBtn}
            onClick={() => void handlePostComment()}
            disabled={!commentBody.trim() || isPostingComment}
          >
            {isPostingComment ? 'Posting…' : 'Post Comment'}
          </button>
        </div>

        {/* SNow root cause URL */}
        <div className={styles.overlaySection}>
          <label className={styles.overlayLabel} htmlFor="overlay-snow-url">SNow Root Cause URL</label>
          <input
            id="overlay-snow-url"
            type="url"
            className={styles.overlayInput}
            value={snowRootCauseUrl}
            onChange={(event) => onSetSnowRootCauseUrl(issue.key, event.target.value)}
            placeholder="https://servicenow.example.com/…"
          />
        </div>
      </div>
    </div>
  );
}
