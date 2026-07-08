// CapacityPlanPanel.reassign.test.tsx — Verifies the "Include reassignments" toggle drives the write-back
// path end to end: when on, an ingested plan's proposed assignee is staged onto the canvas via
// controller.setStoryAssignee; when off, the assignee is dropped and nothing is staged.
//
// The capacity pipeline hook is mocked to a ready fixture so the "Write the plan back" section renders
// without any network run; this keeps the reassignment behaviour isolated from the pipeline itself.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CanvasNode } from '../logic/canvasTypes.ts';
import type { PlanResult } from './capacityTypes.ts';
import { CapacityPlanPanel } from './CapacityPlanPanel.tsx';
import { useCapacityPlan } from './useCapacityPlan.ts';

// Keep the Target PI picker offline (no real Jira call), preserving the rest of the ART module.
vi.mock('../../ArtView/hooks/useArtData.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../ArtView/hooks/useArtData.ts')>();
  return { ...actual, loadAvailablePiNamesFromJira: vi.fn().mockResolvedValue([]) };
});

// Force the panel into a ready state so the write-back section (and its toggle) renders without a run.
vi.mock('./useCapacityPlan.ts', () => ({ useCapacityPlan: vi.fn() }));

/** A ready PlanResult whose single sprint name is the only valid re-sprint target for the ingest. */
function buildReadyResult(): PlanResult {
  return {
    sprints: [
      { index: 1, name: '26.3.1', startIso: '2026-05-21', endIso: '2026-06-03', isBeyondPiEnd: false, scheduledPoints: 3, loads: [] },
    ],
    proposals: [],
    bottleneck: { limitingRole: null, additionalToMatchThroughput: 0, additionalToFinishByPiEnd: 0, statement: 'No bottleneck.' },
    completionSprintIndex: 1,
    completionDateIso: '2026-06-03',
    sprintsBeyondPiEnd: 0,
    unschedulableItemKeys: [],
  };
}

/** A single feature node with one planable child story, so an ingest can resolve to a story placement. */
function buildFeatureNode(): CanvasNode {
  return {
    issueKey: 'DENP-1', position: { x: 0, y: 0 }, size: null, priority: 'Must', containerId: null,
    isExpanded: false, isParked: false, parkReason: null, storyPlacements: {}, storyAssignees: {}, pendingComment: '',
    summary: 'Feature', status: 'To Do', statusCategoryKey: 'new', assignee: null, storyPoints: null,
    businessValue: null, description: null, acceptanceCriteria: null, health: 'green', completionPercent: 0,
    hygieneFlags: [], dependencies: [], attachments: [], effectivePoints: 0,
    childStories: [{ key: 'DENP-2', summary: 'Story', status: 'To Do', statusCategoryKey: 'new', storyPoints: 3, assignee: 'Old Owner' }],
  };
}

/** A controller stub capturing the staging calls the panel makes when applying an ingest. */
function buildControllerStub() {
  return {
    overlay: { containers: [] },
    addContainer: vi.fn(),
    setStoryPlacement: vi.fn(),
    setContainer: vi.fn(),
    setStoryAssignee: vi.fn(),
  } as unknown as React.ComponentProps<typeof CapacityPlanPanel>['controller'] & {
    setStoryAssignee: ReturnType<typeof vi.fn>;
    setStoryPlacement: ReturnType<typeof vi.fn>;
  };
}

/** The ingest JSON Copilot would return, proposing both a re-sprint and a new owner for DENP-2. */
const INGEST_WITH_ASSIGNEE = JSON.stringify({
  kind: 'capacityPlanIngest',
  assignments: [{ issueKey: 'DENP-2', sprint: '26.3.1', assignee: 'Jane Doe' }],
});

describe('CapacityPlanPanel reassignment toggle', () => {
  beforeEach(() => {
    vi.mocked(useCapacityPlan).mockReturnValue({ status: 'ready', result: buildReadyResult(), error: null, run: vi.fn() });
  });

  function renderReadyPanel(controller: ReturnType<typeof buildControllerStub>) {
    return render(
      <CapacityPlanPanel
        canvasNodes={[buildFeatureNode()]}
        rosterMembers={[]}
        projectKey="DENP"
        piName="PI 26.3"
        storyPointsFieldId="customfield_10016"
        artTeams={[]}
        teamProfileId="team-1"
        controller={controller}
        onClose={vi.fn()}
      />,
    );
  }

  it('offers the reassignment checkbox unchecked by default', () => {
    renderReadyPanel(buildControllerStub());
    expect(screen.getByLabelText('Include reassignments (writes assignees)')).not.toBeChecked();
  });

  it('stages the proposed assignee when the toggle is ON', () => {
    const controller = buildControllerStub();
    renderReadyPanel(controller);

    fireEvent.click(screen.getByLabelText('Include reassignments (writes assignees)'));
    fireEvent.change(screen.getByLabelText('Paste plan JSON to ingest'), { target: { value: INGEST_WITH_ASSIGNEE } });
    fireEvent.click(screen.getByRole('button', { name: /Apply to canvas/ }));

    expect(controller.setStoryPlacement).toHaveBeenCalledWith('DENP-1', 'DENP-2', expect.any(String));
    expect(controller.setStoryAssignee).toHaveBeenCalledWith('DENP-1', 'DENP-2', 'Jane Doe');
    expect(screen.getByText(/staged 1 reassignment/)).toBeInTheDocument();
  });

  it('drops the proposed assignee when the toggle is OFF (safe default)', () => {
    const controller = buildControllerStub();
    renderReadyPanel(controller);

    fireEvent.change(screen.getByLabelText('Paste plan JSON to ingest'), { target: { value: INGEST_WITH_ASSIGNEE } });
    fireEvent.click(screen.getByRole('button', { name: /Apply to canvas/ }));

    expect(controller.setStoryPlacement).toHaveBeenCalledWith('DENP-1', 'DENP-2', expect.any(String));
    expect(controller.setStoryAssignee).not.toHaveBeenCalled();
    expect(screen.queryByText(/staged \d+ reassignment/)).not.toBeInTheDocument();
  });
});
