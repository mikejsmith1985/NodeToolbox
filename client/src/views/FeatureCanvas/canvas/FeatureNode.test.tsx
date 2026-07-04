// FeatureNode.test.tsx — Verifies the feature card renders key data and its hygiene badge.

import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CanvasNode } from '../logic/canvasTypes.ts';
import { FeatureNode } from './FeatureNode.tsx';

// The card imports Handle/Position (runtime values) from React Flow; stub them so the node
// renders as plain DOM without a React Flow provider.
vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

function buildNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    issueKey: 'DENP-1', position: { x: 0, y: 0 }, size: 'L', priority: 'Must', containerId: null,
    isExpanded: false, isParked: false, summary: 'Login redesign', status: 'In Progress',
    statusCategoryKey: 'indeterminate', assignee: 'Ada', storyPoints: 5, health: 'yellow',
    completionPercent: 40,
    hygieneFlags: [{ checkId: 'no-ac', label: 'Missing acceptance criteria', severity: 'warn' }],
    childStories: [], dependencies: [], businessValue: null, description: null, attachments: [], effectivePoints: 5, ...overrides,
  };
}

describe('FeatureNode', () => {
  it('renders the key, summary, size/points, priority, and hygiene badge', () => {
    render(<FeatureNode {...({ data: { node: buildNode() }, selected: false } as unknown as ComponentProps<typeof FeatureNode>)} />);
    expect(screen.getByText('DENP-1')).toBeInTheDocument();
    expect(screen.getByText('Login redesign')).toBeInTheDocument();
    expect(screen.getByText(/L · 5pt/)).toBeInTheDocument();
    expect(screen.getByText('Must')).toBeInTheDocument();
    expect(screen.getByText(/⚑ 1/)).toBeInTheDocument();
  });

  it('shows no hygiene badge when a feature is clean', () => {
    render(<FeatureNode {...({ data: { node: buildNode({ hygieneFlags: [] }) }, selected: false } as unknown as ComponentProps<typeof FeatureNode>)} />);
    expect(screen.queryByText(/⚑/)).not.toBeInTheDocument();
  });

  it('renders a remove control that fires onDelete, and omits it when no handler is given', () => {
    const onDelete = vi.fn();
    const { rerender } = render(<FeatureNode {...({ data: { node: buildNode(), onDelete }, selected: false } as unknown as ComponentProps<typeof FeatureNode>)} />);
    fireEvent.click(screen.getByRole('button', { name: /Remove DENP-1 from canvas/ }));
    expect(onDelete).toHaveBeenCalledTimes(1);

    rerender(<FeatureNode {...({ data: { node: buildNode() }, selected: false } as unknown as ComponentProps<typeof FeatureNode>)} />);
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
  });
});
