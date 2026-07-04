// NodeInspectorPanel.test.tsx — Verifies the read-only inspector shows epic detail + child records.

import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CanvasNode } from '../logic/canvasTypes.ts';
import { NodeInspectorPanel } from './NodeInspectorPanel.tsx';

function buildNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    issueKey: 'ENFCT-1', position: { x: 0, y: 0 }, size: 'L', priority: 'Must', containerId: null,
    isExpanded: false, isParked: false, summary: 'Login redesign', status: 'In Progress',
    statusCategoryKey: 'indeterminate', assignee: 'Ada', storyPoints: 5, health: 'yellow', completionPercent: 40,
    hygieneFlags: [], dependencies: [],
    childStories: [
      { key: 'ENFCT-2', summary: 'Build form', status: 'Done', statusCategoryKey: 'done', storyPoints: 3 },
      { key: 'ENFCT-3', summary: 'Wire API', status: 'To Do', statusCategoryKey: 'new', storyPoints: null },
    ],
    effectivePoints: 5, ...overrides,
  };
}

function renderInspector(node: CanvasNode | null, onClose = vi.fn()) {
  render(<NodeInspectorPanel {...({ node, onClose } as ComponentProps<typeof NodeInspectorPanel>)} />);
  return { onClose };
}

describe('NodeInspectorPanel', () => {
  it('renders nothing when no node is selected', () => {
    const { container } = render(<NodeInspectorPanel node={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the epic detail and its child records (read-only)', () => {
    renderInspector(buildNode());
    expect(screen.getByText('ENFCT-1')).toBeInTheDocument();
    expect(screen.getByText('Login redesign')).toBeInTheDocument();
    expect(screen.getByText('Ada')).toBeInTheDocument();
    expect(screen.getByText(/Child records \(2\)/)).toBeInTheDocument();
    expect(screen.getByText(/ENFCT-2 — Build form · Done · 3pt/)).toBeInTheDocument();
    expect(screen.getByText(/ENFCT-3 — Wire API · To Do · —/)).toBeInTheDocument();
    // Read-only: no editable inputs.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('closes via the close control', () => {
    const { onClose } = renderInspector(buildNode());
    fireEvent.click(screen.getByRole('button', { name: /Close inspector/ }));
    expect(onClose).toHaveBeenCalled();
  });
});
