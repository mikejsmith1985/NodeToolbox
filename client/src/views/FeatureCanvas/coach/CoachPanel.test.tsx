// CoachPanel.test.tsx — Verifies stage guidance, non-linear navigation, and stage controls.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CanvasNode } from '../logic/canvasTypes.ts';
import { createEmptyOverlay, type StageId } from '../overlay/overlayModel.ts';
import type { CanvasOverlayController } from '../overlay/useCanvasOverlay.ts';
import { CoachPanel } from './CoachPanel.tsx';

function buildController(currentStageId: StageId): CanvasOverlayController {
  const overlay = createEmptyOverlay('team-a', 'denp:pi-1');
  overlay.stageState.currentStageId = currentStageId;
  return {
    overlay,
    ensureNodeStates: vi.fn(), updateNode: vi.fn(), setWipLimit: vi.fn(), setPriority: vi.fn(),
    setSize: vi.fn(), setContainer: vi.fn(), setParked: vi.fn(), addContainer: vi.fn(),
    updateContainer: vi.fn(), removeContainer: vi.fn(), removeNode: vi.fn(), clearNodes: vi.fn(), goToStage: vi.fn(), completeStage: vi.fn(),
    assignToContainer: vi.fn(), parkNode: vi.fn(), unparkNode: vi.fn(), completeNode: vi.fn(), moveContainer: vi.fn(), applyMasterPlan: vi.fn(), relayoutBoxes: vi.fn(), setStoryPlacement: vi.fn(), autoBalanceSprints: vi.fn(), undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false,
  };
}

function buildSelectedNode(): CanvasNode {
  return {
    issueKey: 'DENP-1', position: { x: 0, y: 0 }, size: null, priority: null, containerId: null,
    isExpanded: false, isParked: false, summary: '', status: '', statusCategoryKey: 'new',
    assignee: null, storyPoints: null, health: 'green', completionPercent: 0, hygieneFlags: [],
    childStories: [], dependencies: [], businessValue: null, description: null, acceptanceCriteria: null, parkReason: null, storyPlacements: {}, attachments: [], effectivePoints: 0,
  };
}

const NO_WIP = { inProgressCount: 0, limit: null, overflow: 0, parkedCount: 0, activeStoryCount: 0 };

describe('CoachPanel', () => {
  it('shows the current stage and jumps to another stage on click', () => {
    const controller = buildController('surface');
    render(<CoachPanel controller={controller} selectedNode={null} wip={NO_WIP} onAddContainer={vi.fn()} onPullSprints={vi.fn()} onOpenCommit={vi.fn()} isAiUnlocked={false} onOpenAi={vi.fn()} />);

    expect(screen.getByRole('heading', { name: /1\. Surface/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /3\. Prioritize/ }));
    expect(controller.goToStage).toHaveBeenCalledWith('prioritize');
  });

  it('assigns a MoSCoW bucket to the selected node in the Prioritize stage', () => {
    const controller = buildController('prioritize');
    render(<CoachPanel controller={controller} selectedNode={buildSelectedNode()} wip={NO_WIP} onAddContainer={vi.fn()} onPullSprints={vi.fn()} onOpenCommit={vi.fn()} isAiUnlocked={false} onOpenAi={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Must' }));
    expect(controller.setPriority).toHaveBeenCalledWith('DENP-1', 'Must');
  });

  it('hides the AI action when locked and shows it when unlocked', () => {
    const locked = buildController('surface');
    const { rerender } = render(<CoachPanel controller={locked} selectedNode={null} wip={NO_WIP} onAddContainer={vi.fn()} onPullSprints={vi.fn()} onOpenCommit={vi.fn()} isAiUnlocked={false} onOpenAi={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /AI suggestions/ })).not.toBeInTheDocument();

    const onOpenAi = vi.fn();
    rerender(<CoachPanel controller={locked} selectedNode={null} wip={NO_WIP} onAddContainer={vi.fn()} onPullSprints={vi.fn()} onOpenCommit={vi.fn()} isAiUnlocked onOpenAi={onOpenAi} />);
    fireEvent.click(screen.getByRole('button', { name: /AI suggestions/ }));
    expect(onOpenAi).toHaveBeenCalled();
  });

  it('sets a WIP limit and parks the selected node in the Stabilize stage', () => {
    const controller = buildController('stabilize');
    const wipWithOverflow = { inProgressCount: 12, limit: 3, overflow: 7, parkedCount: 0, activeStoryCount: 0 };
    render(<CoachPanel controller={controller} selectedNode={buildSelectedNode()} wip={wipWithOverflow} onAddContainer={vi.fn()} onPullSprints={vi.fn()} onOpenCommit={vi.fn()} isAiUnlocked={false} onOpenAi={vi.fn()} />);

    expect(screen.getByText(/7 over limit/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '5' } });
    expect(controller.setWipLimit).toHaveBeenCalledWith(5);

    fireEvent.click(screen.getByRole('button', { name: /Park selected/ }));
    // Parking now routes through parkNode (moves the card into the Parking Lot box), not setParked.
    expect(controller.parkNode).toHaveBeenCalledWith('DENP-1');
  });

  it('assigns a relative size to the selected node in the Size stage', () => {
    const controller = buildController('size');
    render(<CoachPanel controller={controller} selectedNode={buildSelectedNode()} wip={NO_WIP} onAddContainer={vi.fn()} onPullSprints={vi.fn()} onOpenCommit={vi.fn()} isAiUnlocked={false} onOpenAi={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'L' }));
    expect(controller.setSize).toHaveBeenCalledWith('DENP-1', 'L');
  });
});
