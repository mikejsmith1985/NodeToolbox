// PoToolView.test.tsx — Proves the PO Tool shell mounts THE SAME Feature Review and PI Review components
// the Team Dashboard uses, scoped to the PO Tool's own team selection, without disturbing the dashboard.
// See specs/017-po-feature-tools/contracts/tab-reuse.md (INV-T1..T5).

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockFeatureReviewTab,
  mockPiReviewTab,
  mockFeatureSplitterTab,
  mockFeatureCompositionTab,
  mockSetRosterDashboardTeamProfileId,
} = vi.hoisted(() => ({
  mockFeatureReviewTab: vi.fn(),
  mockPiReviewTab: vi.fn(),
  mockFeatureSplitterTab: vi.fn(),
  mockFeatureCompositionTab: vi.fn(),
  mockSetRosterDashboardTeamProfileId: vi.fn(),
}));

// The reused tabs are stubbed so these tests assert HOW they are mounted (the contract), not what they render.
vi.mock('../SprintDashboard/FeatureReviewTab.tsx', () => ({
  default: (props: Record<string, unknown>) => {
    mockFeatureReviewTab(props);
    return <div data-testid="feature-review-tab" />;
  },
}));

vi.mock('../ArtView/PiReviewTab.tsx', () => ({
  default: (props: Record<string, unknown>) => {
    mockPiReviewTab(props);
    return <div data-testid="pi-review-tab" />;
  },
}));

// The authoring tabs are exercised in their own tests; here we only assert HOW the shell mounts them.
vi.mock('./FeatureSplitterTab', () => ({
  default: (props: Record<string, unknown>) => {
    mockFeatureSplitterTab(props);
    return <div data-testid="feature-splitter-tab" />;
  },
}));

vi.mock('./FeatureCompositionTab', () => ({
  default: (props: Record<string, unknown>) => {
    mockFeatureCompositionTab(props);
    return <div data-testid="feature-composition-tab" />;
  },
}));

vi.mock('../SprintDashboard/hooks/useStandupRosterStore', () => ({
  useStandupRosterStore: {
    getState: () => ({ setDashboardTeamProfileId: mockSetRosterDashboardTeamProfileId }),
  },
}));

import { useSettingsStore } from '../../store/settingsStore';
import PoToolView from './PoToolView';

function buildTeamProfile(id: string, name: string, piValue: string, boardId = '42') {
  return {
    id,
    name,
    projectKey: name.toUpperCase(),
    boardId,
    boardName: `${name} Board`,
    boardType: 'scrum',
    scopeMode: 'pi',
    selectedSprintId: '',
    selectedFixVersion: '',
    selectedPiValue: piValue,
    piReviewPages: [{ piName: piValue, pageUrl: 'https://confluence/pages/12345/PI' }],
  };
}

const TEAM_PROFILES = [
  buildTeamProfile('profile-alpha', 'Alpha', 'PI 2026.3', '42'),
  buildTeamProfile('profile-beta', 'Beta', 'PI 2026.4', '77'),
];

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  useSettingsStore.setState({
    sprintDashboardTeamProfiles: TEAM_PROFILES,
    sprintDashboardActiveTeamProfileId: 'profile-alpha',
  });
});

describe('PoToolView — shell', () => {
  it('offers the four PO Tool tabs', () => {
    render(<PoToolView />);

    expect(screen.getByRole('tab', { name: 'Feature Review' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'PI Review' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Feature Splitter' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Feature Composition' })).toBeInTheDocument();
  });

  it('pairs the panel with its tab so assistive tech announces them together', () => {
    render(<PoToolView />);

    const featureReviewTab = screen.getByRole('tab', { name: 'Feature Review' });
    const activePanel = screen.getByRole('tabpanel');
    expect(activePanel).toHaveAttribute('aria-labelledby', featureReviewTab.id);
  });
});

