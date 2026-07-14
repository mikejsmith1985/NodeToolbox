// CapacityTab.tsx — Reusable team capacity planning panel for the PI Review workspace.
//
// Lets the user model sprint capacity by specifying a date range and a set of
// team role rows (each with a headcount, weighted allocation %, and PTO days).
// Results show total work days, 100% capacity, and 80% capacity in story points,
// where 1 point = 1 person-day of fully-dedicated work.

import { useCallback, useEffect, useMemo } from 'react';

import { parsePiDateRange } from '../ArtView/hooks/artHelpers.ts';
import { useCapacityStore } from './hooks/useCapacityStore.ts';
import { useStandupRosterStore } from './hooks/useStandupRosterStore.ts';
import {
  ALL_TEAM_ROLES,
  calculateRecommendedCapacity,
  calculateTotalCapacity,
  countWorkDays,
  generateCapacityRowId,
} from './capacityModel.ts';
import type { CapacityRow, TeamRole } from './capacityModel.ts';
import { resolveMemberCapacityRole, seedCapacityRowsFromRoster } from './capacityRosterSeed.ts';
import styles from './CapacityTab.module.css';

// ── Named constants ──

const DEFAULT_ROLE: TeamRole = 'Developer';
const DEFAULT_MEMBER_COUNT = 1;
const DEFAULT_CAPACITY_PERCENTAGE = 100;
const DEFAULT_PTO_DAYS = 0;

const MIN_MEMBER_COUNT = 1;
const MAX_MEMBER_COUNT = 99;
const MIN_CAPACITY_PERCENTAGE = 1;
const MAX_CAPACITY_PERCENTAGE = 100;
const MIN_PTO_DAYS = 0;

function formatDateForInput(localDate: Date): string {
  const yearNumber = localDate.getFullYear();
  const monthNumber = String(localDate.getMonth() + 1).padStart(2, '0');
  const dayNumber = String(localDate.getDate()).padStart(2, '0');
  return `${yearNumber}-${monthNumber}-${dayNumber}`;
}

// ── Sub-components ──

interface CapacityRowEditorProps {
  row: CapacityRow;
  onUpdate: (rowId: string, updates: Partial<Omit<CapacityRow, 'id'>>) => void;
  onRemove: (rowId: string) => void;
}

/**
 * A single editable row in the team composition table.
 * Renders inline inputs for role, headcount, capacity %, and PTO days.
 */
