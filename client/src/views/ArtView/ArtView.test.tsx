// ArtView.test.tsx — Unit tests for the ART View tabbed component.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockState, mockActions } = vi.hoisted(() => ({
  mockState: {
    activeTab: 'overview' as 'overview' | 'impediments' | 'predictability' | 'releases' | 'sos' | 'monthly' | 'settings',
    persona: 'sm' as 'sm' | 'po' | 'dev' | 'qa',
    teams: [
      {
        id: 'team-1',
        name: 'Alpha Team',
        boardId: '42',
        sprintIssues: [],
        isLoading: false,
        loadError: null as string | null,
      },
    ],
    selectedPiName: 'PI-2025-Q1',
    isLoadingAllTeams: false,
  },
  mockActions: {
    setActiveTab: vi.fn(),
    setPersona: vi.fn(),
    setSelectedPiName: vi.fn(),
    addTeam: vi.fn(),
    removeTeam: vi.fn(),
    loadAllTeams: vi.fn().mockResolvedValue(undefined),
    loadTeam: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./hooks/useArtData.ts', () => ({
  useArtData: () => ({ state: mockState, actions: mockActions }),
}));

import ArtView from './ArtView.tsx';

describe('ArtView', () => {
  beforeEach(() => {
    mockState.activeTab = 'overview';
    vi.clearAllMocks();
  });

  it('renders the 7 tab buttons', () => {
    render(<ArtView />);
    expect(screen.getByRole('tab', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /impediments/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /predictability/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /releases/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /sos/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /monthly/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /settings/i })).toBeInTheDocument();
  });

  it('shows the persona strip with SM/PO/Dev/QA options', () => {
    render(<ArtView />);
    expect(screen.getByRole('button', { name: /^sm$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^po$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^dev$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^qa$/i })).toBeInTheDocument();
  });

  it('shows the Overview tab with Load All Teams button', () => {
    render(<ArtView />);
    expect(screen.getByRole('button', { name: /load all teams/i })).toBeInTheDocument();
  });

  it('renders a team card for each team in state', () => {
    render(<ArtView />);
    expect(screen.getByText('Alpha Team')).toBeInTheDocument();
  });

  it('shows the Settings tab with add-team form', () => {
    mockState.activeTab = 'settings';
    render(<ArtView />);
    expect(screen.getByPlaceholderText(/team name/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/board id/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add team/i })).toBeInTheDocument();
  });

  it('shows the Impediments tab', () => {
    mockState.activeTab = 'impediments';
    render(<ArtView />);
    expect(screen.getByRole('tab', { name: /impediments/i })).toBeInTheDocument();
  });
});
