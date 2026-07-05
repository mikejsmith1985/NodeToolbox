// FeatureCanvasView.test.tsx — Verifies the two-step flow (blueprint select → board), add/remove, inspector.

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeatureReviewItem } from '../SprintDashboard/featureReview.ts';
import type { CanvasScope } from './canvas/useCanvasScope.ts';

const { mockUseCanvasFeatures, mockUseCanvasScope } = vi.hoisted(() => ({
  mockUseCanvasFeatures: vi.fn(),
  mockUseCanvasScope: vi.fn(),
}));
vi.mock('./canvas/useCanvasFeatures.ts', () => ({ useCanvasFeatures: mockUseCanvasFeatures }));
vi.mock('./canvas/useCanvasScope.ts', () => ({ useCanvasScope: mockUseCanvasScope }));

// Stub the board so we can read the rendered node set and drive selection/removal.
vi.mock('./canvas/FeatureCanvasBoard.tsx', () => ({
  FeatureCanvasBoard: ({ canvasNodes, onDeleteNode, onSelect }: { canvasNodes: { issueKey: string }[]; onDeleteNode: (key: string) => void; onSelect: (key: string | null) => void }) => (
    <div>
      {canvasNodes.map((canvasNode) => (
        <div key={canvasNode.issueKey}>
          <span>node-{canvasNode.issueKey}</span>
          <button type="button" onClick={() => onSelect(canvasNode.issueKey)}>select-{canvasNode.issueKey}</button>
          <button type="button" onClick={() => onDeleteNode(canvasNode.issueKey)}>remove-{canvasNode.issueKey}</button>
        </div>
      ))}
    </div>
  ),
}));

// Stub step-1 (blueprint) and the JQL picker so we can drive onAdd without their fetches.
vi.mock('./canvas/BlueprintSelectionStep.tsx', () => ({
  BlueprintSelectionStep: ({ onAdd, onClose }: { onAdd: (keys: string[]) => void; onClose: () => void }) => (
    <div>
      <span>blueprint-step</span>
      <button type="button" onClick={() => { onAdd(['DENP-1']); onClose(); }}>bp-add</button>
    </div>
  ),
}));
vi.mock('./canvas/SurfacePicker.tsx', () => ({
  SurfacePicker: () => <div><span>jql-picker</span></div>,
}));

import FeatureCanvasView from './FeatureCanvasView.tsx';

function buildItem(key: string): FeatureReviewItem {
  return {
    feature: { type: 'feature', key, summary: 'Login', status: 'In Progress', health: 'yellow', completionPercent: 0, children: [], offTrain: [], isExternal: false },
    featureIssue: { key, fields: { status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, labels: [] } } as unknown as FeatureReviewItem['featureIssue'],
    hygieneFlags: [],
    blockedChildCount: 0, doneChildCount: 0, inFlightChildCount: 0, totalChildCount: 0,
  };
}

const SCOPE: CanvasScope = { projectKey: 'DENP', piName: 'PI 26.3', boardId: 42, defaultJql: 'project = "DENP" AND issuetype in (Feature, Epic)' };

describe('FeatureCanvasView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockUseCanvasScope.mockReturnValue(SCOPE);
  });

  it('shows the empty state and the two add affordances when the working set is empty', () => {
    mockUseCanvasFeatures.mockReturnValue({ status: 'ready', items: [], error: null });
    render(<MemoryRouter><FeatureCanvasView /></MemoryRouter>);
    expect(screen.getByText(/Add features to begin/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add features/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add via JQL' })).toBeInTheDocument();
  });

  it('opens the blueprint selection step and additively adds a chosen feature', () => {
    mockUseCanvasFeatures.mockReturnValue({ status: 'ready', items: [buildItem('DENP-1')], error: null });
    render(<MemoryRouter><FeatureCanvasView /></MemoryRouter>);

    fireEvent.click(screen.getByRole('button', { name: /Add features/ }));
    expect(screen.getByText('blueprint-step')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'bp-add' }));

    // Back on the board with the added node; empty state gone.
    expect(screen.queryByText(/Add features to begin/)).not.toBeInTheDocument();
    expect(screen.getByText('node-DENP-1')).toBeInTheDocument();
  });

  it('clears the canvas (working set) after confirmation', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockUseCanvasFeatures.mockReturnValue({ status: 'ready', items: [buildItem('DENP-1')], error: null });
    render(<MemoryRouter><FeatureCanvasView /></MemoryRouter>);
    // Seed one node so the working set is non-empty.
    fireEvent.click(screen.getByRole('button', { name: /Add features/ }));
    fireEvent.click(screen.getByRole('button', { name: 'bp-add' }));
    expect(screen.getByText('node-DENP-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Clear canvas/ }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.queryByText('node-DENP-1')).not.toBeInTheDocument();
    expect(screen.getByText(/Add features to begin/)).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('does not clear the canvas when confirmation is declined', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockUseCanvasFeatures.mockReturnValue({ status: 'ready', items: [buildItem('DENP-1')], error: null });
    render(<MemoryRouter><FeatureCanvasView /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Add features/ }));
    fireEvent.click(screen.getByRole('button', { name: 'bp-add' }));

    fireEvent.click(screen.getByRole('button', { name: /Clear canvas/ }));
    expect(screen.getByText('node-DENP-1')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('opens the Custom-JQL picker from the board', () => {
    mockUseCanvasFeatures.mockReturnValue({ status: 'ready', items: [], error: null });
    render(<MemoryRouter><FeatureCanvasView /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Add via JQL' }));
    expect(screen.getByText('jql-picker')).toBeInTheDocument();
  });

  it('removes a node from the working set so it leaves the board', () => {
    mockUseCanvasFeatures.mockReturnValue({ status: 'ready', items: [buildItem('DENP-1')], error: null });
    render(<MemoryRouter><FeatureCanvasView /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Add features/ }));
    fireEvent.click(screen.getByRole('button', { name: 'bp-add' }));
    expect(screen.getByText('node-DENP-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'remove-DENP-1' }));
    expect(screen.queryByText('node-DENP-1')).not.toBeInTheDocument();
    expect(screen.getByText(/Add features to begin/)).toBeInTheDocument();
  });

  it('opens the read-only inspector for the selected node and closes it', () => {
    mockUseCanvasFeatures.mockReturnValue({ status: 'ready', items: [buildItem('DENP-1')], error: null });
    render(<MemoryRouter><FeatureCanvasView /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Add features/ }));
    fireEvent.click(screen.getByRole('button', { name: 'bp-add' }));

    fireEvent.click(screen.getByRole('button', { name: 'select-DENP-1' }));
    expect(screen.getByLabelText(/Inspector for DENP-1/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Close inspector/ }));
    expect(screen.queryByLabelText(/Inspector for DENP-1/)).not.toBeInTheDocument();
  });
});
