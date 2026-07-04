// CanvasLegend.test.tsx — Verifies the canvas key toggles and explains the card markings.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
});
