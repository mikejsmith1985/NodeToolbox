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
});
