// StandupTab.tsx — Team Dashboard standup view for Sprint and Roster board-walk, person-walk, and AI briefing workflows.

import { useCallback, useEffect, useMemo, useState } from 'react';

import IssueDetailPanel from '../../components/IssueDetailPanel/index.tsx';
import { useSettingsStore } from '../../store/settingsStore.ts';
import type { JiraIssue } from '../../types/jira.ts';
import DsuBoardView from '../DsuBoard/DsuBoardView.tsx';
import type { DashboardScopeMode } from './hooks/useSprintData.ts';
import {
  calculateIssueAgeDays,
  classifyIssueAge,
  formatPersonWalkText,
  hasBlockingLink,
  useSprintStandupState,
  type StandupScopeMode,
  type StandupStatusCategory,
} from './hooks/useSprintStandupState.ts';
import styles from './SprintDashboardView.module.css';

const TIMER_WARNING_SECONDS = 5 * 60;
const TIMER_DANGER_SECONDS = 2 * 60;
const PERSON_WALK_STATUS_IDLE_TEXT = '';
const PERSON_WALK_YESTERDAY_EMPTY_MESSAGE = 'No work moved yesterday.';
const PERSON_WALK_ACTIVE_EMPTY_MESSAGE = 'No active items are assigned right now.';
const PERSON_WALK_PLAN_EMPTY_MESSAGE = 'Click sprint items to build today’s plan.';
const PERSON_WALK_SCOPE_EMPTY_MESSAGE = 'No items are available in this scope yet.';
const STANDUP_SCOPE_SPRINT_LABEL = 'Sprint';
const STANDUP_SCOPE_ROSTER_LABEL = 'Roster';
const PLAN_HELD_LABEL = 'Plan held';
const PLAN_SHIFTED_LABEL = 'Plan shifted';

/** Human-readable labels for each dashboard scope mode, used to relabel the standup scope toggle. */
const DASHBOARD_SCOPE_LABELS: Record<DashboardScopeMode, string> = {
  sprint:      'Sprint',
  fixVersion:  'Fix Version',
  pi:          'PI',
};

/** Days-back options exposed in the briefing mode selector. */
const BRIEFING_DAYS_OPTIONS: readonly number[] = [1, 2, 3];
/** Default copy-button label shown before the first click. */
const BRIEFING_COPY_DEFAULT_LABEL = 'Copy Briefing';
/** Temporary label shown after the user copies the briefing text. */
const BRIEFING_COPY_SUCCESS_LABEL = '✓ Copied!';
/** Duration (ms) the copy-success label stays visible. */
const BRIEFING_COPY_SUCCESS_DURATION_MS = 2_000;

interface BriefingCounts {
  statusChanges: number;
  blockers:      number;
  defects:       number;
  risks:         number;
  completions:   number;
}

interface AdhocBriefingResult {
  ok:          boolean;
  briefingText: string;
  counts?:     BriefingCounts;
  sprintName?: string;
  message:     string;
}

interface StandupTabProps {
  issues: JiraIssue[];
  projectKey: string;
  /** The dashboard-level "View Work By" scope — sprint, fixVersion, or pi. Used to label
   *  the scope toggle accurately and warn when roster scope is mixed with a non-sprint filter. */
  dashboardScopeMode: DashboardScopeMode;
  dashboardTeamProfileId?: string;
  timerSecondsRemaining: number;
  isTimerRunning: boolean;
  onStart: () => void;
  onStop: () => void;
  onReset: () => void;
  onTick: () => void;
  onRefreshIssues: () => void;
}

interface BoardWalkStats {
  workInProgressCount: number;
  staleCount: number;
  blockedCount: number;
  averageAgeDays: number;
}

interface BoardWalkColumn {
  categoryKey: StandupStatusCategory;
  label: string;
}

interface PersonWalkIssueData {
  issue: JiraIssue;
  ageDays: number;
  ageClass: ReturnType<typeof classifyIssueAge>;
  isBlocked: boolean;
}

interface PersonWalkAssigneeCardData {
  assigneeName: string;
  assigneeAvatarUrl: string | null;
  activeIssues: PersonWalkIssueData[];
  updatedYesterdayIssues: PersonWalkIssueData[];
  totalIssueCount: number;
  doneCount: number;
  activeCount: number;
  blockedCount: number;
  staleCount: number;
  completionPercent: number;
  plannedIssueKeys: string[];
  plannedWorkedIssueKeys: string[];
  missedPlanIssueKeys: string[];
  unplannedWorkedIssueKeys: string[];
}

interface PersonWalkSnapshotStats {
  activeAssigneeCount: number;
  activeIssueCount: number;
  followThroughCount: number;
  blockedCount: number;
}

