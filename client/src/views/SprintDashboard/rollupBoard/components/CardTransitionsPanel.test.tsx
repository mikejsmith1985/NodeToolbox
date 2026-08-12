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
  it('names the column a move lands in, not just the Jira status', () => {
    renderPanel();

    expect(screen.getByText(/Send to QA → Ready for Testing/)).toBeTruthy();
    expect(screen.getByText(/lands in SL Testing/)).toBeTruthy();
  });

  it('warns before a move that would drop the card back into Unmapped', () => {
    renderPanel({ options: [TO_NOWHERE] });

    expect(screen.getByText(/stays in Unmapped/)).toBeTruthy();
  });

  it('says what Jira will ask for before the move goes through', () => {
    renderPanel({ options: [{ ...TO_TESTING, requiredFieldNames: ['Story Points'] }] });

    expect(screen.getByText(/asks for Story Points/)).toBeTruthy();
  });

  it('applies the transition that was clicked', () => {
    const applied = renderPanel();

    fireEvent.click(screen.getByText(/Send to QA/));

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
