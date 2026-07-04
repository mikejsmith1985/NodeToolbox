// FeatureCanvasView.test.tsx — Verifies the working-set empty state, the Add-features picker, and additive add.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeatureReviewItem } from '../SprintDashboard/featureReview.ts';
import type { CanvasScope } from './canvas/useCanvasScope.ts';

// Stub React Flow so importing the view is cheap and the board renders without a real canvas.
vi.mock('@xyflow/react', () => ({
  ReactFlow: () => null,
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useNodesState: () => [[], () => {}, () => {}],
  useReactFlow: () => ({ getIntersectingNodes: () => [] }),
  Handle: () => null,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

const { mockUseCanvasFeatures, mockUseCanvasScope } = vi.hoisted(() => ({
  mockUseCanvasFeatures: vi.fn(),
  mockUseCanvasScope: vi.fn(),
}));
vi.mock('./canvas/useCanvasFeatures.ts', () => ({ useCanvasFeatures: mockUseCanvasFeatures }));
vi.mock('./canvas/useCanvasScope.ts', () => ({ useCanvasScope: mockUseCanvasScope }));

// Stub the board so we can read the rendered node set and drive per-node removal.
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

// Stub the picker so we can drive its onAdd without its own Jira fetch.
vi.mock('./canvas/SurfacePicker.tsx', () => ({
  SurfacePicker: ({ onAdd, team }: { onAdd: (keys: string[]) => void; team: unknown }) => (
    <div>
      <span>picker-open</span>
      <span>{team ? 'picker-has-team' : 'picker-no-team'}</span>
      <button type="button" onClick={() => onAdd(['DENP-1'])}>stub-add</button>
    </div>
  ),
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

const SCOPE: CanvasScope = { team: { id: 't', name: 'A', boardId: '42', projectKey: 'DENP', sprintIssues: [], isLoading: false, loadError: null } as never, projectKey: 'DENP', piName: 'PI 26.3', boardId: 42, defaultJql: 'project = "DENP" AND issuetype in (Feature, Epic)' };

describe('FeatureCanvasView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockUseCanvasScope.mockReturnValue(SCOPE);
  });

  it('shows the empty "Add features to begin" state when the working set is empty', () => {
    mockUseCanvasFeatures.mockReturnValue({ status: 'ready', items: [], error: null });
    render(<FeatureCanvasView />);
    expect(screen.getByText(/Add features to begin/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add features/ })).toBeInTheDocument();
  });

  it('hints at the Custom-JQL fallback when no ART team is configured', () => {
    mockUseCanvasScope.mockReturnValue({ ...SCOPE, team: null });
    mockUseCanvasFeatures.mockReturnValue({ status: 'ready', items: [], error: null });
    render(<FeatureCanvasView />);
    expect(screen.getByText(/No ART team configured/)).toBeInTheDocument();
  });

  it('opens the picker and additively adds a chosen feature to the working set', () => {
    mockUseCanvasFeatures.mockReturnValue({ status: 'ready', items: [buildItem('DENP-1')], error: null });
    render(<FeatureCanvasView />);

    // Empty at first.
    expect(screen.getByText(/Add features to begin/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Add features/ }));
    expect(screen.getByText('picker-open')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'stub-add' }));

    // Adding seeded the overlay working set, so the empty state is gone (board now renders).
    expect(screen.queryByText(/Add features to begin/)).not.toBeInTheDocument();
    expect(screen.getByText('node-DENP-1')).toBeInTheDocument();
  });

  it('removes a node from the working set so it leaves the board (and any commit)', () => {
    mockUseCanvasFeatures.mockReturnValue({ status: 'ready', items: [buildItem('DENP-1')], error: null });
    render(<FeatureCanvasView />);
    fireEvent.click(screen.getByRole('button', { name: /Add features/ }));
    fireEvent.click(screen.getByRole('button', { name: 'stub-add' }));
    expect(screen.getByText('node-DENP-1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'remove-DENP-1' }));

    // The node left the working set → it no longer renders (and thus is not in the commit diff).
    expect(screen.queryByText('node-DENP-1')).not.toBeInTheDocument();
    expect(screen.getByText(/Add features to begin/)).toBeInTheDocument();
  });

  it('opens the read-only inspector for the selected node and closes it', () => {
    mockUseCanvasFeatures.mockReturnValue({ status: 'ready', items: [buildItem('DENP-1')], error: null });
    render(<FeatureCanvasView />);
    fireEvent.click(screen.getByRole('button', { name: /Add features/ }));
    fireEvent.click(screen.getByRole('button', { name: 'stub-add' }));

    fireEvent.click(screen.getByRole('button', { name: 'select-DENP-1' }));
    expect(screen.getByLabelText(/Inspector for DENP-1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Close inspector/ }));
    expect(screen.queryByLabelText(/Inspector for DENP-1/)).not.toBeInTheDocument();
  });

  it('shows a loading state while the working set fetches', () => {
    // Pre-seed a working-set node so the view is not in its empty state.
    window.localStorage.clear();
    mockUseCanvasFeatures.mockReturnValue({ status: 'loading', items: [], error: null });
    render(<FeatureCanvasView />);
    // With an empty working set + loading, the empty state wins; loading shows once a set exists.
    // Add a feature first, then loading is reflected.
    fireEvent.click(screen.getByRole('button', { name: /Add features/ }));
    fireEvent.click(screen.getByRole('button', { name: 'stub-add' }));
    expect(screen.getByText(/Loading features/)).toBeInTheDocument();
  });
});
