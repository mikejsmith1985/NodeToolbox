// FeatureCanvasView.test.tsx — Verifies the ART-team scope guard empty state.

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import FeatureCanvasView from './FeatureCanvasView.tsx';

// The view imports the React Flow board at module load; stub React Flow so importing the view is
// cheap and the guard path renders without a real canvas.
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

describe('FeatureCanvasView', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows the configure-ART empty state when no team matches the active board', () => {
    render(<FeatureCanvasView />);
    expect(screen.getByText(/Configure an ART team for this board/)).toBeInTheDocument();
  });
});
