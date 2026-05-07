// ArtView.tsx — Tabbed ART (Agile Release Train) view for multi-team PI planning and health dashboards.

import { useState } from 'react';
import { useArtData } from './hooks/useArtData.ts';
import type { ArtTab, ArtPersona, ArtTeam, ArtBoardPrepIssue, PiProgressStats } from './hooks/useArtData.ts';
import styles from './ArtView.module.css';

// ── Constants ──

const PERSONA_OPTIONS: { key: ArtPersona; label: string }[] = [
  { key: 'sm', label: 'SM' },
  { key: 'po', label: 'PO' },
  { key: 'dev', label: 'Dev' },
  { key: 'qa', label: 'QA' },
];

const ART_TAB_DEFINITIONS: { key: ArtTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'impediments', label: 'Impediments' },
  { key: 'predictability', label: 'Predictability' },
  { key: 'releases', label: 'Releases' },
  { key: 'dependencies', label: 'Dependencies' },
  { key: 'boardprep', label: 'Board Prep' },
  { key: 'sos', label: 'SoS' },
  { key: 'monthly', label: 'Monthly Report' },
  { key: 'settings', label: 'Settings' },
];

/** Pastel color palette assigned per-team in the dependency map SVG. */
const TEAM_PASTEL_COLORS = ['#b3d9ff', '#b3ffcc', '#ffd9b3', '#ffb3cc', '#d9b3ff', '#b3ffff', '#ffff99'];

// SVG layout constants for the dependency map
const DEP_TEAM_BOX_WIDTH = 150;
const DEP_TEAM_BOX_HEIGHT = 40;
const DEP_TEAM_SPACING = 200;
const DEP_ISSUE_HEIGHT = 30;
const DEP_ISSUE_GAP = 4;
const DEP_TEAM_Y = 20;
const DEP_ISSUES_START_Y = DEP_TEAM_Y + DEP_TEAM_BOX_HEIGHT + 10;
const DEP_SVG_SIDE_PADDING = 20;

/** Pattern for detecting Jira issue keys (e.g. "TBX-123") in free text. */
const JIRA_KEY_PATTERN = /[A-Z]+-\d+/g;

// ── Main ArtView component ──

