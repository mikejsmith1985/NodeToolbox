// ArtView.tsx — Tabbed ART (Agile Release Train) view for multi-team PI reporting and planning dashboards.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import IssueDetailPanel from '../../components/IssueDetailPanel/index.tsx';
import { jiraGet, jiraPost } from '../../services/jiraApi.ts';
import {
  createConfluenceDatabase,
  loadSharedArtWorkspace,
  saveSharedArtWorkspace,
} from '../../services/confluenceApi.ts';
import { PrimaryTabs } from '../../components/PrimaryTabs/PrimaryTabs.tsx';
import { useToast } from '../../components/Toast/ToastContext.ts';
import JiraBoardPicker from '../../components/JiraBoardPicker/index.tsx';
import JiraFieldPicker from '../../components/JiraFieldPicker/index.tsx';
import JiraProjectPicker from '../../components/JiraProjectPicker/index.tsx';
import BlueprintTab from './BlueprintTab.tsx';
import DependenciesTab from './DependenciesTab.tsx';
import PiReviewTab from './PiReviewTab.tsx';
import { formatFeatureProjectKeysInput, parseFeatureProjectKeysInput } from './artFeatureScopeSettings.ts';
import type { ArtTab, ArtTeam, ArtBoardPrepIssue, PiProgressStats } from './hooks/useArtData.ts';
import { useArtData } from './hooks/useArtData.ts';
import type { ImpedimentReason, ImpedimentStaleTier } from './hooks/artHelpers.ts';
import {
  classifyImpedimentStaleness,
  computeDaysSinceUpdate,
  computeMonthlyJiraStats,
  detectImpedimentReasons,
  generateMonthlyAccomplishedText,
  isImpediment,
} from './hooks/artHelpers.ts';
import type { JiraIssue } from '../../types/jira.ts';
import styles from './ArtView.module.css';

// ── Constants ──

const ART_TAB_DEFINITIONS: { key: ArtTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'impediments', label: 'Impediments' },
  { key: 'predictability', label: 'Predictability' },
  { key: 'releases', label: 'Releases' },
  { key: 'pireview', label: 'PI Review' },
  { key: 'blueprint', label: 'Blueprint' },
  { key: 'dependencies', label: 'Dependencies' },
  { key: 'boardprep', label: 'Board Prep' },
  { key: 'sos', label: 'SoS' },
  { key: 'monthly', label: 'Monthly Report' },
  { key: 'settings', label: 'Settings' },
];

// ── Main ArtView component ──

/** Main ART View with 11 tabs for tracking multi-team PI health across the Agile Release Train. */
export default function ArtView() {
  const { state, actions } = useArtData();
  const [teamProjectKeyFilter, setTeamProjectKeyFilter] = useState('');
  const lastOverviewAutoLoadKeyRef = useRef('');
  const { loadAllTeams } = actions;

  const filteredTeams = teamProjectKeyFilter
    ? state.teams.filter((team) =>
        (team.projectKey ?? '').toLowerCase().includes(teamProjectKeyFilter.toLowerCase()),
      )
    : state.teams;

  function handleIssueUpdated() {
    void loadAllTeams();
  }

  useEffect(() => {
    if (state.isLoadingAllTeams || state.teams.length === 0) {
      return;
    }

    const overviewAutoLoadKey = `${state.selectedPiName}|${state.teams.map((team) => `${team.id}:${team.boardId}`).join(',')}`;
    if (lastOverviewAutoLoadKeyRef.current === overviewAutoLoadKey) {
      return;
    }

    lastOverviewAutoLoadKeyRef.current = overviewAutoLoadKey;
    void loadAllTeams();
  }, [loadAllTeams, state.isLoadingAllTeams, state.selectedPiName, state.teams]);

  return (
    <div className={styles.artView}>
      <PiProgressHeader
        availablePiNames={state.availablePiNames}
        isLoadingPiOptions={state.isLoadingPiOptions}
        onPiNameChange={actions.setSelectedPiName}
        onReloadPiOptions={actions.loadPiOptions}
        piName={state.selectedPiName}
        stats={state.piProgressStats}
      />

      <PrimaryTabs
        ariaLabel="ART View tabs"
        idPrefix="art-view"
        tabs={ART_TAB_DEFINITIONS}
        activeTab={state.activeTab}
        onChange={actions.setActiveTab}
      />

      <div className={styles.tabContent}>
        {state.activeTab === 'overview' && (
          <OverviewPanel
            selectedPiName={state.selectedPiName}
            teamProjectKeyFilter={teamProjectKeyFilter}
            teams={filteredTeams}
            isLoadingAllTeams={state.isLoadingAllTeams}
            onRefreshAllTeams={loadAllTeams}
            onLoadTeam={actions.loadTeam}
            onTeamProjectKeyFilterChange={setTeamProjectKeyFilter}
          />
        )}
        {state.activeTab === 'impediments' && (
          <ImpedimentsPanel
            onIssueUpdated={handleIssueUpdated}
            teamProjectKeyFilter={teamProjectKeyFilter}
            teams={filteredTeams}
            onTeamProjectKeyFilterChange={setTeamProjectKeyFilter}
          />
        )}
        {state.activeTab === 'predictability' && (
          <PredictabilityPanel teams={state.teams} />
        )}
        {state.activeTab === 'releases' && (
          <ReleasesPanel teams={state.teams} />
        )}
        {state.activeTab === 'pireview' && (
          <PiReviewTab mode="readout" selectedPiName={state.selectedPiName} teams={state.teams} />
        )}
        {state.activeTab === 'blueprint' && (
          <BlueprintTab teams={state.teams} selectedPiName={state.selectedPiName} />
        )}
        {state.activeTab === 'dependencies' && (
          <DependenciesTab teams={state.teams} selectedPiName={state.selectedPiName} />
        )}
        {state.activeTab === 'boardprep' && (
          <BoardPrepPanel
            teams={state.teams}
            selectedPiName={state.selectedPiName}
            boardPrepIssues={state.boardPrepIssues}
            isLoadingBoardPrep={state.isLoadingBoardPrep}
            boardPrepError={state.boardPrepError}
            boardPrepTeamFilter={state.boardPrepTeamFilter}
            onLoadBoardPrep={actions.loadBoardPrep}
            onSetPiName={actions.setSelectedPiName}
            onSetTeamFilter={actions.setBoardPrepTeamFilter}
          />
        )}
        {state.activeTab === 'sos' && (
          <SosPanel
            teams={state.teams}
            sosExpandedTeams={state.sosExpandedTeams}
            onToggleSosTeam={actions.toggleSosTeam}
          />
        )}
        {state.activeTab === 'monthly' && (
          <MonthlyReportPanel teams={state.teams} />
        )}
        {state.activeTab === 'settings' && (
          <SettingsPanel
            teams={state.teams}
            onAddTeam={actions.addTeam}
            onReloadPiOptions={actions.loadPiOptions}
            onReplaceTeams={actions.replaceTeams}
            onRemoveTeam={actions.removeTeam}
            onSaveTeams={actions.saveTeams}
            onUpdateTeamSosKey={actions.updateTeamSosKey}
            onUpdateTeamPiReviewPageUrl={actions.updateTeamPiReviewPageUrl}
            onUpdateTeamJiraLabel={actions.updateTeamJiraLabel}
          />
        )}
      </div>
    </div>
  );
}

// ── Feature 3: PI Progress Header ──

interface PiProgressHeaderProps {
  piName: string;
  availablePiNames: string[];
  isLoadingPiOptions: boolean;
  onPiNameChange: (piName: string) => void;
  onReloadPiOptions: () => Promise<void>;
  stats: PiProgressStats;
}

/** Renders the PI-level progress bar above the tab bar, showing overall completion across all teams. */
function PiProgressHeader({
  piName,
  availablePiNames,
  isLoadingPiOptions,
  onPiNameChange,
  onReloadPiOptions,
  stats,
}: PiProgressHeaderProps) {
  const displayName = piName.trim() || 'No PI selected';
  const progressBarWidth = `${stats.completionPercent}%`;

  // Read piEndDate from localStorage so the header stays in sync with the Settings panel.
  let piEndDate: string | undefined;
  try {
    const artSettings = JSON.parse(localStorage.getItem('tbxARTSettings') || '{}') as { piEndDate?: string };
    piEndDate = artSettings.piEndDate;
  } catch {
    // localStorage errors are non-fatal.
  }

  const daysRemaining = computeDaysRemainingInPi(piEndDate);
  const daysRemainingLabel = daysRemaining === null
    ? null
    : daysRemaining < 0
      ? 'Overdue'
      : daysRemaining === 0
        ? 'Ends today'
        : `${daysRemaining}d left`;

  const isDaysCritical = daysRemaining !== null && daysRemaining <= PI_DAYS_CRITICAL_THRESHOLD;
  const isDaysWarning = daysRemaining !== null
    && daysRemaining > PI_DAYS_CRITICAL_THRESHOLD
    && daysRemaining <= PI_DAYS_WARNING_THRESHOLD;

  return (
    <div className={styles.piProgressHeader}>
      <span className={styles.piProgressName}>{displayName}</span>
      <select
        aria-label="Program Increment"
        className={styles.textInput}
        id="art-pi-selector"
        onChange={(changeEvent) => onPiNameChange(changeEvent.target.value)}
        value={piName}
      >
        <option value="">
          {isLoadingPiOptions ? 'Loading program increments…' : '— Select Program Increment —'}
        </option>
        {availablePiNames.map((availablePiName) => (
          <option key={availablePiName} value={availablePiName}>{availablePiName}</option>
        ))}
      </select>
      <button
        className={styles.secondaryBtn}
        disabled={isLoadingPiOptions}
        onClick={() => onReloadPiOptions()}
        type="button"
      >
        {isLoadingPiOptions ? 'Loading…' : 'Reload PIs'}
      </button>
      <div className={styles.piProgressBarTrack}>
        <div className={styles.piProgressBarFill} style={{ width: progressBarWidth }} />
      </div>
      <span className={styles.piProgressPercent}>{stats.completionPercent}%</span>
      <span className={styles.piProgressPill + ' ' + styles.piProgressPillDone}>{stats.doneCount} done</span>
      <span className={styles.piProgressPill + ' ' + styles.piProgressPillInProgress}>{stats.inProgressCount} in progress</span>
      <span className={styles.piProgressPill + ' ' + styles.piProgressPillToDo}>{stats.toDoCount} to do</span>
      {/* Days remaining badge — urgency colour shifts from warning (yellow) to critical (red) as PI end approaches */}
      {daysRemainingLabel !== null && (
        <span
          className={[
            styles.piProgressPill,
            isDaysCritical ? styles.piProgressPillCritical : '',
            isDaysWarning ? styles.piProgressPillWarning : '',
          ].join(' ').trim()}
          data-testid="pi-days-remaining"
        >
          {daysRemainingLabel}
        </span>
      )}
    </div>
  );
}

// ── Original panel components ──

interface OverviewPanelProps {
  teams: ArtTeam[];
  selectedPiName: string;
  teamProjectKeyFilter: string;
  isLoadingAllTeams: boolean;
  onRefreshAllTeams: () => Promise<void>;
  onLoadTeam: (teamId: string) => Promise<void>;
  onTeamProjectKeyFilterChange: (value: string) => void;
}

/** Renders the Overview tab with team health cards and a manual refresh control. */
function OverviewPanel({
  teams,
  selectedPiName,
  teamProjectKeyFilter,
  isLoadingAllTeams,
  onRefreshAllTeams,
  onLoadTeam,
  onTeamProjectKeyFilterChange,
}: OverviewPanelProps) {
  return (
    <div className={styles.panel}>
      <div className={styles.overviewControls}>
        <button
          className={styles.primaryBtn}
          onClick={() => onRefreshAllTeams()}
          disabled={isLoadingAllTeams}
        >
          {isLoadingAllTeams ? 'Loading…' : 'Refresh All Teams'}
        </button>
      </div>
      {/* ART-level summary bar — aggregates health across all teams at a glance */}
      <ArtSummaryBar teams={teams} />
      <div className={styles.teamFilterRow}>
        <input
          className={styles.teamFilterInput}
          onChange={(event) => onTeamProjectKeyFilterChange(event.target.value)}
          placeholder="Filter by project key…"
          type="search"
          value={teamProjectKeyFilter}
        />
      </div>
      <div className={styles.teamGrid}>
        {teams.length === 0 && (
          <p className={styles.emptyState}>No teams configured. Add teams in the Settings tab.</p>
        )}
        {teams.map((team) => (
          <TeamCard key={team.id} selectedPiName={selectedPiName} team={team} onLoad={onLoadTeam} />
        ))}
      </div>
    </div>
  );
}

interface TeamCardProps {
  selectedPiName: string;
  team: ArtTeam;
  onLoad: (teamId: string) => Promise<void>;
}

// ── TeamCard health stats ──

/**
 * Parses a YYYY-MM-DD string as a local calendar date (not UTC) and returns
 * the number of days between today and that date.
 * Returns: positive = days remaining, 0 = ends today, negative = overdue.
 * Returns null when the string is absent or malformed.
 */
function computeDaysRemainingInPi(piEndDate: string | undefined): number | null {
  if (!piEndDate || piEndDate.trim() === '') return null;

  const dateParts = piEndDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateParts) return null;

  const [, yearStr, monthStr, dayStr] = dateParts;
  // Use local calendar date to avoid UTC midnight offset issues when comparing against today.
  const endDateLocalMs = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr)).getTime();
  const today = new Date();
  const todayStartMs = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();

  return Math.round((endDateLocalMs - todayStartMs) / 86_400_000);
}

// ── PI urgency thresholds — match the color palette in ArtView.module.css ──

/** Days remaining at or below this value triggers the critical (red) urgency indicator. */
const PI_DAYS_CRITICAL_THRESHOLD = 7;
/** Days remaining at or below this value triggers the warning (yellow) urgency indicator. */
const PI_DAYS_WARNING_THRESHOLD = 14;

/** Shape of the ART-level rollup used by ArtSummaryBar. */
interface ArtSummaryStats {
  teamCount: number;
  loadedTeamCount: number;
  totalIssueCount: number;
  doneCount: number;
  blockedCount: number;
  totalStoryPoints: number;
  doneStoryPoints: number;
  hasAnyStoryPoints: boolean;
  daysRemaining: number | null;
}

/**
 * Aggregates issues from all teams into a single ART-level summary snapshot.
 * Story points are included in the summary only when at least one issue carries an estimate.
 */
function computeArtSummaryStats(teams: ArtTeam[], piEndDate?: string): ArtSummaryStats {
  const teamCount = teams.length;
  let loadedTeamCount = 0;
  let totalIssueCount = 0;
  let doneCount = 0;
  let blockedCount = 0;
  let totalStoryPoints = 0;
  let doneStoryPoints = 0;

  for (const team of teams) {
    if (team.sprintIssues.length > 0) loadedTeamCount++;
    for (const issue of team.sprintIssues) {
      totalIssueCount++;

      const categoryKey = issue.fields.status.statusCategory?.key;
      const isDone = categoryKey
        ? categoryKey === OVERVIEW_CARD_STATUS_DONE
        : issue.fields.status.name.toLowerCase() === 'done';

      if (isDone) doneCount++;

      const isBlocked = issue.fields.status.name.toLowerCase().includes('block');
      if (isBlocked) blockedCount++;

      // Try the standard story points fields; fall back gracefully when absent.
      const storyPoints =
        (issue.fields as Record<string, unknown>)['customfield_10016'] ??
        (issue.fields as Record<string, unknown>)['customfield_10028'];
      if (typeof storyPoints === 'number' && storyPoints > 0) {
        totalStoryPoints += storyPoints;
        if (isDone) doneStoryPoints += storyPoints;
      }
    }
  }

  const hasAnyStoryPoints = totalStoryPoints > 0;
  const daysRemaining = computeDaysRemainingInPi(piEndDate);

  return {
    teamCount,
    loadedTeamCount,
    totalIssueCount,
    doneCount,
    blockedCount,
    totalStoryPoints,
    doneStoryPoints,
    hasAnyStoryPoints,
    daysRemaining,
  };
}


const OVERVIEW_CARD_STATUS_DONE = 'done';
/** Status category key Jira uses for items that are actively in progress. */
const OVERVIEW_CARD_STATUS_IN_PROGRESS = 'indeterminate';
/**
 * Fallback stale-issue threshold in days.
 * Matches the default in the SoS section and the ART Settings default.
 */
const OVERVIEW_CARD_STALE_DAYS_DEFAULT = 5;

interface TeamCardHealthStats {
  totalIssueCount: number;
  doneCount: number;
  inProgressCount: number;
  blockedCount: number;
  staleCount: number;
  completionPercent: number;
}

/**
 * Derives a health snapshot from a team's loaded issues.
 * Reads the user-configured stale threshold from localStorage, falling back to the default when absent.
 */
function computeTeamCardHealthStats(team: ArtTeam): TeamCardHealthStats {
  const totalIssueCount = team.sprintIssues.length;
  if (totalIssueCount === 0) {
    return { totalIssueCount: 0, doneCount: 0, inProgressCount: 0, blockedCount: 0, staleCount: 0, completionPercent: 0 };
  }

  const nowMs = Date.now();
  const MS_PER_DAY = 86_400_000;

  // Read the user-configured stale threshold so the Overview card stays in sync with SoS settings.
  let staleDays = OVERVIEW_CARD_STALE_DAYS_DEFAULT;
  try {
    const artSettings = JSON.parse(localStorage.getItem('tbxARTSettings') || '{}') as { staleDays?: number };
    if (typeof artSettings.staleDays === 'number' && artSettings.staleDays > 0) {
      staleDays = artSettings.staleDays;
    }
  } catch {
    // Storage errors are non-fatal; the default threshold is used instead.
  }

  const doneIssues = team.sprintIssues.filter((issue) => {
    const categoryKey = issue.fields.status.statusCategory?.key;
    return categoryKey ? categoryKey === OVERVIEW_CARD_STATUS_DONE : issue.fields.status.name.toLowerCase() === 'done';
  });

  const inProgressIssues = team.sprintIssues.filter((issue) => {
    const categoryKey = issue.fields.status.statusCategory?.key;
    if (categoryKey) return categoryKey === OVERVIEW_CARD_STATUS_IN_PROGRESS;
    const statusName = issue.fields.status.name.toLowerCase();
    return statusName === 'in progress' || statusName === 'in review';
  });

  const blockedCount = team.sprintIssues.filter((issue) =>
    issue.fields.status.name.toLowerCase().includes('block'),
  ).length;

  const staleCount = inProgressIssues.filter((issue) => {
    const updatedMs = new Date(issue.fields.updated).getTime();
    return (nowMs - updatedMs) / MS_PER_DAY > staleDays;
  }).length;

  const doneCount = doneIssues.length;
  const inProgressCount = inProgressIssues.length;
  const completionPercent = Math.round((doneCount / totalIssueCount) * 100);

  return { totalIssueCount, doneCount, inProgressCount, blockedCount, staleCount, completionPercent };
}

/** Returns the CSS class string for the board type badge based on the board's Agile method. */
function getBoardTypeBadgeClass(boardType: string, styles: Record<string, string>): string {
  if (boardType === 'scrum') return `${styles.boardTypeBadge} ${styles.boardTypeBadgeScrum}`;
  if (boardType === 'kanban') return `${styles.boardTypeBadge} ${styles.boardTypeBadgeKanban}`;
  return `${styles.boardTypeBadge} ${styles.boardTypeBadgeSimple}`;
}

