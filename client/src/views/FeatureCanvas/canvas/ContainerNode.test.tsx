// ContainerNode.test.tsx — Verifies the container box renders its title and capacity meter.

import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ContainerNode, type ContainerNodeData } from './ContainerNode.tsx';

function renderContainer(data: ContainerNodeData): void {
  // ContainerNode only reads `data`; the rest of NodeProps is irrelevant to this unit.
  render(<ContainerNode {...({ data } as unknown as ComponentProps<typeof ContainerNode>)} />);
}

describe('ContainerNode', () => {
  it('shows an over-capacity meter for a sprint box past its budget', () => {
    renderContainer({
      kind: 'sprint',
      title: 'Sprint 24',
      isProvisional: false,
      capacity: { containerId: 'ctr-1', total: 8, budget: 5, status: 'over', overBy: 3 },
    });
    expect(screen.getByText('Sprint 24')).toBeInTheDocument();
    expect(screen.getByText(/8 \/ 5 pt/)).toBeInTheDocument();
    expect(screen.getByText(/3 over/)).toBeInTheDocument();
  });

  it('marks a provisional box as proposed', () => {
    renderContainer({ kind: 'release', title: 'New release', isProvisional: true, capacity: null });
    expect(screen.getByText(/New release \(proposed\)/)).toBeInTheDocument();
  });
});
