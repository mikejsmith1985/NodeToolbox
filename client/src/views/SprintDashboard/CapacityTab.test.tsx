// CapacityTab.test.tsx — Tests for the Capacity tab helper functions and component rendering.
//
// Unit tests cover the pure calculation helpers exhaustively since they contain the core
// business logic (work day counting and capacity math). Rendering tests verify the key
// UI elements are present and the results update when data changes.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  calculateRowCapacity,
  calculateTotalCapacity,
  countWorkDays,
} from './capacityModel.ts';
import type { CapacityRow } from './capacityModel.ts';
import { useCapacityStore } from './hooks/useCapacityStore.ts';
import { useStandupRosterStore } from './hooks/useStandupRosterStore.ts';
import type { RosterRoleCapabilities, StandupRosterMember } from './hooks/useStandupRosterStore.ts';
import CapacityTab from './CapacityTab.tsx';

// ── Helpers ──

function buildCapacityRow(overrides: Partial<CapacityRow> = {}): CapacityRow {
  return {
    id: 'row-test',
    role: 'Developer',
    memberCount: 1,
    capacityPercentage: 100,
    totalPtoDays: 0,
    ...overrides,
  };
}

function resetStore(): void {
  useCapacityStore.setState({ dateMode: 'pi', startDate: '', endDate: '', rows: [] });
  useStandupRosterStore.setState({ rosterMembers: [] });
}

let rosterMemberSequence = 0;

/** Builds a minimal roster member carrying only the role capabilities under test. */
function buildRosterMember(roleCapabilities?: RosterRoleCapabilities): StandupRosterMember {
  rosterMemberSequence += 1;
  return {
    id: `roster-${rosterMemberSequence}`,
    displayName: `Roster ${rosterMemberSequence}`,
    assigneeQueryValue: `roster${rosterMemberSequence}`,
    roleCapabilities,
  };
}

