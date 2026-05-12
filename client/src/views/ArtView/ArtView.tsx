// ArtView.tsx — Tabbed ART (Agile Release Train) view for multi-team PI planning and health dashboards.

import { Fragment, useState } from 'react';

import IssueDetailPanel from '../../components/IssueDetailPanel/index.tsx';
import { useToast } from '../../components/Toast/ToastProvider.tsx';
import JiraBoardPicker from '../../components/JiraBoardPicker/index.tsx';
import JiraFieldPicker from '../../components/JiraFieldPicker/index.tsx';
import JiraProjectPicker from '../../components/JiraProjectPicker/index.tsx';
import BlueprintTab from './BlueprintTab.tsx';
import DependenciesTab from './DependenciesTab.tsx';
import type { ArtTab, ArtTeam, ArtBoardPrepIssue, PiProgressStats } from './hooks/useArtData.ts';
import { useArtData } from './hooks/useArtData.ts';
import styles from './ArtView.module.css';

// ── Constants ──

const ART_TAB_DEFINITIONS: { key: ArtTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'impediments', label: 'Impediments' },
  { key: 'predictability', label: 'Predictability' },
  { key: 'releases', label: 'Releases' },
  { key: 'blueprint', label: 'Blueprint' },
  { key: 'dependencies', label: 'Dependencies' },
  { key: 'boardprep', label: 'Board Prep' },
  { key: 'sos', label: 'SoS' },
  { key: 'monthly', label: 'Monthly Report' },
  { key: 'settings', label: 'Settings' },
];

// ── Main ArtView component ──

