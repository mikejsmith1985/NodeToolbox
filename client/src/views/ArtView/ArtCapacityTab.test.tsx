// ArtCapacityTab.test.tsx — Tests for the ART-specific multi-team capacity planner.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import type { CapacityRow } from '../SprintDashboard/capacityModel.ts';
import type { ArtTeam } from './hooks/useArtData.ts';
import { useArtCapacityStore } from './hooks/useArtCapacityStore.ts';
import ArtCapacityTab from './ArtCapacityTab.tsx';

function buildArtTeam(overrides: Partial<ArtTeam> = {}): ArtTeam {
  return {
    id: 'team-1',
    name: 'Alpha Team',
    boardId: '42',
    sprintIssues: [],
    isLoading: false,
    loadError: null,
    ...overrides,
  };
}

function buildCapacityRow(overrides: Partial<CapacityRow> = {}): CapacityRow {
  return {
    id: 'row-1',
    role: 'Dev',
    memberCount: 2,
    capacityPercentage: 100,
    totalPtoDays: 0,
    ...overrides,
  };
}

function resetStoreToDefaults(): void {
  useArtCapacityStore.setState({ teamConfigs: {} });
}

beforeEach(() => {
  resetStoreToDefaults();
  localStorage.clear();
});

describe('ArtCapacityTab', () => {
  it('shows an empty state when no ART teams are configured', () => {
    render(<ArtCapacityTab teams={[]} />);
    expect(screen.getByText(/no teams configured/i)).toBeInTheDocument();
  });

  it('renders a per-team capacity editor and expanded role dropdown options', async () => {
    const user = userEvent.setup();
    render(<ArtCapacityTab teams={[buildArtTeam()]} />);

    await user.click(screen.getByRole('button', { name: /\+ add row/i }));
    expect(screen.getByText('Alpha Team')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Dev Lead' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'TPO' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Test Lead' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /total capacity summary/i })).not.toBeInTheDocument();
  });

  it('renders a cross-team total capacity summary when more than one team is configured', () => {
    useArtCapacityStore.setState({
      teamConfigs: {
        'team-1': {
          startDate: '2025-01-06',
          endDate: '2025-01-10',
          rows: [buildCapacityRow({ id: 'row-a', role: 'Dev', memberCount: 2 })],
        },
        'team-2': {
          startDate: '2025-01-06',
          endDate: '2025-01-10',
          rows: [buildCapacityRow({ id: 'row-b', role: 'QE', memberCount: 1 })],
        },
      },
    });

    render(
      <ArtCapacityTab
        teams={[
          buildArtTeam({ id: 'team-1', name: 'Alpha Team' }),
          buildArtTeam({ id: 'team-2', name: 'Beta Team', boardId: '99' }),
        ]}
      />,
    );

    expect(screen.getByLabelText(/total capacity summary/i)).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Alpha Team' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Beta Team' })).toBeInTheDocument();
    expect(screen.getByText('80% Target')).toBeInTheDocument();
  });
});
