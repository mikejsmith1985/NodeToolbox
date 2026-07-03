// FeatureCanvasView.test.tsx — Verifies the scope guard, the Surface scope bar, and refine filtering.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeatureReviewItem } from '../SprintDashboard/featureReview.ts';
import type { CanvasFeaturesResult } from './canvas/useCanvasFeatures.ts';

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

const { mockUseCanvasFeatures } = vi.hoisted(() => ({ mockUseCanvasFeatures: vi.fn() }));
vi.mock('./canvas/useCanvasFeatures.ts', () => ({ useCanvasFeatures: mockUseCanvasFeatures }));

import FeatureCanvasView from './FeatureCanvasView.tsx';

function buildItem(key: string, summary: string, labels: string[]): FeatureReviewItem {
  return {
    feature: { type: 'feature', key, summary, status: 'In Progress', health: 'yellow', completionPercent: 0, children: [], offTrain: [], isExternal: false },
    featureIssue: { key, fields: { status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } }, labels } } as unknown as FeatureReviewItem['featureIssue'],
    hygieneFlags: [],
    blockedChildCount: 0, doneChildCount: 0, inFlightChildCount: 0, totalChildCount: 0,
  };
}

function buildFeaturesResult(overrides: Partial<CanvasFeaturesResult>): CanvasFeaturesResult {
  return {
    status: 'ready', team: { id: 't', name: 'A', boardId: '42', projectKey: 'DENP', sprintIssues: [], isLoading: false, loadError: null },
    projectKey: 'DENP', piName: 'PI 26.3', boardId: 42, items: [], error: null,
    jql: 'project = "DENP" AND issuetype in (Feature, Epic)', defaultJql: 'project = "DENP" AND issuetype in (Feature, Epic)',
    setJql: vi.fn(), surface: vi.fn(), ...overrides,
  };
}

describe('FeatureCanvasView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('shows the configure-ART empty state when no team matches the active board', () => {
    mockUseCanvasFeatures.mockReturnValue(buildFeaturesResult({ status: 'no-team', team: null, items: [] }));
    render(<FeatureCanvasView />);
    expect(screen.getByText(/Configure an ART team for this board/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/surface query/i)).not.toBeInTheDocument();
  });

  it('renders the Surface scope bar (pre-filled) once a team is resolved', () => {
    mockUseCanvasFeatures.mockReturnValue(buildFeaturesResult({ items: [buildItem('DENP-1', 'Login', ['ENCUC'])] }));
    render(<FeatureCanvasView />);
    expect((screen.getByLabelText(/surface query/i) as HTMLInputElement).value).toContain('issuetype in (Feature, Epic)');
  });

  it('narrows the surfaced set with a refine filter without re-fetching', () => {
    mockUseCanvasFeatures.mockReturnValue(buildFeaturesResult({
      items: [buildItem('DENP-1', 'Login', ['ENCUC']), buildItem('DENP-2', 'Payments', ['payments'])],
    }));
    render(<FeatureCanvasView />);

    expect(screen.getByText('2 features')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/filter by label/i), { target: { value: 'ENCUC' } });
    expect(screen.getByText('1 feature')).toBeInTheDocument();
    // Filtering never triggers a re-surface.
    expect(mockUseCanvasFeatures.mock.results[0].value.surface).not.toHaveBeenCalled();
  });
});
