// CapacityTab.tsx — Team capacity calculator for the Sprint Dashboard.
//
// Lets the user model sprint capacity by specifying a date range and a set of
// team role rows (each with a headcount, weighted allocation %, and PTO days).
// Results show total work days, 100% capacity, and 80% capacity in story points,
// where 1 point = 1 person-day of fully-dedicated work.

import { useCallback } from 'react';

import { useCapacityStore } from './hooks/useCapacityStore.ts';
import type { CapacityRow, TeamRole } from './hooks/useCapacityStore.ts';
import styles from './CapacityTab.module.css';

// ── Named constants ──

const ALL_TEAM_ROLES: TeamRole[] = ['Dev', 'QE', 'BT', 'SL', 'SA', 'PO', 'SM'];

const DEFAULT_ROLE: TeamRole = 'Dev';
const DEFAULT_MEMBER_COUNT = 1;
const DEFAULT_CAPACITY_PERCENTAGE = 100;
const DEFAULT_PTO_DAYS = 0;

/** Capacity buffer applied to the full-team total to get the recommended sprint commitment. */
const EIGHTY_PERCENT_MULTIPLIER = 0.8;

const SUNDAY_DAY_INDEX = 0;
const SATURDAY_DAY_INDEX = 6;

const MIN_MEMBER_COUNT = 1;
const MAX_MEMBER_COUNT = 99;
const MIN_CAPACITY_PERCENTAGE = 1;
const MAX_CAPACITY_PERCENTAGE = 100;
const MIN_PTO_DAYS = 0;

// ── Pure calculation helpers (exported for unit testing) ──

/**
 * Count the number of Monday–Friday work days between two ISO date strings, inclusive
 * of both the start and end dates. Returns 0 if the end is before the start.
 */
export function countWorkDays(startDateString: string, endDateString: string): number {
  if (!startDateString || !endDateString) {
    return 0;
  }

  // Append a fixed time so Date parsing doesn't shift the date due to timezone offset.
  const startDate = new Date(`${startDateString}T00:00:00`);
  const endDate = new Date(`${endDateString}T00:00:00`);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || startDate > endDate) {
    return 0;
  }

  let workDayCount = 0;
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const dayOfWeek = currentDate.getDay();
    const isWeekday = dayOfWeek !== SUNDAY_DAY_INDEX && dayOfWeek !== SATURDAY_DAY_INDEX;
    if (isWeekday) {
      workDayCount++;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return workDayCount;
}

/**
 * Calculate the capacity contribution (in story points) for a single team row.
 *
 * Formula: (workDays × memberCount − totalPtoDays) × (capacityPercentage / 100)
 *
 * PTO days are subtracted before the allocation multiplier because PTO means the
 * person isn't working at all — the multiplier only scales active work days.
 * A negative result is clamped to 0 (more PTO than work days is not meaningful).
 */
export function calculateRowCapacity(row: CapacityRow, workDayCount: number): number {
  const availablePersonDays = workDayCount * row.memberCount - row.totalPtoDays;
  const clampedPersonDays = Math.max(0, availablePersonDays);
  return clampedPersonDays * (row.capacityPercentage / 100);
}

/**
 * Sum the capacity contributions from all rows to produce the total team capacity
 * at 100% allocation. Returns 0 when the rows array is empty.
 */
export function calculateTotalCapacity(rows: CapacityRow[], workDayCount: number): number {
  return rows.reduce((runningTotal, row) => runningTotal + calculateRowCapacity(row, workDayCount), 0);
}

// ── Unique ID generator ──

/** Generate a simple time-based unique id for new rows. */
function generateRowId(): string {
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
  const eightyPercentCapacity = Math.floor(totalCapacityPoints * EIGHTY_PERCENT_MULTIPLIER);
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
 * Capacity tab for the Team Dashboard.
 *
 * Workflow:
 * 1. Pick a start and end date — work days (Mon–Fri) are calculated automatically.
 * 2. Add team rows: choose a role, headcount, allocation %, and any PTO days.
 * 3. Read off the 100% and 80% capacity totals to set sprint point targets.
 *
 * Configuration is persisted to localStorage so it survives tab switches and refreshes.
 */
export default function CapacityTab() {
  const startDate = useCapacityStore((state) => state.startDate);
  const endDate = useCapacityStore((state) => state.endDate);
  const rows = useCapacityStore((state) => state.rows);
  const setStartDate = useCapacityStore((state) => state.setStartDate);
  const setEndDate = useCapacityStore((state) => state.setEndDate);
  const addRow = useCapacityStore((state) => state.addRow);
  const updateRow = useCapacityStore((state) => state.updateRow);
  const removeRow = useCapacityStore((state) => state.removeRow);

  const workDayCount = countWorkDays(startDate, endDate);
  const totalCapacityPoints = calculateTotalCapacity(rows, workDayCount);

  const handleAddRow = useCallback(() => {
    addRow({
      id: generateRowId(),
      role: DEFAULT_ROLE,
      memberCount: DEFAULT_MEMBER_COUNT,
      capacityPercentage: DEFAULT_CAPACITY_PERCENTAGE,
      totalPtoDays: DEFAULT_PTO_DAYS,
    });
  }, [addRow]);

  return (
    <div className={styles.capacityTab}>
      {/* ── Date range ── */}
      <section className={styles.dateRangeSection}>
        <h2 className={styles.sectionTitle}>Planning Window</h2>
        <p className={styles.sectionDescription}>
          Set the start and end dates for this planning period. Only Monday–Friday days are counted.
        </p>
        <div className={styles.dateInputRow}>
          <label className={styles.dateLabel} htmlFor="capacity-start-date">
            Start Date
            <input
              className={styles.dateInput}
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
          <button className={styles.addRowButton} onClick={handleAddRow} type="button">
            + Add Row
          </button>
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