function CapacityRowEditor({ row, onUpdate, onRemove }: CapacityRowEditorProps) {
  return (
    <tr className={styles.capacityRow}>
      <td>
        <select
          aria-label="Role"
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
          aria-label="Number of people"
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
            aria-label="Capacity percentage"
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
          aria-label="Total PTO days"
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
          aria-label={`Remove ${row.role} row`}
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

interface CapacityResultsProps {
  workDayCount: number;
  totalCapacityPoints: number;
}

/**
 * Displays the calculated results: work days in range, 100% capacity, and 80% capacity.
 * The 80% figure is the recommended sprint commitment — teams rarely hit 100% due to
 * meetings, interruptions, and unplanned work.
 */
function CapacityResults({ workDayCount, totalCapacityPoints }: CapacityResultsProps) {
  const eightyPercentCapacity = calculateRecommendedCapacity(totalCapacityPoints);
  const roundedTotalCapacity = Math.floor(totalCapacityPoints);

  return (
    <div className={styles.resultsPanel}>
      <h3 className={styles.resultsPanelTitle}>Capacity Results</h3>
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
          <span className={styles.resultValue}>{eightyPercentCapacity}</span>
          <span className={styles.resultLabel}>80% Capacity (pts)</span>
        </div>
      </div>
    </div>
  );
}

// ── Main component ──

/**
 * Reusable capacity planning panel for Team Dashboard PI Review.
 *
 * Workflow:
 * 1. Pick a start and end date — work days (Mon–Fri) are calculated automatically.
 * 2. Add team rows: choose a role, headcount, allocation %, and any PTO days.
 * 3. Read off the 100% and 80% capacity totals to set sprint point targets.
 *
 * Configuration is persisted to localStorage so it survives refreshes and stays in sync with PI Review saves.
 */
export default function CapacityTab({ selectedPiName }: { selectedPiName: string }) {
  const dateMode = useCapacityStore((state) => state.dateMode);
  const startDate = useCapacityStore((state) => state.startDate);
  const endDate = useCapacityStore((state) => state.endDate);
  const rows = useCapacityStore((state) => state.rows);
  const setDateMode = useCapacityStore((state) => state.setDateMode);
  const setStartDate = useCapacityStore((state) => state.setStartDate);
  const setEndDate = useCapacityStore((state) => state.setEndDate);
  const addRow = useCapacityStore((state) => state.addRow);
  const setRows = useCapacityStore((state) => state.setRows);
  const updateRow = useCapacityStore((state) => state.updateRow);
  const removeRow = useCapacityStore((state) => state.removeRow);
  // The roster is the source for the team makeup; only members in a counting role can seed a row.
  const rosterMembers = useStandupRosterStore((state) => state.rosterMembers);
  const hasSeedableRosterMembers = useMemo(
    () => rosterMembers.some((rosterMember) => resolveMemberCapacityRole(rosterMember) !== null),
    [rosterMembers],
  );
  const parsedPiDateRange = useMemo(() => parsePiDateRange(selectedPiName.trim()), [selectedPiName]);
  const piRangeStartDate = parsedPiDateRange ? formatDateForInput(parsedPiDateRange.startDate) : '';
  const piRangeEndDate = parsedPiDateRange ? formatDateForInput(parsedPiDateRange.endDate) : '';

  const workDayCount = countWorkDays(startDate, endDate);
  const totalCapacityPoints = calculateTotalCapacity(rows, workDayCount);

  useEffect(() => {
    if (dateMode !== 'pi' || !parsedPiDateRange) {
      return;
    }

    if (startDate !== piRangeStartDate) {
      setStartDate(piRangeStartDate);
    }

    if (endDate !== piRangeEndDate) {
      setEndDate(piRangeEndDate);
    }
  }, [dateMode, endDate, parsedPiDateRange, piRangeEndDate, piRangeStartDate, setEndDate, setStartDate, startDate]);

  const handleAddRow = useCallback(() => {
    addRow({
      id: generateCapacityRowId(),
      role: DEFAULT_ROLE,
      memberCount: DEFAULT_MEMBER_COUNT,
      capacityPercentage: DEFAULT_CAPACITY_PERCENTAGE,
      totalPtoDays: DEFAULT_PTO_DAYS,
    });
  }, [addRow]);

  // Auto-fills the team makeup (roles + head counts) from the roster. Capacity numbers stay manual, so
  // a re-seed would wipe any allocation/PTO the planner already entered — hence the confirm guard.
  const handleSeedFromRoster = useCallback(() => {
    const seededRows = seedCapacityRowsFromRoster(rosterMembers);
    if (seededRows.length === 0) {
      return;
    }

    if (rows.length > 0) {
      const shouldReplace = window.confirm(
        `Replace the current ${rows.length} team composition row${rows.length === 1 ? '' : 's'} with `
        + `${seededRows.length} row${seededRows.length === 1 ? '' : 's'} from the roster? `
        + 'Capacity % and PTO Days will reset to defaults and must be re-entered.',
      );
      if (!shouldReplace) {
        return;
      }
    }

    setRows(seededRows);
  }, [rosterMembers, rows.length, setRows]);

  return (
    <div className={styles.capacityTab}>
      {/* ── Date range ── */}
      <section className={styles.dateRangeSection}>
        <h2 className={styles.sectionTitle}>Planning Window</h2>
        <p className={styles.sectionDescription}>
          Default the planning window from the selected PI label, or switch to custom dates when you need a different range.
        </p>
        <div className={styles.dateModeRow}>
          <span className={styles.dateModeLabel}>Date source</span>
          <div className={styles.dateModeToggle}>
            <button
              aria-pressed={dateMode === 'pi'}
              className={dateMode === 'pi' ? styles.dateModeButtonActive : styles.dateModeButton}
              onClick={() => setDateMode('pi')}
              type="button"
            >
              PI Dates
            </button>
            <button
              aria-pressed={dateMode === 'custom'}
              className={dateMode === 'custom' ? styles.dateModeButtonActive : styles.dateModeButton}
              onClick={() => setDateMode('custom')}
              type="button"
            >
              Custom Dates
            </button>
          </div>
        </div>
        <p className={styles.dateModeHint}>
          {dateMode === 'pi'
            ? parsedPiDateRange
              ? `Using ${selectedPiName} for the planning window.`
              : 'The selected PI name does not include a parsable date range. Switch to Custom Dates to enter your own window.'
            : 'Custom Dates mode keeps your manual start and end dates unchanged until you switch back to PI Dates.'}
        </p>
        <div className={styles.dateInputRow}>
          <label className={styles.dateLabel} htmlFor="capacity-start-date">
            Start Date
            <input
              className={styles.dateInput}
              disabled={dateMode === 'pi'}
              id="capacity-start-date"
              onChange={(changeEvent) => setStartDate(changeEvent.target.value)}
              type="date"
              value={startDate}
            />
          </label>
          <label className={styles.dateLabel} htmlFor="capacity-end-date">
            End Date
            <input
              className={styles.dateInput}
              disabled={dateMode === 'pi'}
              id="capacity-end-date"
              onChange={(changeEvent) => setEndDate(changeEvent.target.value)}
              type="date"
              value={endDate}
            />
          </label>
          {workDayCount > 0 && (
            <span className={styles.workDaysBadge}>
              {workDayCount} work {workDayCount === 1 ? 'day' : 'days'}
            </span>
          )}
        </div>
      </section>

      {/* ── Team composition ── */}
      <section className={styles.teamSection}>
        <div className={styles.teamSectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Team Composition</h2>
            <p className={styles.sectionDescription}>
              Add a row for each group of people at the same role and allocation level. PTO days are the
              total days off across the entire row during the planning window.
            </p>
          </div>
          <div className={styles.teamSectionActions}>
            <button
              className={styles.seedFromRosterButton}
              disabled={!hasSeedableRosterMembers}
              onClick={handleSeedFromRoster}
              title={
                hasSeedableRosterMembers
                  ? 'Fill the team makeup from the roster (Scrum Master, Product Owner, Solution Architect, and RTE are excluded)'
                  : 'Add roster members with a delivery role first, then seed the team makeup from them'
              }
              type="button"
            >
              Seed from Roster
            </button>
            <button className={styles.addRowButton} onClick={handleAddRow} type="button">
              + Add Row
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
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
                {rows.map((row) => (
                  <CapacityRowEditor
                    key={row.id}
                    onRemove={removeRow}
                    onUpdate={updateRow}
                    row={row}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Results ── */}
      <CapacityResults totalCapacityPoints={totalCapacityPoints} workDayCount={workDayCount} />
    </div>
  );
}