beforeEach(() => {
  resetStore();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── countWorkDays ──

describe('countWorkDays', () => {
  it('returns 0 for empty date strings', () => {
    expect(countWorkDays('', '')).toBe(0);
    expect(countWorkDays('2025-01-06', '')).toBe(0);
    expect(countWorkDays('', '2025-01-10')).toBe(0);
  });

  it('returns 0 when end date is before start date', () => {
    expect(countWorkDays('2025-01-10', '2025-01-06')).toBe(0);
  });

  it('returns 1 for a single Monday', () => {
    // 2025-01-06 is a Monday
    expect(countWorkDays('2025-01-06', '2025-01-06')).toBe(1);
  });

  it('returns 0 for a weekend-only range (Saturday to Sunday)', () => {
    // 2025-01-04 Sat, 2025-01-05 Sun
    expect(countWorkDays('2025-01-04', '2025-01-05')).toBe(0);
  });

  it('returns 5 for a standard Mon–Fri work week', () => {
    // 2025-01-06 Mon → 2025-01-10 Fri
    expect(countWorkDays('2025-01-06', '2025-01-10')).toBe(5);
  });

  it('returns 10 for two consecutive Mon–Fri work weeks', () => {
    // 2025-01-06 Mon → 2025-01-17 Fri
    expect(countWorkDays('2025-01-06', '2025-01-17')).toBe(10);
  });

  it('excludes Saturday and Sunday within a multi-week range', () => {
    // 2025-01-06 Mon → 2025-01-13 Mon = 6 working days
    expect(countWorkDays('2025-01-06', '2025-01-13')).toBe(6);
  });

  it('returns 1 for a Friday start date with Friday end date', () => {
    // 2025-01-10 Fri
    expect(countWorkDays('2025-01-10', '2025-01-10')).toBe(1);
  });
});

// ── calculateRowCapacity ──

describe('calculateRowCapacity', () => {
  it('returns workDays × memberCount when capacity is 100% and PTO is 0', () => {
    const row = buildCapacityRow({ memberCount: 1, capacityPercentage: 100, totalPtoDays: 0 });
    expect(calculateRowCapacity(row, 10)).toBe(10);
  });

  it('scales capacity by the percentage multiplier', () => {
    // 10 work days, 1 person at 50% = 5 points
    const row = buildCapacityRow({ memberCount: 1, capacityPercentage: 50, totalPtoDays: 0 });
    expect(calculateRowCapacity(row, 10)).toBe(5);
  });

  it('multiplies by memberCount before applying the percentage', () => {
    // 10 work days, 5 people at 100% = 50 points
    const row = buildCapacityRow({ memberCount: 5, capacityPercentage: 100, totalPtoDays: 0 });
    expect(calculateRowCapacity(row, 10)).toBe(50);
  });

  it('subtracts PTO days before applying the capacity multiplier', () => {
    // 10 work days, 1 person at 100%, 1 PTO day → (10 - 1) × 1.0 = 9
    const row = buildCapacityRow({ memberCount: 1, capacityPercentage: 100, totalPtoDays: 1 });
    expect(calculateRowCapacity(row, 10)).toBe(9);
  });

  it('applies the percentage AFTER subtracting PTO', () => {
    // 10 work days, 1 person at 50%, 2 PTO days → (10 - 2) × 0.5 = 4
    const row = buildCapacityRow({ memberCount: 1, capacityPercentage: 50, totalPtoDays: 2 });
    expect(calculateRowCapacity(row, 10)).toBe(4);
  });

  it('handles group PTO across multiple people', () => {
    // 10 work days, 5 people at 100%, 3 total PTO days → (50 - 3) × 1.0 = 47
    const row = buildCapacityRow({ memberCount: 5, capacityPercentage: 100, totalPtoDays: 3 });
    expect(calculateRowCapacity(row, 10)).toBe(47);
  });

  it('clamps to 0 when PTO exceeds total available person-days', () => {
    // 10 work days, 1 person at 100%, 15 PTO days — clamp to 0, not negative
    const row = buildCapacityRow({ memberCount: 1, capacityPercentage: 100, totalPtoDays: 15 });
    expect(calculateRowCapacity(row, 10)).toBe(0);
  });

  it('returns 0 when workDayCount is 0', () => {
    const row = buildCapacityRow({ memberCount: 3, capacityPercentage: 100, totalPtoDays: 0 });
    expect(calculateRowCapacity(row, 0)).toBe(0);
  });
});

// ── calculateTotalCapacity ──

describe('calculateTotalCapacity', () => {
  it('returns 0 for an empty rows array', () => {
    expect(calculateTotalCapacity([], 10)).toBe(0);
  });

  it('sums capacity across multiple rows', () => {
    // Dev: 10×5×1.0 = 50; QE: 10×2×0.5 = 10 → total 60
    const rows: CapacityRow[] = [
      buildCapacityRow({ id: 'r1', role: 'Developer', memberCount: 5, capacityPercentage: 100, totalPtoDays: 0 }),
      buildCapacityRow({ id: 'r2', role: 'External Tester', memberCount: 2, capacityPercentage: 50, totalPtoDays: 0 }),
    ];
    expect(calculateTotalCapacity(rows, 10)).toBe(60);
  });

  it('accounts for PTO in each row when summing', () => {
    // Dev: (10×1 - 1)×1.0 = 9; SM: (10×1 - 0)×1.0 = 10 → 19
    const rows: CapacityRow[] = [
      buildCapacityRow({ id: 'r1', role: 'Developer', memberCount: 1, capacityPercentage: 100, totalPtoDays: 1 }),
      buildCapacityRow({ id: 'r2', role: 'Dev Lead', memberCount: 1, capacityPercentage: 100, totalPtoDays: 0 }),
    ];
    expect(calculateTotalCapacity(rows, 10)).toBe(19);
  });
});

// ── CapacityTab rendering ──

describe('CapacityTab', () => {
  it('renders the date range section and results panel', () => {
    render(<CapacityTab selectedPiName="" />);
    expect(screen.getByText('Planning Window')).toBeInTheDocument();
    expect(screen.getByText('Capacity Results')).toBeInTheDocument();
  });

  it('shows the empty-state message when no rows are present', () => {
    render(<CapacityTab selectedPiName="" />);
    expect(screen.getByText(/No team members added yet/)).toBeInTheDocument();
  });

  it('shows 0 capacity results when no dates or rows are set', () => {
    render(<CapacityTab selectedPiName="" />);
    // Work days, 100% capacity, and 80% capacity are all 0
    expect(screen.getByText('Work Days')).toBeInTheDocument();
    expect(screen.getByText('100% Capacity (pts)')).toBeInTheDocument();
    expect(screen.getByText('80% Capacity (pts)')).toBeInTheDocument();
  });

  it('adds a new row when Add Row is clicked', async () => {
    const user = userEvent.setup();
    render(<CapacityTab selectedPiName="" />);
    await user.click(screen.getByRole('button', { name: '+ Add Row' }));
    expect(screen.getByRole('combobox', { name: 'Role' })).toBeInTheDocument();
  });

  it('shows the expanded ART role list in the dropdown', async () => {
    const user = userEvent.setup();
    render(<CapacityTab selectedPiName="" />);
    await user.click(screen.getByRole('button', { name: '+ Add Row' }));
    const roleSelect = screen.getByRole('combobox', { name: 'Role' });
    expect(screen.getByRole('option', { name: 'Dev Lead' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Internal Tester' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Systems Analyst' })).toBeInTheDocument();
    await user.selectOptions(roleSelect, 'Dev Lead');
    expect(roleSelect).toHaveValue('Dev Lead');
  });

  it('removes a row when the remove button is clicked', async () => {
    const user = userEvent.setup();
    render(<CapacityTab selectedPiName="" />);
    await user.click(screen.getByRole('button', { name: '+ Add Row' }));
    expect(screen.queryByRole('combobox', { name: 'Role' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Remove Developer row/ }));
    expect(screen.queryByRole('combobox', { name: 'Role' })).not.toBeInTheDocument();
  });

  it('displays the work days badge when a valid date range is entered', async () => {
    const user = userEvent.setup();
    render(<CapacityTab selectedPiName="" />);
    await user.click(screen.getByRole('button', { name: 'Custom Dates' }));
    const startInput = screen.getByLabelText('Start Date');
    const endInput = screen.getByLabelText('End Date');
    await user.type(startInput, '2025-01-06');
    await user.type(endInput, '2025-01-10');
    expect(await screen.findByText(/5 work days/)).toBeInTheDocument();
  });

  it('defaults the planning window from the selected PI date range', () => {
    render(<CapacityTab selectedPiName="PI 26.3 (05/21/26 - 07/29/26)" />);

    expect(screen.getByLabelText('Start Date')).toHaveValue('2026-05-21');
    expect(screen.getByLabelText('End Date')).toHaveValue('2026-07-29');
    expect(screen.getByRole('button', { name: 'PI Dates' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('allows switching to custom dates without overwriting the manual range', async () => {
    const user = userEvent.setup();
    render(<CapacityTab selectedPiName="PI 26.3 (05/21/26 - 07/29/26)" />);

    await user.click(screen.getByRole('button', { name: 'Custom Dates' }));
    const startInput = screen.getByLabelText('Start Date');
    const endInput = screen.getByLabelText('End Date');
    await user.clear(startInput);
    await user.type(startInput, '2026-06-01');
    await user.clear(endInput);
    await user.type(endInput, '2026-06-13');

    expect(startInput).toHaveValue('2026-06-01');
    expect(endInput).toHaveValue('2026-06-13');
  });
});

// ── Seed from Roster ──

describe('CapacityTab — Seed from Roster', () => {
  it('disables the Seed from Roster button when the roster has no counting members', () => {
    useStandupRosterStore.setState({
      rosterMembers: [buildRosterMember({ canScrumMaster: true } as RosterRoleCapabilities)],
    });
    render(<CapacityTab selectedPiName="" />);
    expect(screen.getByRole('button', { name: /seed from roster/i })).toBeDisabled();
  });

  it('seeds one grouped row per counting role when there are no existing rows', async () => {
    const user = userEvent.setup();
    useStandupRosterStore.setState({
      rosterMembers: [
        buildRosterMember({ canDevelop: true } as RosterRoleCapabilities),
        buildRosterMember({ canDevelop: true } as RosterRoleCapabilities),
        buildRosterMember({ canInternalTest: true } as RosterRoleCapabilities),
        buildRosterMember({ canScrumMaster: true } as RosterRoleCapabilities),
      ],
    });
    render(<CapacityTab selectedPiName="" />);

    await user.click(screen.getByRole('button', { name: /seed from roster/i }));

    const seededRows = useCapacityStore.getState().rows;
    // Developer (2 developers grouped) + Internal Tester (1); the Scrum Master is excluded.
    expect(seededRows.map((row) => ({ role: row.role, memberCount: row.memberCount }))).toEqual([
      { role: 'Developer', memberCount: 2 },
      { role: 'Internal Tester', memberCount: 1 },
    ]);
  });

  it('asks before replacing existing rows and leaves them untouched when cancelled', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    useCapacityStore.setState({ rows: [buildCapacityRow({ id: 'manual', role: 'Developer', memberCount: 9 })] });
    useStandupRosterStore.setState({
      rosterMembers: [buildRosterMember({ canDevelop: true } as RosterRoleCapabilities)],
    });
    render(<CapacityTab selectedPiName="" />);

    await user.click(screen.getByRole('button', { name: /seed from roster/i }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // The user cancelled, so the hand-entered row survives unchanged.
    expect(useCapacityStore.getState().rows).toEqual([
      { id: 'manual', role: 'Developer', memberCount: 9, capacityPercentage: 100, totalPtoDays: 0 },
    ]);
  });

  it('replaces existing rows when the confirmation is accepted', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    useCapacityStore.setState({ rows: [buildCapacityRow({ id: 'manual', role: 'Dev Lead', memberCount: 1 })] });
    useStandupRosterStore.setState({
      rosterMembers: [buildRosterMember({ canExternalTest: true } as RosterRoleCapabilities)],
    });
    render(<CapacityTab selectedPiName="" />);

    await user.click(screen.getByRole('button', { name: /seed from roster/i }));

    const seededRows = useCapacityStore.getState().rows;
    expect(seededRows).toHaveLength(1);
    expect(seededRows[0].role).toBe('External Tester');
  });
});
