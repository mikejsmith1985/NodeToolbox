// SprintDashboardPiReviewTab.test.tsx — Unit tests for the Team Dashboard PI Review authoring wrapper.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCapacityStore } from './hooks/useCapacityStore.ts';
import { useSettingsStore, type SprintDashboardPiReviewPage } from '../../store/settingsStore.ts';

/** Activates a Team Dashboard team profile with the given PI Review pages (the new source of truth). */
function activateTeamProfileWithPages(piReviewPages: SprintDashboardPiReviewPage[]): void {
  useSettingsStore.setState({
    sprintDashboardTeamProfiles: [{
      id: 'team-1', name: 'Alpha Team', projectKey: 'TBX', boardId: '42', boardName: 'Alpha Board',
      boardType: 'scrum', scopeMode: 'pi', selectedSprintId: '', selectedFixVersion: '', selectedPiValue: 'PI 26.3',
      piReviewPages,
    }],
    sprintDashboardActiveTeamProfileId: 'team-1',
  });
}

const { mockPiReviewTab, mockPiFeatureRemapPanel } = vi.hoisted(() => ({
  mockPiReviewTab: vi.fn(),
  mockPiFeatureRemapPanel: vi.fn(),
}));

vi.mock('./RiskManagementSection.tsx', () => ({
  default: () => <div>Mock Risk Management</div>,
}));

vi.mock('../ArtView/PiReviewTab.tsx', () => ({
  default: ({
    mode,
    selectedPiName,
    teamCapacitySummaries,
    teams,
  }: {
    mode?: 'authoring' | 'readout';
    selectedPiName: string;
    teamCapacitySummaries?: Record<string, unknown>;
    teams: Array<{ name: string; piReviewPages?: Array<{ piName: string; pageUrl: string }> }>;
  }) => {
    mockPiReviewTab({ mode, selectedPiName, teamCapacitySummaries, teams });
    return <div>Mock Embedded PI Review</div>;
  },
}));

vi.mock('./PiFeatureRemapPanel.tsx', () => ({
  default: ({
    projectKey,
    selectedPiName,
  }: {
    projectKey: string;
    selectedPiName: string;
  }) => {
    mockPiFeatureRemapPanel({ projectKey, selectedPiName });
    return <div>Mock PI Carryover Remap</div>;
  },
}));

import SprintDashboardPiReviewTab from './SprintDashboardPiReviewTab.tsx';

describe('SprintDashboardPiReviewTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSettingsStore.setState({ sprintDashboardTeamProfiles: [], sprintDashboardActiveTeamProfileId: '' });
    useCapacityStore.setState({
      dateMode: 'pi',
      startDate: '',
      endDate: '',
      rows: [],
    });
  });

  it('renders the shared PI Review editor in authoring mode for the active team profile', () => {
    activateTeamProfileWithPages([
      { piName: 'PI 26.3', pageUrl: 'https://example.atlassian.net/wiki/pages/12345/Alpha' },
    ]);

    render(
      <SprintDashboardPiReviewTab
        boardId={42}
        boardName="Alpha Board"
        projectKey="TBX"
        riskImpactDateFieldId=""
        riskResponseFieldId=""
        selectedPiName="PI 26.3"
        sprintIssues={[]}
      />,
    );

    expect(screen.getByText('Mock Embedded PI Review')).toBeInTheDocument();
    expect(screen.getByText('Mock PI Carryover Remap')).toBeInTheDocument();
    expect(screen.getByText('Planning Window')).toBeInTheDocument();
    expect(screen.getByText('Team Composition')).toBeInTheDocument();
    expect(mockPiReviewTab).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'authoring',
      selectedPiName: 'PI 26.3',
      teamCapacitySummaries: {
        'team-1': null,
      },
      teams: [
        expect.objectContaining({
          name: 'Alpha Team',
          // Pages come straight from the active team profile now.
          piReviewPages: [
            { piName: 'PI 26.3', pageUrl: 'https://example.atlassian.net/wiki/pages/12345/Alpha' },
          ],
        }),
      ],
    }));
  });

  it('renders the Team Dashboard capacity summary above PI Review when capacity is configured', () => {
    useCapacityStore.setState({
      dateMode: 'pi',
      startDate: '2026-05-18',
      endDate: '2026-05-22',
      rows: [
        { id: 'dev-row', role: 'Developer', memberCount: 2, capacityPercentage: 100, totalPtoDays: 0 },
        { id: 'qe-row', role: 'External Tester', memberCount: 1, capacityPercentage: 50, totalPtoDays: 0 },
      ],
    });

    activateTeamProfileWithPages([
      { piName: 'PI 26.3', pageUrl: 'https://example.atlassian.net/wiki/pages/12345/Alpha' },
    ]);

    render(
      <SprintDashboardPiReviewTab
        boardId={42}
        boardName="Alpha Board"
        projectKey="TBX"
        riskImpactDateFieldId=""
        riskResponseFieldId=""
        selectedPiName="PI 26.3"
        sprintIssues={[]}
      />,
    );

    expect(screen.getByText('Capacity')).toBeInTheDocument();
    expect(screen.getByText('Mock PI Carryover Remap')).toBeInTheDocument();
    expect(screen.getByText('Planning Window')).toBeInTheDocument();
    expect(screen.getByText('Team Composition')).toBeInTheDocument();
    expect(screen.getByText('100% Capacity (pts)')).toBeInTheDocument();
    expect(screen.getByText('80% Capacity (pts)')).toBeInTheDocument();
    expect(screen.getAllByText('Developer').length).toBeGreaterThan(0);
    expect(screen.getAllByText('External Tester').length).toBeGreaterThan(0);
    expect(mockPiReviewTab).toHaveBeenCalledWith(expect.objectContaining({
      teamCapacitySummaries: {
        'team-1': expect.objectContaining({
          workDayCount: 5,
          totalCapacityPoints: 12.5,
          recommendedCapacityPoints: 10,
        }),
      },
    }));
  });

  it('shows guidance when the active team has no PI Review pages configured', () => {
    render(
      <SprintDashboardPiReviewTab
        boardId={42}
        boardName="Alpha Board"
        projectKey="TBX"
        riskImpactDateFieldId=""
        riskResponseFieldId=""
        selectedPiName=""
        sprintIssues={[]}
      />,
    );

    expect(screen.getByText(/save a dashboard team first/i)).toBeInTheDocument();
    expect(mockPiFeatureRemapPanel).not.toHaveBeenCalled();
  });
});
