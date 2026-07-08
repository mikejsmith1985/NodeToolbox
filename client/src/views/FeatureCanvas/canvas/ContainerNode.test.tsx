// ContainerNode.test.tsx — Verifies the container box renders its title and capacity meter.

import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';

import { ContainerNode, type ContainerNodeData } from './ContainerNode.tsx';

function renderContainer(data: ContainerNodeData): void {
  // ContainerNode only reads `data`; the rest of NodeProps is irrelevant to this unit. It embeds a
  // React Flow NodeResizer, which needs the RF store context, so wrap in ReactFlowProvider.
  render(
    <ReactFlowProvider>
      <ContainerNode {...({ data } as unknown as ComponentProps<typeof ContainerNode>)} />
    </ReactFlowProvider>,
  );
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

  it('invokes onDelete when the box delete button is clicked', () => {
    const onDelete = vi.fn();
    renderContainer({ kind: 'sprint', title: 'Sprint 24', isProvisional: false, capacity: null, onDelete });
    fireEvent.click(screen.getByRole('button', { name: /Delete Sprint 24/ }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('renders no delete button when onDelete is absent', () => {
    renderContainer({ kind: 'sprint', title: 'Sprint 24', isProvisional: false, capacity: null });
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });

  it('renames the box via the ✎ button, committing the new title on Enter', () => {
    const onRename = vi.fn();
    renderContainer({ kind: 'sprint', title: 'Sprint 24', isProvisional: false, capacity: null, onRename });
    fireEvent.click(screen.getByRole('button', { name: /Rename Sprint 24/ }));
    const input = screen.getByRole('textbox', { name: /Rename Sprint 24/ });
    fireEvent.change(input, { target: { value: 'Hardening Sprint' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('Hardening Sprint');
  });

  it('does not call onRename when the edit is cancelled with Escape', () => {
    const onRename = vi.fn();
    renderContainer({ kind: 'sprint', title: 'Sprint 24', isProvisional: false, capacity: null, onRename });
    fireEvent.click(screen.getByRole('button', { name: /Rename Sprint 24/ }));
    const input = screen.getByRole('textbox', { name: /Rename Sprint 24/ });
    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
  });

  it('renders no rename affordance when onRename is absent', () => {
    renderContainer({ kind: 'sprint', title: 'Sprint 24', isProvisional: false, capacity: null });
    expect(screen.queryByRole('button', { name: /Rename/ })).not.toBeInTheDocument();
  });
});
