// PoTeamSelector.test.tsx — Proves the PO Tool's own team/PI picker reads the shared profile catalog
// without mutating it, and never moves the Team Dashboard's selection (INV-T3).

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '../../store/settingsStore';
import PoTeamSelector from './PoTeamSelector';

function buildTeamProfile(id: string, name: string, piValue: string) {
  return {
    id,
    name,
    projectKey: name.toUpperCase(),
    boardId: '42',
    boardName: `${name} Board`,
    boardType: 'scrum',
    scopeMode: 'pi',
    selectedSprintId: '',
    selectedFixVersion: '',
    selectedPiValue: piValue,
    piReviewPages: [],
  };
}

const TEAM_PROFILES = [
  buildTeamProfile('profile-alpha', 'Alpha', 'PI 2026.3'),
  buildTeamProfile('profile-beta', 'Beta', 'PI 2026.4'),
];

beforeEach(() => {
  useSettingsStore.setState({
    sprintDashboardTeamProfiles: TEAM_PROFILES,
    sprintDashboardActiveTeamProfileId: 'profile-alpha',
  });
});

describe('PoTeamSelector', () => {
  it('offers every saved team from the shared catalog', () => {
    render(
      <PoTeamSelector
        selectedTeamProfileId="profile-alpha"
        selectedPiName="PI 2026.3"
        onTeamProfileChange={vi.fn()}
        onPiNameChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('option', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Beta' })).toBeInTheDocument();
  });

  it('reports the PO picking a different team', async () => {
    const handleTeamProfileChange = vi.fn();
    render(
      <PoTeamSelector
        selectedTeamProfileId="profile-alpha"
        selectedPiName="PI 2026.3"
        onTeamProfileChange={handleTeamProfileChange}
        onPiNameChange={vi.fn()}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText(/team/i), 'profile-beta');

    expect(handleTeamProfileChange).toHaveBeenCalledWith('profile-beta');
  });

  it('does not touch the Team Dashboard selection when the PO changes team', async () => {
    render(
      <PoTeamSelector
        selectedTeamProfileId="profile-alpha"
        selectedPiName="PI 2026.3"
        onTeamProfileChange={vi.fn()}
        onPiNameChange={vi.fn()}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText(/team/i), 'profile-beta');

    expect(useSettingsStore.getState().sprintDashboardActiveTeamProfileId).toBe('profile-alpha');
    expect(useSettingsStore.getState().sprintDashboardTeamProfiles).toEqual(TEAM_PROFILES);
  });

  it('reports a PI override', async () => {
    const handlePiNameChange = vi.fn();
    render(
      <PoTeamSelector
        selectedTeamProfileId="profile-alpha"
        selectedPiName="PI 2026.3"
        onTeamProfileChange={vi.fn()}
        onPiNameChange={handlePiNameChange}
      />,
    );

    const piInput = screen.getByLabelText(/program increment/i);
    await userEvent.clear(piInput);
    await userEvent.type(piInput, 'PI 2027.1');

    expect(handlePiNameChange).toHaveBeenCalled();
  });

  it('tells the PO what to do when no team is saved yet, rather than showing an empty picker', () => {
    useSettingsStore.setState({ sprintDashboardTeamProfiles: [] });

    render(
      <PoTeamSelector
        selectedTeamProfileId=""
        selectedPiName=""
        onTeamProfileChange={vi.fn()}
        onPiNameChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/save a dashboard team first/i)).toBeInTheDocument();
  });

  it('makes clear this selection is independent of the Team Dashboard', () => {
    // The PO must understand why this picker exists and that it will not move their dashboard.
    render(
      <PoTeamSelector
        selectedTeamProfileId="profile-alpha"
        selectedPiName="PI 2026.3"
        onTeamProfileChange={vi.fn()}
        onPiNameChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/independent of the Team Dashboard/i)).toBeInTheDocument();
  });
});
