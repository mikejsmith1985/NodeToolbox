// ArtView.tsx — Tabbed ART (Agile Release Train) view for multi-team PI planning and health dashboards.

import { useState } from 'react';
import { useArtData } from './hooks/useArtData.ts';
import type { ArtTab, ArtPersona, ArtTeam } from './hooks/useArtData.ts';
import styles from './ArtView.module.css';

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
  { key: 'sos', label: 'SoS' },
  { key: 'monthly', label: 'Monthly Report' },
  { key: 'settings', label: 'Settings' },
];

/** Main ART View with 7 tabs for tracking multi-team PI health across the Agile Release Train. */
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
        {state.activeTab === 'sos' && (
          <SosPanel teams={state.teams} />
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

/** Renders the Scrum of Scrums tab for cross-team issue visibility. */
function SosPanel({ teams }: TeamsPanelProps) {
  return (
    <div className={styles.panel}>
      <h3 className={styles.sectionTitle}>Scrum of Scrums</h3>
      {teams.length === 0 && (
        <p className={styles.emptyState}>No teams loaded. Load teams from the Overview tab.</p>
      )}
      {teams.map((team) => (
        <div key={team.id} className={styles.teamCard}>
          <span className={styles.teamName}>{team.name}</span>
          <span className={styles.issueCount}>{team.sprintIssues.length} active issues</span>
        </div>
      ))}
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