describe('PoToolView — mounts the reused tabs (INV-T1, INV-T4)', () => {
  it('mounts Feature Review scoped to the PO Tool team, not the app-wide active team', () => {
    render(<PoToolView />);

    expect(screen.getByTestId('feature-review-tab')).toBeInTheDocument();
    expect(mockFeatureReviewTab).toHaveBeenCalledWith(
      expect.objectContaining({ dashboardTeamProfileId: 'profile-alpha' }),
    );
  });

  it('passes the selected team board and project through to Feature Review', () => {
    render(<PoToolView />);

    expect(mockFeatureReviewTab).toHaveBeenCalledWith(
      expect.objectContaining({ boardId: 42, projectKey: 'ALPHA', selectedPiName: 'PI 2026.3' }),
    );
  });

  it('mounts PI Review in authoring mode with an ArtTeam built from the PO Tool profile', async () => {
    render(<PoToolView />);

    await userEvent.click(screen.getByRole('tab', { name: 'PI Review' }));

    expect(screen.getByTestId('pi-review-tab')).toBeInTheDocument();
    const piReviewProps = mockPiReviewTab.mock.calls[0]?.[0] as {
      mode?: string;
      selectedPiName?: string;
      teams?: Array<{ id: string; sprintIssues: unknown[] }>;
    };
    expect(piReviewProps.mode).toBe('authoring');
    expect(piReviewProps.selectedPiName).toBe('PI 2026.3');
    expect(piReviewProps.teams?.[0]?.id).toBe('profile-alpha');
    expect(piReviewProps.teams?.[0]?.sprintIssues).toEqual([]);
  });
});

describe('PoToolView — independent team selection (INV-T3, SC-015)', () => {
  it('re-scopes the reused tabs when the PO picks a different team', async () => {
    render(<PoToolView />);

    await userEvent.selectOptions(screen.getByLabelText(/team/i), 'profile-beta');

    expect(mockFeatureReviewTab).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dashboardTeamProfileId: 'profile-beta',
        boardId: 77,
        projectKey: 'BETA',
        selectedPiName: 'PI 2026.4',
      }),
    );
  });

  it('NEVER moves the Team Dashboard selection when the PO changes team', async () => {
    render(<PoToolView />);

    await userEvent.selectOptions(screen.getByLabelText(/team/i), 'profile-beta');

    expect(useSettingsStore.getState().sprintDashboardActiveTeamProfileId).toBe('profile-alpha');
  });

  it('scopes the shared roster store to the PO Tool team so Pull Features filters by the right PO', async () => {
    render(<PoToolView />);

    expect(mockSetRosterDashboardTeamProfileId).toHaveBeenCalledWith('profile-alpha');

    await userEvent.selectOptions(screen.getByLabelText(/team/i), 'profile-beta');

    expect(mockSetRosterDashboardTeamProfileId).toHaveBeenLastCalledWith('profile-beta');
  });
});

describe('PoToolView — authoring tabs', () => {
  it('mounts the Feature Splitter scoped to the PO Tool team', async () => {
    render(<PoToolView />);

    await userEvent.click(screen.getByRole('tab', { name: 'Feature Splitter' }));

    expect(screen.getByTestId('feature-splitter-tab')).toBeInTheDocument();
    expect(mockFeatureSplitterTab).toHaveBeenCalledWith(
      expect.objectContaining({ dashboardTeamProfileId: 'profile-alpha' }),
    );
  });

  it('mounts the Feature Composition seeded with the project of the PO Tool team', async () => {
    render(<PoToolView />);

    await userEvent.click(screen.getByRole('tab', { name: 'Feature Composition' }));

    expect(screen.getByTestId('feature-composition-tab')).toBeInTheDocument();
    expect(mockFeatureCompositionTab).toHaveBeenCalledWith(
      expect.objectContaining({ dashboardTeamProfileId: 'profile-alpha', defaultProjectKey: 'ALPHA' }),
    );
  });

  it('guides the PO when no team is saved rather than mounting an unscoped tab', () => {
    useSettingsStore.setState({ sprintDashboardTeamProfiles: [], sprintDashboardActiveTeamProfileId: '' });

    render(<PoToolView />);

    expect(screen.getByText(/no team selected/i)).toBeInTheDocument();
    expect(mockFeatureReviewTab).not.toHaveBeenCalled();
  });
});
