// CardTransitionsPanel.test.tsx — Proves the open card names where it can go in BOARD terms, warns
// before a move that would land back in Unmapped, and never reads an in-flight fetch as "nowhere".

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CardTransitionsPanel } from './CardTransitionsPanel.tsx';
import type { CardTransitionOption } from '../cardTransitions.ts';

const TO_TESTING: CardTransitionOption = {
  transitionId: '31',
  transitionName: 'Send to QA',
  toStatusName: 'Ready for Testing',
  landsInColumnName: 'SL Testing',
  requiredFieldNames: [],
  requiredFields: [],
};

const TO_NOWHERE: CardTransitionOption = {
  transitionId: '41',
  transitionName: 'Cancel',
  toStatusName: 'Cancelled',
  landsInColumnName: null,
  requiredFieldNames: [],
  requiredFields: [],
};

function renderPanel(overrides: Partial<React.ComponentProps<typeof CardTransitionsPanel>> = {}) {
  const applied: CardTransitionOption[] = [];
  render(
    <CardTransitionsPanel
      isLoading={false}
      onApply={(option) => applied.push(option)}
      options={[TO_TESTING]}
      pendingTransitionId={null}
      {...overrides}
    />,
  );
  return applied;
}

describe('CardTransitionsPanel', () => {
  it('names the destination and the column it lands in, without repeating either', () => {
    renderPanel();

    // The chip carries the destination; the column is the hint beside it. The workflow's own step
    // name ("Send to QA") is deliberately NOT printed — it usually just says the destination again.
    expect(screen.getByText('Ready for Testing')).toBeTruthy();
    expect(screen.getByText('SL Testing')).toBeTruthy();
    expect(screen.queryByText(/Send to QA/)).toBeNull();
  });

  it('says nothing about the column when it reads the same as the status', () => {
    renderPanel({ options: [{ ...TO_TESTING, toStatusName: 'Cancelled', landsInColumnName: 'Cancelled' }] });

    // "Cancelled · Cancelled" is noise; the column is only worth naming when it differs.
    expect(screen.getAllByText('Cancelled')).toHaveLength(1);
  });

  it('keeps the full sentence on the chip as a tooltip, so nothing is lost', () => {
    renderPanel();

    expect(screen.getByTitle(/lands in SL Testing/)).toBeTruthy();
  });

  it('warns before a move that would drop the card back into Unmapped', () => {
    renderPanel({ options: [TO_NOWHERE] });

    // One short word per chip rather than the same sentence repeated down the panel.
    expect(screen.getByText('unmapped')).toBeTruthy();
    expect(screen.getByTitle(/stays in Unmapped/)).toBeTruthy();
  });

  it('marks a move Jira will ask for fields before making', () => {
    renderPanel({ options: [{ ...TO_TESTING, requiredFieldNames: ['Story Points'] }] });

    expect(screen.getByTitle('Asks for Story Points')).toBeTruthy();
  });

  it('applies the transition that was clicked', () => {
    const applied = renderPanel();

    fireEvent.click(screen.getByText('Ready for Testing'));

    expect(applied).toEqual([TO_TESTING]);
  });

  it('never reads an in-flight read as "nowhere to go"', () => {
    renderPanel({ isLoading: true, options: [] });

    expect(screen.queryByText(/offers no moves/)).toBeNull();
    expect(screen.getByText('Asking Jira…')).toBeTruthy();
  });

  it('names both reasons an issue can have nowhere to go, once the read is done', () => {
    renderPanel({ isLoading: false, options: [] });

    expect(screen.getByText(/closed, or you may not have permission/)).toBeTruthy();
  });

  it('locks every option while one is being applied, so two moves cannot race', () => {
    renderPanel({ options: [TO_TESTING, TO_NOWHERE], pendingTransitionId: '31' });

    expect(screen.getByText('Moving…')).toBeTruthy();
    for (const optionButton of screen.getAllByRole('button')) {
      expect(optionButton.hasAttribute('disabled')).toBe(true);
    }
  });
});
