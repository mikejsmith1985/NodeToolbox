// DsuBoardView.tsx — Daily Standup board view with 8 sections, rich filters, and issue detail tools.

import { useEffect, useMemo, useState } from 'react';
import type { JiraIssue } from '../../types/jira.ts';
import styles from './DsuBoardView.module.css';
import { useDsuBoardState } from './hooks/useDsuBoardState.ts';
import type {
  DsuBoardSection,
  DsuViewMode,
  JiraTransition,
  StandupNotes,
} from './hooks/useDsuBoardState.ts';
import {
  applyMultiCriteriaFilters,
  buildFilterOptions,
  hasActiveMultiCriteriaFilters,
  type DsuFilterOptions,
  type DsuMultiCriteriaFilters,
} from './hooks/useDsuFilters.ts';
import type { SnowLink, SnowLinksMap } from './hooks/useDsuSnowEnrichment.ts';

const STALE_DAY_OPTIONS = [3, 5, 7, 10, 14] as const;
const MAX_OVERLAY_LINK_COUNT = 5;
const MAX_OVERLAY_COMMENT_COUNT = 3;

interface DsuIssueLink {
  type: { inward: string; outward: string; name: string };
  inwardIssue?: { key: string; fields: { summary: string; status: { name: string } } };
  outwardIssue?: { key: string; fields: { summary: string; status: { name: string } } };
}

interface DsuIssueComment {
  id: string;
  author: { displayName: string };
  body: string;
  created: string;
}

type DsuIssueFields = JiraIssue['fields'] & {
  labels?: string[];
  customfield_10028?: number | null;
  customfield_10301?: { value?: string; name?: string } | string | null;
  issuelinks?: DsuIssueLink[];
  comment?: { comments: DsuIssueComment[]; total: number };
};

