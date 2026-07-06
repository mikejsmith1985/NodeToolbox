// AiSuggestionPanel.test.tsx — Verifies the accelerator is invisible when locked and errors safely on bad input.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setAiAssistUnlocked } from '../../../store/aiAssistStore.ts';
import type { CanvasNode } from '../logic/canvasTypes.ts';
import type { CanvasOverlayController } from '../overlay/useCanvasOverlay.ts';
import { createEmptyOverlay } from '../overlay/overlayModel.ts';
import { AiSuggestionPanel } from './AiSuggestionPanel.tsx';

function buildController(): CanvasOverlayController {
  // The master plan requires at least one sprint box (it sequences into real sprints), so seed one.
  const overlay = createEmptyOverlay('team-a', 'denp:pi-1');
  overlay.containers = [{
    id: 'sprint-25', kind: 'sprint', title: 'Sprint 25', bounds: { x: 0, y: 0, width: 400, height: 260 }, capacityBudget: 20,
    provenance: { state: 'real', jiraSprintId: 25, jiraVersionName: null, startDateIso: null, endDateIso: null },
  }];
  return {
    overlay,
    ensureNodeStates: vi.fn(), updateNode: vi.fn(), setWipLimit: vi.fn(), setPriority: vi.fn(),
    setSize: vi.fn(), setContainer: vi.fn(), setParked: vi.fn(), addContainer: vi.fn(),
    updateContainer: vi.fn(), removeContainer: vi.fn(), removeNode: vi.fn(), clearNodes: vi.fn(), goToStage: vi.fn(), completeStage: vi.fn(),
    assignToContainer: vi.fn(), parkNode: vi.fn(), unparkNode: vi.fn(), completeNode: vi.fn(), moveContainer: vi.fn(), applyMasterPlan: vi.fn(), relayoutBoxes: vi.fn(), setStoryPlacement: vi.fn(), autoBalanceSprints: vi.fn(), undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false,
  };
}

const NODES: CanvasNode[] = [{
  issueKey: 'DENP-1', position: { x: 0, y: 0 }, size: null, priority: null, containerId: null,
  isExpanded: false, isParked: false, summary: 'Login', status: 'To Do', statusCategoryKey: 'new',
  assignee: null, storyPoints: 3, health: 'green', completionPercent: 0, hygieneFlags: [],
  childStories: [], dependencies: [], businessValue: null, description: null, acceptanceCriteria: null, parkReason: null, storyPlacements: {}, pendingComment: "", attachments: [], effectivePoints: 3,
}];

const WIP = { inProgressCount: 1, limit: 1, overflow: 0, parkedCount: 0, activeStoryCount: 0 };

