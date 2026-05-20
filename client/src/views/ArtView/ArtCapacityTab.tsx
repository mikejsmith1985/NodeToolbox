// ArtCapacityTab.tsx — Multi-team ART capacity planner with per-team editors and cross-team role totals.

import { useCallback, useEffect, useMemo } from 'react';

import {
  ALL_TEAM_ROLES,
  calculateRecommendedCapacity,
  calculateTotalCapacity,
  countWorkDays,
  generateCapacityRowId,
} from '../SprintDashboard/capacityModel.ts';
import type { CapacityRow, TeamRole } from '../SprintDashboard/capacityModel.ts';
import type { ArtTeam } from './hooks/useArtData.ts';
import { useArtCapacityStore } from './hooks/useArtCapacityStore.ts';
import styles from './ArtCapacityTab.module.css';

const DEFAULT_ROLE: TeamRole = 'Dev';
const DEFAULT_MEMBER_COUNT = 1;
const DEFAULT_CAPACITY_PERCENTAGE = 100;
const DEFAULT_PTO_DAYS = 0;
const MIN_MEMBER_COUNT = 1;
const MAX_MEMBER_COUNT = 99;
const MIN_CAPACITY_PERCENTAGE = 1;
const MAX_CAPACITY_PERCENTAGE = 100;
const MIN_PTO_DAYS = 0;

interface CapacityRowEditorProps {
  row: CapacityRow;
  teamName: string;
  onUpdate: (rowId: string, updates: Partial<Omit<CapacityRow, 'id'>>) => void;
  onRemove: (rowId: string) => void;
}

interface TeamCapacityResultsProps {
  workDayCount: number;
  totalCapacityPoints: number;
  title: string;
}

interface ArtCapacityTabProps {
  teams: ArtTeam[];
}

interface TeamCapacitySummary {
  teamId: string;
  teamName: string;
  workDayCount: number;
  totalCapacityPoints: number;
  recommendedCapacityPoints: number;
  roleCapacities: Record<TeamRole, number>;
}