/** Renders a single team's overview card with board type, optional sprint name, and health stats. */
function TeamCard({ selectedPiName, team, onLoad }: TeamCardProps) {
  const isKanbanOrSimpleBoard = team.boardType === 'kanban' || team.boardType === 'simple';
  const issueCountLabel = selectedPiName.trim() !== ''
    ? 'PI issues'
    : isKanbanOrSimpleBoard
      ? 'board issues'
      : 'sprint issues';

  const hasLoadedIssues = team.sprintIssues.length > 0;
  const healthStats = hasLoadedIssues ? computeTeamCardHealthStats(team) : null;

  // Sprint name only appears on Scrum cards when the user is not filtering by a PI.
  const shouldShowSprintName = Boolean(team.activeSprintName)
    && !isKanbanOrSimpleBoard
    && selectedPiName.trim() === '';

  return (
    <div className={styles.teamCard}>
      <div className={styles.teamCardHeader}>
        <span className={styles.teamName}>{team.name}</span>
        {team.boardType && team.boardType !== 'unknown' && (
          <span className={getBoardTypeBadgeClass(team.boardType, styles as unknown as Record<string, string>)}>
            {team.boardType.toUpperCase()}
          </span>
        )}
      </div>
      <span className={styles.boardId}>{team.boardName ?? `Board ${team.boardId}`}</span>

      {/* Sprint name — shows the active sprint for Scrum boards outside of PI mode */}
      {shouldShowSprintName && (
        <span className={styles.sprintName}>{team.activeSprintName}</span>
      )}

      {team.loadError && <p className={styles.errorText}>{team.loadError}</p>}
      {team.isLoading && <p className={styles.loadingText}>Loading…</p>}

      {!team.isLoading && !team.loadError && hasLoadedIssues && healthStats && (
        <>
          {/* Mini bar gives instant at-a-glance completion without requiring the user to do arithmetic */}
          <div className={styles.teamCardProgressTrack} title={`${healthStats.completionPercent}% complete`}>
            <div
              className={styles.teamCardProgressFill}
              style={{ width: `${healthStats.completionPercent}%` }}
            />
          </div>
          <div className={styles.teamCardStats}>
            <span className={styles.teamCardStatDone}>{healthStats.doneCount} done</span>
            <span className={styles.teamCardStatInProgress}>{healthStats.inProgressCount} in progress</span>
            {healthStats.blockedCount > 0 && (
              <span className={styles.teamCardStatBlocked}>🚧 {healthStats.blockedCount} blocked</span>
            )}
            {healthStats.staleCount > 0 && (
              <span className={styles.teamCardStatStale}>⏱ {healthStats.staleCount} stale</span>
            )}
          </div>
        </>
      )}

      {!team.isLoading && !team.loadError && !hasLoadedIssues && (
        <p className={styles.issueCount}>0 {issueCountLabel}</p>
      )}

      <button className={styles.loadBtn} onClick={() => onLoad(team.id)} disabled={team.isLoading}>
        Refresh
      </button>
    </div>
  );
}

interface TeamsPanelProps {
  teams: ArtTeam[];
}

// ── ART Summary Bar ──

/**
 * Renders an ART-level summary bar at the top of the Overview tab.
 * Provides a quick at-a-glance health snapshot across all configured teams:
 * teams loaded, total completion, blocked issues, story points, and days remaining in PI.
 */
function ArtSummaryBar({ teams }: { teams: ArtTeam[] }) {
  if (teams.length === 0) return null;

  // Read piEndDate from settings so the bar stays in sync with the Settings panel.
  let piEndDate: string | undefined;
  try {
    const artSettings = JSON.parse(localStorage.getItem('tbxARTSettings') || '{}') as { piEndDate?: string };
    piEndDate = artSettings.piEndDate;
  } catch {
    // localStorage errors are non-fatal; days remaining is simply omitted.
  }

  const stats = computeArtSummaryStats(teams, piEndDate);
  const { daysRemaining } = stats;

  const daysRemainingLabel = daysRemaining === null
    ? null
    : daysRemaining < 0
      ? 'Overdue'
      : daysRemaining === 0
        ? 'Ends today'
        : `${daysRemaining}d left`;

  const isDaysRemainingCritical = daysRemaining !== null && daysRemaining <= PI_DAYS_CRITICAL_THRESHOLD;
  const isDaysRemainingWarning = daysRemaining !== null
    && daysRemaining > PI_DAYS_CRITICAL_THRESHOLD
    && daysRemaining <= PI_DAYS_WARNING_THRESHOLD;

  return (
    <section
      aria-label="ART Summary"
      className={styles.artSummaryBar}
      data-testid="art-summary-bar"
    >
      {/* Teams loaded indicator */}
      <span className={styles.artSummaryBarStat} data-testid="art-summary-teams-loaded">
        <span className={styles.artSummaryBarLabel}>Teams</span>
        <span className={styles.artSummaryBarValue}>{stats.loadedTeamCount} / {stats.teamCount}</span>
      </span>

      {/* Issues done vs total — only shown when at least one team has data */}
      {stats.totalIssueCount > 0 && (
        <span className={styles.artSummaryBarStat} data-testid="art-summary-issues">
          <span className={styles.artSummaryBarLabel}>Issues Done</span>
          <span className={styles.artSummaryBarValue}>{stats.doneCount} / {stats.totalIssueCount}</span>
        </span>
      )}

      {/* Blocked count — only surfaced when impediments exist to keep the bar clean when healthy */}
      {stats.blockedCount > 0 && (
        <span
          className={`${styles.artSummaryBarStat} ${styles.artSummaryBarStatCritical}`}
          data-testid="art-summary-blocked"
        >
          <span className={styles.artSummaryBarLabel}>Blocked</span>
          <span className={styles.artSummaryBarValue}>🚧 {stats.blockedCount}</span>
        </span>
      )}

      {/* Story points rollup — only shown when estimates are present on any issue */}
      {stats.hasAnyStoryPoints && (
        <span className={styles.artSummaryBarStat} data-testid="art-summary-story-points">
          <span className={styles.artSummaryBarLabel}>Points Done</span>
          <span className={styles.artSummaryBarValue}>{stats.doneStoryPoints} / {stats.totalStoryPoints}</span>
        </span>
      )}

      {/* Days remaining — conditionally shown with urgency colour based on proximity to PI end */}
      {daysRemainingLabel !== null && (
        <span
          className={[
            styles.artSummaryBarStat,
            isDaysRemainingCritical ? styles.artSummaryBarStatCritical : '',
            isDaysRemainingWarning ? styles.artSummaryBarStatWarning : '',
          ].join(' ').trim()}
          data-testid="art-summary-days-remaining"
        >
          <span className={styles.artSummaryBarLabel}>PI End</span>
          <span className={styles.artSummaryBarValue}>{daysRemainingLabel}</span>
        </span>
      )}
    </section>
  );
}



interface ImpedimentsPanelProps extends TeamsPanelProps {
  teamProjectKeyFilter: string;
  onIssueUpdated: () => void;
  onTeamProjectKeyFilterChange: (value: string) => void;
}

// ── Constants: Impediments panel ──

/** Human-readable option labels for the reason filter, plus the "show all" sentinel.
 * Labels are intentionally worded differently from raw reason names to avoid duplicate
 * text matches in tests and screen-reader contexts where table cells show the same terms.
 */
const IMPEDIMENT_REASON_FILTER_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All Reasons' },
  { value: 'Blocked Status', label: 'Status: Blocked' },
  { value: 'Blocked Link', label: 'Blocking Link' },
  { value: 'Flagged', label: 'Impediment Flag' },
  { value: 'Label', label: 'Label' },
];

/**
 * Short actionable prompt shown below each reason badge in the Impediments table.
 * Prompts nudge the team toward the next concrete action without being prescriptive.
 */
const IMPEDIMENT_REASON_PROMPTS: Record<ImpedimentReason, string> = {
  'Blocked Status': 'Update status or add a resolution comment',
  'Blocked Link': 'Follow up with the team owning the blocking issue',
  'Flagged': 'Remove the impediment flag once cleared',
  'Label': 'Escalate to Scrum Master if unresolved',
};

/**
 * Legend entries describing each detection signal in plain English.
 * Used by the collapsible "Detection Signals" legend in the Impediments panel.
 */
const IMPEDIMENT_LEGEND_ENTRIES: Array<{ reason: ImpedimentReason; description: string }> = [
  { reason: 'Blocked Status', description: 'The Jira status name contains "block" (e.g., "Blocked", "Blocked – Waiting").' },
  { reason: 'Blocked Link', description: 'An open "is blocked by" or "blocks" issue link points to an unresolved issue.' },
  { reason: 'Flagged', description: 'The Jira impediment flag 🚩 is set via the board context menu.' },
  { reason: 'Label', description: 'The issue carries a "blocked" or "impediment" label.' },
];

/** Default stale threshold in days when no ART settings are persisted. */
const IMPEDIMENT_STALE_DAYS_DEFAULT = 5;

// ── Helpers: Impediments panel ──

/** Reads the stale-days threshold from ART settings in localStorage, falling back to the default. */
function readStaleDaysThreshold(): number {
  try {
    const settings = JSON.parse(localStorage.getItem('tbxARTSettings') || '{}') as { staleDays?: number };
    return typeof settings.staleDays === 'number' && settings.staleDays > 0
      ? settings.staleDays
      : IMPEDIMENT_STALE_DAYS_DEFAULT;
  } catch {
    return IMPEDIMENT_STALE_DAYS_DEFAULT;
  }
}

/**
 * Renders the Impediments tab with grouped/collapsible team sections, reason filter,
 * stale-tier badges, detection legend, and actionable prompts.
 */