/** Main ART View with 9 tabs for tracking multi-team PI health across the Agile Release Train. */
export default function ArtView() {
  const { state, actions } = useArtData();

  return (
    <div className={styles.artView}>
      <div className={styles.personaStrip}>
        {PERSONA_OPTIONS.map((option) => (
          <button
            key={option.key}
            className={`${styles.personaBtn} ${state.persona === option.key ? styles.personaBtnActive : ''}`}
            onClick={() => actions.setPersona(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>

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
            teams={state.teams}
            isLoadingAllTeams={state.isLoadingAllTeams}
            onLoadAllTeams={actions.loadAllTeams}
            onLoadTeam={actions.loadTeam}
          />
        )}
        {state.activeTab === 'impediments' && (
          <ImpedimentsPanel teams={state.teams} />
        )}
        {state.activeTab === 'predictability' && (
          <PredictabilityPanel teams={state.teams} />
        )}
        {state.activeTab === 'releases' && (
          <ReleasesPanel teams={state.teams} />
        )}
        {state.activeTab === 'dependencies' && (
          <DependencyMapPanel teams={state.teams} />
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
  isLoadingAllTeams: boolean;
  onLoadAllTeams: () => Promise<void>;
  onLoadTeam: (teamId: string) => Promise<void>;
}

/** Renders the Overview tab with team health cards and the Load All Teams control. */
function OverviewPanel({ teams, isLoadingAllTeams, onLoadAllTeams, onLoadTeam }: OverviewPanelProps) {
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

/** Renders the Impediments tab showing blocked issues across all teams. */
function ImpedimentsPanel({ teams }: TeamsPanelProps) {
  const blockedIssues = teams.flatMap((team) =>
    team.sprintIssues
      .filter((issue) => issue.fields.status.name.toLowerCase().includes('block'))
      .map((issue) => ({ ...issue, teamName: team.name })),
  );

  return (
    <div className={styles.panel}>
      <h3 className={styles.sectionTitle}>Impediments</h3>
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
          {blockedIssues.map((issue) => (
            <tr key={issue.key}>
              <td>{issue.key}</td>
              <td>{issue.fields.summary}</td>
              <td>{issue.teamName}</td>
              <td>{issue.fields.assignee?.displayName ?? '—'}</td>
            </tr>
          ))}
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

// ── Feature 1: Dependency Map ──

interface CrossTeamDependency {
  sourceKey: string;
  targetKey: string;
  sourceTeamIndex: number;
  targetTeamIndex: number;
  sourceIssueIndex: number;
  targetIssueIndex: number;
}

/**
 * Builds a map of issue key → team index for fast cross-team reference lookup.
 * Only includes keys from teams that actually have loaded sprint issues.
 */
function buildIssueTeamIndexMap(teams: ArtTeam[]): Map<string, { teamIndex: number; issueIndex: number }> {
  const issueMap = new Map<string, { teamIndex: number; issueIndex: number }>();
  teams.forEach((team, teamIndex) => {
    team.sprintIssues.forEach((issue, issueIndex) => {
      issueMap.set(issue.key, { teamIndex, issueIndex });
    });
  });
  return issueMap;
}

/**
 * Scans all issues across teams for references to issues belonging to OTHER teams.
 * Returns a list of detected cross-team dependency pairs.
 */
function detectCrossTeamDependencies(teams: ArtTeam[]): CrossTeamDependency[] {
  const issueMap = buildIssueTeamIndexMap(teams);
  const dependencies: CrossTeamDependency[] = [];

  teams.forEach((team, sourceTeamIndex) => {
    team.sprintIssues.forEach((issue, sourceIssueIndex) => {
      if (!issue.fields.description) return;
      const mentionedKeys = issue.fields.description.match(JIRA_KEY_PATTERN) ?? [];
      for (const mentionedKey of mentionedKeys) {
        const target = issueMap.get(mentionedKey);
        // Only record if the referenced issue belongs to a DIFFERENT team
        if (target && target.teamIndex !== sourceTeamIndex) {
          dependencies.push({
            sourceKey: issue.key,
            targetKey: mentionedKey,
            sourceTeamIndex,
            targetTeamIndex: target.teamIndex,
            sourceIssueIndex,
            targetIssueIndex: target.issueIndex,
          });
        }
      }
    });
  });

  return dependencies;
}

/** Computes the centre-x of a team's column in the SVG dependency map. */
function getTeamCentreX(teamIndex: number): number {
  return DEP_SVG_SIDE_PADDING + teamIndex * DEP_TEAM_SPACING + DEP_TEAM_BOX_WIDTH / 2;
}

/** Computes the y-midpoint of a specific issue rectangle within its team column. */
function getIssueY(issueIndex: number): number {
  return DEP_ISSUES_START_Y + issueIndex * (DEP_ISSUE_HEIGHT + DEP_ISSUE_GAP) + DEP_ISSUE_HEIGHT / 2;
}

/** Renders the Dependency Map tab with an inline SVG visualisation of cross-team issue references. */
function DependencyMapPanel({ teams }: TeamsPanelProps) {
  const [selectedIssueKey, setSelectedIssueKey] = useState<string | null>(null);
  const dependencies = detectCrossTeamDependencies(teams);
  const hasDependencies = dependencies.length > 0;
  const hasTeamsWithIssues = teams.some((team) => team.sprintIssues.length > 0);

  if (!hasTeamsWithIssues || !hasDependencies) {
    return (
      <div className={styles.panel}>
        <h3 className={styles.sectionTitle}>Dependency Map</h3>
        <p className={styles.emptyState}>No cross-team dependencies detected</p>
      </div>
    );
  }

  const svgWidth = DEP_SVG_SIDE_PADDING * 2 + teams.length * DEP_TEAM_SPACING;
  const maxIssueCount = Math.max(...teams.map((t) => t.sprintIssues.length), 0);
  const svgHeight = DEP_ISSUES_START_Y + maxIssueCount * (DEP_ISSUE_HEIGHT + DEP_ISSUE_GAP) + 20;

  const selectedIssue = selectedIssueKey
    ? teams.flatMap((t) => t.sprintIssues).find((i) => i.key === selectedIssueKey)
    : null;

  return (
    <div className={styles.panel}>
      <h3 className={styles.sectionTitle}>Dependency Map</h3>
      <svg
        width={svgWidth}
        height={svgHeight}
        className={styles.depMapSvg}
        aria-label="Cross-team dependency map"
      >
        <defs>
          {/* Arrowhead marker for dependency arrows */}
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#888" />
          </marker>
        </defs>

        {/* Team column headers */}
        {teams.map((team, teamIndex) => {
          const teamX = DEP_SVG_SIDE_PADDING + teamIndex * DEP_TEAM_SPACING;
          const teamColor = TEAM_PASTEL_COLORS[teamIndex % TEAM_PASTEL_COLORS.length];
          return (
            <g key={team.id}>
              <rect x={teamX} y={DEP_TEAM_Y} width={DEP_TEAM_BOX_WIDTH} height={DEP_TEAM_BOX_HEIGHT}
                fill={teamColor} stroke="#666" strokeWidth="1" rx="4" />
              <text x={teamX + DEP_TEAM_BOX_WIDTH / 2} y={DEP_TEAM_Y + 24}
                textAnchor="middle" fontSize="12" fontWeight="bold" fill="#333">
                {team.name}
              </text>
              {/* Issue rectangles under the team box */}
              {team.sprintIssues.map((issue, issueIndex) => {
                const issueY = DEP_ISSUES_START_Y + issueIndex * (DEP_ISSUE_HEIGHT + DEP_ISSUE_GAP);
                const isSelected = selectedIssueKey === issue.key;
                return (
                  <g key={issue.key} style={{ cursor: 'pointer' }} onClick={() => setSelectedIssueKey(isSelected ? null : issue.key)}>
                    <rect x={teamX} y={issueY} width={DEP_TEAM_BOX_WIDTH} height={DEP_ISSUE_HEIGHT}
                      fill={isSelected ? '#ffd700' : '#f5f5f5'} stroke="#aaa" strokeWidth="1" rx="2" />
                    <text x={teamX + 6} y={issueY + 18} fontSize="10" fill="#333">{issue.key}</text>
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* Dependency arrows between issues */}
        {dependencies.map((dep, depIndex) => {
          const x1 = getTeamCentreX(dep.sourceTeamIndex);
          const y1 = getIssueY(dep.sourceIssueIndex);
          const x2 = getTeamCentreX(dep.targetTeamIndex);
          const y2 = getIssueY(dep.targetIssueIndex);
          const midX = (x1 + x2) / 2;
          return (
            <path key={depIndex}
              d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
              fill="none" stroke="#888" strokeWidth="1.5"
              markerEnd="url(#arrowhead)"
              opacity="0.7"
            />
          );
        })}
      </svg>

      {selectedIssue && (
        <div className={styles.depIssueDetail}>
          <strong>{selectedIssue.key}</strong>: {selectedIssue.fields.summary}
        </div>
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

/** Renders the enhanced SoS tab with a Pulse summary and per-team accordion sections. */
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

      {/* Per-team accordion sections */}
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
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Renders the Monthly Report tab with aggregated PI metrics. */
function MonthlyReportPanel({ teams }: TeamsPanelProps) {
  const totalIssues = teams.reduce((sum, team) => sum + team.sprintIssues.length, 0);

  return (
    <div className={styles.panel}>
      <h3 className={styles.sectionTitle}>Monthly Report</h3>
      <p className={styles.metricSummary}>Total issues across all teams: {totalIssues}</p>
    </div>
  );
}

interface SettingsPanelProps {
  teams: ArtTeam[];
  onAddTeam: (name: string, boardId: string) => void;
  onRemoveTeam: (teamId: string) => void;
}

/** Renders the Settings tab for managing ART team roster and board IDs. */
function SettingsPanel({ teams, onAddTeam, onRemoveTeam }: SettingsPanelProps) {
  const [newTeamName, setNewTeamName] = useState('');
  const [newBoardId, setNewBoardId] = useState('');

  function handleAddTeam() {
    if (!newTeamName.trim() || !newBoardId.trim()) return;
    onAddTeam(newTeamName.trim(), newBoardId.trim());
    setNewTeamName('');
    setNewBoardId('');
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
        <input
          type="text"
          className={styles.textInput}
          placeholder="Board ID"
          value={newBoardId}
          onChange={(event) => setNewBoardId(event.target.value)}
        />
        <button className={styles.primaryBtn} onClick={handleAddTeam}>
          Add Team
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
            <button className={styles.removeBtn} onClick={() => onRemoveTeam(team.id)}>
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