/** Main ART View with 10 tabs for tracking multi-team PI health across the Agile Release Train. */
export default function ArtView() {
  const { state, actions } = useArtData();
  const [teamProjectKeyFilter, setTeamProjectKeyFilter] = useState('');

  const filteredTeams = teamProjectKeyFilter
    ? state.teams.filter((team) =>
        (team.projectKey ?? '').toLowerCase().includes(teamProjectKeyFilter.toLowerCase()),
      )
    : state.teams;

  function handleIssueUpdated() {
    void actions.loadAllTeams();
  }

  return (
    <div className={styles.artView}>
      <PiProgressHeader piName={state.selectedPiName} stats={state.piProgressStats} />

      <div className={styles.tabBar} role="tablist">
        {ART_TAB_DEFINITIONS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={state.activeTab === tab.key}
            className={`${styles.tabBtn} ${state.activeTab === tab.key ? styles.tabBtnActive : ''}`}
            onClick={() => actions.setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={styles.tabContent}>
        {state.activeTab === 'overview' && (
          <OverviewPanel
            teamProjectKeyFilter={teamProjectKeyFilter}
            teams={filteredTeams}
            isLoadingAllTeams={state.isLoadingAllTeams}
            onLoadAllTeams={actions.loadAllTeams}
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
        {state.activeTab === 'blueprint' && (
          <BlueprintTab teams={state.teams} selectedPiName={state.selectedPiName} />
        )}
        {state.activeTab === 'dependencies' && (
          <DependenciesTab teams={state.teams} />
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
            onRemoveTeam={actions.removeTeam}
            onSaveTeams={actions.saveTeams}
          />
        )}
      </div>
    </div>
  );
}

// ── Feature 3: PI Progress Header ──

interface PiProgressHeaderProps {
  piName: string;
  stats: PiProgressStats;
}

/** Renders the PI-level progress bar above the tab bar, showing overall completion across all teams. */
function PiProgressHeader({ piName, stats }: PiProgressHeaderProps) {
  const displayName = piName.trim() || 'No PI selected';
  const progressBarWidth = `${stats.completionPercent}%`;

  return (
    <div className={styles.piProgressHeader}>
      <span className={styles.piProgressName}>{displayName}</span>
      <div className={styles.piProgressBarTrack}>
        <div className={styles.piProgressBarFill} style={{ width: progressBarWidth }} />
      </div>
      <span className={styles.piProgressPercent}>{stats.completionPercent}%</span>
      <span className={styles.piProgressPill + ' ' + styles.piProgressPillDone}>{stats.doneCount} done</span>
      <span className={styles.piProgressPill + ' ' + styles.piProgressPillInProgress}>{stats.inProgressCount} in progress</span>
      <span className={styles.piProgressPill + ' ' + styles.piProgressPillToDo}>{stats.toDoCount} to do</span>
    </div>
  );
}

// ── Original panel components ──

interface OverviewPanelProps {
  teams: ArtTeam[];
  teamProjectKeyFilter: string;
  isLoadingAllTeams: boolean;
  onLoadAllTeams: () => Promise<void>;
  onLoadTeam: (teamId: string) => Promise<void>;
  onTeamProjectKeyFilterChange: (value: string) => void;
}

/** Renders the Overview tab with team health cards and the Load All Teams control. */
function OverviewPanel({
  teams,
  teamProjectKeyFilter,
  isLoadingAllTeams,
  onLoadAllTeams,
  onLoadTeam,
  onTeamProjectKeyFilterChange,
}: OverviewPanelProps) {
  return (
    <div className={styles.panel}>
      <div className={styles.overviewControls}>
        <button
          className={styles.primaryBtn}
          onClick={() => onLoadAllTeams()}
          disabled={isLoadingAllTeams}
        >
          {isLoadingAllTeams ? 'Loading…' : 'Load All Teams'}
        </button>
      </div>
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
          <TeamCard key={team.id} team={team} onLoad={onLoadTeam} />
        ))}
      </div>
    </div>
  );
}

interface TeamCardProps {
  team: ArtTeam;
  onLoad: (teamId: string) => Promise<void>;
}

/** Renders a single team's sprint summary card. */
function TeamCard({ team, onLoad }: TeamCardProps) {
  return (
    <div className={styles.teamCard}>
      <div className={styles.teamCardHeader}>
        <span className={styles.teamName}>{team.name}</span>
        <span className={styles.boardId}>Board {team.boardId}</span>
      </div>
      {team.loadError && <p className={styles.errorText}>{team.loadError}</p>}
      {team.isLoading && <p className={styles.loadingText}>Loading…</p>}
      {!team.isLoading && !team.loadError && (
        <p className={styles.issueCount}>{team.sprintIssues.length} sprint issues</p>
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

interface ImpedimentsPanelProps extends TeamsPanelProps {
  teamProjectKeyFilter: string;
  onIssueUpdated: () => void;
  onTeamProjectKeyFilterChange: (value: string) => void;
}

/** Renders the Impediments tab showing blocked issues across all teams. */
function ImpedimentsPanel({
  teams,
  teamProjectKeyFilter,
  onIssueUpdated,
  onTeamProjectKeyFilterChange,
}: ImpedimentsPanelProps) {
  const [expandedIssueKey, setExpandedIssueKey] = useState<string | null>(null);
  const blockedIssues = teams.flatMap((team) =>
    team.sprintIssues
      .filter((issue) => issue.fields.status.name.toLowerCase().includes('block'))
      .map((issue) => ({ ...issue, teamName: team.name })),
  );

  function toggleExpandedIssue(issueKey: string) {
    setExpandedIssueKey((previousIssueKey) => previousIssueKey === issueKey ? null : issueKey);
  }

  return (
    <div className={styles.panel}>
      <h3 className={styles.sectionTitle}>Impediments</h3>
      <div className={styles.teamFilterRow}>
        <input
          className={styles.teamFilterInput}
          onChange={(event) => onTeamProjectKeyFilterChange(event.target.value)}
          placeholder="Filter by project key…"
          type="search"
          value={teamProjectKeyFilter}
        />
      </div>
      {blockedIssues.length === 0 && (
        <p className={styles.emptyState}>No blocked issues found across all teams.</p>
      )}
      <table className={styles.dataTable}>
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">Summary</th>
            <th scope="col">Team</th>
            <th scope="col">Assignee</th>
          </tr>
        </thead>
        <tbody>
          {blockedIssues.map((issue) => {
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
                      <span
                        aria-hidden="true"
                        className={styles.expandToggleButton}
                      >
                        {isExpanded ? '▲' : '▼'}
                      </span>
                    </div>
                  </td>
                  <td>{issue.fields.summary}</td>
                  <td>{issue.teamName}</td>
                  <td>{issue.fields.assignee?.displayName ?? '—'}</td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td className={styles.issueDetailCell} colSpan={4}>
                      <IssueDetailPanel isEmbedded issue={issue} onIssueUpdated={onIssueUpdated} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Renders the Predictability tab with team velocity metrics. */
function PredictabilityPanel({ teams }: TeamsPanelProps) {
  return (
    <div className={styles.panel}>
      <h3 className={styles.sectionTitle}>Predictability</h3>
      {teams.length === 0 && (
        <p className={styles.emptyState}>No teams loaded. Load teams from the Overview tab.</p>
      )}
      {teams.map((team) => (
        <div key={team.id} className={styles.teamCard}>
          <span className={styles.teamName}>{team.name}</span>
          <span className={styles.issueCount}>{team.sprintIssues.length} issues this sprint</span>
        </div>
      ))}
    </div>
  );
}

/** Renders the Releases tab with fix version tracking. */
function ReleasesPanel({ teams }: TeamsPanelProps) {
  const releaseIssues = teams.flatMap((team) => team.sprintIssues);

  return (
    <div className={styles.panel}>
      <h3 className={styles.sectionTitle}>Releases</h3>
      {releaseIssues.length === 0 && (
        <p className={styles.emptyState}>No release issues found. Load teams from the Overview tab.</p>
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
    const teamImpediments = team.sprintIssues.filter((issue) =>
      issue.fields.summary.toLowerCase().includes('block'),
    ).length;

    totalIssues += issueCount;
    totalDone += doneCount;
    impedimentCount += teamImpediments;

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

/** Returns today's date as YYYY-MM-DD. */
function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
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
  const blockedIssues = team.sprintIssues.filter((issue) =>
    issue.fields.status.name.toLowerCase().includes('block') ||
    issue.fields.summary.toLowerCase().includes('block'),
  );
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
}

/** Renders the 5 narrative textarea fields for a single team's SoS accordion section. */
function SosTeamNarrative({ team }: SosTeamNarrativeProps) {
  const todayString = getTodayDateString();
  const storedNarrative = readStoredSosNarrative(team.id, todayString);

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

  function handleFieldChange(fieldName: SosNarrativeField, newValue: string) {
    const updatedData: SosNarrativeData = {
      ...narrativeData,
      [fieldName]: newValue,
      editedAt: { ...narrativeData.editedAt, [fieldName]: new Date().toISOString() },
    };
    setNarrativeData(updatedData);
    storeSosNarrative(team.id, todayString, updatedData);
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
    storeSosNarrative(team.id, todayString, updatedData);
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
    </div>
  );
}

/** Renders the enhanced SoS tab with a Pulse summary and per-team accordion sections with narrative fields. */
function SosPanel({ teams, sosExpandedTeams, onToggleSosTeam }: SosPanelProps) {
  const pulse = computeSosPulse(teams);

  return (
    <div className={styles.panel}>
      <h3 className={styles.sectionTitle}>Scrum of Scrums</h3>

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
        const teamImpediments = team.sprintIssues.filter((issue) =>
          issue.fields.summary.toLowerCase().includes('block'),
        );
        const assignees = [
          ...new Set(
            team.sprintIssues
              .map((issue) => issue.fields.assignee?.displayName)
              .filter((name): name is string => Boolean(name)),
          ),
        ];

        return (
          <div key={team.id} className={styles.sosAccordion}>
            <button
              className={styles.sosAccordionHeader}
              onClick={() => onToggleSosTeam(team.id)}
              aria-expanded={isExpanded}
            >
              {team.name}
              <span className={styles.sosAccordionChevron}>{isExpanded ? '▲' : '▼'}</span>
            </button>

            {isExpanded && (
              <div className={styles.sosAccordionBody}>
                <p className={styles.sosStat}>{team.sprintIssues.length} issues</p>

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
                <SosTeamNarrative team={team} />
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

/** Editable fields that form a single team's monthly report card. */
interface MonthlyReportCard {
  teamId: string;
  teamName: string;
  accomplished: string;
  outcomes: string;
  risks: string;
  stakeholders: string;
  pillar: MonthlyReportPillar;
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
    if (stored) return JSON.parse(stored) as MonthlyReportCard;
  } catch {
    // Fall through to default
  }
  return {
    teamId: team.id,
    teamName: team.name,
    accomplished: '',
    outcomes: '',
    risks: '',
    stakeholders: '',
    pillar: '',
  };
}

/** Saves a monthly report card to localStorage. */
function saveMonthlyReportCard(teamId: string, yearMonth: string, card: MonthlyReportCard): void {
  localStorage.setItem(buildMonthlyReportStorageKey(teamId, yearMonth), JSON.stringify(card));
}

/** Formats all visible cards as plain text for copying to clipboard. */
function formatCardsAsText(cards: MonthlyReportCard[], yearMonth: string): string {
  const lines: string[] = [`Monthly Report — ${yearMonth}`, ''];
  for (const card of cards) {
    lines.push(`=== ${card.teamName} ===`);
    if (card.pillar) lines.push(`Pillar: ${card.pillar}`);
    if (card.accomplished) lines.push(`Accomplished:\n${card.accomplished}`);
    if (card.outcomes) lines.push(`Outcomes:\n${card.outcomes}`);
    if (card.risks) lines.push(`Risks:\n${card.risks}`);
    if (card.stakeholders) lines.push(`Stakeholders: ${card.stakeholders}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Formats all visible cards as a self-contained HTML document for download. */
function formatCardsAsHtml(cards: MonthlyReportCard[], yearMonth: string): string {
  const cardHtml = cards
    .map(
      (card) => `
        <section class="card">
          <h2>${card.teamName}</h2>
          ${card.pillar ? `<p><strong>Pillar:</strong> ${card.pillar}</p>` : ''}
          ${card.accomplished ? `<h3>Accomplished</h3><pre>${card.accomplished}</pre>` : ''}
          ${card.outcomes ? `<h3>Outcomes</h3><pre>${card.outcomes}</pre>` : ''}
          ${card.risks ? `<h3>Risks</h3><pre>${card.risks}</pre>` : ''}
          ${card.stakeholders ? `<p><strong>Stakeholders:</strong> ${card.stakeholders}</p>` : ''}
        </section>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Monthly Report ${yearMonth}</title>
  <style>
    body { font-family: sans-serif; margin: 2rem; }
    .card { border: 1px solid #ccc; padding: 1rem; margin-bottom: 1.5rem; border-radius: 6px; }
    h2 { background: #0052cc; color: #fff; margin: -1rem -1rem 1rem; padding: 0.5rem 1rem; border-radius: 4px 4px 0 0; }
    pre { white-space: pre-wrap; background: #f8f8f8; padding: 0.5rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Monthly Report — ${yearMonth}</h1>
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

const PILLAR_OPTIONS: MonthlyReportPillar[] = ['', 'Growth', 'Affordability', 'Operating Model'];

interface MonthlyReportCardEditorProps {
  card: MonthlyReportCard;
  onChange: (updatedCard: MonthlyReportCard) => void;
}

/** Renders a single editable monthly report card for one team. */
function MonthlyReportCardEditor({ card, onChange }: MonthlyReportCardEditorProps) {
  function handleFieldChange(fieldName: keyof MonthlyReportCard, value: string) {
    onChange({ ...card, [fieldName]: value });
  }

  return (
    <div className={styles.monthlyCard}>
      <div className={styles.monthlyCardHeader}>
        <span className={styles.monthlyCardTeamName}>{card.teamName}</span>
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

      <div className={styles.monthlyFieldRow}>
        <label className={styles.monthlyFieldLabel}>Accomplished</label>
        <textarea
          className={styles.monthlyTextarea}
          value={card.accomplished}
          onChange={(event) => handleFieldChange('accomplished', event.target.value)}
          rows={3}
          placeholder="What did the team accomplish this month?"
        />
      </div>

      <div className={styles.monthlyFieldRow}>
        <label className={styles.monthlyFieldLabel}>Outcomes</label>
        <textarea
          className={styles.monthlyTextarea}
          value={card.outcomes}
          onChange={(event) => handleFieldChange('outcomes', event.target.value)}
          rows={2}
          placeholder="Business outcomes delivered or progressed"
        />
      </div>

      <div className={styles.monthlyFieldRow}>
        <label className={styles.monthlyFieldLabel}>Risks</label>
        <textarea
          className={styles.monthlyTextarea}
          value={card.risks}
          onChange={(event) => handleFieldChange('risks', event.target.value)}
          rows={2}
          placeholder="Current risks or impediments"
        />
      </div>

      <div className={styles.monthlyFieldRow}>
        <label className={styles.monthlyFieldLabel}>Stakeholders</label>
        <input
          type="text"
          className={styles.monthlyTextInput}
          value={card.stakeholders}
          onChange={(event) => handleFieldChange('stakeholders', event.target.value)}
          placeholder="Key stakeholders or reviewers"
        />
      </div>
    </div>
  );
}

/** Renders the Monthly Report tab with per-team editable report cards, month selector, and export actions. */
function MonthlyReportPanel({ teams }: TeamsPanelProps) {
  const monthOptions = generateMonthOptions();
  const [selectedYearMonth, setSelectedYearMonth] = useState(monthOptions[0].value);
  const [teamFilter, setTeamFilter] = useState('all');

  // Load cards for all teams for the current month, initialising from localStorage
  const [cards, setCards] = useState<MonthlyReportCard[]>(() =>
    teams.map((team) => loadMonthlyReportCard(team, monthOptions[0].value)),
  );

  function handleMonthChange(newYearMonth: string) {
    setSelectedYearMonth(newYearMonth);
    setCards(teams.map((team) => loadMonthlyReportCard(team, newYearMonth)));
  }

  function handleCardChange(updatedCard: MonthlyReportCard) {
    setCards((previous) =>
      previous.map((card) => (card.teamId === updatedCard.teamId ? updatedCard : card)),
    );
    saveMonthlyReportCard(updatedCard.teamId, selectedYearMonth, updatedCard);
  }

  const visibleCards = teamFilter === 'all' ? cards : cards.filter((card) => card.teamId === teamFilter);

  function handleCopyAll() {
    const text = formatCardsAsText(visibleCards, selectedYearMonth);
    navigator.clipboard.writeText(text).catch(() => {
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

        <button className={styles.secondaryBtn} onClick={handleCopyAll}>
          Copy All
        </button>
        <button className={styles.secondaryBtn} onClick={handleExportHtml}>
          Export HTML
        </button>
      </div>

      {teams.length === 0 && (
        <p className={styles.emptyState}>No teams configured. Add teams in the Settings tab.</p>
      )}

      <div className={styles.monthlyCardList}>
        {visibleCards.map((card) => (
          <MonthlyReportCardEditor key={card.teamId} card={card} onChange={handleCardChange} />
        ))}
      </div>
    </div>
  );
}

interface SettingsPanelProps {
  teams: ArtTeam[];
  onAddTeam: (name: string, boardId: string, projectKey?: string) => void;
  onRemoveTeam: (teamId: string) => void;
  onSaveTeams: () => void;
}

/** Shape of the ART advanced settings object stored under 'tbxARTSettings' in localStorage. */
interface ArtAdvancedSettings {
  piFieldId?: string;
  spFieldId?: string;
  isSpAutoDetect?: boolean;
  featureLinkField?: string;
  staleDays?: number;
}

/** Reads ART advanced settings from localStorage or returns an empty object. */
function readArtAdvancedSettings(): ArtAdvancedSettings {
  try {
    return JSON.parse(localStorage.getItem('tbxARTSettings') || '{}') as ArtAdvancedSettings;
  } catch {
    return {};
  }
}

/** Writes ART advanced settings to localStorage. */
function writeArtAdvancedSettings(settings: ArtAdvancedSettings): void {
  localStorage.setItem('tbxARTSettings', JSON.stringify(settings));
}

const DEFAULT_STALE_DAYS_SETTING = 5;

/** Renders the Settings tab for managing ART team roster, board IDs, and advanced field configuration. */
function SettingsPanel({ teams, onAddTeam, onRemoveTeam, onSaveTeams }: SettingsPanelProps) {
  const { showToast } = useToast();
  const [newTeamName, setNewTeamName] = useState('');
  const [newBoardId, setNewBoardId] = useState('');
  const [newProjectKey, setNewProjectKey] = useState('');

  const storedSettings = readArtAdvancedSettings();
  const [piFieldId, setPiFieldId] = useState(storedSettings.piFieldId ?? '');
  const [spFieldId, setSpFieldId] = useState(storedSettings.spFieldId ?? '');
  const [featureLinkField, setFeatureLinkField] = useState(storedSettings.featureLinkField ?? '');
  const [staleDaysInput, setStaleDaysInput] = useState(
    String(storedSettings.staleDays ?? DEFAULT_STALE_DAYS_SETTING),
  );

  function handleAddTeam() {
    if (!newTeamName.trim() || !newBoardId.trim()) return;
    onAddTeam(newTeamName.trim(), newBoardId.trim(), newProjectKey.trim() || undefined);
    setNewTeamName('');
    setNewBoardId('');
    setNewProjectKey('');
  }

  function handleSaveTeams() {
    onSaveTeams();
    showToast('Teams saved ✓', 'success');
  }

  /** Persists a single settings field change to localStorage. */
  function saveSettingField(fieldName: keyof ArtAdvancedSettings, value: string | number | boolean) {
    const current = readArtAdvancedSettings();
    writeArtAdvancedSettings({ ...current, [fieldName]: value });
  }

  function handlePiFieldChange(value: string) {
    setPiFieldId(value);
    saveSettingField('piFieldId', value);
  }

  function handleSpFieldChange(value: string) {
    setSpFieldId(value);
    saveSettingField('spFieldId', value);
  }

  function handleFeatureLinkFieldChange(value: string) {
    setFeatureLinkField(value);
    saveSettingField('featureLinkField', value);
  }

  function handleStaleDaysChange(value: string) {
    setStaleDaysInput(value);
    const parsedDays = parseInt(value, 10);
    if (!isNaN(parsedDays) && parsedDays > 0) {
      saveSettingField('staleDays', parsedDays);
    }
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
          onChange={setNewBoardId}
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
        {teams.length === 0 && (
          <p className={styles.emptyState}>No teams configured yet.</p>
        )}
        {teams.map((team) => (
          <div key={team.id} className={styles.teamListRow}>
            <span className={styles.teamName}>{team.name}</span>
            <span className={styles.boardId}>Board {team.boardId}</span>
            {team.projectKey && (
              <span className={styles.projectKeyBadge}>{team.projectKey}</span>
            )}
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
          These field IDs are used by Blueprint, Dependencies, and the SoS stale-issue detector.
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
          <label className={styles.settingsFieldLabel}>Stale Days Threshold</label>
          <input
            type="number"
            className={styles.textInput}
            placeholder={String(DEFAULT_STALE_DAYS_SETTING)}
            value={staleDaysInput}
            min={1}
            max={90}
            onChange={(event) => handleStaleDaysChange(event.target.value)}
            aria-label="Stale Days Threshold"
          />
        </div>
      </div>
    </div>
  );
}