function ImpedimentsPanel({
  teams,
  teamProjectKeyFilter,
  onIssueUpdated,
  onTeamProjectKeyFilterChange,
}: ImpedimentsPanelProps) {
  const [expandedIssueKey, setExpandedIssueKey] = useState<string | null>(null);
  const [selectedReasonFilter, setSelectedReasonFilter] = useState<string>('all');
  // Tracks which team sections are collapsed; empty set means all sections start expanded.
  const [collapsedTeamIds, setCollapsedTeamIds] = useState<Set<string>>(new Set());
  // Legend starts closed so its content doesn't create duplicate text matches with table data.
  const [isLegendOpen, setIsLegendOpen] = useState(false);

  const staleDaysThreshold = readStaleDaysThreshold();

  // Build per-team groups: annotate issues with reasons, days elapsed, and stale tier,
  // then apply the reason filter. Teams with zero matching issues are omitted entirely.
  const teamGroups = teams
    .map((team) => {
      const issuesWithMeta = team.sprintIssues
        .map((issue) => {
          const reasons = detectImpedimentReasons(issue);
          const daysSinceUpdate = computeDaysSinceUpdate(issue);
          const staleTier: ImpedimentStaleTier = classifyImpedimentStaleness(daysSinceUpdate, staleDaysThreshold);
          return { ...issue, reasons, daysSinceUpdate, staleTier };
        })
        .filter((issue) => issue.reasons.length > 0)
        .filter((issue) =>
          selectedReasonFilter === 'all' || issue.reasons.includes(selectedReasonFilter as ImpedimentReason),
        );
      return { team, issues: issuesWithMeta };
    })
    .filter(({ issues }) => issues.length > 0);

  const totalImpedimentCount = teamGroups.reduce((sum, { issues }) => sum + issues.length, 0);

  function toggleExpandedIssue(issueKey: string) {
    setExpandedIssueKey((prev) => (prev === issueKey ? null : issueKey));
  }

  function toggleTeamSection(teamId: string) {
    setCollapsedTeamIds((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  }

  return (
    <div className={styles.panel}>
      <h3 className={styles.sectionTitle}>Impediments</h3>

      {/* ── Toolbar: project key filter + reason filter ── */}
      <div className={styles.impedimentsToolbar}>
        <input
          className={styles.teamFilterInput}
          onChange={(event) => onTeamProjectKeyFilterChange(event.target.value)}
          placeholder="Filter by project key…"
          type="search"
          value={teamProjectKeyFilter}
        />
        <select
          aria-label="Filter by reason"
          className={styles.impedimentsReasonSelect}
          onChange={(event) => setSelectedReasonFilter(event.target.value)}
          value={selectedReasonFilter}
        >
          {IMPEDIMENT_REASON_FILTER_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* ── Detection Signals legend (collapsed by default) ── */}
      <div className={styles.impedimentLegend}>
        <button
          aria-expanded={isLegendOpen}
          aria-label="Detection Signals"
          className={styles.impedimentLegendToggle}
          onClick={() => setIsLegendOpen((prev) => !prev)}
          type="button"
        >
          <span aria-hidden="true" className={styles.impedimentLegendIcon}>{isLegendOpen ? '▲' : '▼'}</span>
          {' '}Detection Signals
        </button>
        {isLegendOpen && (
          <dl className={styles.impedimentLegendBody}>
            {IMPEDIMENT_LEGEND_ENTRIES.map(({ reason, description }) => (
              <div key={reason} className={styles.impedimentLegendEntry}>
                <dt className={styles.impedimentLegendTerm}>{reason}</dt>
                <dd className={styles.impedimentLegendDesc}>{description}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {/* ── Empty state when no issues match the current filters ── */}
      {totalImpedimentCount === 0 && (
        <p className={styles.emptyState}>No impediments found across all teams.</p>
      )}

      {/* ── Per-team collapsible sections ── */}
      {teamGroups.map(({ team, issues }) => {
        const isTeamCollapsed = collapsedTeamIds.has(team.id);
        const teamHeaderLabel = `${team.name} (${issues.length} impediment${issues.length !== 1 ? 's' : ''})`;

        return (
          <div key={team.id} className={styles.impedimentTeamSection}>
            {/* Team section header acts as a collapse/expand toggle for its issue table. */}
            <button
              aria-expanded={!isTeamCollapsed}
              aria-label={teamHeaderLabel}
              className={styles.impedimentTeamHeader}
              onClick={() => toggleTeamSection(team.id)}
              type="button"
            >
              <span>{team.name}</span>
              <span className={styles.impedimentTeamHeaderMeta}>
                {issues.length} impediment{issues.length !== 1 ? 's' : ''}
                {' '}
                <span aria-hidden="true">{isTeamCollapsed ? '▶' : '▼'}</span>
              </span>
            </button>

            {!isTeamCollapsed && (
              <table className={styles.dataTable}>
                <thead>
                  <tr>
                    <th scope="col">Key</th>
                    <th scope="col">Summary</th>
                    <th scope="col">Reason</th>
                    <th scope="col">Days</th>
                    <th scope="col">Assignee</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((issue) => {
                    const isExpanded = expandedIssueKey === issue.key;
                    const expandButtonLabel = `${isExpanded ? 'Collapse' : 'Expand'} details for ${issue.key}`;

                    return (
                      <Fragment key={issue.key}>
                        {/* Whole row toggles the detail panel; caret is a visual affordance hint. */}
                        <tr
                          aria-expanded={isExpanded}
                          aria-label={expandButtonLabel}
                          onClick={() => toggleExpandedIssue(issue.key)}
                          onKeyDown={(keyEvent) => {
                            if (keyEvent.key === 'Enter' || keyEvent.key === ' ')
                              toggleExpandedIssue(issue.key);
                          }}
                          role="button"
                          style={{ cursor: 'pointer', userSelect: 'none' }}
                          tabIndex={0}
                        >
                          <td>
                            <div className={styles.issueKeyCell}>
                              <span>{issue.key}</span>
                              <span aria-hidden="true" className={styles.expandToggleButton}>
                                {isExpanded ? '▲' : '▼'}
                              </span>
                            </div>
                          </td>
                          <td>{issue.fields.summary}</td>
                          <td>
                            {/* Primary reason text + actionable prompt nudging the next step. */}
                            <div className={styles.impedimentReasonCell}>
                              <span>{issue.reasons.join(', ')}</span>
                              <span
                                className={styles.impedimentReasonPrompt}
                                data-testid={`impediment-prompt-${issue.key}`}
                              >
                                {IMPEDIMENT_REASON_PROMPTS[issue.reasons[0]]}
                              </span>
                            </div>
                          </td>
                          <td>
                            {/* Days since last update badge with colour-coded stale tier. */}
                            <span
                              className={
                                issue.staleTier === 'critical'
                                  ? styles.impedimentStaleBadgeCritical
                                  : issue.staleTier === 'stale'
                                    ? styles.impedimentStaleBadgeStale
                                    : styles.impedimentStaleBadgeFresh
                              }
                              data-testid={`impediment-stale-badge-${issue.key}`}
                            >
                              {issue.daysSinceUpdate}d
                            </span>
                          </td>
                          <td>{issue.fields.assignee?.displayName ?? '—'}</td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td className={styles.issueDetailCell} colSpan={5}>
                              <IssueDetailPanel isEmbedded issue={issue} onIssueUpdated={onIssueUpdated} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Predictability helpers ──

/** Status category key constants used by both the Overview and Predictability panels. */
const STATUS_CATEGORY_DONE_KEY = 'done';
const STATUS_CATEGORY_IN_PROGRESS_KEY = 'indeterminate';

/** Returns true when an issue's status category (or name fallback) indicates completion. */
function isIssueCompleted(issue: JiraIssue): boolean {
  const categoryKey = issue.fields.status.statusCategory?.key;
  if (categoryKey) return categoryKey === STATUS_CATEGORY_DONE_KEY;
  return issue.fields.status.name.toLowerCase() === 'done';
}

/** Returns true when an issue is actively in progress by status category or known name patterns. */
function isIssueActivelyInProgress(issue: JiraIssue): boolean {
  const categoryKey = issue.fields.status.statusCategory?.key;
  if (categoryKey) return categoryKey === STATUS_CATEGORY_IN_PROGRESS_KEY;
  const statusName = issue.fields.status.name.toLowerCase();
  return statusName === 'in progress' || statusName === 'in review';
}

/**
 * Returns the story-point estimate for an issue, checking the two common custom field IDs.
 * Returns null when neither field is populated.
 */
function getIssueStoryPoints(issue: JiraIssue): number | null {
  return issue.fields.customfield_10016 ?? issue.fields.customfield_10028 ?? null;
}

/** Aggregate per-team metrics surfaced in the Predictability tab. */
interface TeamPredictabilityMetrics {
  teamName: string;
  boardType: string;
  totalIssues: number;
  doneCount: number;
  inProgressCount: number;
  completionPercent: number;
  /** Story points completed — null when no issues carry point estimates. */
  storyPointsDone: number | null;
  /** Total story points planned — null when no issues carry point estimates. */
  storyPointsTotal: number | null;
  /** Active sprint name for Scrum teams; undefined for Kanban/Simple teams. */
  activeSprintName: string | undefined;
  /**
   * Human-readable throughput description adapted to board type and sprint window.
   * - Scrum with pts: "{N} pts/sprint"
   * - Scrum without pts: "{N} issues/sprint"
   * - Kanban/other: "{N} issues / {W}d window"
   */
  throughputDescription: string;
}

/**
 * ART-level predictability rollup aggregated from all team metrics.
 * Surfaces the overall ART predictability percentage and total story point burndown.
 */
interface ArtPredictabilityRollup {
  teamCount: number;
  /** Number of teams using Scrum boards. */
  scrumTeamCount: number;
  /** Number of teams using Kanban or other non-Scrum boards. */
  kanbanTeamCount: number;
  totalDoneCount: number;
  totalIssueCount: number;
  /**
   * Overall ART predictability: totalDoneCount / totalIssueCount × 100.
   * Represents how much of the committed work has been delivered across all teams.
   */
  artPredictabilityPercent: number;
  /** Sum of story points done across all teams — null when no team has estimates. */
  totalStoryPointsDone: number | null;
  /** Sum of story points planned across all teams — null when no team has estimates. */
  totalStoryPointsTotal: number | null;
}

/**
 * Derives a predictability snapshot from a single team's loaded issues.
 * Story points columns are omitted (null) when none of the team's issues have estimates,
 * so Kanban teams with no estimates still show useful counts and percentages.
 *
 * @param sprintWindowDays - Sprint length in days from ART settings, used to contextualize throughput labels.
 */
function computeTeamPredictabilityMetrics(team: ArtTeam, sprintWindowDays: number): TeamPredictabilityMetrics {
  const totalIssues = team.sprintIssues.length;
  const doneIssues = team.sprintIssues.filter(isIssueCompleted);
  const inProgressIssues = team.sprintIssues.filter(isIssueActivelyInProgress);
  const completionPercent = totalIssues > 0 ? Math.round((doneIssues.length / totalIssues) * 100) : 0;

  const allPoints = team.sprintIssues.map(getIssueStoryPoints);
  const hasAnyPointEstimates = allPoints.some((pointValue) => pointValue !== null);

  const storyPointsDone = hasAnyPointEstimates
    ? doneIssues.reduce((runningTotal, issue) => runningTotal + (getIssueStoryPoints(issue) ?? 0), 0)
    : null;
  const storyPointsTotal = hasAnyPointEstimates
    ? team.sprintIssues.reduce((runningTotal, issue) => runningTotal + (getIssueStoryPoints(issue) ?? 0), 0)
    : null;

  // Throughput description is board-type-aware so Scrum teams show velocity framing
  // and Kanban teams show flow framing with the sprint window length as context.
  const isScrum = team.boardType === 'scrum';
  let throughputDescription: string;
  if (isScrum && storyPointsDone !== null) {
    throughputDescription = `${storyPointsDone} pts/sprint`;
  } else if (isScrum) {
    throughputDescription = `${doneIssues.length} issues/sprint`;
  } else {
    throughputDescription = `${doneIssues.length} issues / ${sprintWindowDays}d`;
  }

  return {
    teamName: team.name,
    boardType: team.boardType ?? 'unknown',
    totalIssues,
    doneCount: doneIssues.length,
    inProgressCount: inProgressIssues.length,
    completionPercent,
    storyPointsDone,
    storyPointsTotal,
    activeSprintName: isScrum ? team.activeSprintName : undefined,
    throughputDescription,
  };
}

/**
 * Computes ART-level predictability rollup from all per-team metrics.
 * The ART predictability percent is a weighted measure: done issues / total issues across all teams.
 */
function computeArtPredictabilityRollup(teamMetrics: TeamPredictabilityMetrics[]): ArtPredictabilityRollup {
  const teamCount = teamMetrics.length;
  const scrumTeamCount = teamMetrics.filter((metrics) => metrics.boardType === 'scrum').length;
  const kanbanTeamCount = teamCount - scrumTeamCount;

  const totalDoneCount = teamMetrics.reduce((sum, metrics) => sum + metrics.doneCount, 0);
  const totalIssueCount = teamMetrics.reduce((sum, metrics) => sum + metrics.totalIssues, 0);
  const artPredictabilityPercent = totalIssueCount > 0
    ? Math.round((totalDoneCount / totalIssueCount) * 100)
    : 0;

  const hasAnyPts = teamMetrics.some((metrics) => metrics.storyPointsDone !== null);
  const totalStoryPointsDone = hasAnyPts
    ? teamMetrics.reduce((sum, metrics) => sum + (metrics.storyPointsDone ?? 0), 0)
    : null;
  const totalStoryPointsTotal = hasAnyPts
    ? teamMetrics.reduce((sum, metrics) => sum + (metrics.storyPointsTotal ?? 0), 0)
    : null;

  return {
    teamCount,
    scrumTeamCount,
    kanbanTeamCount,
    totalDoneCount,
    totalIssueCount,
    artPredictabilityPercent,
    totalStoryPointsDone,
    totalStoryPointsTotal,
  };
}

/** Renders the Predictability tab with ART rollup, Scrum/Kanban sections, and per-team velocity/throughput metrics. */
function PredictabilityPanel({ teams }: TeamsPanelProps) {
  if (teams.length === 0) {
    return (
      <div className={styles.panel}>
        <h3 className={styles.sectionTitle}>Predictability</h3>
        <p className={styles.emptyState}>No teams loaded. Load teams from the Overview tab.</p>
      </div>
    );
  }

  const sprintWindowDays = readArtAdvancedSettings().sprintWindowDays ?? DEFAULT_SPRINT_WINDOW_DAYS;
  const teamMetrics = teams.map((team) => computeTeamPredictabilityMetrics(team, sprintWindowDays));
  const rollup = computeArtPredictabilityRollup(teamMetrics);

  // Determine whether any team has story point data — used to show/hide optional columns.
  const hasAnyStoryPointData = teamMetrics.some((metrics) => metrics.storyPointsDone !== null);
  // Total column count drives the colSpan on section sub-header rows.
  // Base columns: Team, Type, Sprint, Done, In Progress, Total, Completion, Throughput = 8
  // Optional pts columns: Pts Done, Pts Total = +2
  const columnCount = hasAnyStoryPointData ? 10 : 8;

  // Show separate Scrum/Kanban section sub-headers only when both board types are present.
  const hasMixedBoardTypes = rollup.scrumTeamCount > 0 && rollup.kanbanTeamCount > 0;
  const scrumTeamMetrics = hasMixedBoardTypes
    ? teamMetrics.filter((metrics) => metrics.boardType === 'scrum')
    : [];
  const nonScrumTeamMetrics = hasMixedBoardTypes
    ? teamMetrics.filter((metrics) => metrics.boardType !== 'scrum')
    : [];
  // When board types are not mixed, render all teams in a single flat list.
  const flatTeamMetrics = hasMixedBoardTypes ? [] : teamMetrics;

  /** Renders a single row in the per-team metrics table. */
  function renderTeamRow(metrics: TeamPredictabilityMetrics) {
    return (
      <tr key={metrics.teamName}>
        <td>{metrics.teamName}</td>
        <td>{metrics.boardType !== 'unknown' ? metrics.boardType.toUpperCase() : '—'}</td>
        <td>{metrics.activeSprintName ?? '—'}</td>
        <td>{metrics.doneCount}</td>
        <td>{metrics.inProgressCount}</td>
        <td>{metrics.totalIssues}</td>
        <td>{metrics.totalIssues > 0 ? `${metrics.completionPercent}%` : '—'}</td>
        {hasAnyStoryPointData && <td>{metrics.storyPointsDone ?? '—'}</td>}
        {hasAnyStoryPointData && <td>{metrics.storyPointsTotal ?? '—'}</td>}
        <td>{metrics.throughputDescription}</td>
      </tr>
    );
  }

  return (
    <div className={styles.panel}>
      <h3 className={styles.sectionTitle}>Predictability</h3>

      {/* ART-level predictability rollup — overall completion rate and story point burndown across all teams */}
      <div
        aria-label="ART predictability rollup"
        className={styles.predictabilityRollupBar}
        role="region"
      >
        <div className={styles.predictabilityRollupStat}>
          <span className={styles.predictabilityRollupLabel}>ART Predictability</span>
          <span className={styles.predictabilityRollupValue}>{rollup.artPredictabilityPercent}%</span>
        </div>
        <div className={styles.predictabilityRollupStat}>
          <span className={styles.predictabilityRollupLabel}>Issues Done</span>
          <span className={styles.predictabilityRollupValue}>
            {rollup.totalDoneCount} / {rollup.totalIssueCount}
          </span>
        </div>
        {rollup.totalStoryPointsDone !== null && (
          <div
            className={styles.predictabilityRollupStat}
            data-testid="art-predictability-pts-rollup"
          >
            <span className={styles.predictabilityRollupLabel}>Pts Done</span>
            <span className={styles.predictabilityRollupValue}>
              {rollup.totalStoryPointsDone} / {rollup.totalStoryPointsTotal ?? 0}
            </span>
          </div>
        )}
        <div className={styles.predictabilityRollupStat}>
          <span className={styles.predictabilityRollupLabel}>Teams</span>
          <span className={styles.predictabilityRollupValue}>{rollup.teamCount}</span>
        </div>
        {hasMixedBoardTypes && (
          <div className={styles.predictabilityRollupStat}>
            <span className={styles.predictabilityRollupLabel}>Scrum / Kanban</span>
            <span className={styles.predictabilityRollupValue}>
              {rollup.scrumTeamCount} / {rollup.kanbanTeamCount}
            </span>
          </div>
        )}
      </div>

      {/* Per-team metrics table — Sprint column shows active sprint for Scrum, Throughput column shows flow rate */}
      <table className={styles.dataTable}>
        <thead>
          <tr>
            <th scope="col">Team</th>
            <th scope="col">Type</th>
            <th scope="col">Sprint</th>
            <th scope="col">Done</th>
            <th scope="col">In Progress</th>
            <th scope="col">Total</th>
            <th scope="col">Completion</th>
            {hasAnyStoryPointData && <th scope="col">Pts Done</th>}
            {hasAnyStoryPointData && <th scope="col">Pts Total</th>}
            <th scope="col">Throughput</th>
          </tr>
        </thead>
        <tbody>
          {/* Flat list when all teams share the same board type */}
          {flatTeamMetrics.map(renderTeamRow)}

          {/* Scrum section — velocity framed as pts or issues per sprint */}
          {hasMixedBoardTypes && scrumTeamMetrics.length > 0 && (
            <>
              <tr className={styles.predictabilitySectionSubHeader}>
                <td colSpan={columnCount}>
                  Scrum Teams — velocity per sprint ({sprintWindowDays}d)
                </td>
              </tr>
              {scrumTeamMetrics.map(renderTeamRow)}
            </>
          )}

          {/* Kanban / flow section — throughput framed as issues per window */}
          {hasMixedBoardTypes && nonScrumTeamMetrics.length > 0 && (
            <>
              <tr className={styles.predictabilitySectionSubHeader}>
                <td colSpan={columnCount}>
                  Kanban / Flow Teams — throughput per {sprintWindowDays}d window
                </td>
              </tr>
              {nonScrumTeamMetrics.map(renderTeamRow)}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Releases helpers ──

/** Urgency classification bucket for a release version based on its date relative to today. */
type ReleaseUrgencyLevel = 'released' | 'overdue' | 'critical' | 'warning' | 'upcoming' | 'no-date';

// Thresholds matching the PI urgency palette so the release radar uses consistent colour signals.
/** Release dates within this many days trigger the critical (red) urgency level. */
const RELEASE_URGENCY_CRITICAL_DAYS = 7;
/** Release dates within this many days trigger the warning (amber) urgency level. */
const RELEASE_URGENCY_WARNING_DAYS = 30;

/** A lightweight summary of a single issue within an expandable release row. */
interface ReleaseIssueSummary {
  key: string;
  summary: string;
  statusName: string;
  isDone: boolean;
  teamName: string;
}

/** A single fix-version bucket aggregating issues from potentially multiple teams. */
interface ReleaseVersionSummary {
  versionName: string;
  releaseDate: string | null;
  isReleased: boolean;
  teamNames: string[];
  doneCount: number;
  totalIssueCount: number;
  /** Timeline urgency computed from the release date; drives badge colour in the UI. */
  urgency: ReleaseUrgencyLevel;
  /** Slim issue snapshots used to populate the expandable detail row. */
  issues: ReleaseIssueSummary[];
}

/**
 * Classifies how urgent a release version is relative to today's date.
 * Released versions always return "released" — their date is no longer relevant.
 */
function classifyReleaseUrgency(releaseDate: string | null, isReleased: boolean): ReleaseUrgencyLevel {
  if (isReleased) return 'released';
  if (!releaseDate) return 'no-date';

  const daysRemaining = computeDaysRemainingInPi(releaseDate);
  if (daysRemaining === null) return 'no-date';
  if (daysRemaining < 0) return 'overdue';
  if (daysRemaining <= RELEASE_URGENCY_CRITICAL_DAYS) return 'critical';
  if (daysRemaining <= RELEASE_URGENCY_WARNING_DAYS) return 'warning';
  return 'upcoming';
}

/**
 * Groups all team sprint issues by fix version, aggregating done/total counts,
 * contributing teams, urgency classification, and a slim issue list for expandable rows.
 * Issues without any fix version are excluded; they are not release-oriented.
 */
function groupIssuesByFixVersion(teams: ArtTeam[]): ReleaseVersionSummary[] {
  interface VersionAccumulator {
    releaseDate: string | null;
    isReleased: boolean;
    teamNameSet: Set<string>;
    doneCount: number;
    totalIssueCount: number;
    issueSummaries: ReleaseIssueSummary[];
  }

  const versionMap = new Map<string, VersionAccumulator>();

  for (const team of teams) {
    for (const issue of team.sprintIssues) {
      const fixVersions = issue.fields.fixVersions ?? [];
      if (fixVersions.length === 0) continue;

      const issueIsDone = isIssueCompleted(issue);
      const issueSummary: ReleaseIssueSummary = {
        key: issue.key,
        summary: issue.fields.summary,
        statusName: issue.fields.status.name,
        isDone: issueIsDone,
        teamName: team.name,
      };

      for (const fixVersion of fixVersions) {
        if (!versionMap.has(fixVersion.name)) {
          versionMap.set(fixVersion.name, {
            releaseDate: fixVersion.releaseDate ?? null,
            isReleased: fixVersion.released ?? false,
            teamNameSet: new Set(),
            doneCount: 0,
            totalIssueCount: 0,
            issueSummaries: [],
          });
        }

        const accumulator = versionMap.get(fixVersion.name)!;
        accumulator.teamNameSet.add(team.name);
        accumulator.totalIssueCount++;
        if (issueIsDone) accumulator.doneCount++;
        // Each issue may appear in multiple fix versions; add it to each version it belongs to.
        accumulator.issueSummaries.push(issueSummary);
      }
    }
  }

  return Array.from(versionMap.entries())
    .map(([versionName, accumulator]) => ({
      versionName,
      releaseDate: accumulator.releaseDate,
      isReleased: accumulator.isReleased,
      teamNames: Array.from(accumulator.teamNameSet).sort(),
      doneCount: accumulator.doneCount,
      totalIssueCount: accumulator.totalIssueCount,
      urgency: classifyReleaseUrgency(accumulator.releaseDate, accumulator.isReleased),
      issues: accumulator.issueSummaries,
    }))
    .sort((firstVersion, secondVersion) => {
      // Released versions appear after unreleased so upcoming work is prominent.
      if (firstVersion.isReleased !== secondVersion.isReleased) {
        return firstVersion.isReleased ? 1 : -1;
      }
      // Within the same released/unreleased group, sort ascending by date so nearest deadline is first.
      if (firstVersion.releaseDate && secondVersion.releaseDate) {
        return firstVersion.releaseDate.localeCompare(secondVersion.releaseDate);
      }
      if (firstVersion.releaseDate) return -1;
      if (secondVersion.releaseDate) return 1;
      return firstVersion.versionName.localeCompare(secondVersion.versionName);
    });
}

// Urgency display configuration — maps each level to its human label and CSS modifier class.
// Kept as a plain object so callers get a compile-time error if a new level is added without
// updating this config.
const RELEASE_URGENCY_CONFIG: Record<ReleaseUrgencyLevel, { label: string; cssClass: string }> = {
  released: { label: 'Released', cssClass: styles.releaseUrgencyBadgeReleased },
  overdue: { label: 'Overdue', cssClass: styles.releaseUrgencyBadgeOverdue },
  critical: { label: 'Critical', cssClass: styles.releaseUrgencyBadgeCritical },
  warning: { label: 'Warning', cssClass: styles.releaseUrgencyBadgeWarning },
  upcoming: { label: 'Upcoming', cssClass: styles.releaseUrgencyBadgeUpcoming },
  'no-date': { label: 'No Date', cssClass: styles.releaseUrgencyBadgeNoDate },
};

/** Renders the Releases tab with urgency badges, mini progress bars, and expandable issue detail rows. */
function ReleasesPanel({ teams }: TeamsPanelProps) {
  const releaseVersions = groupIssuesByFixVersion(teams);
  // Tracks which version rows are currently expanded — uses version name as key.
  const [expandedVersionNames, setExpandedVersionNames] = useState<Set<string>>(new Set());

  function toggleVersionExpanded(versionName: string): void {
    setExpandedVersionNames((previousSet) => {
      const updatedSet = new Set(previousSet);
      if (updatedSet.has(versionName)) {
        updatedSet.delete(versionName);
      } else {
        updatedSet.add(versionName);
      }
      return updatedSet;
    });
  }

  return (
    <div className={styles.panel}>
      <h3 className={styles.sectionTitle}>Releases</h3>
      {releaseVersions.length === 0 && (
        <p className={styles.emptyState}>
          No release data found. Assign fix versions to issues in Jira, then reload teams.
        </p>
      )}
      {releaseVersions.length > 0 && (
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th scope="col">Fix Version</th>
              <th scope="col">Release Date</th>
              <th scope="col">Urgency</th>
              <th scope="col">Progress</th>
              <th scope="col">Done / Total</th>
              <th scope="col">Teams</th>
              <th scope="col" aria-label="Expand / Collapse" />
            </tr>
          </thead>
          <tbody>
            {releaseVersions.map((releaseVersion) => {
              const isExpanded = expandedVersionNames.has(releaseVersion.versionName);
              const urgencyConfig = RELEASE_URGENCY_CONFIG[releaseVersion.urgency];
              const completionPercent = releaseVersion.totalIssueCount > 0
                ? Math.round((releaseVersion.doneCount / releaseVersion.totalIssueCount) * 100)
                : 0;

              return (
                <Fragment key={releaseVersion.versionName}>
                  <tr>
                    <td>{releaseVersion.versionName}</td>
                    <td>{releaseVersion.releaseDate ?? '—'}</td>
                    <td>
                      <span className={`${styles.releaseUrgencyBadge} ${urgencyConfig.cssClass}`}>
                        {urgencyConfig.label}
                      </span>
                    </td>
                    <td>
                      {/* Accessible progress bar; aria-valuenow drives automated tests as well as assistive technology. */}
                      <div
                        className={styles.releaseProgressTrack}
                        role="progressbar"
                        aria-valuenow={completionPercent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`${releaseVersion.versionName} completion: ${completionPercent}%`}
                      >
                        <div
                          className={styles.releaseProgressFill}
                          style={{ width: `${completionPercent}%` }}
                        />
                      </div>
                    </td>
                    <td>{releaseVersion.doneCount} / {releaseVersion.totalIssueCount}</td>
                    <td>{releaseVersion.teamNames.join(', ')}</td>
                    <td>
                      <button
                        className={styles.expandToggleButton}
                        onClick={() => toggleVersionExpanded(releaseVersion.versionName)}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} issues for ${releaseVersion.versionName}`}
                        type="button"
                      >
                        {isExpanded ? '▲' : '▼'}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={7} className={styles.releaseExpandedRow}>
                        <table className={styles.releaseIssueTable}>
                          <thead>
                            <tr>
                              <th scope="col">Key</th>
                              <th scope="col">Summary</th>
                              <th scope="col">Status</th>
                              <th scope="col">Team</th>
                            </tr>
                          </thead>
                          <tbody>
                            {releaseVersion.issues.map((issueSummary) => (
                              <tr
                                key={issueSummary.key}
                                className={issueSummary.isDone ? styles.releaseIssueRowDone : ''}
                              >
                                <td className={styles.releaseIssueKeyCell}>{issueSummary.key}</td>
                                <td>{issueSummary.summary}</td>
                                <td>{issueSummary.statusName}</td>
                                <td>{issueSummary.teamName}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Feature 2: Board Prep ──

interface BoardPrepPanelProps {
  teams: ArtTeam[];
  selectedPiName: string;
  boardPrepIssues: ArtBoardPrepIssue[];
  isLoadingBoardPrep: boolean;
  boardPrepError: string | null;
  boardPrepTeamFilter: string;
  onLoadBoardPrep: () => Promise<void>;
  onSetPiName: (name: string) => void;
  onSetTeamFilter: (teamName: string) => void;
}

/** Exports the board prep issue table as a comma-separated CSV download. */
function exportBoardPrepToCsv(issues: ArtBoardPrepIssue[], piName: string): void {
  const headerRow = 'Team,Key,Summary,Estimate,Priority';
  const dataRows = issues.map((issue) => {
    const escapedSummary = `"${issue.summary.replace(/"/g, '""')}"`;
    return `${issue.teamName},${issue.key},${escapedSummary},${issue.estimate ?? ''},${issue.priority ?? ''}`;
  });
  const csvContent = [headerRow, ...dataRows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const downloadAnchor = document.createElement('a');
  downloadAnchor.href = url;
  downloadAnchor.download = `board-prep-${piName || 'export'}.csv`;
  downloadAnchor.click();
  URL.revokeObjectURL(url);
}

/** Renders the Board Prep panel for reviewing backlog-ready issues before PI Planning. */
function BoardPrepPanel({
  teams, selectedPiName, boardPrepIssues, isLoadingBoardPrep,
  boardPrepError, boardPrepTeamFilter, onLoadBoardPrep, onSetPiName, onSetTeamFilter,
}: BoardPrepPanelProps) {
  const teamNames = ['all', ...teams.map((t) => t.name)];
  const filteredIssues = boardPrepTeamFilter === 'all'
    ? boardPrepIssues
    : boardPrepIssues.filter((issue) => issue.teamName === boardPrepTeamFilter);

  return (
    <div className={styles.panel}>
      <h3 className={styles.sectionTitle}>Board Prep</h3>
      <div className={styles.boardPrepControls}>
        <input
          aria-label="Board Prep PI Name"
          type="text"
          className={styles.textInput}
          placeholder="PI Name"
          value={selectedPiName}
          onChange={(event) => onSetPiName(event.target.value)}
        />
        <button className={styles.primaryBtn} onClick={onLoadBoardPrep} disabled={isLoadingBoardPrep}>
          {isLoadingBoardPrep ? 'Loading…' : 'Load Board Prep'}
        </button>
        <select
          className={styles.textInput}
          value={boardPrepTeamFilter}
          onChange={(event) => onSetTeamFilter(event.target.value)}
          aria-label="Filter by team"
        >
          {teamNames.map((name) => (
            <option key={name} value={name}>{name === 'all' ? 'All Teams' : name}</option>
          ))}
        </select>
        {filteredIssues.length > 0 && (
          <button className={styles.secondaryBtn} onClick={() => exportBoardPrepToCsv(filteredIssues, selectedPiName)}>
            Export to CSV
          </button>
        )}
      </div>

      {boardPrepError && <p className={styles.errorText}>{boardPrepError}</p>}

      {filteredIssues.length === 0 && !isLoadingBoardPrep && !boardPrepError && (
        <p className={styles.emptyState}>No backlog-ready issues found. Load board prep to populate this panel.</p>
      )}

      {filteredIssues.length > 0 && (
        <table className={styles.dataTable}>
          <thead>
            <tr>
              <th scope="col">Team</th>
              <th scope="col">Key</th>
              <th scope="col">Summary</th>
              <th scope="col">Estimate</th>
              <th scope="col">Priority</th>
            </tr>
          </thead>
          <tbody>
            {filteredIssues.map((issue) => (
              <tr key={issue.key}>
                <td>{issue.teamName}</td>
                <td>{issue.key}</td>
                <td>{issue.summary}</td>
                <td>{issue.estimate ?? '—'}</td>
                <td>{issue.priority ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Feature 4: Enhanced SoS Panel (Drawer) ──

interface SosPanelProps {
  teams: ArtTeam[];
  sosExpandedTeams: string[];
  onToggleSosTeam: (teamId: string) => void;
}

/**
 * Computes the aggregate pulse stats across all teams for the SoS Pulse summary.
 * Uses the same 4-signal impediment detection as the Impediments tab so that flagged,
 * label-blocked, link-blocked, and status-blocked issues all count toward the pulse.
 * Teams at risk are those with fewer than 50% of their issues marked done.
 */
function computeSosPulse(teams: ArtTeam[]): { impedimentCount: number; completionPercent: number; teamsAtRisk: string[] } {
  const RISK_THRESHOLD_PERCENT = 50;
  let totalIssues = 0;
  let totalDone = 0;
  let impedimentCount = 0;
  const teamsAtRisk: string[] = [];

  for (const team of teams) {
    const issueCount = team.sprintIssues.length;
    const doneCount = team.sprintIssues.filter(
      (issue) => issue.fields.status.statusCategory?.key === 'done' || issue.fields.status.name.toLowerCase() === 'done',
    ).length;
    // Use the same 4-signal detection as ImpedimentsPanel so the pulse count is consistent.
    const teamImpedimentCount = team.sprintIssues.filter(isImpediment).length;

    totalIssues += issueCount;
    totalDone += doneCount;
    impedimentCount += teamImpedimentCount;

    const teamCompletionPercent = issueCount > 0 ? (doneCount / issueCount) * 100 : 0;
    if (issueCount > 0 && teamCompletionPercent < RISK_THRESHOLD_PERCENT) {
      teamsAtRisk.push(team.name);
    }
  }

  const completionPercent = totalIssues > 0 ? Math.round((totalDone / totalIssues) * 100) : 0;
  return { impedimentCount, completionPercent, teamsAtRisk };
}

/** localStorage key for a team's SoS narrative for a given date. */
function buildSosNarrativeStorageKey(teamId: string, dateString: string): string {
  return `tbxSosNarrative_${teamId}_${dateString}`;
}

/** Formats a Date using local calendar values so storage keys match the user's timezone. */
function formatLocalDateString(date: Date): string {
  const yearNumber = date.getFullYear();
  const monthNumber = String(date.getMonth() + 1).padStart(2, '0');
  const dayNumber = String(date.getDate()).padStart(2, '0');
  return `${yearNumber}-${monthNumber}-${dayNumber}`;
}

/** The 5 SoS narrative field names aligned with the legacy Toolbox app. */
type SosNarrativeField = 'yesterday' | 'today' | 'blockers' | 'risks' | 'dependencies';

interface SosNarrativeData {
  yesterday: string;
  today: string;
  blockers: string;
  risks: string;
  dependencies: string;
  /** ISO timestamp of when the narrative was last manually edited, per field. */
  editedAt: Partial<Record<SosNarrativeField, string>>;
}

/** Auto-generates SoS narrative text from live sprint issue data. */
function autoGenerateSosNarrative(team: ArtTeam, staleDaysThreshold: number): Omit<SosNarrativeData, 'editedAt'> {
  const now = Date.now();
  const msPerDay = 86_400_000;

  const doneIssues = team.sprintIssues.filter(
    (issue) =>
      issue.fields.status.statusCategory?.key === 'done' ||
      issue.fields.status.name.toLowerCase() === 'done',
  );
  const inProgressIssues = team.sprintIssues.filter(
    (issue) =>
      issue.fields.status.statusCategory?.key === 'indeterminate' ||
      issue.fields.status.name.toLowerCase().includes('progress'),
  );
  const blockedIssues = team.sprintIssues.filter(isImpediment);
  const staleIssues = inProgressIssues.filter((issue) => {
    const updatedMs = new Date(issue.fields.updated).getTime();
    return (now - updatedMs) / msPerDay > staleDaysThreshold;
  });

  const formatIssueList = (issues: typeof team.sprintIssues) =>
    issues.length === 0
      ? 'None'
      : issues.map((issue) => `${issue.key}: ${issue.fields.summary}`).join('\n');

  return {
    yesterday: formatIssueList(doneIssues),
    today: formatIssueList(inProgressIssues),
    blockers: formatIssueList(blockedIssues),
    risks: staleIssues.length === 0 ? 'None' : `Stale (>${staleDaysThreshold}d): ${formatIssueList(staleIssues)}`,
    dependencies: 'None detected — load Dependencies tab for cross-team link analysis.',
  };
}

/** Reads the stored SoS narrative for a team + date, or returns null if not stored. */
function readStoredSosNarrative(teamId: string, dateString: string): SosNarrativeData | null {
  try {
    const stored = localStorage.getItem(buildSosNarrativeStorageKey(teamId, dateString));
    if (!stored) return null;
    return JSON.parse(stored) as SosNarrativeData;
  } catch {
    return null;
  }
}

/** Saves the SoS narrative for a team + date to localStorage. */
function storeSosNarrative(teamId: string, dateString: string, data: SosNarrativeData): void {
  localStorage.setItem(buildSosNarrativeStorageKey(teamId, dateString), JSON.stringify(data));
}

const SOS_NARRATIVE_FIELD_LABELS: Record<SosNarrativeField, string> = {
  yesterday: 'Yesterday',
  today: 'Today',
  blockers: 'Blockers',
  risks: 'Risks',
  dependencies: 'Dependencies',
};

const SOS_NARRATIVE_FIELDS: SosNarrativeField[] = ['yesterday', 'today', 'blockers', 'risks', 'dependencies'];
const DEFAULT_STALE_DAYS = 5;

interface SosTeamNarrativeProps {
  team: ArtTeam;
  /** The date string (YYYY-MM-DD) for which to load and save the narrative. */
  selectedDateString: string;
  /** Optional Jira issue key to enable the "Post to Jira" sync feature. */
  sosIssueKey?: string;
}

// ── SoS Jira sync helpers ──

/** Shape of the sync record stored in localStorage for a given team+date. */
interface SosSyncRecord {
  /** ISO timestamp of the last successful Jira post. */
  postedAt: string;
}

/** Returns the localStorage key for a team+date sync record. */
function buildSosSyncStorageKey(teamId: string, dateString: string): string {
  return `tbxSosSyncRecord-${teamId}-${dateString}`;
}

/** Reads the sync record from localStorage, returning null if absent or invalid. */
function readSosSyncRecord(teamId: string, dateString: string): SosSyncRecord | null {
  try {
    const stored = localStorage.getItem(buildSosSyncStorageKey(teamId, dateString));
    if (!stored) return null;
    return JSON.parse(stored) as SosSyncRecord;
  } catch {
    return null;
  }
}

/** Persists the sync record to localStorage. */
function writeSosSyncRecord(teamId: string, dateString: string, record: SosSyncRecord): void {
  localStorage.setItem(buildSosSyncStorageKey(teamId, dateString), JSON.stringify(record));
}

/** Formats the narrative fields as a Jira wiki-markup comment body. */
function buildSosJiraCommentBody(narrative: SosNarrativeData, teamName: string, dateString: string): string {
  const fieldLines = SOS_NARRATIVE_FIELDS.map(
    (fieldName) => `*${SOS_NARRATIVE_FIELD_LABELS[fieldName]}:* ${narrative[fieldName] || '_None_'}`,
  ).join('\n');
  return `h3. SoS Update — ${teamName} — ${dateString}\n\n${fieldLines}`;
}

/** Renders the 5 narrative textarea fields for a single team's SoS accordion section. */
function SosTeamNarrative({ team, selectedDateString, sosIssueKey }: SosTeamNarrativeProps) {
  const storedNarrative = readStoredSosNarrative(team.id, selectedDateString);

  // Load settings for stale-day threshold
  let staleDays = DEFAULT_STALE_DAYS;
  try {
    const settings = JSON.parse(localStorage.getItem('tbxARTSettings') || '{}') as { staleDays?: number };
    if (typeof settings.staleDays === 'number') staleDays = settings.staleDays;
  } catch {
    // Use default
  }

  const autoNarrative = autoGenerateSosNarrative(team, staleDays);
  const [narrativeData, setNarrativeData] = useState<SosNarrativeData>(
    storedNarrative ?? { ...autoNarrative, editedAt: {} },
  );

  // Sync state: initialized from localStorage so "Synced" survives a page refresh.
  const [syncRecord, setSyncRecord] = useState<SosSyncRecord | null>(() =>
    sosIssueKey ? readSosSyncRecord(team.id, selectedDateString) : null,
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  function handleFieldChange(fieldName: SosNarrativeField, newValue: string) {
    const updatedData: SosNarrativeData = {
      ...narrativeData,
      [fieldName]: newValue,
      editedAt: { ...narrativeData.editedAt, [fieldName]: new Date().toISOString() },
    };
    setNarrativeData(updatedData);
    storeSosNarrative(team.id, selectedDateString, updatedData);
  }

  function handleRevertField(fieldName: SosNarrativeField) {
    const updatedEditedAt = { ...narrativeData.editedAt };
    delete updatedEditedAt[fieldName];
    const updatedData: SosNarrativeData = {
      ...narrativeData,
      [fieldName]: autoNarrative[fieldName],
      editedAt: updatedEditedAt,
    };
    setNarrativeData(updatedData);
    storeSosNarrative(team.id, selectedDateString, updatedData);
  }

  async function handlePostToJira() {
    if (!sosIssueKey) return;
    setIsSyncing(true);
    setSyncError(null);
    try {
      const commentBody = buildSosJiraCommentBody(narrativeData, team.name, selectedDateString);
      await jiraPost(`/rest/api/2/issue/${sosIssueKey}/comment`, { body: commentBody });
      const newRecord: SosSyncRecord = { postedAt: new Date().toISOString() };
      writeSosSyncRecord(team.id, selectedDateString, newRecord);
      setSyncRecord(newRecord);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to post to Jira';
      setSyncError(message);
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <div className={styles.sosNarrativeSection}>
      {SOS_NARRATIVE_FIELDS.map((fieldName) => {
        const isManuallyEdited = Boolean(narrativeData.editedAt[fieldName]);
        const editedTimestamp = narrativeData.editedAt[fieldName];
        return (
          <div key={fieldName} className={styles.sosNarrativeField}>
            <div className={styles.sosNarrativeFieldHeader}>
              <label className={styles.sosNarrativeLabel}>{SOS_NARRATIVE_FIELD_LABELS[fieldName]}</label>
              {isManuallyEdited && (
                <>
                  <span className={styles.sosNarrativeTimestamp}>
                    Edited {new Date(editedTimestamp!).toLocaleTimeString()}
                  </span>
                  <button
                    className={styles.sosNarrativeRevertBtn}
                    onClick={() => handleRevertField(fieldName)}
                  >
                    Revert to auto
                  </button>
                </>
              )}
            </div>
            <textarea
              className={styles.sosNarrativeTextarea}
              value={narrativeData[fieldName]}
              onChange={(event) => handleFieldChange(fieldName, event.target.value)}
              rows={3}
              aria-label={`${SOS_NARRATIVE_FIELD_LABELS[fieldName]} narrative for ${team.name}`}
            />
          </div>
        );
      })}

      {/* Jira sync footer — only shown when a sosIssueKey is configured for this team */}
      {sosIssueKey && (
        <div className={styles.sosSyncFooter}>
          <span className={styles.sosSyncState}>
            {syncRecord
              ? `✅ Synced · ${new Date(syncRecord.postedAt).toLocaleTimeString()}`
              : '🔵 Local only'}
          </span>
          <button
            className={styles.secondaryBtn}
            onClick={() => void handlePostToJira()}
            disabled={isSyncing}
          >
            {isSyncing ? 'Posting…' : 'Post to Jira'}
          </button>
          {syncError && <span className={styles.sosSyncError}>{syncError}</span>}
        </div>
      )}
    </div>
  );
}

/** Generates a list of the past 14 days (inclusive) as date option objects for the SoS date picker. */
function generateSosDateOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOffset);
    const value = formatLocalDateString(date);
    const label =
      dayOffset === 0
        ? `Today (${value})`
        : dayOffset === 1
          ? `Yesterday (${value})`
          : value;
    options.push({ value, label });
  }
  return options;
}

/**
 * Formats all team narratives as a single plain-text SoS report for pasting into
 * Confluence, email, or Jira comments.
 */
function formatSosReportAsText(
  teams: ArtTeam[],
  selectedDateString: string,
  staleDaysThreshold: number,
): string {
  const lines: string[] = [`SoS Report — ${selectedDateString}`, ''];
  for (const team of teams) {
    const stored = readStoredSosNarrative(team.id, selectedDateString);
    const autoNarrative = autoGenerateSosNarrative(team, staleDaysThreshold);
    const narrative = stored ?? { ...autoNarrative, editedAt: {} };
    lines.push(`=== ${team.name} ===`);
    SOS_NARRATIVE_FIELDS.forEach((fieldName) => {
      if (narrative[fieldName] && narrative[fieldName] !== 'None') {
        lines.push(`${SOS_NARRATIVE_FIELD_LABELS[fieldName]}:\n${narrative[fieldName]}`);
      }
    });
    lines.push('');
  }
  return lines.join('\n');
}

/** Renders the enhanced SoS tab with a Pulse summary and per-team accordion sections with narrative fields. */
function SosPanel({ teams, sosExpandedTeams, onToggleSosTeam }: SosPanelProps) {
  const pulse = computeSosPulse(teams);
  const sosDateOptions = generateSosDateOptions();
  const [selectedDateString, setSelectedDateString] = useState(sosDateOptions[0].value);

  // Load stale-days threshold for the report formatter
  let staleDays = DEFAULT_STALE_DAYS;
  try {
    const settings = JSON.parse(localStorage.getItem('tbxARTSettings') || '{}') as { staleDays?: number };
    if (typeof settings.staleDays === 'number') staleDays = settings.staleDays;
  } catch {
    // Use default
  }

  function handleCopySosReport() {
    const text = formatSosReportAsText(teams, selectedDateString, staleDays);
    navigator.clipboard.writeText(text).catch(() => {
      // Fallback for environments where clipboard API is unavailable
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    });
  }

  return (
    <div className={styles.panel}>
      <h3 className={styles.sectionTitle}>Scrum of Scrums</h3>

      {/* Toolbar: date selector and report export */}
      <div className={styles.sosToolbar}>
        <select
          className={styles.textInput}
          value={selectedDateString}
          onChange={(event) => setSelectedDateString(event.target.value)}
          aria-label="Select SoS date"
        >
          {sosDateOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <button className={styles.secondaryBtn} onClick={handleCopySosReport}>
          Copy SoS Report
        </button>
      </div>

      {/* Pulse: aggregate health at a glance */}
      <div className={styles.sosPulse}>
        <strong className={styles.sosPulseTitle}>Pulse</strong>
        <span className={styles.sosPulseStat}>
          🚧 {pulse.impedimentCount} impediment{pulse.impedimentCount !== 1 ? 's' : ''}
        </span>
        <span className={styles.sosPulseStat}>{pulse.completionPercent}% complete</span>
        {pulse.teamsAtRisk.length > 0 && (
          <span className={styles.sosPulseRisk}>
            ⚠️ At risk: {pulse.teamsAtRisk.join(', ')}
          </span>
        )}
      </div>

      {teams.length === 0 && (
        <p className={styles.emptyState}>No teams loaded. Load teams from the Overview tab.</p>
      )}

      {/* Per-team accordion sections with narrative fields */}
      {teams.map((team) => {
        const isExpanded = sosExpandedTeams.includes(team.id);
        // Use the full 4-signal impediment detection so the accordion list matches the Impediments tab.
        const teamImpediments = team.sprintIssues.filter(isImpediment);
        const assignees = [
          ...new Set(
            team.sprintIssues
              .map((issue) => issue.fields.assignee?.displayName)
              .filter((name): name is string => Boolean(name)),
          ),
        ];
        // Per-team completion for the accordion header badge
        const teamTotalIssues = team.sprintIssues.length;
        const teamDoneCount = team.sprintIssues.filter(
          (issue) =>
            issue.fields.status.statusCategory?.key === 'done' ||
            issue.fields.status.name.toLowerCase() === 'done',
        ).length;

        return (
          <div key={team.id} className={styles.sosAccordion}>
            <button
              className={styles.sosAccordionHeader}
              onClick={() => onToggleSosTeam(team.id)}
              aria-expanded={isExpanded}
            >
              {team.name}
              {/* Jira SoS issue badge — shows the linked issue key when configured */}
              {team.sosIssueKey && (
                <span
                  className={styles.sosJiraKeyBadge}
                  title="Jira SoS Issue"
                >
                  {team.sosIssueKey}
                </span>
              )}
              {/* Per-team stats badge so facilitators see at-a-glance health without expanding */}
              <span className={styles.sosAccordionStats}>
                {teamTotalIssues} issues · {teamDoneCount}/{teamTotalIssues} done
                {teamImpediments.length > 0 && ` · ⚠️ ${teamImpediments.length}`}
              </span>
              <span className={styles.sosAccordionChevron}>{isExpanded ? '▲' : '▼'}</span>
            </button>

            {isExpanded && (
              <div className={styles.sosAccordionBody}>
                {assignees.length > 0 && (
                  <div className={styles.sosAssignees}>
                    <strong>Assignees: </strong>{assignees.join(', ')}
                  </div>
                )}

                {teamImpediments.length > 0 && (
                  <div className={styles.sosImpediments}>
                    <strong>Impediments:</strong>
                    <ul className={styles.sosImpedimentList}>
                      {teamImpediments.map((issue) => (
                        <li key={issue.key}>{issue.key}: {issue.fields.summary}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {teamImpediments.length === 0 && (
                  <p className={styles.emptyState}>No impediments for this team.</p>
                )}

                {/* Editable SoS narrative fields — auto-generated, manually overridable */}
                <SosTeamNarrative
                  key={`${team.id}-${selectedDateString}`}
                  team={team}
                  selectedDateString={selectedDateString}
                  sosIssueKey={team.sosIssueKey}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Feature 5: Monthly Report Panel ──

/** Pillar categories used by the SAFe portfolio for classifying features. */
type MonthlyReportPillar = '' | 'Growth' | 'Affordability' | 'Operating Model';

type MonthlyReportTemplateFieldName =
  | 'reportTeamName'
  | 'initiativeName'
  | 'code'
  | 'productAreas'
  | 'accomplished'
  | 'outcomes'
  | 'stakeholders'
  | 'pillar'
  | 'deliveredDate'
  | 'pointOfContact';

type MonthlyReportInputMode = 'text' | 'textarea' | 'select';

interface MonthlyReportTemplateRow {
  fieldName: MonthlyReportTemplateFieldName;
  label: string;
  inputMode: MonthlyReportInputMode;
  isBulletList: boolean;
  textareaRows?: number;
}

/** Editable fields that form a single team's monthly report card. */
interface MonthlyReportCard {
  teamId: string;
  teamName: string;
  reportTeamName: string;
  initiativeName: string;
  code: string;
  productAreas: string;
  accomplished: string;
  outcomes: string;
  stakeholders: string;
  pillar: MonthlyReportPillar;
  deliveredDate: string;
  pointOfContact: string;
  /** Retained so older stored cards can still be loaded without data loss. */
  risks?: string;
}

const MONTHLY_REPORT_PLACEHOLDER_TEXT = 'Provide response here';
const MONTHLY_REPORT_BULLET_PREFIX = '• ';
const MONTHLY_REPORT_COPY_TABLE_LABEL = 'Monthly accomplishments table';
const MONTHLY_REPORT_TEMPLATE_ROWS: MonthlyReportTemplateRow[] = [
  {
    fieldName: 'reportTeamName',
    label: 'Team Name (Salesforce: xx or Enrollment: xx)',
    inputMode: 'text',
    isBulletList: false,
  },
  {
    fieldName: 'initiativeName',
    label: 'What is the name of the initiative/project?',
    inputMode: 'text',
    isBulletList: false,
  },
  {
    fieldName: 'code',
    label: 'P or T - Code if applicable:',
    inputMode: 'text',
    isBulletList: false,
  },
  {
    fieldName: 'productAreas',
    label: 'Included Product Areas? (Ex. SalesOps, Telesales, Enrollment Ops, Prod Support, Asset, etc)',
    inputMode: 'textarea',
    isBulletList: true,
    textareaRows: 3,
  },
  {
    fieldName: 'accomplished',
    label: 'What was accomplished? Provide a summary of the achievement focusing on what was delivered that benefited the business or major technical improvement.',
    inputMode: 'textarea',
    isBulletList: true,
    textareaRows: 4,
  },
  {
    fieldName: 'outcomes',
    label: 'What are the business outcomes or desired benefits? (Ex. Improved the member experience, cost savings or cost avoidance, major milestone or incremental improvement, process improvement, defect resolution, technology resiliency)',
    inputMode: 'textarea',
    isBulletList: true,
    textareaRows: 4,
  },
  {
    fieldName: 'stakeholders',
    label: 'Who are the impacted stakeholders? (Members, Brokers, Agents, same info from Product Areas, etc)',
    inputMode: 'textarea',
    isBulletList: true,
    textareaRows: 3,
  },
  {
    fieldName: 'pillar',
    label: 'What Business Pillar is impacted? (Growth, Affordability, Operating Model)',
    inputMode: 'select',
    isBulletList: true,
  },
  {
    fieldName: 'deliveredDate',
    label: 'Date Delivered Accomplished',
    inputMode: 'text',
    isBulletList: true,
  },
  {
    fieldName: 'pointOfContact',
    label: 'SME / Point of Contact (PO)',
    inputMode: 'text',
    isBulletList: true,
  },
];
const MONTHLY_REPORT_DRAFT_FIELDS: MonthlyReportTemplateFieldName[] = [
  'initiativeName',
  'code',
  'productAreas',
  'accomplished',
  'outcomes',
  'stakeholders',
  'pillar',
  'deliveredDate',
  'pointOfContact',
];
const PILLAR_OPTIONS: MonthlyReportPillar[] = ['', 'Growth', 'Affordability', 'Operating Model'];

function createDefaultMonthlyReportCard(team: ArtTeam): MonthlyReportCard {
  return {
    teamId: team.id,
    teamName: team.name,
    reportTeamName: team.name,
    initiativeName: '',
    code: '',
    productAreas: '',
    accomplished: '',
    outcomes: '',
    stakeholders: '',
    pillar: '',
    deliveredDate: '',
    pointOfContact: '',
    risks: '',
  };
}

function readStoredMonthlyText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeStoredMonthlyReportCard(team: ArtTeam, storedCard: unknown): MonthlyReportCard {
  const defaultCard = createDefaultMonthlyReportCard(team);

  if (!storedCard || typeof storedCard !== 'object') {
    return defaultCard;
  }

  const storedCardRecord = storedCard as Partial<MonthlyReportCard>;
  const storedReportTeamName = readStoredMonthlyText(storedCardRecord.reportTeamName).trim();
  const storedLegacyTeamName = readStoredMonthlyText(storedCardRecord.teamName).trim();
  const reportTeamName = storedReportTeamName || storedLegacyTeamName || defaultCard.reportTeamName;
  const storedPillar = readStoredMonthlyText(storedCardRecord.pillar);
  const normalizedPillar = PILLAR_OPTIONS.includes(storedPillar as MonthlyReportPillar)
    ? storedPillar as MonthlyReportPillar
    : '';

  return {
    ...defaultCard,
    reportTeamName,
    initiativeName: readStoredMonthlyText(storedCardRecord.initiativeName),
    code: readStoredMonthlyText(storedCardRecord.code),
    productAreas: readStoredMonthlyText(storedCardRecord.productAreas),
    accomplished: readStoredMonthlyText(storedCardRecord.accomplished),
    outcomes: readStoredMonthlyText(storedCardRecord.outcomes),
    stakeholders: readStoredMonthlyText(storedCardRecord.stakeholders),
    pillar: normalizedPillar,
    deliveredDate: readStoredMonthlyText(storedCardRecord.deliveredDate),
    pointOfContact: readStoredMonthlyText(storedCardRecord.pointOfContact),
    risks: readStoredMonthlyText(storedCardRecord.risks),
  };
}

/** Generates a list of the last 12 month labels in 'YYYY-MM' format for the month selector. */
function generateMonthOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let monthOffset = 0; monthOffset < 12; monthOffset++) {
    const date = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);
    const yearNumber = date.getFullYear();
    const monthNumber = date.getMonth() + 1;
    const value = `${yearNumber}-${String(monthNumber).padStart(2, '0')}`;
    const label = date.toLocaleString('default', { month: 'long', year: 'numeric' });
    options.push({ value, label });
  }
  return options;
}

/** Builds the localStorage key for storing a monthly report card. */
function buildMonthlyReportStorageKey(teamId: string, yearMonth: string): string {
  return `tbxMonthlyReport_${teamId}_${yearMonth}`;
}

/** Loads a stored monthly report card or returns an empty default. */
function loadMonthlyReportCard(team: ArtTeam, yearMonth: string): MonthlyReportCard {
  try {
    const stored = localStorage.getItem(buildMonthlyReportStorageKey(team.id, yearMonth));
    if (stored) {
      return normalizeStoredMonthlyReportCard(team, JSON.parse(stored));
    }
  } catch {
    // Fall through to default
  }
  return createDefaultMonthlyReportCard(team);
}

/** Saves a monthly report card to localStorage. */
function saveMonthlyReportCard(teamId: string, yearMonth: string, card: MonthlyReportCard): void {
  localStorage.setItem(buildMonthlyReportStorageKey(teamId, yearMonth), JSON.stringify(card));
}

function readMonthlyTemplateFieldValue(card: MonthlyReportCard, fieldName: MonthlyReportTemplateFieldName): string {
  const rawFieldValue = card[fieldName];
  return typeof rawFieldValue === 'string' ? rawFieldValue : '';
}

function createMonthlyTemplateResponseLines(fieldValue: string, isBulletList: boolean): string[] {
  const trimmedFieldValue = fieldValue.trim();
  if (!isBulletList) {
    return [trimmedFieldValue || MONTHLY_REPORT_PLACEHOLDER_TEXT];
  }

  const responseLines = trimmedFieldValue
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `${MONTHLY_REPORT_BULLET_PREFIX}${line.replace(/^[•*-]\s*/, '')}`);

  return responseLines.length > 0
    ? responseLines
    : [`${MONTHLY_REPORT_BULLET_PREFIX}${MONTHLY_REPORT_PLACEHOLDER_TEXT}`];
}

function escapeMonthlyReportHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatMonthlyTemplateResponseAsText(card: MonthlyReportCard, row: MonthlyReportTemplateRow): string {
  return createMonthlyTemplateResponseLines(
    readMonthlyTemplateFieldValue(card, row.fieldName),
    row.isBulletList,
  ).join('\n');
}

function formatMonthlyTemplateResponseAsHtml(card: MonthlyReportCard, row: MonthlyReportTemplateRow): string {
  const responseLines = createMonthlyTemplateResponseLines(
    readMonthlyTemplateFieldValue(card, row.fieldName),
    row.isBulletList,
  );

  if (!row.isBulletList) {
    return `<div class="monthly-template-text">${escapeMonthlyReportHtml(responseLines[0]).replaceAll('\n', '<br>')}</div>`;
  }

  return `<ul class="monthly-template-list">${responseLines.map((line) => `<li>${escapeMonthlyReportHtml(line.replace(/^[•]\s*/, ''))}</li>`).join('')}</ul>`;
}

/** Formats all visible cards as plain text for copying to clipboard or file download. */
function formatCardsAsText(cards: MonthlyReportCard[]): string {
  return cards
    .map((card) => MONTHLY_REPORT_TEMPLATE_ROWS
      .map((row) => `${row.label}\n${formatMonthlyTemplateResponseAsText(card, row)}`)
      .join('\n\n'))
    .join('\n\n');
}

function formatCardsAsHtmlFragment(cards: MonthlyReportCard[]): string {
  return cards
    .map((card) => {
      const tableRowsHtml = MONTHLY_REPORT_TEMPLATE_ROWS
        .map((row) => `
          <tr>
            <th scope="row">${escapeMonthlyReportHtml(row.label)}</th>
            <td>${formatMonthlyTemplateResponseAsHtml(card, row)}</td>
          </tr>`)
        .join('');

      return `
        <table aria-label="${MONTHLY_REPORT_COPY_TABLE_LABEL}" class="monthly-template-table">
          <tbody>${tableRowsHtml}</tbody>
        </table>`;
    })
    .join('<div class="monthly-template-spacer"></div>');
}

/** Formats all visible cards as a self-contained HTML document for download. */
function formatCardsAsHtml(
  cards: MonthlyReportCard[],
  yearMonth: string,
): string {
  const cardHtml = formatCardsAsHtmlFragment(cards);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Monthly Report ${yearMonth}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 24px; color: #111827; }
    .monthly-template-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-bottom: 20px; }
    .monthly-template-table th,
    .monthly-template-table td { border: 1px solid #cbd5e1; padding: 10px 12px; vertical-align: top; text-align: left; }
    .monthly-template-table th { width: 28%; background: #0b67ad; color: #ffffff; font-weight: 600; }
    .monthly-template-text { white-space: pre-wrap; }
    .monthly-template-list { margin: 0; padding-left: 18px; }
    .monthly-template-list li + li { margin-top: 6px; }
    .monthly-template-spacer { height: 18px; }
  </style>
</head>
<body>
  ${cardHtml}
</body>
</html>`;
}

/** Triggers a download of a text file with the given content. */
function downloadTextFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copyMonthlyReportToClipboard(html: string, text: string): Promise<void> {
  if (navigator.clipboard && typeof navigator.clipboard.write === 'function' && typeof ClipboardItem !== 'undefined') {
    const clipboardItem = new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([text], { type: 'text/plain' }),
    });
    await navigator.clipboard.write([clipboardItem]);
    return;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

/**
 * Formats visible cards as a CSV file ready for import into Excel or Google Sheets.
 * Includes Jira-derived velocity, committed points, completion %, and impediment count
 * as additional columns when a stats map is provided — columns are blank when no data is loaded.
 */
function formatCardsAsCsv(
  cards: MonthlyReportCard[],
): string {
  /** Wraps a single cell value in double quotes and escapes embedded quotes per RFC 4180. */
  function escapeCsvCell(value: string | undefined | null): string {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  const HEADER_ROW = [
    'Team Name',
    'Initiative / Project',
    'P or T Code',
    'Included Product Areas',
    'Accomplished',
    'Business Outcomes / Desired Benefits',
    'Impacted Stakeholders',
    'Business Pillar',
    'Date Delivered Accomplished',
    'SME / Point of Contact (PO)',
  ].map(escapeCsvCell).join(',');

  const dataRows = cards.map((card) => {
    return [
      card.reportTeamName,
      card.initiativeName,
      card.code,
      card.productAreas,
      card.accomplished,
      card.outcomes,
      card.stakeholders,
      card.pillar,
      card.deliveredDate,
      card.pointOfContact,
    ].map(escapeCsvCell).join(',');
  });

  return [HEADER_ROW, ...dataRows].join('\n');
}

/** localStorage key for persisting the selected month across Monthly Report visits. */
const MONTHLY_REPORT_META_STORAGE_KEY = 'tbxMonthlyReportMeta';

/** Loads the last-used month (YYYY-MM) from localStorage, or returns null if not stored. */
function loadPersistedMonthSelection(): string | null {
  try {
    const raw = localStorage.getItem(MONTHLY_REPORT_META_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { selectedYearMonth?: string };
    return parsed.selectedYearMonth ?? null;
  } catch {
    return null;
  }
}

/** Persists the selected month to localStorage so it survives tab switches. */
function savePersistedMonthSelection(yearMonth: string): void {
  localStorage.setItem(MONTHLY_REPORT_META_STORAGE_KEY, JSON.stringify({ selectedYearMonth: yearMonth }));
}

/** Returns true when a monthly report card has at least one content field filled in. */
function monthlyCardHasDraftContent(card: MonthlyReportCard): boolean {
  return MONTHLY_REPORT_DRAFT_FIELDS.some((fieldName) =>
    readMonthlyTemplateFieldValue(card, fieldName).trim() !== '',
  );
}

interface MonthlyReportCardEditorProps {
  card: MonthlyReportCard;
  /** Sprint issues loaded for this team from Jira — empty array when data has not been fetched. */
  jiraIssues: JiraIssue[];
  onChange: (updatedCard: MonthlyReportCard) => void;
}

/** Renders a single editable monthly report card for one team. */
function MonthlyReportCardEditor({ card, jiraIssues, onChange }: MonthlyReportCardEditorProps) {
  function handleFieldChange(fieldName: keyof MonthlyReportCard, value: string) {
    onChange({ ...card, [fieldName]: value });
  }

  const hasDraftContent = monthlyCardHasDraftContent(card);
  // Jira stats and the generate button are only shown when the team's issues have been loaded.
  const hasJiraData = jiraIssues.length > 0;
  // Compute stats inline — they change whenever the issues change (after team refresh).
  const jiraStats = hasJiraData ? computeMonthlyJiraStats(jiraIssues) : null;

  /**
   * Pre-fills the "What was accomplished?" row from the team's loaded Jira issues.
   * Preserving the manual content here prevents Jira generation from wiping out edited report text.
   */
  function handleGenerateFromJira() {
    const generatedAccomplished = generateMonthlyAccomplishedText(jiraIssues);
    onChange({
      ...card,
      accomplished: generatedAccomplished || card.accomplished,
    });
  }

  return (
    <div className={styles.monthlyCard}>
      <div className={styles.monthlyCardHeader}>
        <span className={styles.monthlyCardTeamName}>{card.teamName}</span>
        {/* Draft indicator: a checkmark badge signals the card has been filled in */}
        {hasDraftContent && (
          <span
            className={styles.monthlyCardDraftIndicator}
            title="Draft — this card has content"
          >
            ✓ Draft
          </span>
        )}
        <select
          className={styles.monthlyPillarSelect}
          value={card.pillar}
          onChange={(event) => handleFieldChange('pillar', event.target.value)}
          aria-label={`Pillar for ${card.teamName}`}
        >
          {PILLAR_OPTIONS.map((pillar) => (
            <option key={pillar} value={pillar}>{pillar || '— Select pillar —'}</option>
          ))}
        </select>
      </div>

      {/* Jira-derived stats strip — only rendered when sprint issues have been loaded for this team */}
      {jiraStats && (
        <div className={styles.monthlyJiraStatsBar} data-testid={`jira-stats-${card.teamId}`}>
          <span className={styles.monthlyJiraStatItem}>
            {jiraStats.doneIssueCount}/{jiraStats.totalIssueCount} done
          </span>
          <span className={styles.monthlyJiraStatItem}>
            {jiraStats.completionPercent}% complete
          </span>
          {jiraStats.committedPoints > 0 && (
            <span className={styles.monthlyJiraStatItem}>
              {jiraStats.velocityPoints}/{jiraStats.committedPoints} pts
            </span>
          )}
          {jiraStats.impedimentCount > 0 && (
            <span className={`${styles.monthlyJiraStatItem} ${styles.monthlyJiraStatItemImpediment}`}>
              ⚠️ {jiraStats.impedimentCount} impediment{jiraStats.impedimentCount !== 1 ? 's' : ''}
            </span>
          )}
          <button
            className={styles.monthlyJiraGenerateBtn}
            onClick={handleGenerateFromJira}
            title="Pre-fill the accomplishment summary from Jira issues"
            type="button"
          >
            Generate from Jira
          </button>
        </div>
      )}

      {/* Hint shown when the team has not had its Jira data loaded yet */}
      {!hasJiraData && (
        <p className={styles.monthlyJiraHint}>
          Load this team from the Overview tab to enable Jira-driven generation.
        </p>
      )}

      {MONTHLY_REPORT_TEMPLATE_ROWS.map((row) => {
        const fieldValue = readMonthlyTemplateFieldValue(card, row.fieldName);

        return (
          <div className={styles.monthlyFieldRow} key={row.fieldName}>
            <label className={styles.monthlyFieldLabel}>{row.label}</label>
            {row.inputMode === 'textarea' ? (
              <textarea
                className={styles.monthlyTextarea}
                value={fieldValue}
                onChange={(event) => handleFieldChange(row.fieldName, event.target.value)}
                rows={row.textareaRows ?? 3}
                placeholder={MONTHLY_REPORT_PLACEHOLDER_TEXT}
                aria-label={row.label}
              />
            ) : row.inputMode === 'select' ? (
              <select
                className={styles.monthlyTextInput}
                value={card.pillar}
                onChange={(event) => handleFieldChange('pillar', event.target.value)}
                aria-label={row.label}
              >
                <option value="">{MONTHLY_REPORT_PLACEHOLDER_TEXT}</option>
                {PILLAR_OPTIONS.filter((pillarOption) => pillarOption !== '').map((pillarOption) => (
                  <option key={pillarOption} value={pillarOption}>{pillarOption}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className={styles.monthlyTextInput}
                value={fieldValue}
                onChange={(event) => handleFieldChange(row.fieldName, event.target.value)}
                placeholder={MONTHLY_REPORT_PLACEHOLDER_TEXT}
                aria-label={row.label}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Renders the Monthly Report tab with per-team editable report cards, month selector,
 * pillar filter, draft indicators, Jira-derived stats strips, "Generate from Jira" buttons,
 * and export actions (HTML, plain text, and CSV).
 * The selected month is persisted to localStorage so it is remembered across tab switches.
 */
function MonthlyReportPanel({ teams }: TeamsPanelProps) {
  const monthOptions = generateMonthOptions();

  // Restore the last-used month, defaulting to the current month if nothing is stored.
  const [selectedYearMonth, setSelectedYearMonth] = useState(() => {
    const persisted = loadPersistedMonthSelection();
    // Validate that the stored value is still in the available 12-month window.
    const isStillAvailable = persisted && monthOptions.some((option) => option.value === persisted);
    return isStillAvailable ? persisted : monthOptions[0].value;
  });

  const [teamFilter, setTeamFilter] = useState('all');
  const [pillarFilter, setPillarFilter] = useState<MonthlyReportPillar>('');

  // Load cards for all teams for the current month, initialising from localStorage
  const [cards, setCards] = useState<MonthlyReportCard[]>(() =>
    teams.map((team) => loadMonthlyReportCard(team, selectedYearMonth)),
  );

  // Build a stable teamId → sprintIssues map so editors receive the latest loaded Jira issues.
  const issuesByTeamId = useMemo(
    () => new Map(teams.map((team) => [team.id, team.sprintIssues])),
    [teams],
  );

  function handleMonthChange(newYearMonth: string) {
    setSelectedYearMonth(newYearMonth);
    savePersistedMonthSelection(newYearMonth);
    setCards(teams.map((team) => loadMonthlyReportCard(team, newYearMonth)));
  }

  function handleCardChange(updatedCard: MonthlyReportCard) {
    setCards((previous) =>
      previous.map((card) => (card.teamId === updatedCard.teamId ? updatedCard : card)),
    );
    saveMonthlyReportCard(updatedCard.teamId, selectedYearMonth, updatedCard);
  }

  // Apply team filter first, then pillar filter
  const visibleCards = cards
    .filter((card) => teamFilter === 'all' || card.teamId === teamFilter)
    .filter((card) => pillarFilter === '' || card.pillar === pillarFilter);

  function handleCopyAll() {
    const text = formatCardsAsText(visibleCards);
    const htmlDocument = formatCardsAsHtml(visibleCards, selectedYearMonth);
    const htmlFragment = formatCardsAsHtmlFragment(visibleCards);
    copyMonthlyReportToClipboard(htmlFragment || htmlDocument, text).catch(() => {
      // Fallback: create a temporary textarea for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    });
  }

  function handleExportHtml() {
    const html = formatCardsAsHtml(visibleCards, selectedYearMonth);
    downloadTextFile(html, `monthly-report-${selectedYearMonth}.html`, 'text/html');
  }

  function handleExportText() {
    const text = formatCardsAsText(visibleCards);
    downloadTextFile(text, `monthly-report-${selectedYearMonth}.txt`, 'text/plain');
  }

  function handleExportCsv() {
    const csv = formatCardsAsCsv(visibleCards);
    downloadTextFile(csv, `monthly-report-${selectedYearMonth}.csv`, 'text/csv');
  }

  return (
    <div className={styles.panel}>
      <h3 className={styles.sectionTitle}>Monthly Report</h3>

      <div className={styles.monthlyToolbar}>
        <select
          className={styles.textInput}
          value={selectedYearMonth}
          onChange={(event) => handleMonthChange(event.target.value)}
          aria-label="Select month"
        >
          {monthOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>

        <select
          className={styles.textInput}
          value={teamFilter}
          onChange={(event) => setTeamFilter(event.target.value)}
          aria-label="Filter by team"
        >
          <option value="all">All Teams</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>{team.name}</option>
          ))}
        </select>

        <select
          className={styles.textInput}
          value={pillarFilter}
          onChange={(event) => setPillarFilter(event.target.value as MonthlyReportPillar)}
          aria-label="Filter by pillar"
        >
          <option value="">All Pillars</option>
          {PILLAR_OPTIONS.filter((pillar) => pillar !== '').map((pillar) => (
            <option key={pillar} value={pillar}>{pillar}</option>
          ))}
        </select>

        <button className={styles.secondaryBtn} onClick={handleCopyAll}>
          Copy All
        </button>
        <button className={styles.secondaryBtn} onClick={handleExportHtml}>
          Export HTML
        </button>
        <button className={styles.secondaryBtn} onClick={handleExportText}>
          Export Text
        </button>
        <button className={styles.secondaryBtn} onClick={handleExportCsv}>
          Export CSV
        </button>
      </div>

      {teams.length === 0 && (
        <p className={styles.emptyState}>No teams configured. Add teams in the Settings tab.</p>
      )}

      <div className={styles.monthlyCardList}>
        {visibleCards.map((card) => (
          <MonthlyReportCardEditor
            key={card.teamId}
            card={card}
            jiraIssues={issuesByTeamId.get(card.teamId) ?? []}
            onChange={handleCardChange}
          />
        ))}
      </div>
    </div>
  );
}

interface SettingsPanelProps {
  teams: ArtTeam[];
  onAddTeam: (name: string, boardId: string, projectKey?: string, boardName?: string, sosIssueKey?: string) => void;
  onReloadPiOptions: () => Promise<void>;
  onReplaceTeams: (teams: Array<Partial<ArtTeam>>) => void;
  onRemoveTeam: (teamId: string) => void;
  onSaveTeams: () => void;
  /** Updates the SoS Jira issue key for a specific team without requiring a full Save Teams. */
  onUpdateTeamSosKey: (teamId: string, sosIssueKey: string) => void;
  /** Updates the PI Review Confluence page URL for a specific team without requiring a full Save Teams. */
  onUpdateTeamPiReviewPageUrl: (teamId: string, piReviewPageUrl: string) => void;
  /** Updates the Jira label for a specific team used in Feature Change report queries. */
  onUpdateTeamJiraLabel: (teamId: string, jiraLabel: string) => void;
}

/** Shape of the ART advanced settings object stored under 'tbxARTSettings' in localStorage. */
interface ArtAdvancedSettings {
  piFieldId?: string;
  spFieldId?: string;
  isSpAutoDetect?: boolean;
  featureLinkField?: string;
  featureProjectKeys?: string[];
  pCodeField?: string;
  piReviewTargetStartFieldId?: string;
  piReviewTargetEndFieldId?: string;
  depLinkTypes?: string[];
  staleDays?: number;
  /** ISO date string (YYYY-MM-DD) for the end of the current Program Increment. */
  piEndDate?: string;
  /**
   * Length of a sprint in calendar days, used by future burndown and stale-issue calculations.
   * Defaults to DEFAULT_SPRINT_WINDOW_DAYS when not set.
   */
  sprintWindowDays?: number;
  /** Numeric Confluence page ID that contains the PI Review table synced by the PI Review tab. */
  piReviewPageId?: string;
  /** Shared fallback Confluence page URL or page ID used when no team-specific PI Review page is configured. */
  piReviewPageUrl?: string;
  /** Human-readable ART name used by the experimental shared Confluence workspace flow. */
  sharedArtName?: string;
  /** Short shared ART key (for example S2E) used by the experimental shared Confluence workspace flow. */
  sharedArtKey?: string;
  /** Confluence Database ID backing the experimental shared ART workspace. */
  sharedArtDatabaseId?: string;
  /** Confluence Space ID used when creating the shared ART workspace. */
  sharedArtSpaceId?: string;
  /** Optional Confluence parent content ID used when creating the shared ART workspace. */
  sharedArtParentId?: string;
}

/** Reads ART advanced settings from localStorage or returns an empty object. */
function readArtAdvancedSettings(): ArtAdvancedSettings {
  try {
    const storedSettings = JSON.parse(localStorage.getItem('tbxARTSettings') || '{}') as ArtAdvancedSettings;
    return {
      ...DEFAULT_SHARED_ART_SETTINGS,
      ...storedSettings,
    };
  } catch {
    return { ...DEFAULT_SHARED_ART_SETTINGS };
  }
}

/** Writes ART advanced settings to localStorage. */
function writeArtAdvancedSettings(settings: ArtAdvancedSettings): void {
  localStorage.setItem('tbxARTSettings', JSON.stringify(settings));
}

const DEFAULT_SHARED_ART_SETTINGS: Pick<
  ArtAdvancedSettings,
  'sharedArtName' | 'sharedArtKey' | 'sharedArtDatabaseId' | 'sharedArtSpaceId' | 'sharedArtParentId'
> = {
  sharedArtName: 'Sales to Enrollment',
  sharedArtKey: 'S2E',
  sharedArtDatabaseId: '684163133',
  sharedArtSpaceId: '256344064',
  sharedArtParentId: '685473797',
};

const DEFAULT_STALE_DAYS_SETTING = 5;
/** Default sprint length in calendar days (2-week sprint). Used by stale-issue and sprint-window calculations. */
const DEFAULT_SPRINT_WINDOW_DAYS = 14;
const DEFAULT_DEPENDENCY_LINK_TYPES = ['blocks', 'is blocked by', 'depends on', 'is depended on by', 'relates to'];
const DEFAULT_PI_REVIEW_TARGET_START_FIELD_ID = 'customfield_10101';
const DEFAULT_PI_REVIEW_TARGET_END_FIELD_ID = 'customfield_10102';
const LOCKED_SHARED_ART_WORKSPACE_LABEL = 'Sales To Enrollment ART';
const IS_SHARED_ART_WORKSPACE_SELECTION_LOCKED = true;
const SHARED_ART_RECENT_WORKSPACES_STORAGE_KEY = 'tbxSharedArtRecentWorkspaces';
const SHARED_ART_SYNC_SNAPSHOTS_STORAGE_KEY = 'tbxSharedArtSyncSnapshots';
const MAX_RECENT_SHARED_ARTS = 10;
const PI_REVIEW_PAGE_ID_SETTING_KEY: keyof ArtAdvancedSettings = 'piReviewPageId';
const PI_REVIEW_PAGE_URL_SETTING_KEY: keyof ArtAdvancedSettings = 'piReviewPageUrl';
const SHARED_ART_TOP_LEVEL_FIELD_NAMES = ['artKey', 'artName'] as const;
const SHARED_ART_SETTINGS_FIELD_NAMES = [
  'piFieldId',
  'spFieldId',
  'isSpAutoDetect',
  'featureLinkField',
  'featureProjectKeys',
  'pCodeField',
  'piReviewTargetStartFieldId',
  'piReviewTargetEndFieldId',
  'depLinkTypes',
  'staleDays',
  'piEndDate',
  'sprintWindowDays',
  'piReviewPageUrl',
] as const;
const SHARED_ART_TEAM_FIELD_NAMES = [
  'name',
  'boardId',
  'boardName',
  'projectKey',
  'piReviewPageUrl',
  'sosIssueKey',
] as const;
/**
 * Matches a fully-formed Jira custom field ID (e.g. "customfield_10301").
 * Requires at least 4 digits after the prefix because Jira's generated IDs
 * are always 4–5+ digits (10000+). This guards onReloadPiOptions so it only
 * fires when the user has finished entering a complete field ID, not on every
 * keystroke in the fallback text input.
 */
const VALID_CUSTOM_FIELD_ID_PATTERN = /^customfield_\d{4,}$/;

function readDefaultedPiReviewTargetStartFieldId(fieldValue: string | undefined): string {
  return fieldValue?.trim() || DEFAULT_PI_REVIEW_TARGET_START_FIELD_ID;
}

function readDefaultedPiReviewTargetEndFieldId(fieldValue: string | undefined): string {
  return fieldValue?.trim() || DEFAULT_PI_REVIEW_TARGET_END_FIELD_ID;
}

/**
 * Shows the shared workspace as a friendly label while the published ART
 * workspace remains fixed during the current rollout.
 */
function formatSharedArtWorkspaceDisplayValue(sharedArtName: string, sharedArtDatabaseId: string): string {
  const normalizedDatabaseId = sharedArtDatabaseId.trim();
  if (normalizedDatabaseId === '') {
    return '';
  }

  if (normalizedDatabaseId === DEFAULT_SHARED_ART_SETTINGS.sharedArtDatabaseId) {
    return `${LOCKED_SHARED_ART_WORKSPACE_LABEL} (${normalizedDatabaseId})`;
  }

  const normalizedSharedArtName = sharedArtName.trim();
  if (normalizedSharedArtName === '') {
    return normalizedDatabaseId;
  }

  const normalizedSharedArtLabel = /art$/i.test(normalizedSharedArtName)
    ? normalizedSharedArtName
    : `${normalizedSharedArtName} ART`;
  return `${normalizedSharedArtLabel} (${normalizedDatabaseId})`;
}

interface JiraIssueLinkTypeOption {
  name?: string;
  inward?: string;
  outward?: string;
}

interface SharedArtRecentWorkspace {
  artName: string;
  artKey: string;
  databaseId: string;
}

interface SharedArtWorkspacePayload {
  schemaVersion: number;
  artKey: string;
  artName: string;
  updatedAt: string;
  teams: Array<{
    id: string;
    name: string;
    boardId: string;
    boardName?: string;
    projectKey?: string;
    piReviewPageUrl?: string;
    sosIssueKey?: string;
  }>;
  settings: {
    piFieldId?: string;
    spFieldId?: string;
    isSpAutoDetect?: boolean;
    featureLinkField?: string;
    featureProjectKeys?: string[];
    pCodeField?: string;
    piReviewTargetStartFieldId?: string;
    piReviewTargetEndFieldId?: string;
    depLinkTypes?: string[];
    staleDays?: number;
    piEndDate?: string;
    sprintWindowDays?: number;
    piReviewPageUrl?: string;
  };
}

interface SharedArtMergeConflict {
  path: string;
  localValue: unknown;
  remoteValue: unknown;
}

interface SharedArtMergeResult {
  conflicts: SharedArtMergeConflict[];
  mergedWorkspace: SharedArtWorkspacePayload;
}

function loadRecentSharedArtWorkspaces(): SharedArtRecentWorkspace[] {
  try {
    const storedRecentWorkspaces = localStorage.getItem(SHARED_ART_RECENT_WORKSPACES_STORAGE_KEY);
    if (!storedRecentWorkspaces) {
      return [];
    }

    const parsedRecentWorkspaces = JSON.parse(storedRecentWorkspaces) as unknown;
    if (!Array.isArray(parsedRecentWorkspaces)) {
      return [];
    }

    return parsedRecentWorkspaces
      .filter((workspace): workspace is SharedArtRecentWorkspace =>
        typeof workspace === 'object'
        && workspace !== null
        && typeof workspace.artName === 'string'
        && typeof workspace.artKey === 'string'
        && typeof workspace.databaseId === 'string',
      )
      .map((workspace) => ({
        artName: workspace.artName.trim(),
        artKey: workspace.artKey.trim(),
        databaseId: workspace.databaseId.trim(),
      }))
      .filter((workspace) => workspace.artKey !== '' && workspace.databaseId !== '');
  } catch {
    return [];
  }
}

function persistRecentSharedArtWorkspaces(recentWorkspaces: SharedArtRecentWorkspace[]): void {
  localStorage.setItem(
    SHARED_ART_RECENT_WORKSPACES_STORAGE_KEY,
    JSON.stringify(recentWorkspaces.slice(0, MAX_RECENT_SHARED_ARTS)),
  );
}

function upsertRecentSharedArtWorkspace(workspace: SharedArtRecentWorkspace): SharedArtRecentWorkspace[] {
  const nextRecentWorkspaces = [
    workspace,
    ...loadRecentSharedArtWorkspaces().filter((storedWorkspace) => storedWorkspace.databaseId !== workspace.databaseId),
  ].slice(0, MAX_RECENT_SHARED_ARTS);
  persistRecentSharedArtWorkspaces(nextRecentWorkspaces);
  return nextRecentWorkspaces;
}

function buildSharedArtWorkspacePayload(
  artName: string,
  artKey: string,
  teams: ArtTeam[],
  settings: ArtAdvancedSettings,
): SharedArtWorkspacePayload {
  return {
    schemaVersion: 1,
    artKey: artKey.trim(),
    artName: artName.trim() || artKey.trim(),
    updatedAt: new Date().toISOString(),
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      boardId: team.boardId,
      boardName: team.boardName,
      projectKey: team.projectKey,
      piReviewPageUrl: team.piReviewPageUrl,
      sosIssueKey: team.sosIssueKey,
    })),
    settings: {
      piFieldId: settings.piFieldId?.trim() || undefined,
      spFieldId: settings.spFieldId?.trim() || undefined,
      isSpAutoDetect: settings.isSpAutoDetect ?? false,
      featureLinkField: settings.featureLinkField?.trim() || undefined,
      featureProjectKeys: settings.featureProjectKeys?.map((featureProjectKey) => featureProjectKey.trim().toUpperCase()).filter(Boolean) ?? [],
      pCodeField: settings.pCodeField?.trim() || undefined,
      piReviewTargetStartFieldId: settings.piReviewTargetStartFieldId?.trim() || undefined,
      piReviewTargetEndFieldId: settings.piReviewTargetEndFieldId?.trim() || undefined,
      depLinkTypes: settings.depLinkTypes ?? DEFAULT_DEPENDENCY_LINK_TYPES,
      staleDays: settings.staleDays ?? DEFAULT_STALE_DAYS_SETTING,
      piEndDate: settings.piEndDate?.trim() || undefined,
      sprintWindowDays: settings.sprintWindowDays ?? DEFAULT_SPRINT_WINDOW_DAYS,
      piReviewPageUrl: settings.piReviewPageUrl?.trim() || undefined,
    },
  };
}

function cloneSharedArtWorkspacePayload(payload: SharedArtWorkspacePayload): SharedArtWorkspacePayload {
  return JSON.parse(JSON.stringify(payload)) as SharedArtWorkspacePayload;
}

function readSharedArtSyncSnapshots(): Record<string, SharedArtWorkspacePayload> {
  try {
    const storedSnapshots = JSON.parse(localStorage.getItem(SHARED_ART_SYNC_SNAPSHOTS_STORAGE_KEY) || '{}') as
      | Record<string, SharedArtWorkspacePayload>
      | null;
    return storedSnapshots ?? {};
  } catch {
    return {};
  }
}

function readSharedArtSyncSnapshot(databaseId: string): SharedArtWorkspacePayload | null {
  const storedSnapshot = readSharedArtSyncSnapshots()[databaseId];
  return storedSnapshot ? cloneSharedArtWorkspacePayload(storedSnapshot) : null;
}

function writeSharedArtSyncSnapshot(databaseId: string, payload: SharedArtWorkspacePayload): void {
  const storedSnapshots = readSharedArtSyncSnapshots();
  storedSnapshots[databaseId] = cloneSharedArtWorkspacePayload(payload);
  localStorage.setItem(SHARED_ART_SYNC_SNAPSHOTS_STORAGE_KEY, JSON.stringify(storedSnapshots));
}

function areSharedArtValuesEqual(leftValue: unknown, rightValue: unknown): boolean {
  return JSON.stringify(leftValue ?? null) === JSON.stringify(rightValue ?? null);
}

function mergeSharedArtField(
  baseValue: unknown,
  localValue: unknown,
  remoteValue: unknown,
): { mergedValue: unknown; isConflict: boolean } {
  if (areSharedArtValuesEqual(localValue, remoteValue)) {
    return { mergedValue: localValue, isConflict: false };
  }
  if (areSharedArtValuesEqual(baseValue, localValue)) {
    return { mergedValue: remoteValue, isConflict: false };
  }
  if (areSharedArtValuesEqual(baseValue, remoteValue)) {
    return { mergedValue: localValue, isConflict: false };
  }
  return { mergedValue: localValue, isConflict: true };
}

function buildSharedArtTeamOrder(
  baseTeams: SharedArtWorkspacePayload['teams'],
  localTeams: SharedArtWorkspacePayload['teams'],
  remoteTeams: SharedArtWorkspacePayload['teams'],
): string[] {
  const orderedTeamIds: string[] = [];
  const seenTeamIds = new Set<string>();
  for (const teamRecord of [...localTeams, ...remoteTeams, ...baseTeams]) {
    if (!seenTeamIds.has(teamRecord.id)) {
      seenTeamIds.add(teamRecord.id);
      orderedTeamIds.push(teamRecord.id);
    }
  }
  return orderedTeamIds;
}

function mergeSharedArtTeamRecord(
  teamId: string,
  baseTeam: SharedArtWorkspacePayload['teams'][number] | undefined,
  localTeam: SharedArtWorkspacePayload['teams'][number] | undefined,
  remoteTeam: SharedArtWorkspacePayload['teams'][number] | undefined,
): { conflicts: SharedArtMergeConflict[]; mergedTeam?: SharedArtWorkspacePayload['teams'][number] } {
  if (!baseTeam && !localTeam && !remoteTeam) {
    return { conflicts: [] };
  }
  if (!baseTeam && !localTeam && remoteTeam) {
    return { conflicts: [], mergedTeam: remoteTeam };
  }
  if (!baseTeam && localTeam && !remoteTeam) {
    return { conflicts: [], mergedTeam: localTeam };
  }
  if (baseTeam && !localTeam && !remoteTeam) {
    return { conflicts: [] };
  }
  if (baseTeam && !localTeam && remoteTeam) {
    if (areSharedArtValuesEqual(baseTeam, remoteTeam)) {
      return { conflicts: [] };
    }
    return {
      conflicts: [{ path: `teams.${teamId}`, localValue: undefined, remoteValue: remoteTeam }],
    };
  }
  if (baseTeam && localTeam && !remoteTeam) {
    if (areSharedArtValuesEqual(baseTeam, localTeam)) {
      return { conflicts: [] };
    }
    return {
      conflicts: [{ path: `teams.${teamId}`, localValue: localTeam, remoteValue: undefined }],
    };
  }

  const mergedTeam = { id: teamId } as SharedArtWorkspacePayload['teams'][number];
  const conflicts: SharedArtMergeConflict[] = [];
  for (const fieldName of SHARED_ART_TEAM_FIELD_NAMES) {
    const fieldMerge = mergeSharedArtField(baseTeam?.[fieldName], localTeam?.[fieldName], remoteTeam?.[fieldName]);
    if (fieldMerge.isConflict) {
      conflicts.push({
        path: `teams.${teamId}.${fieldName}`,
        localValue: localTeam?.[fieldName],
        remoteValue: remoteTeam?.[fieldName],
      });
      continue;
    }
    mergedTeam[fieldName] = fieldMerge.mergedValue as never;
  }
  return { conflicts, mergedTeam };
}

function mergeSharedArtWorkspacePayload(
  baseWorkspace: SharedArtWorkspacePayload,
  localWorkspace: SharedArtWorkspacePayload,
  remoteWorkspace: SharedArtWorkspacePayload,
): SharedArtMergeResult {
  const conflicts: SharedArtMergeConflict[] = [];
  const mergedSettings = {} as SharedArtWorkspacePayload['settings'];
  for (const fieldName of SHARED_ART_SETTINGS_FIELD_NAMES) {
    const fieldMerge = mergeSharedArtField(
      baseWorkspace.settings[fieldName],
      localWorkspace.settings[fieldName],
      remoteWorkspace.settings[fieldName],
    );
    if (fieldMerge.isConflict) {
      conflicts.push({
        path: `settings.${fieldName}`,
        localValue: localWorkspace.settings[fieldName],
        remoteValue: remoteWorkspace.settings[fieldName],
      });
      continue;
    }
    mergedSettings[fieldName] = fieldMerge.mergedValue as never;
  }

  const mergedWorkspace = {
    schemaVersion: remoteWorkspace.schemaVersion,
    artKey: localWorkspace.artKey,
    artName: localWorkspace.artName,
    updatedAt: new Date().toISOString(),
    teams: [] as SharedArtWorkspacePayload['teams'],
    settings: mergedSettings,
  };

  for (const fieldName of SHARED_ART_TOP_LEVEL_FIELD_NAMES) {
    const fieldMerge = mergeSharedArtField(baseWorkspace[fieldName], localWorkspace[fieldName], remoteWorkspace[fieldName]);
    if (fieldMerge.isConflict) {
      conflicts.push({
        path: `workspace.${fieldName}`,
        localValue: localWorkspace[fieldName],
        remoteValue: remoteWorkspace[fieldName],
      });
      continue;
    }
    mergedWorkspace[fieldName] = fieldMerge.mergedValue as never;
  }

  const baseTeamsById = new Map(baseWorkspace.teams.map((teamRecord) => [teamRecord.id, teamRecord]));
  const localTeamsById = new Map(localWorkspace.teams.map((teamRecord) => [teamRecord.id, teamRecord]));
  const remoteTeamsById = new Map(remoteWorkspace.teams.map((teamRecord) => [teamRecord.id, teamRecord]));
  for (const teamId of buildSharedArtTeamOrder(baseWorkspace.teams, localWorkspace.teams, remoteWorkspace.teams)) {
    const teamMerge = mergeSharedArtTeamRecord(
      teamId,
      baseTeamsById.get(teamId),
      localTeamsById.get(teamId),
      remoteTeamsById.get(teamId),
    );
    conflicts.push(...teamMerge.conflicts);
    if (teamMerge.mergedTeam) {
      mergedWorkspace.teams.push(teamMerge.mergedTeam);
    }
  }

  return { conflicts, mergedWorkspace };
}

function formatSharedArtMergeConflictMessage(conflicts: SharedArtMergeConflict[]): string {
  const summarizedPaths = conflicts.slice(0, 3).map((conflict) => conflict.path).join(', ');
  const remainingConflictSuffix = conflicts.length > 3 ? ` and ${conflicts.length - 3} more` : '';
  return `Shared ART push found conflicts with newer workspace changes. Load shared settings to review before pushing again. Conflicts: ${summarizedPaths}${remainingConflictSuffix}.`;
}

function readDependencyLinkTypeNames(issueLinkTypes: JiraIssueLinkTypeOption[]): string[] {
  const uniqueLinkTypeNames = new Set<string>();
  for (const issueLinkType of issueLinkTypes) {
    for (const linkTypeName of [issueLinkType.name, issueLinkType.inward, issueLinkType.outward]) {
      if (linkTypeName) {
        uniqueLinkTypeNames.add(linkTypeName);
      }
    }
  }

  return Array.from(uniqueLinkTypeNames).sort((leftName, rightName) => leftName.localeCompare(rightName));
}

/** Renders the Settings tab for managing ART team roster, board IDs, and advanced field configuration. */
function SettingsPanel({
  teams,
  onAddTeam,
  onReloadPiOptions,
  onReplaceTeams,
  onRemoveTeam,
  onSaveTeams,
  onUpdateTeamSosKey,
  onUpdateTeamPiReviewPageUrl,
  onUpdateTeamJiraLabel,
}: SettingsPanelProps) {
  const { showToast } = useToast();
  const [newTeamName, setNewTeamName] = useState('');
  const [newBoardId, setNewBoardId] = useState('');
  const [newBoardName, setNewBoardName] = useState('');
  const [newProjectKey, setNewProjectKey] = useState('');
  const [newSosIssueKey, setNewSosIssueKey] = useState('');

  const storedSettings = readArtAdvancedSettings();
  const [piFieldId, setPiFieldId] = useState(storedSettings.piFieldId ?? '');
  const [spFieldId, setSpFieldId] = useState(storedSettings.spFieldId ?? '');
  const [featureLinkField, setFeatureLinkField] = useState(storedSettings.featureLinkField ?? '');
  const [featureProjectKeysInput, setFeatureProjectKeysInput] = useState(
    formatFeatureProjectKeysInput(storedSettings.featureProjectKeys),
  );
  const [pCodeField, setPCodeField] = useState(storedSettings.pCodeField ?? '');
  const [piReviewTargetStartFieldId, setPiReviewTargetStartFieldId] = useState(
    readDefaultedPiReviewTargetStartFieldId(storedSettings.piReviewTargetStartFieldId),
  );
  const [piReviewTargetEndFieldId, setPiReviewTargetEndFieldId] = useState(
    readDefaultedPiReviewTargetEndFieldId(storedSettings.piReviewTargetEndFieldId),
  );
  const [staleDaysInput, setStaleDaysInput] = useState(
    String(storedSettings.staleDays ?? DEFAULT_STALE_DAYS_SETTING),
  );
  const [sprintWindowDaysInput, setSprintWindowDaysInput] = useState(
    String(storedSettings.sprintWindowDays ?? DEFAULT_SPRINT_WINDOW_DAYS),
  );
  const [piEndDate, setPiEndDate] = useState(storedSettings.piEndDate ?? '');
  const [piReviewPageUrl, setPiReviewPageUrl] = useState(
    storedSettings.piReviewPageUrl ?? storedSettings.piReviewPageId ?? '',
  );
  const [sharedArtName, setSharedArtName] = useState(storedSettings.sharedArtName ?? '');
  const [sharedArtKey, setSharedArtKey] = useState(storedSettings.sharedArtKey ?? '');
  const [sharedArtDatabaseId, setSharedArtDatabaseId] = useState(storedSettings.sharedArtDatabaseId ?? '');
  const [sharedArtSpaceId, setSharedArtSpaceId] = useState(storedSettings.sharedArtSpaceId ?? '');
  const [sharedArtParentId, setSharedArtParentId] = useState(storedSettings.sharedArtParentId ?? '');
  const [recentSharedArtWorkspaces, setRecentSharedArtWorkspaces] = useState(loadRecentSharedArtWorkspaces);
  const [isSpAutoDetect, setIsSpAutoDetect] = useState(storedSettings.isSpAutoDetect ?? false);
  const [dependencyLinkTypeOptions, setDependencyLinkTypeOptions] = useState<string[]>([]);
  const [selectedDependencyLinkTypes, setSelectedDependencyLinkTypes] = useState(
    storedSettings.depLinkTypes ?? DEFAULT_DEPENDENCY_LINK_TYPES,
  );
  const [isLoadingDependencyLinkTypes, setIsLoadingDependencyLinkTypes] = useState(false);
  const [dependencyLinkTypeError, setDependencyLinkTypeError] = useState<string | null>(null);
  const [sharedArtError, setSharedArtError] = useState<string | null>(null);
  const [sharedArtStatus, setSharedArtStatus] = useState('');
  const [isCreatingSharedArt, setIsCreatingSharedArt] = useState(false);
  const [isPublishingSharedArt, setIsPublishingSharedArt] = useState(false);
  const [isLoadingSharedArt, setIsLoadingSharedArt] = useState(false);
  const sharedArtWorkspaceDisplayValue = IS_SHARED_ART_WORKSPACE_SELECTION_LOCKED
    ? formatSharedArtWorkspaceDisplayValue(sharedArtName, sharedArtDatabaseId)
    : sharedArtDatabaseId;

  useEffect(() => {
    void loadDependencyLinkTypes();
  }, []);

  function handleAddTeam() {
    if (!newTeamName.trim() || !newBoardId.trim()) return;
    onAddTeam(
      newTeamName.trim(),
      newBoardId.trim(),
      newProjectKey.trim() || undefined,
      newBoardName.trim() || undefined,
      newSosIssueKey.trim() || undefined,
    );
    setNewTeamName('');
    setNewBoardId('');
    setNewBoardName('');
    setNewProjectKey('');
    setNewSosIssueKey('');
  }

  function handleSaveTeams() {
    onSaveTeams();
    showToast('Teams saved ✓', 'success');
  }

  /** Persists a single settings field change to localStorage. */
  function saveSettingField(fieldName: keyof ArtAdvancedSettings, value: string | number | boolean | string[]) {
    const current = readArtAdvancedSettings();
    writeArtAdvancedSettings({ ...current, [fieldName]: value });
  }

  function handlePiFieldChange(value: string) {
    setPiFieldId(value);
    saveSettingField('piFieldId', value);
    // Only trigger the expensive PI reload when the value is a complete Jira custom field
    // ID (e.g. "customfield_10301"). In the JiraFieldPicker fallback text-input path this
    // function fires on every keystroke, so the guard prevents noisy/stale reloads while
    // the user is still typing.
    if (VALID_CUSTOM_FIELD_ID_PATTERN.test(value)) {
      void onReloadPiOptions();
    }
  }

  function handleSpFieldChange(value: string) {
    setSpFieldId(value);
    saveSettingField('spFieldId', value);
  }

  function handleFeatureLinkFieldChange(value: string) {
    setFeatureLinkField(value);
    saveSettingField('featureLinkField', value);
  }

  function handleFeatureProjectKeysChange(value: string) {
    setFeatureProjectKeysInput(value);
    saveSettingField('featureProjectKeys', parseFeatureProjectKeysInput(value));
  }

  function handlePiReviewTargetStartFieldChange(value: string) {
    setPiReviewTargetStartFieldId(value);
    saveSettingField('piReviewTargetStartFieldId', value);
  }

  function handlePiReviewTargetEndFieldChange(value: string) {
    setPiReviewTargetEndFieldId(value);
    saveSettingField('piReviewTargetEndFieldId', value);
  }

  function handleStaleDaysChange(value: string) {
    setStaleDaysInput(value);
    const parsedDays = parseInt(value, 10);
    if (!isNaN(parsedDays) && parsedDays > 0) {
      saveSettingField('staleDays', parsedDays);
    }
  }

  function handleSprintWindowDaysChange(value: string) {
    setSprintWindowDaysInput(value);
    const parsedDays = parseInt(value, 10);
    if (!isNaN(parsedDays) && parsedDays > 0) {
      saveSettingField('sprintWindowDays', parsedDays);
    }
  }

  function handlePiEndDateChange(value: string) {
    setPiEndDate(value);
    saveSettingField('piEndDate', value);
  }

  function handlePiReviewPageUrlChange(value: string) {
    setPiReviewPageUrl(value);
    saveSettingField(PI_REVIEW_PAGE_URL_SETTING_KEY, value.trim());
    if (value.trim() !== '') {
      saveSettingField(PI_REVIEW_PAGE_ID_SETTING_KEY, '');
    }
  }

  function saveSharedArtWorkspaceReference(
    nextArtName: string,
    nextArtKey: string,
    nextDatabaseId: string,
    nextSpaceId: string,
    nextParentId: string,
  ) {
    saveSettingField('sharedArtName', nextArtName.trim());
    saveSettingField('sharedArtKey', nextArtKey.trim());
    saveSettingField('sharedArtDatabaseId', nextDatabaseId.trim());
    saveSettingField('sharedArtSpaceId', nextSpaceId.trim());
    saveSettingField('sharedArtParentId', nextParentId.trim());
  }

  function getCurrentAdvancedSettingsSnapshot(): ArtAdvancedSettings {
    return {
      ...readArtAdvancedSettings(),
      piFieldId,
      spFieldId,
      isSpAutoDetect,
      featureLinkField,
      featureProjectKeys: parseFeatureProjectKeysInput(featureProjectKeysInput),
      pCodeField,
      piReviewTargetStartFieldId,
      piReviewTargetEndFieldId,
      depLinkTypes: selectedDependencyLinkTypes,
      staleDays: Number.parseInt(staleDaysInput, 10) || DEFAULT_STALE_DAYS_SETTING,
      piEndDate,
      sprintWindowDays: Number.parseInt(sprintWindowDaysInput, 10) || DEFAULT_SPRINT_WINDOW_DAYS,
      piReviewPageUrl: piReviewPageUrl.trim() || undefined,
      sharedArtName: sharedArtName.trim() || undefined,
      sharedArtKey: sharedArtKey.trim() || undefined,
      sharedArtDatabaseId: sharedArtDatabaseId.trim() || undefined,
      sharedArtSpaceId: sharedArtSpaceId.trim() || undefined,
      sharedArtParentId: sharedArtParentId.trim() || undefined,
    };
  }

  function rememberSharedArtWorkspace(nextArtName: string, nextArtKey: string, nextDatabaseId: string) {
    setRecentSharedArtWorkspaces(
      upsertRecentSharedArtWorkspace({
        artName: nextArtName.trim() || nextArtKey.trim(),
        artKey: nextArtKey.trim(),
        databaseId: nextDatabaseId.trim(),
      }),
    );
  }

  function applyLoadedSharedArtWorkspace(
    sharedWorkspace: SharedArtWorkspacePayload,
    databaseId: string,
  ) {
    const nextArtName = sharedWorkspace.artName.trim() || sharedWorkspace.artKey.trim();
    const nextArtKey = sharedWorkspace.artKey.trim();
    const nextPiFieldId = sharedWorkspace.settings.piFieldId ?? '';
    const nextSpFieldId = sharedWorkspace.settings.spFieldId ?? '';
    const nextFeatureLinkField = sharedWorkspace.settings.featureLinkField ?? '';
    const nextFeatureProjectKeys = sharedWorkspace.settings.featureProjectKeys ?? [];
    const nextPCodeField = sharedWorkspace.settings.pCodeField ?? '';
    const nextPiReviewTargetStartFieldId = readDefaultedPiReviewTargetStartFieldId(
      sharedWorkspace.settings.piReviewTargetStartFieldId,
    );
    const nextPiReviewTargetEndFieldId = readDefaultedPiReviewTargetEndFieldId(
      sharedWorkspace.settings.piReviewTargetEndFieldId,
    );
    const nextStaleDays = sharedWorkspace.settings.staleDays ?? DEFAULT_STALE_DAYS_SETTING;
    const nextSprintWindowDays = sharedWorkspace.settings.sprintWindowDays ?? DEFAULT_SPRINT_WINDOW_DAYS;
    const nextPiEndDate = sharedWorkspace.settings.piEndDate ?? '';
    const nextPiReviewPageUrl = sharedWorkspace.settings.piReviewPageUrl ?? '';
    const nextDependencyLinkTypes = sharedWorkspace.settings.depLinkTypes ?? DEFAULT_DEPENDENCY_LINK_TYPES;
    const nextIsSpAutoDetect = sharedWorkspace.settings.isSpAutoDetect ?? false;

    onReplaceTeams(sharedWorkspace.teams);
    setSharedArtName(nextArtName);
    setSharedArtKey(nextArtKey);
    setSharedArtDatabaseId(databaseId);
    setPiFieldId(nextPiFieldId);
    setSpFieldId(nextSpFieldId);
    setFeatureLinkField(nextFeatureLinkField);
    setFeatureProjectKeysInput(formatFeatureProjectKeysInput(nextFeatureProjectKeys));
    setPCodeField(nextPCodeField);
    setPiReviewTargetStartFieldId(nextPiReviewTargetStartFieldId);
    setPiReviewTargetEndFieldId(nextPiReviewTargetEndFieldId);
    setStaleDaysInput(String(nextStaleDays));
    setSprintWindowDaysInput(String(nextSprintWindowDays));
    setPiEndDate(nextPiEndDate);
    setPiReviewPageUrl(nextPiReviewPageUrl);
    setSelectedDependencyLinkTypes(nextDependencyLinkTypes);
    setIsSpAutoDetect(nextIsSpAutoDetect);

    const nextSettings: ArtAdvancedSettings = {
      ...readArtAdvancedSettings(),
      piFieldId: nextPiFieldId,
      spFieldId: nextSpFieldId,
      isSpAutoDetect: nextIsSpAutoDetect,
      featureLinkField: nextFeatureLinkField,
      featureProjectKeys: nextFeatureProjectKeys,
      pCodeField: nextPCodeField,
      piReviewTargetStartFieldId: nextPiReviewTargetStartFieldId,
      piReviewTargetEndFieldId: nextPiReviewTargetEndFieldId,
      depLinkTypes: nextDependencyLinkTypes,
      staleDays: nextStaleDays,
      piEndDate: nextPiEndDate,
      sprintWindowDays: nextSprintWindowDays,
      piReviewPageId: '',
      piReviewPageUrl: nextPiReviewPageUrl,
      sharedArtName: nextArtName,
      sharedArtKey: nextArtKey,
      sharedArtDatabaseId: databaseId,
      sharedArtSpaceId: sharedArtSpaceId.trim() || undefined,
      sharedArtParentId: sharedArtParentId.trim() || undefined,
    };
    writeArtAdvancedSettings(nextSettings);
    rememberSharedArtWorkspace(nextArtName, nextArtKey, databaseId);
  }

  async function handleCreateSharedArtWorkspace() {
    const normalizedSharedArtKey = sharedArtKey.trim();
    const normalizedSharedArtSpaceId = sharedArtSpaceId.trim();
    const normalizedSharedArtParentId = sharedArtParentId.trim();
    const normalizedSharedArtName = sharedArtName.trim();
    const normalizedArtShortName = normalizedSharedArtKey || normalizedSharedArtName;

    if (normalizedSharedArtName === '' || normalizedSharedArtSpaceId === '') {
      setSharedArtError('Shared ART Name and Confluence Space ID are required before creating a workspace.');
      return;
    }

    setIsCreatingSharedArt(true);
    setSharedArtError(null);
    setSharedArtStatus('');
    try {
      const createdDatabase = await createConfluenceDatabase({
        spaceId: normalizedSharedArtSpaceId,
        title: normalizedSharedArtName,
        parentId: normalizedSharedArtParentId || undefined,
      });
      const sharedWorkspacePayload = buildSharedArtWorkspacePayload(
        normalizedSharedArtName,
        normalizedArtShortName,
        teams,
        getCurrentAdvancedSettingsSnapshot(),
      );
      await saveSharedArtWorkspace(createdDatabase.id, sharedWorkspacePayload);
      writeSharedArtSyncSnapshot(createdDatabase.id, sharedWorkspacePayload);

      setSharedArtName(normalizedSharedArtName);
      setSharedArtDatabaseId(createdDatabase.id);
      saveSharedArtWorkspaceReference(
        normalizedSharedArtName,
        normalizedArtShortName,
        createdDatabase.id,
        normalizedSharedArtSpaceId,
        normalizedSharedArtParentId,
      );
      rememberSharedArtWorkspace(normalizedSharedArtName, normalizedArtShortName, createdDatabase.id);
      setSharedArtStatus(`Created shared ART workspace ${normalizedSharedArtName} (${createdDatabase.id}).`);
      showToast('Shared ART workspace created ✓', 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create the shared ART workspace.';
      setSharedArtError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setIsCreatingSharedArt(false);
    }
  }

  async function handlePublishSharedArtWorkspace() {
    const normalizedSharedArtKey = sharedArtKey.trim();
    const normalizedDatabaseId = sharedArtDatabaseId.trim();
    const normalizedSharedArtName = sharedArtName.trim();
    const normalizedArtShortName = normalizedSharedArtKey || normalizedSharedArtName;

    if (normalizedSharedArtName === '' || normalizedDatabaseId === '') {
      setSharedArtError('Shared ART Name and Shared ART Database ID are required before publishing.');
      return;
    }

    setIsPublishingSharedArt(true);
    setSharedArtError(null);
    setSharedArtStatus('');
    try {
      const localWorkspacePayload = buildSharedArtWorkspacePayload(
        normalizedSharedArtName,
        normalizedArtShortName,
        teams,
        getCurrentAdvancedSettingsSnapshot(),
      );
      let workspacePayloadToSave = localWorkspacePayload;
      try {
        const remoteWorkspacePayload = await loadSharedArtWorkspace(normalizedDatabaseId);
        const baseWorkspaceSnapshot = readSharedArtSyncSnapshot(normalizedDatabaseId);
        if (!baseWorkspaceSnapshot) {
          const missingSnapshotMessage = 'Load shared settings from workspace once before pushing so Toolbox can merge safely.';
          setSharedArtError(missingSnapshotMessage);
          showToast(missingSnapshotMessage, 'error');
          return;
        }

        const mergeResult = mergeSharedArtWorkspacePayload(
          baseWorkspaceSnapshot,
          localWorkspacePayload,
          remoteWorkspacePayload,
        );
        if (mergeResult.conflicts.length > 0) {
          const conflictMessage = formatSharedArtMergeConflictMessage(mergeResult.conflicts);
          setSharedArtError(conflictMessage);
          showToast(conflictMessage, 'error');
          return;
        }
        workspacePayloadToSave = mergeResult.mergedWorkspace;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to load the shared ART workspace before publishing.';
        if (!errorMessage.includes('does not contain a NodeToolbox shared ART workspace yet')) {
          throw error;
        }
      }

      await saveSharedArtWorkspace(normalizedDatabaseId, workspacePayloadToSave);
      writeSharedArtSyncSnapshot(normalizedDatabaseId, workspacePayloadToSave);
      applyLoadedSharedArtWorkspace(workspacePayloadToSave, normalizedDatabaseId);
      saveSharedArtWorkspaceReference(
        workspacePayloadToSave.artName,
        workspacePayloadToSave.artKey,
        normalizedDatabaseId,
        sharedArtSpaceId,
        sharedArtParentId,
      );
      rememberSharedArtWorkspace(workspacePayloadToSave.artName, workspacePayloadToSave.artKey, normalizedDatabaseId);
      setSharedArtStatus(`Published local ART settings to shared workspace ${normalizedDatabaseId}.`);
      showToast('Shared ART published ✓', 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to publish the shared ART workspace.';
      setSharedArtError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setIsPublishingSharedArt(false);
    }
  }

  async function handleLoadSharedArtWorkspace() {
    const normalizedDatabaseId = sharedArtDatabaseId.trim();
    if (normalizedDatabaseId === '') {
      setSharedArtError('Shared ART Database ID is required before loading.');
      return;
    }

    setIsLoadingSharedArt(true);
    setSharedArtError(null);
    setSharedArtStatus('');
    try {
      const sharedWorkspace = await loadSharedArtWorkspace(normalizedDatabaseId);
      applyLoadedSharedArtWorkspace(sharedWorkspace, normalizedDatabaseId);
      writeSharedArtSyncSnapshot(normalizedDatabaseId, sharedWorkspace);
      saveSharedArtWorkspaceReference(
        sharedWorkspace.artName,
        sharedWorkspace.artKey,
        normalizedDatabaseId,
        sharedArtSpaceId,
        sharedArtParentId,
      );
      await onReloadPiOptions();
      setSharedArtStatus(`Loaded shared ART workspace ${sharedWorkspace.artName} (${normalizedDatabaseId}).`);
      showToast('Shared ART loaded ✓', 'success');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load the shared ART workspace.';
      setSharedArtError(errorMessage);
      showToast(errorMessage, 'error');
    } finally {
      setIsLoadingSharedArt(false);
    }
  }

  function handleRecentSharedArtChange(databaseId: string) {
    const selectedWorkspace = recentSharedArtWorkspaces.find((workspace) => workspace.databaseId === databaseId);
    setSharedArtDatabaseId(databaseId);
    saveSettingField('sharedArtDatabaseId', databaseId);

    if (!selectedWorkspace) {
      return;
    }

    setSharedArtName(selectedWorkspace.artName);
    setSharedArtKey(selectedWorkspace.artKey);
    saveSettingField('sharedArtName', selectedWorkspace.artName);
    saveSettingField('sharedArtKey', selectedWorkspace.artKey);
  }

  function handlePCodeFieldChange(value: string) {
    setPCodeField(value);
    saveSettingField('pCodeField', value);
  }

  function handleIsSpAutoDetectChange(checked: boolean) {
    setIsSpAutoDetect(checked);
    saveSettingField('isSpAutoDetect', checked);
  }

  async function loadDependencyLinkTypes() {
    setIsLoadingDependencyLinkTypes(true);
    setDependencyLinkTypeError(null);
    try {
      const response = await jiraGet<{ issueLinkTypes?: JiraIssueLinkTypeOption[] }>('/rest/api/2/issueLinkType');
      setDependencyLinkTypeOptions(readDependencyLinkTypeNames(response.issueLinkTypes ?? []));
    } catch (error) {
      setDependencyLinkTypeError(error instanceof Error ? error.message : 'Failed to load dependency link types');
    } finally {
      setIsLoadingDependencyLinkTypes(false);
    }
  }

  function handleDependencyLinkTypeToggle(dependencyLinkType: string, isChecked: boolean) {
    const nextDependencyLinkTypes = isChecked
      ? Array.from(new Set([...selectedDependencyLinkTypes, dependencyLinkType]))
      : selectedDependencyLinkTypes.filter((storedLinkType) => storedLinkType !== dependencyLinkType);
    setSelectedDependencyLinkTypes(nextDependencyLinkTypes);
    saveSettingField('depLinkTypes', nextDependencyLinkTypes);
  }

  return (
    <div className={styles.panel}>
      <h3 className={styles.sectionTitle}>Team Settings</h3>
      <div className={styles.addTeamForm}>
        <input
          type="text"
          className={styles.textInput}
          placeholder="Team name"
          value={newTeamName}
          onChange={(event) => setNewTeamName(event.target.value)}
        />
        <JiraBoardPicker
          id="art-board-picker"
          label="Board"
          onBoardSelected={(selectedBoard) => setNewBoardName(selectedBoard?.name ?? '')}
          onChange={(boardId) => {
            setNewBoardId(boardId);
            if (boardId === '') {
              setNewBoardName('');
            }
          }}
          placeholder="Select a board"
          projectKey={newProjectKey || undefined}
          value={newBoardId}
        />
        <JiraProjectPicker
          id="art-project-picker"
          label="Project"
          onChange={setNewProjectKey}
          placeholder="Select a project"
          value={newProjectKey}
        />
        <input
          aria-label="SoS Issue Key (optional)"
          className={styles.textInput}
          onChange={(event) => setNewSosIssueKey(event.target.value)}
          placeholder="SoS Issue Key (optional)"
          type="text"
          value={newSosIssueKey}
        />
        <button className={styles.primaryBtn} onClick={handleAddTeam}>
          Add Team
        </button>
      </div>

      <div className={styles.settingsButtonRow}>
        <button className={styles.secondaryBtn} onClick={handleSaveTeams} type="button">
          Save Teams
        </button>
      </div>

      <div className={styles.teamList}>
        <p className={styles.settingsSectionHint}>
          Each team row can carry its own PI Review page URL. The PI Review tab loads one Confluence page per configured team.
        </p>
        {teams.length === 0 && (
          <p className={styles.emptyState}>No teams configured yet.</p>
        )}
        {teams.map((team) => (
          <div key={team.id} className={styles.teamListRow}>
            <span className={styles.teamName}>{team.name}</span>
            <span className={styles.boardId}>{team.boardName ?? `Board ${team.boardId}`}</span>
            {team.projectKey && (
              <span className={styles.projectKeyBadge}>{team.projectKey}</span>
            )}
            {/* Per-team SoS issue key — auto-saved on change so no extra Save click is needed */}
            <input
              aria-label={`SoS Issue Key for ${team.name}`}
              className={styles.textInput}
              onChange={(event) => onUpdateTeamSosKey(team.id, event.target.value)}
              placeholder="SoS Issue Key"
              type="text"
              value={team.sosIssueKey ?? ''}
            />
            <input
              aria-label={`PI Review Page URL for ${team.name}`}
              className={styles.textInput}
              onChange={(event) => onUpdateTeamPiReviewPageUrl(team.id, event.target.value)}
              placeholder="PI Review Page URL"
              type="text"
              value={team.piReviewPageUrl ?? ''}
            />
            <input
              aria-label={`Jira Label for ${team.name}`}
              className={styles.textInput}
              onChange={(event) => onUpdateTeamJiraLabel(team.id, event.target.value)}
              placeholder="Jira Label (e.g. Transformers)"
              type="text"
              value={team.jiraLabel ?? ''}
            />
            <button className={styles.removeBtn} onClick={() => onRemoveTeam(team.id)}>
              Remove
            </button>
          </div>
        ))}
      </div>

      {/* Advanced ART Settings — saved to localStorage under 'tbxARTSettings' */}
      <div className={styles.settingsSection}>
        <h4 className={styles.settingsSectionTitle}>Advanced ART Settings</h4>
        <p className={styles.settingsSectionHint}>
          These field IDs and values are used by Blueprint, Dependencies, SoS, and the stale-issue detector.
          Changes take effect immediately and are saved to your browser.
        </p>

        <div className={styles.settingsFieldRow}>
          <JiraFieldPicker
            id="art-pi-field"
            label="PI Field"
            onChange={handlePiFieldChange}
            placeholder="PI allocation field"
            value={piFieldId}
          />
        </div>

        <div className={styles.settingsFieldRow}>
          <JiraFieldPicker
            id="art-sp-field"
            label="Story Points Field"
            onChange={handleSpFieldChange}
            placeholder="Story points field"
            value={spFieldId}
          />
        </div>

        {/* Auto-detect toggle: when checked, the secondary story-point field (customfield_10028) is
            tried automatically so teams whose Jira instances use the alternate field get correct counts. */}
        <div className={styles.settingsFieldRow}>
          <label className={styles.settingsCheckboxLabel}>
            <input
              aria-label="Auto-detect story points"
              checked={isSpAutoDetect}
              className={styles.settingsCheckbox}
              onChange={(event) => handleIsSpAutoDetectChange(event.target.checked)}
              type="checkbox"
            />
            Auto-detect story points (try secondary field automatically)
          </label>
        </div>

        <div className={styles.settingsFieldRow}>
          <JiraFieldPicker
            id="art-feature-link-field"
            label="Feature Link Field"
            onChange={handleFeatureLinkFieldChange}
            placeholder="Feature link field"
            value={featureLinkField}
          />
        </div>

        <div className={styles.settingsFieldRow}>
          <label className={styles.settingsFieldLabel}>Feature Project Filter</label>
          <input
            aria-label="Feature Project Filter"
            className={styles.textInput}
            onChange={(event) => handleFeatureProjectKeysChange(event.target.value)}
            placeholder="DENP, ENFCT"
            type="text"
            value={featureProjectKeysInput}
          />
          <p className={styles.settingsFieldHint}>
            Optional comma-separated feature project keys for Team Dashboard carryover remap and Feature Review.
          </p>
        </div>

        <div className={styles.settingsFieldRow}>
          <JiraFieldPicker
            id="art-pi-review-target-start-field"
            label="PI Review Target Start Field"
            onChange={handlePiReviewTargetStartFieldChange}
            placeholder="Target start field"
            value={piReviewTargetStartFieldId}
          />
        </div>

        <div className={styles.settingsFieldRow}>
          <JiraFieldPicker
            id="art-pi-review-target-end-field"
            label="PI Review Target End Field"
            onChange={handlePiReviewTargetEndFieldChange}
            placeholder="Target end field"
            value={piReviewTargetEndFieldId}
          />
        </div>

        <div className={styles.settingsFieldRow}>
          <div className={styles.settingsFieldBlock}>
            <div className={styles.settingsFieldHeader}>
              <label className={styles.settingsFieldLabel}>Dependency Link Types</label>
              <button className={styles.secondaryBtn} disabled={isLoadingDependencyLinkTypes} onClick={() => void loadDependencyLinkTypes()} type="button">
                {isLoadingDependencyLinkTypes ? 'Loading…' : 'Reload Link Types'}
              </button>
            </div>
            <p className={styles.settingsFieldHint}>
              Choose which Jira link types the dependency graph should include by default.
            </p>
            {dependencyLinkTypeError && <p className={styles.errorText}>{dependencyLinkTypeError}</p>}
            {dependencyLinkTypeOptions.length === 0 && !isLoadingDependencyLinkTypes && !dependencyLinkTypeError && (
              <p className={styles.emptyState}>No Jira link types are loaded yet.</p>
            )}
            {dependencyLinkTypeOptions.length > 0 && (
              <div className={styles.toggleButtonGrid}>
                {dependencyLinkTypeOptions.map((dependencyLinkType) => (
                  <button
                    aria-label={`Dependency link type ${dependencyLinkType}`}
                    aria-pressed={selectedDependencyLinkTypes.includes(dependencyLinkType)}
                    className={[
                      styles.toggleButtonChip,
                      selectedDependencyLinkTypes.includes(dependencyLinkType) ? styles.toggleButtonChipSelected : '',
                    ].join(' ').trim()}
                    key={dependencyLinkType}
                    onClick={() => handleDependencyLinkTypeToggle(
                      dependencyLinkType,
                      !selectedDependencyLinkTypes.includes(dependencyLinkType),
                    )}
                    type="button"
                  >
                    {dependencyLinkType}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* P-Code field: the Jira custom field used to store a portfolio/program code that links
            features to their parent Capabilities or Epics in the portfolio backlog. */}
        <div className={styles.settingsFieldRow}>
          <JiraFieldPicker
            id="art-pcode-field"
            label="P-Code Field"
            onChange={handlePCodeFieldChange}
            placeholder="Program/portfolio code field"
            value={pCodeField}
          />
        </div>

        <div className={styles.settingsFieldRow}>
          <label className={styles.settingsFieldLabel}>Stale Days Threshold</label>
          <input
            aria-label="Stale Days Threshold"
            className={styles.textInput}
            max={90}
            min={1}
            onChange={(event) => handleStaleDaysChange(event.target.value)}
            placeholder={String(DEFAULT_STALE_DAYS_SETTING)}
            type="number"
            value={staleDaysInput}
          />
        </div>

        {/* Sprint window: how many calendar days a sprint covers. Used for burndown projections
            and to determine whether an in-progress issue is mid-sprint or nearing end-of-sprint. */}
        <div className={styles.settingsFieldRow}>
          <label className={styles.settingsFieldLabel}>Sprint Window (days)</label>
          <input
            aria-label="Sprint Window Days"
            className={styles.textInput}
            max={90}
            min={1}
            onChange={(event) => handleSprintWindowDaysChange(event.target.value)}
            placeholder={String(DEFAULT_SPRINT_WINDOW_DAYS)}
            type="number"
            value={sprintWindowDaysInput}
          />
        </div>

        {/* PI End Date: the last day of the current PI. Used by Overview and SoS panels to
            show how many days remain and to colour-code urgency indicators. */}
        <div className={styles.settingsFieldRow}>
          <label className={styles.settingsFieldLabel}>PI End Date</label>
          <input
            aria-label="PI End Date"
            className={styles.textInput}
            onChange={(event) => handlePiEndDateChange(event.target.value)}
            type="text"
            value={piEndDate}
            placeholder="YYYY-MM-DD"
          />
        </div>

        <div className={styles.settingsFieldRow}>
          <div className={styles.settingsFieldBlock}>
            <label className={styles.settingsFieldLabel} htmlFor="art-pi-review-page-url">Default PI Review Confluence Page URL or ID</label>
            <input
              aria-label="Default PI Review Confluence Page URL or ID"
              className={styles.textInput}
              id="art-pi-review-page-url"
              onChange={(event) => handlePiReviewPageUrlChange(event.target.value)}
              placeholder="Full Confluence page URL or numeric page ID"
              type="text"
              value={piReviewPageUrl}
            />
            <p className={styles.settingsFieldHint}>
              Prefer team-specific PI Review page URLs in the team list above. This shared default is used only when no team-specific PI Review pages are configured yet.
            </p>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <h4 className={styles.settingsSectionTitle}>Shared ART Workspace (Experimental)</h4>
          <p className={styles.settingsSectionHint}>
            This experimental flow creates a real Confluence Database and stores the shared ART setup in supported database content properties.
            It shares team roster and ART settings across NodeToolbox instances without requiring a separate server.
          </p>

          <div className={styles.sharedArtWorkflowSection}>
            <h5 className={styles.sharedArtWorkflowTitle}>1. First-Time Setup</h5>
            <p className={styles.sharedArtWorkflowHint}>
              Create the Confluence workspace once. Toolbox creates the workspace and fills in the Shared ART Database ID for future sync.
            </p>

            <div className={styles.settingsFieldRow}>
              <div className={styles.settingsFieldBlock}>
                <label className={styles.settingsFieldLabel}>Shared ART Name</label>
                <input
                  aria-label="Shared ART Name"
                  className={styles.textInput}
                  onChange={(event) => {
                    setSharedArtName(event.target.value);
                    saveSettingField('sharedArtName', event.target.value.trim());
                  }}
                  placeholder="Platform Engineering ART"
                  type="text"
                  value={sharedArtName}
                />
                <p className={styles.settingsFieldHint}>
                  Required for setup. This becomes the workspace title that Toolbox creates in Confluence.
                </p>
              </div>
            </div>

            <div className={styles.settingsFieldRow}>
              <div className={styles.settingsFieldBlock}>
                <label className={styles.settingsFieldLabel}>ART Short Name (optional)</label>
                <input
                  aria-label="ART Short Name"
                  className={styles.textInput}
                  onChange={(event) => {
                    setSharedArtKey(event.target.value);
                    saveSettingField('sharedArtKey', event.target.value.trim());
                  }}
                  placeholder="S2E"
                  type="text"
                  value={sharedArtKey}
                />
                <p className={styles.settingsFieldHint}>
                  Optional short label for the ART workspace. This is only a friendly NodeToolbox label and is not tied to Jira.
                </p>
              </div>
            </div>

            <div className={styles.settingsFieldRow}>
              <div className={styles.settingsFieldBlock}>
                <label className={styles.settingsFieldLabel}>Confluence Space ID</label>
                <input
                  aria-label="Confluence Space ID"
                  className={styles.textInput}
                  onChange={(event) => {
                    setSharedArtSpaceId(event.target.value);
                    saveSettingField('sharedArtSpaceId', event.target.value.trim());
                  }}
                  placeholder="Required for setup only"
                  type="text"
                  value={sharedArtSpaceId}
                />
                <p className={styles.settingsFieldHint}>
                  Required only when creating a new workspace. Toolbox does not need this for later push or load actions.
                </p>
              </div>
            </div>

            <div className={styles.settingsFieldRow}>
              <div className={styles.settingsFieldBlock}>
                <label className={styles.settingsFieldLabel}>Parent Content ID (optional)</label>
                <input
                  aria-label="Parent Content ID"
                  className={styles.textInput}
                  onChange={(event) => {
                    setSharedArtParentId(event.target.value);
                    saveSettingField('sharedArtParentId', event.target.value.trim());
                  }}
                  placeholder="Optional page or folder ID"
                  type="text"
                  value={sharedArtParentId}
                />
                <p className={styles.settingsFieldHint}>
                  Use this only if the new Confluence workspace should be created under a specific parent page or folder.
                </p>
              </div>
            </div>

            <div className={styles.settingsButtonRow}>
              <button
                className={styles.primaryBtn}
                disabled={isCreatingSharedArt}
                onClick={() => void handleCreateSharedArtWorkspace()}
                type="button"
              >
                {isCreatingSharedArt ? 'Creating…' : 'Create New Shared ART Workspace'}
              </button>
            </div>
          </div>

          <div className={styles.sharedArtWorkflowSection}>
            <h5 className={styles.sharedArtWorkflowTitle}>2. Sync an Existing Workspace</h5>
            <p className={styles.sharedArtWorkflowHint}>
              Use this after a workspace already exists. Load pulls shared settings into this browser, while Push publishes your local ART settings back to Confluence.
            </p>

            {recentSharedArtWorkspaces.length > 0 && !IS_SHARED_ART_WORKSPACE_SELECTION_LOCKED && (
              <div className={styles.settingsFieldRow}>
                <div className={styles.settingsFieldBlock}>
                  <label className={styles.settingsFieldLabel} htmlFor="art-shared-recent">Recent Shared ARTs</label>
                  <select
                    aria-label="Recent Shared ARTs"
                    className={styles.textInput}
                    id="art-shared-recent"
                    onChange={(event) => handleRecentSharedArtChange(event.target.value)}
                    value={sharedArtDatabaseId}
                  >
                    <option value="">Select a recent shared ART</option>
                    {recentSharedArtWorkspaces.map((workspace) => (
                      <option key={workspace.databaseId} value={workspace.databaseId}>
                        {workspace.artKey} — {workspace.artName}
                      </option>
                    ))}
                  </select>
                  <p className={styles.settingsFieldHint}>
                    Pick a recent workspace to refill the database ID and friendly labels on this device.
                  </p>
                </div>
              </div>
            )}

            <div className={styles.settingsFieldRow}>
              <div className={styles.settingsFieldBlock}>
                <label className={styles.settingsFieldLabel}>Shared ART Database ID</label>
                <input
                  aria-label="Shared ART Database ID"
                  className={styles.textInput}
                  onChange={
                    IS_SHARED_ART_WORKSPACE_SELECTION_LOCKED
                      ? undefined
                      : (event) => {
                          setSharedArtDatabaseId(event.target.value);
                          saveSettingField('sharedArtDatabaseId', event.target.value.trim());
                        }
                  }
                  placeholder={IS_SHARED_ART_WORKSPACE_SELECTION_LOCKED ? undefined : 'Paste an existing Confluence database ID'}
                  readOnly={IS_SHARED_ART_WORKSPACE_SELECTION_LOCKED}
                  type="text"
                  value={sharedArtWorkspaceDisplayValue}
                />
                <p className={styles.settingsFieldHint}>
                  {IS_SHARED_ART_WORKSPACE_SELECTION_LOCKED
                    ? 'Toolbox is currently locked to the published Sales To Enrollment shared ART workspace, so this reference is shown for visibility only.'
                    : 'Required for sync. Toolbox fills this in after Create, or you can paste an existing database ID to connect to a shared workspace.'}
                </p>
              </div>
            </div>

            <div className={styles.settingsButtonRow}>
              <button
                className={styles.secondaryBtn}
                disabled={isPublishingSharedArt}
                onClick={() => void handlePublishSharedArtWorkspace()}
                type="button"
              >
                {isPublishingSharedArt ? 'Publishing…' : 'Push Local Settings to Workspace'}
              </button>
              <button
                className={styles.secondaryBtn}
                disabled={isLoadingSharedArt}
                onClick={() => void handleLoadSharedArtWorkspace()}
                type="button"
              >
                {isLoadingSharedArt ? 'Loading…' : 'Load Shared Settings from Workspace'}
              </button>
            </div>
          </div>

          {sharedArtStatus && <p className={styles.metricSummary}>{sharedArtStatus}</p>}
          {sharedArtError && <p className={styles.errorText}>{sharedArtError}</p>}
        </div>
      </div>
    </div>
  );
}
