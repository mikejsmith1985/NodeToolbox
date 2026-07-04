// AiSuggestionPanel.test.tsx — Verifies the accelerator is invisible when locked and errors safely on bad input.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setAiAssistUnlocked } from '../../../store/aiAssistStore.ts';
import type { CanvasNode } from '../logic/canvasTypes.ts';
import type { CanvasOverlayController } from '../overlay/useCanvasOverlay.ts';
import { createEmptyOverlay } from '../overlay/overlayModel.ts';
import { AiSuggestionPanel } from './AiSuggestionPanel.tsx';

function buildController(): CanvasOverlayController {
  return {
    overlay: createEmptyOverlay('team-a', 'denp:pi-1'),
    ensureNodeStates: vi.fn(), updateNode: vi.fn(), setWipLimit: vi.fn(), setPriority: vi.fn(),
    setSize: vi.fn(), setContainer: vi.fn(), setParked: vi.fn(), addContainer: vi.fn(),
    updateContainer: vi.fn(), removeContainer: vi.fn(), removeNode: vi.fn(), clearNodes: vi.fn(), goToStage: vi.fn(), completeStage: vi.fn(),
    undo: vi.fn(), redo: vi.fn(), canUndo: false, canRedo: false,
  };
}

const NODES: CanvasNode[] = [{
  issueKey: 'DENP-1', position: { x: 0, y: 0 }, size: null, priority: null, containerId: null,
  isExpanded: false, isParked: false, summary: 'Login', status: 'To Do', statusCategoryKey: 'new',
  assignee: null, storyPoints: 3, health: 'green', completionPercent: 0, hygieneFlags: [],
  childStories: [], dependencies: [], businessValue: null, description: null, acceptanceCriteria: null, attachments: [], effectivePoints: 3,
}];

const WIP = { inProgressCount: 1, limit: 1, overflow: 0, parkedCount: 0, activeStoryCount: 0 };

describe('AiSuggestionPanel', () => {
  afterEach(() => {
    act(() => setAiAssistUnlocked(false));
  });

  it('renders nothing when AI Assist is locked (manual parity)', () => {
    const { container } = render(<AiSuggestionPanel canvasNodes={NODES} controller={buildController()} wip={WIP} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders when unlocked and reports a descriptive error on malformed input without applying anything', () => {
    act(() => setAiAssistUnlocked(true));
    const controller = buildController();
    render(<AiSuggestionPanel canvasNodes={NODES} controller={controller} wip={WIP} onClose={vi.fn()} />);

    expect(screen.getByText(/AI suggestions/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Paste the JSON reply/), { target: { value: 'not json at all' } });
    fireEvent.click(screen.getByRole('button', { name: /Ingest suggestions/ }));

    expect(screen.getByText(/No JSON object/)).toBeInTheDocument();
    expect(controller.setPriority).not.toHaveBeenCalled();
  });

  it('parks a feature when a Reduce WIP suggestion is accepted', () => {
    act(() => setAiAssistUnlocked(true));
    const controller = buildController();
    render(<AiSuggestionPanel canvasNodes={NODES} controller={controller} wip={WIP} onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'wipReduction' } });
    fireEvent.change(screen.getByPlaceholderText(/Paste the JSON reply/), {
      target: { value: '{"kind":"wipReduction","items":[{"issueKey":"DENP-1","reason":"lowest priority"}]}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Ingest suggestions/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect(controller.setParked).toHaveBeenCalledWith('DENP-1', true);
  });

  it('shows a clear action label + rationale per suggestion instead of a bare value', () => {
    act(() => setAiAssistUnlocked(true));
    render(<AiSuggestionPanel canvasNodes={NODES} controller={buildController()} wip={WIP} onClose={vi.fn()} />);
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
    render(<AiSuggestionPanel canvasNodes={NODES} controller={controller} wip={WIP} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sizeEstimate' } });
    fireEvent.change(screen.getByPlaceholderText(/Paste the JSON reply/), {
      target: { value: '{"kind":"sizeEstimate","items":[{"issueKey":"DENP-1","size":"L","rationale":"broad"}]}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Ingest suggestions/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect(controller.setSize).toHaveBeenCalledWith('DENP-1', 'L');
  });

  it('parks the duplicate when a Duplicate suggestion is accepted', () => {
    act(() => setAiAssistUnlocked(true));
    const controller = buildController();
    render(<AiSuggestionPanel canvasNodes={NODES} controller={controller} wip={WIP} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'duplicateCandidates' } });
    fireEvent.change(screen.getByPlaceholderText(/Paste the JSON reply/), {
      target: { value: '{"kind":"duplicateCandidates","items":[{"issueKey":"DENP-1","duplicateOfKey":"DENP-9","confidence":"high"}]}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Ingest suggestions/ }));
    expect(screen.getByText(/likely duplicate of DENP-9/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect(controller.setParked).toHaveBeenCalledWith('DENP-1', true);
  });

  it('creates and assigns a sprint box when a Sprint-grouping suggestion is accepted', () => {
    act(() => setAiAssistUnlocked(true));
    const controller = buildController();
    render(<AiSuggestionPanel canvasNodes={NODES} controller={controller} wip={WIP} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sprintGrouping' } });
    fireEvent.change(screen.getByPlaceholderText(/Paste the JSON reply/), {
      target: { value: '{"kind":"sprintGrouping","groups":[{"containerTitle":"Sprint 25","issueKeys":["DENP-1"]}]}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Ingest suggestions/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect(controller.addContainer).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sprint', title: 'Sprint 25' }));
    expect(controller.setContainer).toHaveBeenCalledWith('DENP-1', expect.any(String));
  });
});