function formatTimerDisplay(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function buildBoardWalkColumns(shouldShowDoneColumn: boolean): BoardWalkColumn[] {
  const allColumns: BoardWalkColumn[] = [
    { categoryKey: 'done', label: 'Done' },
    { categoryKey: 'indeterminate', label: 'In Progress' },
    { categoryKey: 'new', label: 'To Do' },
  ];

  return shouldShowDoneColumn ? allColumns : allColumns.filter((column) => column.categoryKey !== 'done');
}

function buildBoardWalkStats(issues: JiraIssue[]): BoardWalkStats {
  let blockedCount = 0;
  let staleCount = 0;
  let workInProgressCount = 0;
  let ageSum = 0;
  let ageCount = 0;

  for (const issue of issues) {
    const categoryKey = issue.fields.status.statusCategory.key;
    const issueAgeDays = calculateIssueAgeDays(issue);

    if (categoryKey !== 'done') {
      ageSum += issueAgeDays;
      ageCount += 1;
    }
    if (categoryKey === 'indeterminate') {
      workInProgressCount += 1;
      if (issueAgeDays > 5) {
        staleCount += 1;
      }
    }
    if (hasBlockingLink(issue)) {
      blockedCount += 1;
    }
  }

  return {
    workInProgressCount,
    staleCount,
    blockedCount,
    averageAgeDays: ageCount === 0 ? 0 : Math.round((ageSum / ageCount) * 10) / 10,
  };
}

function buildVisibleBoardWalkIssues(
  issues: JiraIssue[],
  categoryKey: StandupStatusCategory,
  categoryFilters: Record<string, boolean>,
): JiraIssue[] {
  return issues
    .filter((issue) => issue.fields.status.statusCategory.key === categoryKey)
    .filter((issue) => categoryFilters[issue.fields.status.name] !== false)
    .sort((firstIssue, secondIssue) => calculateIssueAgeDays(secondIssue) - calculateIssueAgeDays(firstIssue));
}

function buildBlockedIssues(issues: JiraIssue[]): JiraIssue[] {
  return issues.filter((issue) => hasBlockingLink(issue));
}

function renderToggleButton(activeValue: string, buttonValue: string, label: string, onSelectValue: (value: never) => void) {
  return (
    <button
      className={activeValue === buttonValue ? styles.standupToggleButtonActive : styles.standupToggleButton}
      onClick={() => onSelectValue(buttonValue as never)}
      type="button"
    >
      {label}
    </button>
  );
}

function renderPersonWalkStatus(status: 'idle' | 'posting' | 'success' | 'error', errorMessage: string | null, postKey: string) {
  if (status === 'idle') {
    return PERSON_WALK_STATUS_IDLE_TEXT;
  }
  if (status === 'posting') {
    return 'Posting…';
  }
  if (status === 'success') {
    return `Comment posted to ${postKey.trim().toUpperCase()}.`;
  }
  return errorMessage ?? 'Could not post standup comment.';
}

function readYesterdayIsoDate(): string {
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  return yesterdayDate.toISOString().slice(0, 10);
}

function createPersonWalkIssueData(issue: JiraIssue): PersonWalkIssueData {
  const ageDays = calculateIssueAgeDays(issue);
  return {
    issue,
    ageDays,
    ageClass: classifyIssueAge(ageDays),
    isBlocked: hasBlockingLink(issue),
  };
}

function createEmptyPersonWalkAssigneeCard(issue: JiraIssue): PersonWalkAssigneeCardData {
  return {
    assigneeName: issue.fields.assignee?.displayName ?? 'Unassigned',
    assigneeAvatarUrl: issue.fields.assignee?.avatarUrls['24x24'] ?? issue.fields.assignee?.avatarUrls['48x48'] ?? null,
    activeIssues: [],
    updatedYesterdayIssues: [],
    totalIssueCount: 0,
    doneCount: 0,
    activeCount: 0,
    blockedCount: 0,
    staleCount: 0,
    completionPercent: 0,
    plannedIssueKeys: [],
    plannedWorkedIssueKeys: [],
    missedPlanIssueKeys: [],
    unplannedWorkedIssueKeys: [],
  };
}

function comparePersonWalkIssues(firstIssueData: PersonWalkIssueData, secondIssueData: PersonWalkIssueData): number {
  if (firstIssueData.isBlocked !== secondIssueData.isBlocked) {
    return Number(secondIssueData.isBlocked) - Number(firstIssueData.isBlocked);
  }
  if (firstIssueData.ageDays !== secondIssueData.ageDays) {
    return secondIssueData.ageDays - firstIssueData.ageDays;
  }
  return firstIssueData.issue.key.localeCompare(secondIssueData.issue.key);
}

function buildPersonWalkAssigneeCards(
  issues: JiraIssue[],
  plannedIssueKeysByPerson: Record<string, string[]>,
  previousPlannedIssueKeysByPerson: Record<string, string[]>,
): PersonWalkAssigneeCardData[] {
  const yesterdayIsoDate = readYesterdayIsoDate();
  const assigneeCards = new Map<string, PersonWalkAssigneeCardData>();

  for (const issue of issues) {
    const assigneeName = issue.fields.assignee?.displayName ?? 'Unassigned';
    const personWalkIssue = createPersonWalkIssueData(issue);
    const assigneeCard = assigneeCards.get(assigneeName) ?? createEmptyPersonWalkAssigneeCard(issue);

    assigneeCard.totalIssueCount += 1;
    if (personWalkIssue.isBlocked) {
      assigneeCard.blockedCount += 1;
    }
    if (personWalkIssue.ageClass === 'old' && issue.fields.status.statusCategory.key !== 'done') {
      assigneeCard.staleCount += 1;
    }
    if (issue.fields.updated.slice(0, 10) === yesterdayIsoDate) {
      assigneeCard.updatedYesterdayIssues.push(personWalkIssue);
    }
    if (issue.fields.status.statusCategory.key === 'done') {
      assigneeCard.doneCount += 1;
    } else {
      assigneeCard.activeCount += 1;
      assigneeCard.activeIssues.push(personWalkIssue);
    }

    assigneeCards.set(assigneeName, assigneeCard);
  }

  return [...assigneeCards.values()]
    .map((assigneeCard) => {
      const updatedYesterdayIssueKeys = new Set(
        assigneeCard.updatedYesterdayIssues.map((issueData) => issueData.issue.key),
      );
      const previousPlannedIssueKeys = previousPlannedIssueKeysByPerson[assigneeCard.assigneeName] ?? [];
      return {
        ...assigneeCard,
        activeIssues: [...assigneeCard.activeIssues].sort(comparePersonWalkIssues),
        updatedYesterdayIssues: [...assigneeCard.updatedYesterdayIssues].sort(comparePersonWalkIssues),
        completionPercent:
          assigneeCard.totalIssueCount === 0
            ? 0
            : Math.round((assigneeCard.doneCount / assigneeCard.totalIssueCount) * 100),
        plannedIssueKeys: plannedIssueKeysByPerson[assigneeCard.assigneeName] ?? [],
        plannedWorkedIssueKeys: previousPlannedIssueKeys.filter((issueKey) => updatedYesterdayIssueKeys.has(issueKey)),
        missedPlanIssueKeys: previousPlannedIssueKeys.filter((issueKey) => !updatedYesterdayIssueKeys.has(issueKey)),
        unplannedWorkedIssueKeys: assigneeCard.updatedYesterdayIssues
          .map((issueData) => issueData.issue.key)
          .filter((issueKey) => !previousPlannedIssueKeys.includes(issueKey)),
      };
    })
    .filter(
      (assigneeCard) =>
        assigneeCard.activeCount > 0 ||
        assigneeCard.updatedYesterdayIssues.length > 0 ||
        assigneeCard.missedPlanIssueKeys.length > 0,
    )
    .sort(
      (firstCard, secondCard) =>
        secondCard.activeCount - firstCard.activeCount ||
        secondCard.updatedYesterdayIssues.length - firstCard.updatedYesterdayIssues.length ||
        firstCard.assigneeName.localeCompare(secondCard.assigneeName),
    );
}

function buildPersonWalkSnapshotStats(personWalkAssigneeCards: PersonWalkAssigneeCardData[]): PersonWalkSnapshotStats {
  return personWalkAssigneeCards.reduce<PersonWalkSnapshotStats>(
    (currentStats, assigneeCard) => ({
      activeAssigneeCount: currentStats.activeAssigneeCount + (assigneeCard.activeCount > 0 ? 1 : 0),
      activeIssueCount: currentStats.activeIssueCount + assigneeCard.activeCount,
      followThroughCount: currentStats.followThroughCount + assigneeCard.updatedYesterdayIssues.length,
      blockedCount: currentStats.blockedCount + assigneeCard.blockedCount,
    }),
    {
      activeAssigneeCount: 0,
      activeIssueCount: 0,
      followThroughCount: 0,
      blockedCount: 0,
    },
  );
}

function readAvatarFallbackText(assigneeName: string): string {
  return assigneeName
    .split(/[\s,]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((namePart) => namePart[0]?.toUpperCase() ?? '')
    .join('');
}

function readPersonWalkAgeBadgeClassName(ageClass: PersonWalkIssueData['ageClass']): string {
  if (ageClass === 'old') {
    return styles.personWalkAgeBadgeOld;
  }
  if (ageClass === 'warn') {
    return styles.personWalkAgeBadgeWarn;
  }
  return styles.personWalkAgeBadgeFresh;
}

function readPersonWalkStatusBadgeClassName(statusCategoryKey: string): string {
  if (statusCategoryKey === 'done') {
    return styles.personWalkStatusBadgeDone;
  }
  if (statusCategoryKey === 'indeterminate') {
    return styles.personWalkStatusBadgeProgress;
  }
  return styles.personWalkStatusBadgeTodo;
}

function readScopeLabel(scopeMode: StandupScopeMode): string {
  return scopeMode === 'roster' ? STANDUP_SCOPE_ROSTER_LABEL : STANDUP_SCOPE_SPRINT_LABEL;
}

function PersonWalkIssueRow({
  issueData,
  personName,
  isPlannedToday,
  onTogglePlan,
}: {
  issueData: PersonWalkIssueData;
  personName: string;
  isPlannedToday: boolean;
  onTogglePlan: (personName: string, issueKey: string) => void;
}) {
  return (
    <li className={isPlannedToday ? `${styles.personWalkIssueRow} ${styles.personWalkIssueRowPlanned}` : styles.personWalkIssueRow}>
      <div className={styles.personWalkIssueRowHeader}>
        <div className={styles.personWalkIssueKeyRow}>
          <span className={styles.issueKeyLink}>{issueData.issue.key}</span>
          <div className={styles.personWalkIssueIconRow}>
            <img
              alt={issueData.issue.fields.issuetype.name}
              className={styles.personWalkIssueIcon}
              src={issueData.issue.fields.issuetype.iconUrl}
            />
            {issueData.issue.fields.priority ? (
              <img
                alt={issueData.issue.fields.priority.name}
                className={styles.personWalkIssueIcon}
                src={issueData.issue.fields.priority.iconUrl}
              />
            ) : null}
          </div>
        </div>
        <div className={styles.personWalkIssueBadgeRow}>
          <button
            aria-label={`Plan ${issueData.issue.key} for ${personName}`}
            aria-pressed={isPlannedToday}
            className={isPlannedToday ? styles.planIssueButtonActive : styles.planIssueButton}
            onClick={() => onTogglePlan(personName, issueData.issue.key)}
            type="button"
          >
            {isPlannedToday ? 'Planned' : 'Plan'}
          </button>
          <span
            className={`${styles.statusBadge} ${readPersonWalkStatusBadgeClassName(
              issueData.issue.fields.status.statusCategory.key,
            )}`}
          >
            {issueData.issue.fields.status.name}
          </span>
          <span className={`${styles.statusBadge} ${readPersonWalkAgeBadgeClassName(issueData.ageClass)}`}>
            {issueData.ageDays}d old
          </span>
          {issueData.isBlocked ? <span className={styles.blockedBadge}>Blocked</span> : null}
        </div>
      </div>
      <p className={styles.personWalkIssueSummary}>{issueData.issue.fields.summary}</p>
    </li>
  );
}

/** Renders the Team Dashboard standup timer plus Sprint and Roster board-walk and person-walk workflows. */
export default function StandupTab({
  issues,
  projectKey,
  dashboardScopeMode,
  dashboardTeamProfileId = '',
  timerSecondsRemaining,
  isTimerRunning,
  onStart,
  onStop,
  onReset,
  onTick,
  onRefreshIssues,
}: StandupTabProps) {
  const [expandedIssueKey, setExpandedIssueKey] = useState<string | null>(null);
  const { state, actions } = useSprintStandupState(issues, projectKey, dashboardTeamProfileId);
  const standupIssues = state.scopeMode === 'roster' ? state.scopeIssues : state.scopeIssues.length > 0 ? state.scopeIssues : issues;

  // ── Briefing mode state ──
  const [briefingText,    setBriefingText]    = useState<string>('');
  const [briefingCounts,  setBriefingCounts]  = useState<BriefingCounts | null>(null);
  const [isBriefingBusy,  setIsBriefingBusy]  = useState(false);
  const [briefingError,   setBriefingError]   = useState<string | null>(null);
  const [briefingDaysBack, setBriefingDaysBack] = useState(1);
  const [briefingCopyLabel, setBriefingCopyLabel] = useState(BRIEFING_COPY_DEFAULT_LABEL);

  // Resolve the display name for the current team profile so the briefing header is human-readable.
  const teamProfiles = useSettingsStore((storeState) => storeState.sprintDashboardTeamProfiles);
  const activeTeamName = useMemo(() => {
    const matchingProfile = teamProfiles.find((profile) => profile.id === dashboardTeamProfileId);
    return matchingProfile ? matchingProfile.name : (projectKey || 'Team');
  }, [teamProfiles, dashboardTeamProfileId, projectKey]);

  const handleRunBriefing = useCallback(async () => {
    if (!projectKey) {
      setBriefingError('No project key configured for this team.');
      return;
    }
    setBriefingError(null);
    setBriefingText('');
    setBriefingCounts(null);
    setIsBriefingBusy(true);
    try {
      const response = await fetch('/api/standup/run-adhoc', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ projectKeys: [projectKey], teamName: activeTeamName, daysBack: briefingDaysBack }),
      });
      const result = await response.json() as AdhocBriefingResult;
      if (!result.ok) {
        setBriefingError(result.message || 'Briefing failed.');
      } else {
        setBriefingText(result.briefingText || '');
        setBriefingCounts(result.counts ?? null);
      }
    } catch (fetchError) {
      setBriefingError(fetchError instanceof Error ? fetchError.message : 'Network error.');
    } finally {
      setIsBriefingBusy(false);
    }
  }, [projectKey, activeTeamName, briefingDaysBack]);

  const handleCopyBriefing = useCallback(async () => {
    if (!briefingText) return;
    try {
      await navigator.clipboard.writeText(briefingText);
      setBriefingCopyLabel(BRIEFING_COPY_SUCCESS_LABEL);
      setTimeout(() => setBriefingCopyLabel(BRIEFING_COPY_DEFAULT_LABEL), BRIEFING_COPY_SUCCESS_DURATION_MS);
    } catch {
      setBriefingCopyLabel('Copy failed');
      setTimeout(() => setBriefingCopyLabel(BRIEFING_COPY_DEFAULT_LABEL), BRIEFING_COPY_SUCCESS_DURATION_MS);
    }
  }, [briefingText]);

  useEffect(() => {
    if (!isTimerRunning) {
      return;
    }

    const intervalId = window.setInterval(() => {
      onTick();
    }, 1_000);

    return () => window.clearInterval(intervalId);
  }, [isTimerRunning, onTick]);

  const boardWalkColumns = useMemo(
    () => buildBoardWalkColumns(state.shouldShowDoneColumn),
    [state.shouldShowDoneColumn],
  );
  const boardWalkStats = useMemo(() => buildBoardWalkStats(standupIssues), [standupIssues]);
  const blockedIssues = useMemo(() => buildBlockedIssues(standupIssues), [standupIssues]);
  const personWalkAssigneeCards = useMemo(
    () =>
      buildPersonWalkAssigneeCards(
        standupIssues,
        state.plannedIssueKeysByPerson,
        state.previousPlannedIssueKeysByPerson,
      ),
    [standupIssues, state.plannedIssueKeysByPerson, state.previousPlannedIssueKeysByPerson],
  );
  const personWalkSnapshotStats = useMemo(() => buildPersonWalkSnapshotStats(personWalkAssigneeCards), [personWalkAssigneeCards]);
  const personWalkFollowThroughCards = useMemo(
    () =>
      personWalkAssigneeCards.filter(
        (assigneeCard) =>
          assigneeCard.updatedYesterdayIssues.length > 0 ||
          assigneeCard.missedPlanIssueKeys.length > 0 ||
          assigneeCard.plannedWorkedIssueKeys.length > 0,
      ),
    [personWalkAssigneeCards],
  );

  const timerDisplayClassName =
    timerSecondsRemaining <= TIMER_DANGER_SECONDS
      ? `${styles.timerDisplay} ${styles.timerDanger}`
      : timerSecondsRemaining <= TIMER_WARNING_SECONDS
        ? `${styles.timerDisplay} ${styles.timerWarning}`
        : styles.timerDisplay;

  return (
    <div className={styles.standupLayout}>
      <div className={styles.timerBlock}>
        <span className={timerDisplayClassName}>{formatTimerDisplay(timerSecondsRemaining)}</span>
        <div className={styles.timerControls}>
          {isTimerRunning ? (
            <button className={styles.timerButton} onClick={onStop} type="button">
              Stop
            </button>
          ) : (
            <button className={styles.timerButton} onClick={onStart} type="button">
              Start
            </button>
          )}
          <button className={styles.timerButton} onClick={onReset} type="button">
            Reset
          </button>
        </div>
      </div>

      <div className={styles.standupToolbar}>
        <div className={styles.standupToggleGroup} aria-label="Standup mode" role="group">
          {renderToggleButton(state.standupMode, 'boardwalk', 'Board Walk', actions.setStandupMode)}
          {renderToggleButton(state.standupMode, 'personwalk', 'Person Walk', actions.setStandupMode)}
          {renderToggleButton(state.standupMode, 'dsu-board', 'DSU Board', actions.setStandupMode)}
          {renderToggleButton(state.standupMode, 'briefing', '📋 Briefing', actions.setStandupMode)}
        </div>
        {state.standupMode !== 'dsu-board' && state.standupMode !== 'briefing' ? (
          <div className={styles.standupToggleGroup} aria-label="Standup scope" role="group">
            {renderToggleButton(state.scopeMode, 'sprint', DASHBOARD_SCOPE_LABELS[dashboardScopeMode], actions.setScopeMode)}
            {renderToggleButton(state.scopeMode, 'roster', STANDUP_SCOPE_ROSTER_LABEL, actions.setScopeMode)}
          </div>
        ) : null}
      </div>
      {state.scopeMode === 'roster' && state.activeRosterTeamName ? (
        <p className={styles.personWalkMeta}>Active roster team: {state.activeRosterTeamName}</p>
      ) : null}
      {state.scopeMode === 'roster' && dashboardScopeMode !== 'sprint' ? (
        <p className={styles.standupStatusBanner}>
          Roster loads all assignee activity — not filtered by {DASHBOARD_SCOPE_LABELS[dashboardScopeMode]}
        </p>
      ) : null}

      {state.standupMode === 'briefing' ? (
        <div className={styles.personWalkShell}>
          <div className={styles.personWalkSectionHeader}>
            <div>
              <h3 className={styles.personWalkSectionTitle}>Pre-Standup Briefing</h3>
              <p className={styles.personWalkMeta}>
                Scans Jira activity for <strong>{activeTeamName}</strong> ({projectKey}) and buckets it into
                Status Changes, Blockers, Defects, Risks, and Completions.
              </p>
            </div>
            <div className={styles.personWalkActionRow}>
              <label className={styles.personWalkMeta} htmlFor="briefing-days-back">
                Look back&nbsp;
                <select
                  id="briefing-days-back"
                  value={briefingDaysBack}
                  onChange={(changeEvent) => setBriefingDaysBack(Number(changeEvent.target.value))}
                  style={{ marginLeft: '4px' }}
                >
                  {BRIEFING_DAYS_OPTIONS.map((dayCount) => (
                    <option key={dayCount} value={dayCount}>{dayCount} {dayCount === 1 ? 'day' : 'days'}</option>
                  ))}
                </select>
              </label>
              <button
                className={styles.secondaryButton}
                disabled={isBriefingBusy || !projectKey}
                onClick={() => void handleRunBriefing()}
                type="button"
              >
                {isBriefingBusy ? 'Running…' : 'Run Briefing'}
              </button>
              {briefingText ? (
                <button className={styles.secondaryButton} onClick={() => void handleCopyBriefing()} type="button">
                  {briefingCopyLabel}
                </button>
              ) : null}
            </div>
          </div>

          {briefingError ? <p className={styles.standupStatusBanner}>{briefingError}</p> : null}

          {briefingCounts ? (
            <div className={styles.personWalkSnapshotBar}>
              <div className={styles.personWalkSnapshotCard}>
                <span className={styles.personWalkSnapshotValue}>{briefingCounts.statusChanges}</span>
                <span className={styles.personWalkSnapshotLabel}>Status Changes</span>
              </div>
              <div className={styles.personWalkSnapshotCard}>
                <span className={styles.personWalkSnapshotValue}>{briefingCounts.blockers}</span>
                <span className={styles.personWalkSnapshotLabel}>Blockers</span>
              </div>
              <div className={styles.personWalkSnapshotCard}>
                <span className={styles.personWalkSnapshotValue}>{briefingCounts.defects}</span>
                <span className={styles.personWalkSnapshotLabel}>Defects</span>
              </div>
              <div className={styles.personWalkSnapshotCard}>
                <span className={styles.personWalkSnapshotValue}>{briefingCounts.risks}</span>
                <span className={styles.personWalkSnapshotLabel}>Risks</span>
              </div>
              <div className={styles.personWalkSnapshotCard}>
                <span className={styles.personWalkSnapshotValue}>{briefingCounts.completions}</span>
                <span className={styles.personWalkSnapshotLabel}>Completions</span>
              </div>
            </div>
          ) : null}

          {briefingText ? (
            <textarea
              aria-label="Pre-standup briefing text"
              readOnly
              style={{
                width:       '100%',
                minHeight:   '420px',
                marginTop:   '12px',
                padding:     '12px',
                fontFamily:  'monospace',
                fontSize:    '13px',
                lineHeight:  '1.5',
                resize:      'vertical',
                boxSizing:   'border-box',
                background:  'var(--color-bg-secondary, #1e1e2e)',
                color:       'var(--color-text-primary, #cdd6f4)',
                border:      '1px solid var(--color-border, #45475a)',
                borderRadius: '6px',
              }}
              value={briefingText}
            />
          ) : !isBriefingBusy ? (
            <p className={styles.personWalkMeta} style={{ marginTop: '16px' }}>
              Click &ldquo;Run Briefing&rdquo; to scan Jira and generate today&apos;s pre-standup summary.
            </p>
          ) : null}
        </div>
      ) : state.standupMode === 'dsu-board' ? (
        <DsuBoardView key={projectKey || 'standalone'} projectKey={projectKey} />
      ) : state.standupMode === 'personwalk' ? (
        <div className={styles.personWalkShell}>
          {state.scopeLoadErrorMessage ? <p className={styles.standupStatusBanner}>{state.scopeLoadErrorMessage}</p> : null}
          {state.personWalkErrorMessage && <p className={styles.errorText}>{state.personWalkErrorMessage}</p>}
          {state.isLoadingScopeIssues && <p className={styles.personWalkMeta}>Loading {readScopeLabel(state.scopeMode).toLowerCase()} issues…</p>}
          {state.isLoadingPersonWalk && <p className={styles.personWalkMeta}>Loading your activity…</p>}
          <div className={styles.personWalkSnapshotBar}>
            <div className={styles.personWalkSnapshotCard}>
              <span className={styles.personWalkSnapshotValue}>{personWalkSnapshotStats.activeAssigneeCount}</span>
              <span className={styles.personWalkSnapshotLabel}>People in walk</span>
            </div>
            <div className={styles.personWalkSnapshotCard}>
              <span className={styles.personWalkSnapshotValue}>{personWalkSnapshotStats.activeIssueCount}</span>
              <span className={styles.personWalkSnapshotLabel}>{readScopeLabel(state.scopeMode)} items</span>
            </div>
            <div className={styles.personWalkSnapshotCard}>
              <span className={styles.personWalkSnapshotValue}>{personWalkSnapshotStats.followThroughCount}</span>
              <span className={styles.personWalkSnapshotLabel}>Yesterday follow-through</span>
            </div>
            <div className={styles.personWalkSnapshotCard}>
              <span className={styles.personWalkSnapshotValue}>{personWalkSnapshotStats.blockedCount}</span>
              <span className={styles.personWalkSnapshotLabel}>Blockers in walk</span>
            </div>
          </div>

          <section className={styles.personWalkFollowThroughSection}>
            <div className={styles.personWalkSectionHeader}>
              <div>
                <h3 className={styles.personWalkSectionTitle}>Yesterday&apos;s Follow-Through</h3>
                <p className={styles.personWalkSubtitle}>
                  Compare yesterday&apos;s clicked plan against what Jira shows actually moved.
                </p>
              </div>
              <div className={styles.personWalkActionRow}>
                <button className={styles.secondaryButton} onClick={() => void actions.refreshPersonWalk()} type="button">
                  Refresh
                </button>
                <button className={styles.secondaryButton} onClick={() => void actions.copyPersonWalk()} type="button">
                  📋 Copy Summary
                </button>
              </div>
            </div>
            {personWalkFollowThroughCards.length === 0 ? (
              <p className={styles.personWalkMeta}>{PERSON_WALK_YESTERDAY_EMPTY_MESSAGE}</p>
            ) : (
              <div className={styles.personWalkFollowThroughGrid}>
                {personWalkFollowThroughCards.map((assigneeCard) => (
                  <div className={styles.personWalkFollowThroughCard} key={assigneeCard.assigneeName}>
                    <div className={styles.personWalkFollowThroughHeader}>
                      <div className={styles.personWalkIdentity}>
                        {assigneeCard.assigneeAvatarUrl ? (
                          <img
                            alt={`${assigneeCard.assigneeName} avatar`}
                            className={styles.personWalkAvatar}
                            src={assigneeCard.assigneeAvatarUrl}
                          />
                        ) : (
                          <span className={styles.personWalkAvatarFallback}>
                            {readAvatarFallbackText(assigneeCard.assigneeName)}
                          </span>
                        )}
                        <div>
                          <h4 className={styles.personWalkFollowThroughName}>{assigneeCard.assigneeName}</h4>
                          <p className={styles.personWalkMeta}>
                            {assigneeCard.updatedYesterdayIssues.length} update
                            {assigneeCard.updatedYesterdayIssues.length === 1 ? '' : 's'}
                          </p>
                        </div>
                      </div>
                      <span className={styles.columnCountBadge}>{assigneeCard.updatedYesterdayIssues.length}</span>
                    </div>
                    <div className={styles.personWalkFollowThroughStatusRow}>
                      {assigneeCard.plannedWorkedIssueKeys.length > 0 ? (
                        <span className={styles.personWalkFollowThroughStatusSuccess}>{PLAN_HELD_LABEL}</span>
                      ) : null}
                      {assigneeCard.missedPlanIssueKeys.length > 0 || assigneeCard.unplannedWorkedIssueKeys.length > 0 ? (
                        <span className={styles.personWalkFollowThroughStatusWarn}>{PLAN_SHIFTED_LABEL}</span>
                      ) : null}
                    </div>
                    <div className={styles.personWalkFollowThroughGroup}>
                      {assigneeCard.plannedWorkedIssueKeys.length > 0 ? (
                        <>
                          <p className={styles.personWalkMeta}>Planned and worked</p>
                          <div className={styles.personWalkFollowThroughChipRow}>
                            {assigneeCard.plannedWorkedIssueKeys.map((issueKey) => (
                              <span className={styles.personWalkFollowThroughChip} key={issueKey}>
                                {issueKey}
                              </span>
                            ))}
                          </div>
                        </>
                      ) : null}
                      {assigneeCard.missedPlanIssueKeys.length > 0 ? (
                        <>
                          <p className={styles.personWalkMeta}>Planned but did not move</p>
                          <div className={styles.personWalkFollowThroughChipRow}>
                            {assigneeCard.missedPlanIssueKeys.map((issueKey) => (
                              <span className={styles.personWalkFollowThroughChipMuted} key={issueKey}>
                                {issueKey}
                              </span>
                            ))}
                          </div>
                        </>
                      ) : null}
                      {assigneeCard.unplannedWorkedIssueKeys.length > 0 ? (
                        <>
                          <p className={styles.personWalkMeta}>Work that shifted in</p>
                          <div className={styles.personWalkFollowThroughChipRow}>
                            {assigneeCard.unplannedWorkedIssueKeys.map((issueKey) => (
                              <span className={styles.personWalkFollowThroughChipWarn} key={issueKey}>
                                {issueKey}
                              </span>
                            ))}
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {personWalkAssigneeCards.length === 0 ? (
            <p className={styles.emptyStandupText}>{PERSON_WALK_SCOPE_EMPTY_MESSAGE}</p>
          ) : (
            <div className={styles.personWalkGrid}>
              {personWalkAssigneeCards.map((assigneeCard) => (
                <section className={styles.personWalkCard} key={assigneeCard.assigneeName}>
                  <div className={styles.personWalkHeader}>
                    <div className={styles.personWalkIdentity}>
                      {assigneeCard.assigneeAvatarUrl ? (
                        <img
                          alt={`${assigneeCard.assigneeName} avatar`}
                          className={styles.personWalkAvatar}
                          src={assigneeCard.assigneeAvatarUrl}
                        />
                      ) : (
                        <span className={styles.personWalkAvatarFallback}>
                          {readAvatarFallbackText(assigneeCard.assigneeName)}
                        </span>
                      )}
                      <div>
                        <h3 className={styles.personWalkTitle}>{assigneeCard.assigneeName}</h3>
                        <p className={styles.personWalkSubtitle}>
                          {assigneeCard.activeCount} active &middot; {assigneeCard.doneCount} done &middot; {assigneeCard.totalIssueCount}{' '}
                          in {readScopeLabel(state.scopeMode).toLowerCase()} scope
                        </p>
                      </div>
                    </div>
                    <div className={styles.personWalkMetricBadgeRow}>
                      {assigneeCard.blockedCount > 0 ? (
                        <span className={styles.personWalkMetricBadgeDanger}>{assigneeCard.blockedCount} blocked</span>
                      ) : null}
                      {assigneeCard.staleCount > 0 ? (
                        <span className={styles.personWalkMetricBadgeWarn}>{assigneeCard.staleCount} stale</span>
                      ) : null}
                    </div>
                  </div>
                  <div className={styles.personWalkProgressHeader}>
                    <span className={styles.personWalkMeta}>Completion in current scope</span>
                    <span className={styles.personWalkProgressValue}>{assigneeCard.completionPercent}%</span>
                  </div>
                  <div className={styles.personWalkProgressTrack}>
                    <div className={styles.personWalkProgressFill} style={{ width: `${assigneeCard.completionPercent}%` }} />
                  </div>

                  <div className={styles.personWalkSection}>
                    <div className={styles.personWalkSectionHeader}>
                      <h4 className={styles.personWalkSectionTitle}>Today Plan</h4>
                      <span className={styles.columnCountBadge}>{assigneeCard.plannedIssueKeys.length}</span>
                    </div>
                    {assigneeCard.plannedIssueKeys.length === 0 ? (
                      <p className={styles.personWalkMeta}>{PERSON_WALK_PLAN_EMPTY_MESSAGE}</p>
                    ) : (
                      <div className={styles.personWalkFollowThroughChipRow}>
                        {assigneeCard.plannedIssueKeys.map((issueKey) => (
                          <span className={styles.personWalkFollowThroughChip} key={issueKey}>
                            {issueKey}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className={styles.personWalkSection}>
                    <div className={styles.personWalkSectionHeader}>
                      <h4 className={styles.personWalkSectionTitle}>Yesterday</h4>
                      <span className={styles.columnCountBadge}>{assigneeCard.updatedYesterdayIssues.length}</span>
                    </div>
                    {assigneeCard.updatedYesterdayIssues.length === 0 ? (
                      <p className={styles.personWalkMeta}>{PERSON_WALK_YESTERDAY_EMPTY_MESSAGE}</p>
                    ) : (
                      <ul className={styles.personWalkIssueList}>
                        {assigneeCard.updatedYesterdayIssues.map((issueData) => (
                          <PersonWalkIssueRow
                            issueData={issueData}
                            isPlannedToday={assigneeCard.plannedIssueKeys.includes(issueData.issue.key)}
                            key={issueData.issue.key}
                            onTogglePlan={actions.togglePlannedIssue}
                            personName={assigneeCard.assigneeName}
                          />
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className={styles.personWalkSection}>
                    <div className={styles.personWalkSectionHeader}>
                      <h4 className={styles.personWalkSectionTitle}>{readScopeLabel(state.scopeMode)} Items</h4>
                      <span className={styles.columnCountBadge}>{assigneeCard.activeIssues.length}</span>
                    </div>
                    {assigneeCard.activeIssues.length === 0 ? (
                      <p className={styles.personWalkMeta}>{PERSON_WALK_ACTIVE_EMPTY_MESSAGE}</p>
                    ) : (
                      <ul className={styles.personWalkIssueList}>
                        {assigneeCard.activeIssues.map((issueData) => (
                          <PersonWalkIssueRow
                            issueData={issueData}
                            isPlannedToday={assigneeCard.plannedIssueKeys.includes(issueData.issue.key)}
                            key={issueData.issue.key}
                            onTogglePlan={actions.togglePlannedIssue}
                            personName={assigneeCard.assigneeName}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}

          <section className={styles.personWalkComposerShell}>
            <div className={styles.personWalkSectionHeader}>
              <div>
                <h3 className={styles.personWalkSectionTitle}>📋 Standup Draft</h3>
                <p className={styles.personWalkSubtitle}>Edit the current user’s standup note for copy or Jira posting.</p>
              </div>
            </div>
            <div className={styles.personWalkColumns}>
              <div className={styles.personWalkEditorColumn}>
                <label className={styles.personWalkFieldLabel}>
                  <span className={styles.personWalkFieldTitle}>✅ Yesterday</span>
                  <textarea
                    className={styles.personWalkTextarea}
                    rows={5}
                    value={state.personWalkDraft.yesterday}
                    onChange={(event) => actions.setPersonWalkDraftField('yesterday', event.target.value)}
                  />
                </label>
                <label className={styles.personWalkFieldLabel}>
                  <span className={styles.personWalkFieldTitle}>🎯 Today</span>
                  <textarea
                    className={styles.personWalkTextarea}
                    rows={5}
                    value={state.personWalkDraft.today}
                    onChange={(event) => actions.setPersonWalkDraftField('today', event.target.value)}
                  />
                </label>
                <label className={styles.personWalkFieldLabel}>
                  <span className={styles.personWalkFieldTitle}>🚧 Blockers</span>
                  <textarea
                    className={styles.personWalkTextarea}
                    placeholder="None"
                    rows={3}
                    value={state.personWalkDraft.blockers}
                    onChange={(event) => actions.setPersonWalkDraftField('blockers', event.target.value)}
                  />
                </label>
              </div>
              <div className={styles.personWalkPreviewColumn}>
                <div className={styles.personWalkPreviewPanel}>
                  <h3 className={styles.personWalkPreviewTitle}>Standup Preview</h3>
                  <div className={styles.personWalkPreviewStack}>
                    <section className={`${styles.personWalkPreviewSection} ${styles.personWalkPreviewSectionYesterday}`}>
                      <h4 className={styles.personWalkPreviewSectionTitle}>Yesterday</h4>
                      <pre className={styles.personWalkPreviewText}>{state.personWalkDraft.yesterday}</pre>
                    </section>
                    <section className={`${styles.personWalkPreviewSection} ${styles.personWalkPreviewSectionToday}`}>
                      <h4 className={styles.personWalkPreviewSectionTitle}>Today</h4>
                      <pre className={styles.personWalkPreviewText}>{state.personWalkDraft.today}</pre>
                    </section>
                    <section className={`${styles.personWalkPreviewSection} ${styles.personWalkPreviewSectionBlockers}`}>
                      <h4 className={styles.personWalkPreviewSectionTitle}>Blockers</h4>
                      <pre className={styles.personWalkPreviewText}>
                        {state.personWalkDraft.blockers.trim() ? state.personWalkDraft.blockers : 'None'}
                      </pre>
                    </section>
                  </div>
                  <pre className={styles.personWalkPostBodyPreview}>{formatPersonWalkText(state.personWalkDraft)}</pre>
                </div>
                <div className={styles.personWalkActionRow}>
                  <input
                    className={styles.personWalkPostInput}
                    placeholder="Issue key (e.g. PROJ-123)"
                    value={state.personWalkPostKey}
                    onChange={(event) => actions.setPersonWalkPostKey(event.target.value)}
                  />
                  <button className={styles.secondaryButton} onClick={() => void actions.postPersonWalkComment()} type="button">
                    Post to Jira
                  </button>
                </div>
                <p className={styles.personWalkMeta}>
                  {state.personWalkCopyStatusMessage ??
                    renderPersonWalkStatus(
                      state.personWalkPostStatus,
                      state.personWalkPostErrorMessage,
                      state.personWalkPostKey,
                    )}
                </p>
              </div>
            </div>
          </section>
        </div>
      ) : (
        <>
          {state.scopeLoadErrorMessage ? <p className={styles.standupStatusBanner}>{state.scopeLoadErrorMessage}</p> : null}
          {state.isLoadingScopeIssues ? (
            <p className={styles.personWalkMeta}>Loading {readScopeLabel(state.scopeMode).toLowerCase()} issues…</p>
          ) : null}
          <div className={styles.boardWalkToolbar}>
            <label className={styles.standupCheckbox}>
              <input
                checked={state.shouldShowDoneColumn}
                onChange={(event) => actions.setShouldShowDoneColumn(event.target.checked)}
                type="checkbox"
              />
              Show Done column
            </label>
          </div>

          <div className={styles.flowStatsBar}>
            <div className={styles.flowStatCard}>
              <span className={styles.flowStatValue}>{boardWalkStats.workInProgressCount}</span>
              <span className={styles.flowStatLabel}>WIP</span>
            </div>
            <div className={styles.flowStatCard}>
              <span className={styles.flowStatValue}>{boardWalkStats.staleCount}</span>
              <span className={styles.flowStatLabel}>Stale</span>
            </div>
            <div className={styles.flowStatCard}>
              <span className={styles.flowStatValue}>{boardWalkStats.blockedCount}</span>
              <span className={styles.flowStatLabel}>Blocked</span>
            </div>
            <div className={styles.flowStatCard}>
              <span className={styles.flowStatValue}>{boardWalkStats.averageAgeDays}d</span>
              <span className={styles.flowStatLabel}>Avg Age</span>
            </div>
          </div>

          <div className={styles.boardWalk}>
            {boardWalkColumns.map((column) => {
              const categoryFilters = state.boardwalkStatusFilters[column.categoryKey] ?? {};
              const visibleIssues = buildVisibleBoardWalkIssues(standupIssues, column.categoryKey, categoryFilters);
              const statusNames = Object.keys(categoryFilters);

              return (
                <section className={styles.boardColumn} key={column.categoryKey}>
                  <div className={styles.boardColumnHeader}>
                    <h3 className={styles.boardColumnTitle}>{column.label}</h3>
                    <span className={styles.columnCountBadge}>{visibleIssues.length}</span>
                  </div>
                  {statusNames.length > 1 ? (
                    <div className={styles.statusFilterGroup}>
                      {statusNames.map((statusName) => {
                        const isActive = categoryFilters[statusName] !== false;
                        return (
                          <button
                            className={isActive ? styles.statusFilterChip : styles.statusFilterChipMuted}
                            key={statusName}
                            onClick={() => actions.toggleBoardwalkStatusFilter(column.categoryKey, statusName)}
                            type="button"
                          >
                            {statusName}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {visibleIssues.length === 0 ? (
                    <p className={styles.emptyColumnText}>No issues match the active filters</p>
                  ) : (
                    visibleIssues.map((issue) => {
                      const ageDays = calculateIssueAgeDays(issue);
                      const ageClass = classifyIssueAge(ageDays);
                      const isExpanded = expandedIssueKey === issue.key;
                      const issueCardClassName =
                        ageClass === 'old'
                          ? `${styles.boardIssueCard} ${styles.boardIssueCardStale}`
                          : ageClass === 'warn'
                            ? `${styles.boardIssueCard} ${styles.boardIssueCardWarn}`
                            : `${styles.boardIssueCard} ${styles.boardIssueCardFresh}`;

                      return (
                        <div className={issueCardClassName} key={issue.key}>
                          <button
                            className={styles.boardWalkCardButton}
                            onClick={() => setExpandedIssueKey(isExpanded ? null : issue.key)}
                            type="button"
                          >
                            <div className={styles.standupIssueHeader}>
                              <span className={styles.issueKeyLink}>
                                {issue.key}
                                {hasBlockingLink(issue) ? ' 🔴' : ''}
                              </span>
                            </div>
                            <p className={styles.standupIssueSummary}>{issue.fields.summary.slice(0, 80)}</p>
                            <div className={styles.standupIssueMetaRow}>
                              <span className={styles.statusBadge}>{ageDays}d</span>
                              <span className={styles.personWalkMeta}>
                                👤 {(issue.fields.assignee?.displayName ?? 'Unassigned').split(' ')[0]}
                              </span>
                              <span className={styles.statusBadge}>{issue.fields.status.name}</span>
                            </div>
                          </button>
                          {isExpanded ? <IssueDetailPanel isEmbedded issue={issue} onIssueUpdated={onRefreshIssues} /> : null}
                        </div>
                      );
                    })
                  )}
                </section>
              );
            })}
          </div>

          {blockedIssues.length > 0 ? (
            <div className={styles.blockerPanel}>
              <h3 className={styles.blockerPanelTitle}>🔴 Blockers ({blockedIssues.length})</h3>
              <div className={styles.blockerList}>
                {blockedIssues.map((issue) => (
                  <div className={styles.blockerRow} key={issue.key}>
                    <span className={styles.blockerKey}>{issue.key}</span>
                    <span className={styles.blockerSummary}>{issue.fields.summary.slice(0, 60)}</span>
                    <span className={styles.blockerAssignee}>👤 {issue.fields.assignee?.displayName ?? 'Unassigned'}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
