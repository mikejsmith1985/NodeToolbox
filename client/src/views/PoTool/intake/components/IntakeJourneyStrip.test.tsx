// IntakeJourneyStrip.test.tsx — The strip renders the engine's step and count, and marks earlier steps done.

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import IntakeJourneyStrip from './IntakeJourneyStrip.tsx';

describe('IntakeJourneyStrip', () => {
  it('marks the current step, the ones before it done, and shows the next action with the open count', () => {
    render(<IntakeJourneyStrip nextStep={{ step: 'checkDenp', turn: 'toolbox', openCount: 4, nextAction: 'Check DENP for open Epics.' }} />);
    const strip = screen.getByRole('list', { name: 'Intake progress' });
    const steps = within(strip).getAllByRole('listitem');
    expect(steps).toHaveLength(8);
    expect(steps[2]).toHaveAttribute('aria-current', 'step');
    expect(steps[0]).toHaveTextContent('✓');
    expect(steps[3]).not.toHaveTextContent('✓');
    expect(screen.getByText(/Check DENP for open Epics\./)).toBeInTheDocument();
    expect(screen.getByText(/4 still open/)).toBeInTheDocument();
  });

  it('marks every step done when the intake is finished', () => {
    render(<IntakeJourneyStrip nextStep={{ step: 'summary', turn: 'done', openCount: 0, nextAction: 'Everything is decided.' }} />);
    const steps = screen.getAllByRole('listitem');
    expect(steps.every((step) => step.textContent?.startsWith('✓'))).toBe(true);
    expect(screen.getByText(/Finished\./)).toBeInTheDocument();
  });
});