function CapacityRowEditor({ row, teamName, onUpdate, onRemove }: CapacityRowEditorProps) {
  return (
    <tr className={styles.capacityRow}>
      <td>
        <select
          aria-label={`Role for ${teamName}`}
          className={styles.roleSelect}
          onChange={(changeEvent) => onUpdate(row.id, { role: changeEvent.target.value as TeamRole })}
          value={row.role}
        >
          {ALL_TEAM_ROLES.map((teamRole) => (
            <option key={teamRole} value={teamRole}>
              {teamRole}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          aria-label={`Number of people for ${teamName}`}
          className={styles.numberInput}
          max={MAX_MEMBER_COUNT}
          min={MIN_MEMBER_COUNT}
          onChange={(changeEvent) =>
            onUpdate(row.id, { memberCount: Math.max(MIN_MEMBER_COUNT, parseInt(changeEvent.target.value, 10) || MIN_MEMBER_COUNT) })
          }
          type="number"
          value={row.memberCount}
        />
      </td>
      <td>
        <div className={styles.percentageInputWrapper}>
          <input
            aria-label={`Capacity percentage for ${teamName}`}
            className={styles.numberInput}
            max={MAX_CAPACITY_PERCENTAGE}
            min={MIN_CAPACITY_PERCENTAGE}
            onChange={(changeEvent) =>
              onUpdate(row.id, {
                capacityPercentage: Math.min(
                  MAX_CAPACITY_PERCENTAGE,
                  Math.max(MIN_CAPACITY_PERCENTAGE, parseInt(changeEvent.target.value, 10) || MIN_CAPACITY_PERCENTAGE),
                ),
              })
            }
            type="number"
            value={row.capacityPercentage}
          />
          <span className={styles.percentageSymbol}>%</span>
        </div>
      </td>
      <td>
        <input
          aria-label={`Total PTO days for ${teamName}`}
          className={styles.numberInput}
          min={MIN_PTO_DAYS}
          onChange={(changeEvent) =>
            onUpdate(row.id, { totalPtoDays: Math.max(MIN_PTO_DAYS, parseInt(changeEvent.target.value, 10) || MIN_PTO_DAYS) })
          }
          type="number"
          value={row.totalPtoDays}
        />
      </td>
      <td>
        <button
          aria-label={`Remove ${row.role} row from ${teamName}`}
          className={styles.removeRowButton}
          onClick={() => onRemove(row.id)}
          type="button"
        >
          ✕
        </button>
      </td>
    </tr>
  );
}

function TeamCapacityResults({ workDayCount, totalCapacityPoints, title }: TeamCapacityResultsProps) {
  const recommendedCapacity = calculateRecommendedCapacity(totalCapacityPoints);
  const roundedTotalCapacity = Math.floor(totalCapacityPoints);

  return (
    <div className={styles.resultsPanel}>
      <h3 className={styles.resultsPanelTitle}>{title}</h3>
      <div className={styles.resultsGrid}>
        <div className={styles.resultCard}>
          <span className={styles.resultIcon}>📅</span>
          <span className={styles.resultValue}>{workDayCount}</span>
          <span className={styles.resultLabel}>Work Days</span>
        </div>
        <div className={`${styles.resultCard} ${styles.resultCardHighlight}`}>
          <span className={styles.resultIcon}>💯</span>
          <span className={styles.resultValue}>{roundedTotalCapacity}</span>
          <span className={styles.resultLabel}>100% Capacity (pts)</span>
        </div>
        <div className={`${styles.resultCard} ${styles.resultCardAccent}`}>
          <span className={styles.resultIcon}>🎯</span>
          <span className={styles.resultValue}>{recommendedCapacity}</span>
          <span className={styles.resultLabel}>80% Capacity (pts)</span>
        </div>
      </div>
    </div>
  );
}

function buildTeamCapacitySummary(team: ArtTeam, rows: CapacityRow[], startDate: string, endDate: string): TeamCapacitySummary {
  const workDayCount = countWorkDays(startDate, endDate);
  const totalCapacityPoints = calculateTotalCapacity(rows, workDayCount);
  const roleCapacities = Object.fromEntries(
    ALL_TEAM_ROLES.map((teamRole) => [
      teamRole,
      calculateTotalCapacity(
        rows.filter((row) => row.role === teamRole),
        workDayCount,
      ),
    ]),
  ) as Record<TeamRole, number>;

  return {
    teamId: team.id,
    teamName: team.name,
    workDayCount,
    totalCapacityPoints,
    recommendedCapacityPoints: calculateRecommendedCapacity(totalCapacityPoints),
    roleCapacities,
  };
}

/** ART Capacity tab: manages capacity rows per ART team and shows cross-team role totals. */
export default function ArtCapacityTab({ teams }: ArtCapacityTabProps) {
  const teamConfigs = useArtCapacityStore((state) => state.teamConfigs);
  const ensureTeamConfig = useArtCapacityStore((state) => state.ensureTeamConfig);
  const pruneTeamConfigs = useArtCapacityStore((state) => state.pruneTeamConfigs);
  const setTeamStartDate = useArtCapacityStore((state) => state.setTeamStartDate);
  const setTeamEndDate = useArtCapacityStore((state) => state.setTeamEndDate);
  const addTeamRow = useArtCapacityStore((state) => state.addTeamRow);
  const updateTeamRow = useArtCapacityStore((state) => state.updateTeamRow);
  const removeTeamRow = useArtCapacityStore((state) => state.removeTeamRow);

  useEffect(() => {
    for (const team of teams) {
      ensureTeamConfig(team.id);
    }

    pruneTeamConfigs(teams.map((team) => team.id));
  }, [ensureTeamConfig, pruneTeamConfigs, teams]);

  const teamSummaries = useMemo(
    () =>
      teams.map((team) => {
        const teamConfig = teamConfigs[team.id] ?? { startDate: '', endDate: '', rows: [] };
        return buildTeamCapacitySummary(team, teamConfig.rows, teamConfig.startDate, teamConfig.endDate);
      }),
    [teamConfigs, teams],
  );

  const grandTotalCapacity = teamSummaries.reduce((runningTotal, teamSummary) => runningTotal + teamSummary.totalCapacityPoints, 0);
  const hasMultipleTeams = teams.length > 1;

  const handleAddRow = useCallback(
    (teamId: string) => {
      addTeamRow(teamId, {
        id: generateCapacityRowId(),
        role: DEFAULT_ROLE,
        memberCount: DEFAULT_MEMBER_COUNT,
        capacityPercentage: DEFAULT_CAPACITY_PERCENTAGE,
        totalPtoDays: DEFAULT_PTO_DAYS,
      });
    },
    [addTeamRow],
  );

  if (teams.length === 0) {
    return (
      <div className={styles.artCapacityTab}>
        <div className={styles.emptyStateCard}>
          <h3 className={styles.sectionTitle}>ART Capacity</h3>
          <p className={styles.sectionDescription}>No teams configured. Add teams in the Settings tab to plan ART capacity.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.artCapacityTab}>
      {teams.map((team, teamIndex) => {
        const teamConfig = teamConfigs[team.id] ?? { startDate: '', endDate: '', rows: [] };
        const teamSummary = teamSummaries[teamIndex];
        return (
          <section className={styles.teamSection} key={team.id}>
            <div className={styles.teamSectionHeader}>
              <div>
                <h2 className={styles.teamTitle}>{team.name}</h2>
                <p className={styles.sectionDescription}>
                  Plan this team&apos;s capacity with role-based rows for the ART window.
                </p>
              </div>
              <button className={styles.addRowButton} onClick={() => handleAddRow(team.id)} type="button">
                + Add Row
              </button>
            </div>

            <div className={styles.dateInputRow}>
              <label className={styles.dateLabel} htmlFor={`art-capacity-start-date-${team.id}`}>
                Start Date
                <input
                  className={styles.dateInput}
                  id={`art-capacity-start-date-${team.id}`}
                  onChange={(changeEvent) => setTeamStartDate(team.id, changeEvent.target.value)}
                  type="date"
                  value={teamConfig.startDate}
                />
              </label>
              <label className={styles.dateLabel} htmlFor={`art-capacity-end-date-${team.id}`}>
                End Date
                <input
                  className={styles.dateInput}
                  id={`art-capacity-end-date-${team.id}`}
                  onChange={(changeEvent) => setTeamEndDate(team.id, changeEvent.target.value)}
                  type="date"
                  value={teamConfig.endDate}
                />
              </label>
              {teamSummary.workDayCount > 0 && (
                <span className={styles.workDaysBadge}>
                  {teamSummary.workDayCount} work {teamSummary.workDayCount === 1 ? 'day' : 'days'}
                </span>
              )}
            </div>

            {teamConfig.rows.length === 0 ? (
              <p className={styles.emptyTableMessage}>
                No team members added yet — click <strong>+ Add Row</strong> to start.
              </p>
            ) : (
              <div className={styles.tableWrapper}>
                <table className={styles.capacityTable}>
                  <thead>
                    <tr>
                      <th className={styles.tableHeader}>Role</th>
                      <th className={styles.tableHeader}>Count</th>
                      <th className={styles.tableHeader}>Capacity %</th>
                      <th className={styles.tableHeader}>PTO Days</th>
                      <th className={styles.tableHeader} aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {teamConfig.rows.map((row) => (
                      <CapacityRowEditor
                        key={row.id}
                        onRemove={(rowId) => removeTeamRow(team.id, rowId)}
                        onUpdate={(rowId, updates) => updateTeamRow(team.id, rowId, updates)}
                        row={row}
                        teamName={team.name}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <TeamCapacityResults title={`${team.name} Capacity`} totalCapacityPoints={teamSummary.totalCapacityPoints} workDayCount={teamSummary.workDayCount} />
          </section>
        );
      })}

      {hasMultipleTeams && (
        <section aria-label="Total capacity summary" className={styles.summarySection}>
          <div className={styles.summaryHeader}>
            <div>
              <h2 className={styles.sectionTitle}>Total Capacity</h2>
              <p className={styles.sectionDescription}>
                Review the ART-wide capacity breakdown by role across all configured teams.
              </p>
            </div>
          </div>

          <div className={styles.tableWrapper}>
            <table className={styles.summaryTable}>
              <thead>
                <tr>
                  <th scope="col">Role</th>
                  {teamSummaries.map((teamSummary) => (
                    <th key={teamSummary.teamId} scope="col">{teamSummary.teamName}</th>
                  ))}
                  <th scope="col">ART Total</th>
                </tr>
              </thead>
              <tbody>
                {ALL_TEAM_ROLES.map((teamRole) => {
                  const roleTotal = teamSummaries.reduce(
                    (runningTotal, teamSummary) => runningTotal + teamSummary.roleCapacities[teamRole],
                    0,
                  );
                  return (
                    <tr key={teamRole}>
                      <td>{teamRole}</td>
                      {teamSummaries.map((teamSummary) => (
                        <td key={`${teamSummary.teamId}-${teamRole}`}>{Math.floor(teamSummary.roleCapacities[teamRole])}</td>
                      ))}
                      <td>{Math.floor(roleTotal)}</td>
                    </tr>
                  );
                })}
                <tr className={styles.summaryTotalRow}>
                  <td>Total</td>
                  {teamSummaries.map((teamSummary) => (
                    <td key={`${teamSummary.teamId}-total`}>{Math.floor(teamSummary.totalCapacityPoints)}</td>
                  ))}
                  <td>{Math.floor(grandTotalCapacity)}</td>
                </tr>
                <tr className={styles.summaryRecommendedRow}>
                  <td>80% Target</td>
                  {teamSummaries.map((teamSummary) => (
                    <td key={`${teamSummary.teamId}-recommended`}>{teamSummary.recommendedCapacityPoints}</td>
                  ))}
                  <td>{calculateRecommendedCapacity(grandTotalCapacity)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