describe('AiSuggestionPanel', () => {
  afterEach(() => {
    act(() => setAiAssistUnlocked(false));
  });

  it('renders nothing when AI Assist is locked (manual parity)', () => {
    const { container } = render(<AiSuggestionPanel canvasNodes={NODES} controller={buildController()} wip={WIP} piName="PI 26.3 (05/21/26 - 07/29/26)" onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders when unlocked and reports a descriptive error on malformed input without applying anything', () => {
    act(() => setAiAssistUnlocked(true));
    const controller = buildController();
    render(<AiSuggestionPanel canvasNodes={NODES} controller={controller} wip={WIP} piName="PI 26.3 (05/21/26 - 07/29/26)" onClose={vi.fn()} />);

    expect(screen.getByText(/AI suggestions/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Paste the JSON reply/), { target: { value: 'not json at all' } });
    fireEvent.click(screen.getByRole('button', { name: /Ingest suggestions/ }));

    expect(screen.getByText(/No JSON object/)).toBeInTheDocument();
    expect(controller.setPriority).not.toHaveBeenCalled();
  });

  it('parks a feature (with reason) when a Triage "park" suggestion is accepted', () => {
    act(() => setAiAssistUnlocked(true));
    const controller = buildController();
    render(<AiSuggestionPanel canvasNodes={NODES} controller={controller} wip={WIP} piName="PI 26.3 (05/21/26 - 07/29/26)" onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'parkCandidates' } });
    fireEvent.change(screen.getByPlaceholderText(/Paste the JSON reply/), {
      target: { value: '{"kind":"parkCandidates","items":[{"issueKey":"DENP-1","action":"park","reason":"lowest priority"}]}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Ingest suggestions/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect(controller.parkNode).toHaveBeenCalledWith('DENP-1', 'lowest priority');
  });

  it('moves a done feature to Complete when a Triage "complete" suggestion is accepted', () => {
    act(() => setAiAssistUnlocked(true));
    const controller = buildController();
    render(<AiSuggestionPanel canvasNodes={NODES} controller={controller} wip={WIP} piName="PI 26.3 (05/21/26 - 07/29/26)" onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'parkCandidates' } });
    fireEvent.change(screen.getByPlaceholderText(/Paste the JSON reply/), {
      target: { value: '{"kind":"parkCandidates","items":[{"issueKey":"DENP-1","action":"complete","reason":"100% done"}]}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Ingest suggestions/ }));
    expect(screen.getByText(/Move to Complete box/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect(controller.completeNode).toHaveBeenCalledWith('DENP-1');
    expect(controller.parkNode).not.toHaveBeenCalled();
  });

  it('shows a clear action label + rationale per suggestion instead of a bare value', () => {
    act(() => setAiAssistUnlocked(true));
    render(<AiSuggestionPanel canvasNodes={NODES} controller={buildController()} wip={WIP} piName="PI 26.3 (05/21/26 - 07/29/26)" onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'priorityOrder' } });
    fireEvent.change(screen.getByPlaceholderText(/Paste the JSON reply/), {
      target: { value: '{"kind":"priorityOrder","items":[{"issueKey":"DENP-1","bucket":"Must","rationale":"blocks downstream work"}]}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Ingest suggestions/ }));

    expect(screen.getByText(/Set priority to Must/)).toBeInTheDocument();
    expect(screen.getByText('blocks downstream work')).toBeInTheDocument();
  });

  it('sets the size when a Size suggestion is accepted', () => {
    act(() => setAiAssistUnlocked(true));
    const controller = buildController();
    render(<AiSuggestionPanel canvasNodes={NODES} controller={controller} wip={WIP} piName="PI 26.3 (05/21/26 - 07/29/26)" onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sizeEstimate' } });
    fireEvent.change(screen.getByPlaceholderText(/Paste the JSON reply/), {
      target: { value: '{"kind":"sizeEstimate","items":[{"issueKey":"DENP-1","size":"L","rationale":"broad"}]}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Ingest suggestions/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect(controller.setSize).toHaveBeenCalledWith('DENP-1', 'L');
  });

  it('creates and assigns a sprint box (moving the card in) when a Sprint-grouping suggestion is accepted', () => {
    act(() => setAiAssistUnlocked(true));
    const controller = buildController();
    render(<AiSuggestionPanel canvasNodes={NODES} controller={controller} wip={WIP} piName="PI 26.3 (05/21/26 - 07/29/26)" onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sprintGrouping' } });
    // A title that does NOT match the seeded sprint, so this exercises creating a NEW box.
    fireEvent.change(screen.getByPlaceholderText(/Paste the JSON reply/), {
      target: { value: '{"kind":"sprintGrouping","groups":[{"containerTitle":"Sprint 30","issueKeys":["DENP-1"]}]}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Ingest suggestions/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect(controller.addContainer).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sprint', title: 'Sprint 30' }));
    // assignToContainer (not setContainer) — it repositions the card inside the box.
    expect(controller.assignToContainer).toHaveBeenCalledWith('DENP-1', expect.any(String));
  });

  it('warns when no WIP limit is set (advisory, not a block) and lets you set it inline', () => {
    act(() => setAiAssistUnlocked(true));
    const controller = buildController();
    const noWip = { inProgressCount: 3, limit: null, overflow: 0, parkedCount: 0, activeStoryCount: 0 };
    render(<AiSuggestionPanel canvasNodes={NODES} controller={controller} wip={noWip} piName="PI 26.3 (05/21/26 - 07/29/26)" onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'masterPlan' } });
    expect(screen.getByText(/Set a WIP limit/)).toBeInTheDocument();
    // Advisory only — the buttons still work.
    expect(screen.getByRole('button', { name: /Ingest & apply plan/ })).not.toBeDisabled();

    fireEvent.change(screen.getByRole('spinbutton', { name: 'WIP limit' }), { target: { value: '4' } });
    expect(controller.setWipLimit).toHaveBeenCalledWith(4);
  });

  it('warns when no sprints are pulled (advisory, not a block) and auto-pulls them', () => {
    act(() => setAiAssistUnlocked(true));
    const controller = buildController();
    controller.overlay.containers = []; // no sprints pulled from the board yet
    const onEnsureSprints = vi.fn();
    render(<AiSuggestionPanel canvasNodes={NODES} controller={controller} wip={WIP} piName="PI 26.3 (05/21/26 - 07/29/26)" onEnsureSprints={onEnsureSprints} onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'masterPlan' } });
    expect(screen.getByText(/No sprints pulled yet/)).toBeInTheDocument();
    // Advisory only — the plan still runs (features go to Later); buttons stay enabled.
    expect(screen.getByRole('button', { name: /Ingest & apply plan/ })).not.toBeDisabled();
    // Selecting the master plan with no sprints auto-pulls them so the flow just works.
    expect(onEnsureSprints).toHaveBeenCalled();
  });

  it('lists the real sprints in the master prompt so the AI never invents sprint names', () => {
    act(() => setAiAssistUnlocked(true));
    render(<AiSuggestionPanel canvasNodes={NODES} controller={buildController()} wip={WIP} piName="PI 26.3 (05/21/26 - 07/29/26)" onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'masterPlan' } });
    expect(screen.getByDisplayValue(/Available sprints .* "Sprint 25"/s)).toBeInTheDocument();
  });

  it('applies the whole master plan in one shot on ingest and shows a summary', () => {
    act(() => setAiAssistUnlocked(true));
    const controller = buildController();
    render(<AiSuggestionPanel canvasNodes={NODES} controller={controller} wip={WIP} piName="PI 26.3 (05/21/26 - 07/29/26)" onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'masterPlan' } });
    fireEvent.change(screen.getByPlaceholderText(/Paste the JSON reply/), {
      target: { value: '{"kind":"masterPlan","items":[{"issueKey":"DENP-1","size":"L","bucket":"Must","triage":"keep","sprint":"Sprint 25","reason":"core"}]}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Ingest & apply plan/ }));

    expect(controller.applyMasterPlan).toHaveBeenCalledWith([
      { issueKey: 'DENP-1', size: 'L', bucket: 'Must', triage: 'keep', sprint: 'Sprint 25', reason: 'core' },
    ]);
    expect(screen.getByText(/Applied to 1 feature/)).toBeInTheDocument();
    // No accept/reject rows for the master plan — it's applied directly.
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });
});