/** Main DSU Board view rendering 8 board sections with project controls and filter bar. */
export default function DsuBoardView() {
  const { state, actions } = useDsuBoardState();
  const allIssues = useMemo(
    () => state.sections.flatMap((section) => section.issues),
    [state.sections],
  );
  const filterOptions = useMemo(() => buildFilterOptions(allIssues), [allIssues]);
  const hasAnyActiveFilters =
    state.activeFilters.length > 0 || hasActiveMultiCriteriaFilters(state.multiCriteriaFilters);
  const shouldRenderFilterBar =
    hasAnyActiveFilters ||
    filterOptions.issueTypes.length > 0 ||
    filterOptions.priorities.length > 0 ||
    filterOptions.statuses.length > 1 ||
    filterOptions.fixVersions.length > 0 ||
    filterOptions.piValues.length > 0 ||
    filterOptions.assignees.length > 0;

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

      {shouldRenderFilterBar && (
        <MultiCriteriaFilterBar
          filterOptions={filterOptions}
          multiCriteriaFilters={state.multiCriteriaFilters}
          activeAssigneeFilters={state.activeFilters}
          onToggleIssueType={actions.toggleIssueTypeFilter}
          onTogglePriority={actions.togglePriorityFilter}
          onToggleStatus={actions.toggleStatusFilter}
          onToggleAssignee={actions.toggleFilter}
          onSetFixVersion={actions.setFixVersionFilter}
          onSetPiValue={actions.setPiFilter}
          onClearAll={actions.clearAllFilters}
        />
      )}

      <StandupNotesPanel
        notes={state.standupNotes}
        isCollapsed={state.isStandupPanelCollapsed}
        onUpdateNotes={actions.updateStandupNotes}
        onToggleCollapse={actions.setStandupPanelCollapsed}
        onCopyToClipboard={actions.copyStandupToClipboard}
        onAutoFill={actions.autoFillStandupNotes}
      />

      <div className={styles.sectionsContainer}>
        {state.sections.map((section) => (
          <BoardSection
            key={section.key}
            section={section}
            viewMode={state.viewMode}
            activeFilters={state.activeFilters}
            multiCriteriaFilters={state.multiCriteriaFilters}
            snowLinks={state.sectionSnowLinks[section.key] ?? {}}
            releaseInfo={
              section.key === 'release'
                ? {
                    availableVersions: state.availableVersions,
                    autoReleaseName: state.autoReleaseName,
                    selectedReleaseName: state.selectedReleaseName,
                    onSetSelectedRelease: actions.setSelectedRelease,
                  }
                : undefined
            }
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

interface FilterPillGroupProps {
  label: string;
  options: string[];
  activeValues: string[];
  onToggle: (value: string) => void;
}

function FilterPillGroup({ label, options, activeValues, onToggle }: FilterPillGroupProps) {
  if (options.length === 0) {
    return null;
  }

  return (
    <div className={styles.filterGroup}>
      <span className={styles.filterLabel}>{label}</span>
      {options.map((optionValue) => (
        <button
          key={optionValue}
          className={`${styles.filterPill} ${activeValues.includes(optionValue) ? styles.filterPillActive : ''}`}
          onClick={() => onToggle(optionValue)}
        >
          {optionValue}
        </button>
      ))}
    </div>
  );
}

interface FilterDropdownProps {
  label: string;
  options: string[];
  value: string;
  emptyLabel: string;
  onChange: (value: string) => void;
}

function FilterDropdown({ label, options, value, emptyLabel, onChange }: FilterDropdownProps) {
  if (options.length === 0 && !value) {
    return null;
  }

  return (
    <div className={styles.filterGroup}>
      <label className={styles.filterLabel}>
        {label}
        <select
          className={styles.filterDropdown}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{emptyLabel}</option>
          {options.map((optionValue) => (
            <option key={optionValue} value={optionValue}>
              {optionValue}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

interface MultiCriteriaFilterBarProps {
  filterOptions: DsuFilterOptions;
  multiCriteriaFilters: DsuMultiCriteriaFilters;
  activeAssigneeFilters: string[];
  onToggleIssueType: (issueTypeName: string) => void;
  onTogglePriority: (priorityName: string) => void;
  onToggleStatus: (statusName: string) => void;
  onToggleAssignee: (assigneeName: string) => void;
  onSetFixVersion: (fixVersion: string) => void;
  onSetPiValue: (piValue: string) => void;
  onClearAll: () => void;
}

function MultiCriteriaFilterBar({
  filterOptions,
  multiCriteriaFilters,
  activeAssigneeFilters,
  onToggleIssueType,
  onTogglePriority,
  onToggleStatus,
  onToggleAssignee,
  onSetFixVersion,
  onSetPiValue,
  onClearAll,
}: MultiCriteriaFilterBarProps) {
  const missingAssigneeFilters = activeAssigneeFilters.filter(
    (assigneeName) => !filterOptions.assignees.includes(assigneeName),
  );
  const hasAnyActiveFilters =
    activeAssigneeFilters.length > 0 || hasActiveMultiCriteriaFilters(multiCriteriaFilters);

  return (
    <div className={styles.filterBar}>
      <FilterPillGroup
        label="Issue type:"
        options={filterOptions.issueTypes}
        activeValues={multiCriteriaFilters.issueTypes}
        onToggle={onToggleIssueType}
      />
      <FilterPillGroup
        label="Priority:"
        options={filterOptions.priorities}
        activeValues={multiCriteriaFilters.priorities}
        onToggle={onTogglePriority}
      />
      {filterOptions.statuses.length > 1 && (
        <FilterPillGroup
          label="Status:"
          options={filterOptions.statuses}
          activeValues={multiCriteriaFilters.statuses}
          onToggle={onToggleStatus}
        />
      )}
      <FilterDropdown
        label="Fix version:"
        options={filterOptions.fixVersions}
        value={multiCriteriaFilters.fixVersion}
        emptyLabel="All fix versions"
        onChange={onSetFixVersion}
      />
      <FilterDropdown
        label="PI:"
        options={filterOptions.piValues}
        value={multiCriteriaFilters.piValue}
        emptyLabel="All PIs"
        onChange={onSetPiValue}
      />
      <FilterPillGroup
        label="Assignee:"
        options={filterOptions.assignees}
        activeValues={activeAssigneeFilters}
        onToggle={onToggleAssignee}
      />
      {missingAssigneeFilters.map((assigneeName) => (
        <button
          key={assigneeName}
          className={`${styles.filterPill} ${styles.filterPillActive}`}
          onClick={() => onToggleAssignee(assigneeName)}
        >
          {assigneeName} ✕
        </button>
      ))}
      {hasAnyActiveFilters && (
        <button className={styles.clearFiltersBtn} onClick={onClearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}

interface ReleaseInfo {
  availableVersions: string[];
  autoReleaseName: string | null;
  selectedReleaseName: string | null;
  onSetSelectedRelease: (name: string | null) => void;
}

interface BoardSectionProps {
  section: DsuBoardSection;
  viewMode: DsuViewMode;
  activeFilters: string[];
  multiCriteriaFilters: DsuMultiCriteriaFilters;
  snowLinks: SnowLinksMap;
  releaseInfo?: ReleaseInfo;
  onToggleCollapse: (key: string) => void;
  onIssueKeyClick: (issue: JiraIssue) => void;
}

function createReleaseBadgeText(releaseInfo: ReleaseInfo): string {
  if (releaseInfo.selectedReleaseName) {
    return `Release: ${releaseInfo.selectedReleaseName}`;
  }

  if (releaseInfo.autoReleaseName) {
    return `Auto: ${releaseInfo.autoReleaseName}`;
  }

  return 'Release: Unreleased';
}

function BoardSection({
  section,
  viewMode,
  activeFilters,
  multiCriteriaFilters,
  snowLinks,
  releaseInfo,
  onToggleCollapse,
  onIssueKeyClick,
}: BoardSectionProps) {
  const visibleIssues = applyMultiCriteriaFilters(section.issues, multiCriteriaFilters, activeFilters);
  const releaseBadgeText = releaseInfo ? createReleaseBadgeText(releaseInfo) : null;

  return (
    <div className={styles.boardSection}>
      <div className={styles.sectionHeaderRow}>
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
        {section.key === 'release' && releaseInfo && (
          <div className={styles.releaseControls} onClick={(event) => event.stopPropagation()}>
            <span className={styles.releaseBadge}>{releaseBadgeText}</span>
            {releaseInfo.availableVersions.length > 0 && (
              <select
                className={styles.releaseSelect}
                value={releaseInfo.selectedReleaseName ?? ''}
                onChange={(event) =>
                  releaseInfo.onSetSelectedRelease(event.target.value || null)
                }
                aria-label="Release version"
              >
                <option value="">
                  {releaseInfo.autoReleaseName
                    ? `Auto (${releaseInfo.autoReleaseName})`
                    : 'Auto-detect release'}
                </option>
                {releaseInfo.availableVersions.map((versionName) => (
                  <option key={versionName} value={versionName}>
                    {versionName}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

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
                <IssueCard
                  key={issue.key}
                  issue={issue}
                  snowLinks={snowLinks[issue.key] ?? []}
                  onIssueKeyClick={onIssueKeyClick}
                />
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
  snowLinks: SnowLink[];
  onIssueKeyClick: (issue: JiraIssue) => void;
}

function IssueCard({ issue, snowLinks, onIssueKeyClick }: IssueCardProps) {
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
      {snowLinks.length > 0 && (
        <div className={styles.snowBadges}>
          {snowLinks.map((snowLink) =>
            snowLink.url ? (
              <a
                key={snowLink.label}
                className={styles.snowBadgeLink}
                href={snowLink.url}
                target="_blank"
                rel="noreferrer"
              >
                {snowLink.label}
              </a>
            ) : (
              <span key={snowLink.label} className={styles.snowBadge}>
                {snowLink.label}
              </span>
            ),
          )}
        </div>
      )}
    </div>
  );
}

interface IssueTableProps {
  issues: JiraIssue[];
  onIssueKeyClick: (issue: JiraIssue) => void;
}

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

function getStatusClass(statusCategoryKey: string): string {
  if (statusCategoryKey === 'done') return styles.statusDone;
  if (statusCategoryKey === 'indeterminate') return styles.statusInProgress;
  return styles.statusTodo;
}

interface StandupNotesPanelProps {
  notes: StandupNotes;
  isCollapsed: boolean;
  onUpdateNotes: (notes: Partial<StandupNotes>) => void;
  onToggleCollapse: (isCollapsed: boolean) => void;
  onCopyToClipboard: () => void;
  onAutoFill: () => void;
}

function StandupNotesPanel({
  notes,
  isCollapsed,
  onUpdateNotes,
  onToggleCollapse,
  onCopyToClipboard,
  onAutoFill,
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
          <div className={styles.standupActions}>
            <button className={styles.copyBtn} onClick={onCopyToClipboard}>
              📋 Copy to Clipboard
            </button>
            <button className={styles.autoFillBtn} onClick={onAutoFill}>
              ✨ Auto-fill
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

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

function getExtendedIssueFields(issue: JiraIssue): DsuIssueFields {
  return issue.fields as DsuIssueFields;
}

function getStoryPoints(issueFields: DsuIssueFields): number | null {
  return issueFields.customfield_10016 ?? issueFields.customfield_10028 ?? null;
}

function createIssueLinkDescription(issueLink: DsuIssueLink): string {
  if (issueLink.outwardIssue) {
    return `${issueLink.type.outward}: ${issueLink.outwardIssue.key} - ${issueLink.outwardIssue.fields.summary} (${issueLink.outwardIssue.fields.status.name})`;
  }

  if (issueLink.inwardIssue) {
    return `${issueLink.type.inward}: ${issueLink.inwardIssue.key} - ${issueLink.inwardIssue.fields.summary} (${issueLink.inwardIssue.fields.status.name})`;
  }

  return issueLink.type.name;
}

function createCommentPreview(issueComment: DsuIssueComment): string {
  return `${issueComment.author.displayName}: ${issueComment.body} (${issueComment.created.slice(0, 10)})`;
}

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
  const issueFields = getExtendedIssueFields(issue);
  const storyPoints = getStoryPoints(issueFields);
  const issueLinks = (issueFields.issuelinks ?? []).slice(0, MAX_OVERLAY_LINK_COUNT);
  const recentComments = (issueFields.comment?.comments ?? []).slice(-MAX_OVERLAY_COMMENT_COUNT);
  const descriptionPreview =
    issue.fields.description
      ? issue.fields.description.slice(0, 300) + (issue.fields.description.length > 300 ? '…' : '')
      : '—';

  useEffect(() => {
    void onLoadTransitions(issue.key);
  }, [issue.key, onLoadTransitions]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); };
  }, [onClose]);

  const handleTransition = async () => {
    if (!selectedTransitionId) {
      return;
    }

    await onTransitionIssue(issue.key, selectedTransitionId);
  };

  const handlePostComment = async () => {
    if (!commentBody.trim()) {
      return;
    }

    setIsPostingComment(true);
    try {
      await onPostComment(issue.key, commentBody);
      setCommentBody('');
    } finally {
      setIsPostingComment(false);
    }
  };

  return (
    <div className={styles.overlayBackdrop} onClick={onClose}>
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

        {issueFields.labels && issueFields.labels.length > 0 && (
          <div className={styles.overlayLabels}>
            <span className={styles.overlayLabel}>Labels</span>
            <span>{issueFields.labels.join(', ')}</span>
          </div>
        )}

        {storyPoints !== null && (
          <div className={styles.overlayStoryPoints}>
            <span className={styles.overlayLabel}>Story points</span>
            <span>{storyPoints}</span>
          </div>
        )}

        {issue.fields.description && (
          <p className={styles.overlayDescription}>{descriptionPreview}</p>
        )}

        {issueLinks.length > 0 && (
          <div className={styles.overlayLinks}>
            <span className={styles.overlayLabel}>Issue links</span>
            <ul className={styles.overlayLinkList}>
              {issueLinks.map((issueLink, issueLinkIndex) => (
                <li key={`${issue.key}-link-${issueLinkIndex}`} className={styles.overlayLinkItem}>
                  {createIssueLinkDescription(issueLink)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {recentComments.length > 0 && (
          <div className={styles.overlayComments}>
            <span className={styles.overlayLabel}>Recent comments</span>
            {recentComments.map((issueComment) => (
              <div key={issueComment.id} className={styles.overlayComment}>
                {createCommentPreview(issueComment)}
              </div>
            ))}
          </div>
        )}

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
