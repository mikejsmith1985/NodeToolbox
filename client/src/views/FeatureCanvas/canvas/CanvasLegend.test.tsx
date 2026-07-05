// CanvasLegend.test.tsx — Verifies the canvas key toggles and explains the card markings.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CanvasLegend } from './CanvasLegend.tsx';

describe('CanvasLegend', () => {
  it('is collapsed until opened', () => {
    render(<CanvasLegend />);
    expect(screen.queryByRole('dialog', { name: /Canvas legend/ })).not.toBeInTheDocument();
  });

  it('explains the blue in-progress stripe and other markings when opened', () => {
    render(<CanvasLegend />);
    fireEvent.click(screen.getByRole('button', { name: /Key/ }));

    expect(screen.getByRole('dialog', { name: /Canvas legend/ })).toBeInTheDocument();
    expect(screen.getByText(/In progress \(counts toward WIP\)/)).toBeInTheDocument();
    expect(screen.getByText(/Left stripe — status/)).toBeInTheDocument();
    expect(screen.getByText(/Corner dot — health/)).toBeInTheDocument();
    expect(screen.getByText(/parked \(excluded from WIP\)/)).toBeInTheDocument();
  });

  it('closes again via the close control', () => {
    render(<CanvasLegend />);
    fireEvent.click(screen.getByRole('button', { name: /Key/ }));
    fireEvent.click(screen.getByRole('button', { name: /Close legend/ }));
    expect(screen.queryByRole('dialog', { name: /Canvas legend/ })).not.toBeInTheDocument();
  });

  it('stays static (no focus toggles) when no filter handler is provided', () => {
    render(<CanvasLegend />);
    fireEvent.click(screen.getByRole('button', { name: /Key/ }));
    // Without a handler the entries are plain text, not pressable toggles.
    expect(screen.queryByRole('button', { name: /In progress/ })).not.toBeInTheDocument();
  });

  it('emits a status filter when a status entry is clicked in interactive mode', () => {
    const onToggleFilter = vi.fn();
    render(<CanvasLegend activeFilter={null} onToggleFilter={onToggleFilter} />);
    fireEvent.click(screen.getByRole('button', { name: /Key/ }));

    fireEvent.click(screen.getByRole('button', { name: /In progress/ }));
    expect(onToggleFilter).toHaveBeenCalledWith({ dimension: 'status', value: 'indeterminate' });
  });

  it('marks the active entry pressed and offers Show all to clear', () => {
    const onToggleFilter = vi.fn();
    render(<CanvasLegend activeFilter={{ dimension: 'health', value: 'red' }} onToggleFilter={onToggleFilter} />);
    fireEvent.click(screen.getByRole('button', { name: /Key/ }));

    expect(screen.getByRole('button', { name: /Blocked/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(onToggleFilter).toHaveBeenCalledWith({ dimension: 'health', value: 'red' });
  });

  it('documents the blue (early / low-completion) health dot', () => {
    render(<CanvasLegend />);
    fireEvent.click(screen.getByRole('button', { name: /Key/ }));
    expect(screen.getByText(/Early — under 40% done/)).toBeInTheDocument();
  });
});
