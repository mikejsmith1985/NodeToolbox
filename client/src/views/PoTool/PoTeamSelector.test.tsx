// PoTeamSelector.test.tsx — Proves the PO Tool's own team/PI picker reads the shared profile catalog
// without mutating it, never moves the Team Dashboard's selection (INV-T3), and (US4/FR-012..014) offers
// the Program Increment as a Jira-populated dropdown that degrades to manual entry when Jira is unreachable.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '../../store/settingsStore';
import PoTeamSelector from './PoTeamSelector';
import { loadAvailablePiNamesFromJira, type ArtTeam } from '../ArtView/hooks/useArtData';

// The PI options come from Jira; the network call is mocked so these tests stay fast and deterministic.
vi.mock('../ArtView/hooks/useArtData', () => ({
  loadAvailablePiNamesFromJira: vi.fn(),
}));

const loadPiNamesMock = vi.mocked(loadAvailablePiNamesFromJira);

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

/** A minimal ArtTeam for the selected profile — only the shape matters, the loader is mocked. */
function buildPiReviewTeams(teamId: string): ArtTeam[] {
  return [
    {
      id: teamId,
      name: teamId,
      boardId: '42',
      piReviewPages: [],
      sprintIssues: [],
      isLoading: false,
      loadError: null,
    },
  ];
}

const ALPHA_TEAMS = buildPiReviewTeams('profile-alpha');

beforeEach(() => {
  loadPiNamesMock.mockReset();
  loadPiNamesMock.mockResolvedValue(['PI 2026.3', 'PI 2026.4', 'PI 2027.1']);
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
        piReviewTeams={ALPHA_TEAMS}
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
        piReviewTeams={ALPHA_TEAMS}
        onTeamProfileChange={handleTeamProfileChange}
        onPiNameChange={vi.fn()}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText(/^team$/i), 'profile-beta');

    expect(handleTeamProfileChange).toHaveBeenCalledWith('profile-beta');
  });

  it('does not touch the Team Dashboard selection when the PO changes team', async () => {
    render(
      <PoTeamSelector
        selectedTeamProfileId="profile-alpha"
        selectedPiName="PI 2026.3"
        piReviewTeams={ALPHA_TEAMS}
        onTeamProfileChange={vi.fn()}
        onPiNameChange={vi.fn()}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText(/^team$/i), 'profile-beta');

    expect(useSettingsStore.getState().sprintDashboardActiveTeamProfileId).toBe('profile-alpha');
    expect(useSettingsStore.getState().sprintDashboardTeamProfiles).toEqual(TEAM_PROFILES);
  });

  it('populates the Program Increment dropdown from Jira for the selected team', async () => {
    render(
      <PoTeamSelector
        selectedTeamProfileId="profile-alpha"
        selectedPiName="PI 2026.3"
        piReviewTeams={ALPHA_TEAMS}
        onTeamProfileChange={vi.fn()}
        onPiNameChange={vi.fn()}
      />,
    );

    // The loader is asked for THIS team's PIs, and every returned label becomes a selectable option.
    expect(loadPiNamesMock).toHaveBeenCalledWith(ALPHA_TEAMS);
    expect(await screen.findByRole('option', { name: 'PI 2027.1' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'PI 2026.4' })).toBeInTheDocument();
  });

  it('reports the PI the PO picks from the dropdown', async () => {
    const handlePiNameChange = vi.fn();
    render(
      <PoTeamSelector
        selectedTeamProfileId="profile-alpha"
        selectedPiName="PI 2026.3"
        piReviewTeams={ALPHA_TEAMS}
        onTeamProfileChange={vi.fn()}
        onPiNameChange={handlePiNameChange}
      />,
    );

    // Wait for the options to load (the control is briefly disabled mid-load) before making a choice.
    await screen.findByRole('option', { name: 'PI 2027.1' });
    const piSelect = screen.getByRole('combobox', { name: /program increment/i });
    await userEvent.selectOptions(piSelect, 'PI 2027.1');

    expect(handlePiNameChange).toHaveBeenCalledWith('PI 2027.1');
  });

  it('never offers a PI outside the loaded option list', async () => {
    render(
      <PoTeamSelector
        selectedTeamProfileId="profile-alpha"
        selectedPiName="PI 2026.3"
        piReviewTeams={ALPHA_TEAMS}
        onTeamProfileChange={vi.fn()}
        onPiNameChange={vi.fn()}
      />,
    );

    // Wait for options to load, then confirm an un-returned PI simply is not an option.
    await screen.findByRole('option', { name: 'PI 2027.1' });
    expect(screen.queryByRole('option', { name: 'PI 2099.9' })).not.toBeInTheDocument();
  });

  it('reloads the PI options when the selected team changes', async () => {
    const { rerender } = render(
      <PoTeamSelector
        selectedTeamProfileId="profile-alpha"
        selectedPiName="PI 2026.3"
        piReviewTeams={ALPHA_TEAMS}
        onTeamProfileChange={vi.fn()}
        onPiNameChange={vi.fn()}
      />,
    );
    await screen.findByRole('option', { name: 'PI 2027.1' });
    expect(loadPiNamesMock).toHaveBeenCalledTimes(1);

    const betaTeams = buildPiReviewTeams('profile-beta');
    rerender(
      <PoTeamSelector
        selectedTeamProfileId="profile-beta"
        selectedPiName="PI 2026.4"
        piReviewTeams={betaTeams}
        onTeamProfileChange={vi.fn()}
        onPiNameChange={vi.fn()}
      />,
    );

    await vi.waitFor(() => expect(loadPiNamesMock).toHaveBeenCalledWith(betaTeams));
    expect(loadPiNamesMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to a manual-entry field when Jira cannot be reached', async () => {
    loadPiNamesMock.mockRejectedValue(new Error('network down'));
    const handlePiNameChange = vi.fn();
    render(
      <PoTeamSelector
        selectedTeamProfileId="profile-alpha"
        selectedPiName="PI 2026.3"
        piReviewTeams={ALPHA_TEAMS}
        onTeamProfileChange={vi.fn()}
        onPiNameChange={handlePiNameChange}
      />,
    );

    // The tool must never be blocked by an empty locked dropdown — an editable field takes over,
    // with an honest message and a way to retry.
    const piField = await screen.findByRole('textbox', { name: /program increment/i });
    expect(screen.getByText(/could/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();

    await userEvent.type(piField, 'X');
    expect(handlePiNameChange).toHaveBeenCalled();
  });

  it('falls back to manual entry when Jira returns no program increments', async () => {
    loadPiNamesMock.mockResolvedValue([]);
    render(
      <PoTeamSelector
        selectedTeamProfileId="profile-alpha"
        selectedPiName=""
        piReviewTeams={ALPHA_TEAMS}
        onTeamProfileChange={vi.fn()}
        onPiNameChange={vi.fn()}
      />,
    );

    expect(await screen.findByRole('textbox', { name: /program increment/i })).toBeInTheDocument();
  });

  it('tells the PO what to do when no team is saved yet, rather than showing an empty picker', () => {
    useSettingsStore.setState({ sprintDashboardTeamProfiles: [] });

    render(
      <PoTeamSelector
        selectedTeamProfileId=""
        selectedPiName=""
        piReviewTeams={[]}
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
        piReviewTeams={ALPHA_TEAMS}
        onTeamProfileChange={vi.fn()}
        onPiNameChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/independent of the Team Dashboard/i)).toBeInTheDocument();
  });
});
