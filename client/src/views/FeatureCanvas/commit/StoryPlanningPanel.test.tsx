// StoryPlanningPanel.test.tsx — Verifies story-level placement across boxes and sprint capacity.

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The story inspector fetches description/AC/comments on open — keep those calls inert in tests.
vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn().mockResolvedValue({ fields: {} }) }));

import type { CanvasNode } from '../logic/canvasTypes.ts';
import type { CanvasContainer } from '../overlay/overlayModel.ts';
import { createEmptyOverlay } from '../overlay/overlayModel.ts';
import type { CanvasOverlayController } from '../overlay/useCanvasOverlay.ts';
import { StoryPlanningPanel } from './StoryPlanningPanel.tsx';

const SPRINT_A: CanvasContainer = {
  id: 'ctr-a', kind: 'sprint', title: 'Sprint 24', bounds: { x: 0, y: 0, width: 300, height: 200 }, capacityBudget: 5,
  provenance: { state: 'provisional', jiraSprintId: null, jiraVersionName: null, startDateIso: null, endDateIso: null },
};
const SPRINT_B: CanvasContainer = { ...SPRINT_A, id: 'ctr-b', title: 'Sprint 25' };

function buildController(): CanvasOverlayController {
  const overlay = createEmptyOverlay('team-a', 'denp:pi-1');
  overlay.containers = [SPRINT_A, SPRINT_B];
  return {
    overlay,
    ensureNodeStates: vi.fn(), updateNode: vi.fn(), setWipLimit: vi.fn(), setPriority: vi.fn(),
    setSize: vi.fn(), setContainer: vi.fn(), setParked: vi.fn(), addContainer: vi.fn(),
    updateContainer: vi.fn(), removeContainer: vi.fn(), removeNode: vi.fn(), clearNodes: vi.fn(), goToStage: vi.fn(), completeStage: vi.fn(),
    assignToContainer: vi.fn(), parkNode: vi.fn(), unparkNode: vi.fn(), completeNode: vi.fn(), moveContainer: vi.fn(), applyMasterPlan: vi.fn(), relayoutBoxes: vi.fn(), setStoryPlacement: vi.fn(), autoBalanceSprints: vi.fn(), undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false,
  };
}

// A feature in Sprint 24 with two pointed child stories.
const NODE: CanvasNode = {
  issueKey: 'DENP-1', position: { x: 0, y: 0 }, size: null, priority: null, containerId: 'ctr-a',
  isExpanded: false, isParked: false, summary: 'Login', status: '', statusCategoryKey: 'new',
  assignee: null, storyPoints: null, health: 'green', completionPercent: 0, hygieneFlags: [],
  childStories: [
    { key: 'DENP-2', summary: 'Build the API', status: 'In Progress', statusCategoryKey: 'indeterminate', storyPoints: 3, assignee: 'Ada Lovelace', issueType: 'Story', subtaskCount: 2 },
    { key: 'DENP-3', summary: 'Build the UI', status: 'To Do', statusCategoryKey: 'new', storyPoints: 3, assignee: null, issueType: 'Story', subtaskCount: 0 },
  ],
  dependencies: [], businessValue: null, description: null, acceptanceCriteria: null, parkReason: null, storyPlacements: {}, pendingComment: "", attachments: [], effectivePoints: 0,
};

describe('StoryPlanningPanel', () => {
  it('shows both stories under their feature box with the sprint load (over capacity)', () => {
    render(<StoryPlanningPanel canvasNodes={[NODE]} controller={buildController()} onClose={vi.fn()} />);
    const sprintA = screen.getByRole('region', { name: 'Box Sprint 24' });
    // Both 3pt stories inherit the feature's box → 6pt against the 5pt budget = over.
    expect(within(sprintA).getByText(/6 \/ 5 pt · over capacity/)).toBeInTheDocument();
    expect(within(sprintA).getByText('DENP-2')).toBeInTheDocument();
    expect(within(sprintA).getByText('DENP-3')).toBeInTheDocument();
  });

  it('surfaces per-story complexity/ownership detail (summary, points, status, subtasks, assignee)', () => {
    render(<StoryPlanningPanel canvasNodes={[NODE]} controller={buildController()} onClose={vi.fn()} />);
    const sprintA = screen.getByRole('region', { name: 'Box Sprint 24' });
    expect(within(sprintA).getByText('Build the API')).toBeInTheDocument(); // full summary, not truncated away
    expect(within(sprintA).getByText(/2 subtasks/)).toBeInTheDocument();
    expect(within(sprintA).getByText(/Ada Lovelace/)).toBeInTheDocument();
    expect(within(sprintA).getByText(/Unassigned/)).toBeInTheDocument(); // DENP-3 has no assignee
  });

  it('moves a story to another sprint via its box selector', () => {
    const controller = buildController();
    render(<StoryPlanningPanel canvasNodes={[NODE]} controller={controller} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Move DENP-3 to box' }), { target: { value: 'ctr-b' } });
    expect(controller.setStoryPlacement).toHaveBeenCalledWith('DENP-1', 'DENP-3', 'ctr-b');
  });

  it('opens the story inspector (description/AC/comments experience) when a card is clicked', () => {
    render(<StoryPlanningPanel canvasNodes={[NODE]} controller={buildController()} onClose={vi.fn()} />);
    expect(screen.queryByLabelText('Inspector for DENP-2')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Open DENP-2 detail'));
    const inspector = screen.getByLabelText('Inspector for DENP-2');
    expect(within(inspector).getByText('Description')).toBeInTheDocument();
    expect(within(inspector).getByText('Acceptance criteria')).toBeInTheDocument();
  });

  it('auto-balances stories across sprints and reports the fit/overflow summary', () => {
    const controller = buildController();
    // Two 3pt stories, sprint capacity 5 → one fits (3), the other overflows (would be 6 > 5).
    render(<StoryPlanningPanel canvasNodes={[NODE]} controller={controller} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Auto-balance sprints/ }));

    expect(controller.autoBalanceSprints).toHaveBeenCalled();
    const assignments = (controller.autoBalanceSprints as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Array<{ storyKey: string; sprintId: string | null }>;
    expect(assignments).toHaveLength(2);
    // The summary reports what fit vs what spilled (unique "re-prioritize" wording).
    expect(screen.getByText(/fit across .* sprint\(s\).*re-prioritize/)).toBeInTheDocument();
  });

  it('excludes Parking Lot / Complete boxes from the planning board', () => {
    const controller = buildController();
    controller.overlay.containers = [
      ...controller.overlay.containers,
      { ...SPRINT_A, id: 'ctr-lot', kind: 'parkingLot', title: 'Parking Lot' },
      { ...SPRINT_A, id: 'ctr-done', kind: 'complete', title: 'Complete' },
    ];
    render(<StoryPlanningPanel canvasNodes={[NODE]} controller={controller} onClose={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Box Parking Lot' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Box Complete' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Box Sprint 24' })).toBeInTheDocument();
  });
});
