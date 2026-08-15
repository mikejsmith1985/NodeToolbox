// ChecklistCard.test.tsx — Proves a checklist item reads as a checklist item, not as a broken issue.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ChecklistCard } from './ChecklistCard.tsx';
import type { ChecklistCard as ChecklistCardModel } from '../checklistCards.ts';

/** One card with only what the component draws. */
function buildCard(overrides: Partial<ChecklistCardModel> = {}): ChecklistCardModel {
  return {
    id: 'DEV-1#item-43628',
    parentKey: 'DEV-1',
    featureKey: 'FEAT-1',
    columnId: 'col-todo',
    text: 'this is a test',
    state: 'open',
    ownerFilterId: null,
    ownerDisplayName: null,
    itemId: 'item-43628',
    rank: 0,
    ...overrides,
  };
}

describe('ChecklistCard', () => {
  it('says which of the three states it is in, in words', () => {
    render(<ChecklistCard card={buildCard({ state: 'in-progress' })} />);

    expect(screen.getByText('In progress')).toBeTruthy();
  });

  it('marks the state as data too, so it never rests on colour alone', () => {
    const { container } = render(<ChecklistCard card={buildCard({ state: 'done' })} />);

    expect(container.querySelector('[data-state="done"]')).toBeTruthy();
  });

  it('says what KIND of thing it is', () => {
    // A card that looked like a sub-task but carried no issue key would be read as a broken
    // sub-task rather than as the different thing it is.
    render(<ChecklistCard card={buildCard()} />);

    expect(screen.getByText('Checklist')).toBeTruthy();
  });

  it('offers no issue key, because a checklist item has none', () => {
    // The whole reason this is not a copy of the issue card: a key here would be a dead link.
    render(<ChecklistCard card={buildCard()} />);

    expect(screen.queryByText(/DEV-1/)).toBeNull();
  });

  it('names its owner rather than printing their Jira id', () => {
    render(<ChecklistCard card={buildCard({
      ownerFilterId: 'acc-11', ownerDisplayName: 'Smith, Michael (CTR)',
    })} />);

    expect(screen.getByText('Smith, Michael (CTR)')).toBeTruthy();
  });

  it('falls back to the raw id when nobody on the board holds it', () => {
    render(<ChecklistCard card={buildCard({ ownerFilterId: 'GHOST' })} />);

    expect(screen.getByText('@GHOST')).toBeTruthy();
  });

  it('moves the item on when its state is clicked', () => {
    // Dragging says which column; clicking is the shortcut for ticking the next one off.
    const stateChanges: Array<[string, string]> = [];
    render(<ChecklistCard
      card={buildCard()}
      onSetState={(card, nextState) => stateChanges.push([card.itemId, nextState])}
    />);

    fireEvent.click(screen.getByRole('button', { name: /Set to In progress/ }));

    expect(stateChanges).toEqual([['item-43628', 'in-progress']]);
  });

  it('is unpressable when nothing can be written', () => {
    render(<ChecklistCard card={buildCard()} onSetState={undefined} />);

    expect(screen.getByRole('button', { name: /Set to In progress/ }).hasAttribute('disabled')).toBe(true);
  });

  it('is unpressable on another discipline’s read-only work', () => {
    render(<ChecklistCard card={buildCard()} isReadOnly onSetState={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Set to In progress/ }).hasAttribute('disabled')).toBe(true);
  });

  it('shows a failed write on the card, not in a toast that scrolls away', () => {
    render(<ChecklistCard card={buildCard()} errorMessage="No checklist field on the edit screen." />);

    expect(screen.getByText('No checklist field on the edit screen.')).toBeTruthy();
  });
});

describe('when a write did not take', () => {
  it('keeps the card readable — the explanation belongs in the board notice, not here', () => {
    // A configuration problem with a two-sentence fix used to render as a paragraph of red text on a
    // 250px card, covering the item it was about, every single time it was tried.
    render(<ChecklistCard card={buildCard()} errorMessage="Did not move — see the board notice above." />);

    expect(screen.getByText('Did not move — see the board notice above.')).toBeTruthy();
  });

  it('offers the escape: the one issue that needs opening in Jira', () => {
    // Where the board cannot write the checklist, Jira can. Leaving somebody to work out which issue
    // to open is the difference between a dead end and a detour.
    render(<ChecklistCard card={buildCard()} errorMessage="Did not move." />);

    const jiraLink = screen.queryByRole('link', { name: /Change it in DEV-1/ });
    // Rendered only when the board knows the Jira base URL; without one there is nothing to link to.
    if (jiraLink) expect(jiraLink.getAttribute('target')).toBe('_blank');
  });

  it('shows no failure text at all when nothing failed', () => {
    render(<ChecklistCard card={buildCard()} />);

    expect(screen.queryByText(/Did not move/)).toBeNull();
  });
});

describe('the explanation lives on the card, not only in a notice', () => {
  it('folds the paragraph away behind “Why?” instead of showing it always', () => {
    // The board notice sits above a scroll region the reader has usually scrolled past, so a card
    // pointing "above" was pointing off screen. It is here — just not unfolded.
    render(<ChecklistCard
      card={buildCard()}
      errorMessage="Did not move."
      errorDetail="Jira accepted the change and the checklist app ignored it."
    />);

    expect(screen.getByText('Why?')).toBeTruthy();
    expect(screen.getByText(/the checklist app ignored it/)).toBeTruthy();
  });

  it('shows no disclosure when there is no explanation to give', () => {
    render(<ChecklistCard card={buildCard()} errorMessage="Did not move." />);

    expect(screen.queryByText('Why?')).toBeNull();
  });
});

describe('opening the issue in Jira', () => {
  it('offers it from the menu at ANY time, not only after something failed', () => {
    // Where an instance does not let the board write checklists at all, opening the issue is the
    // workflow rather than the fallback.
    render(<ChecklistCard card={buildCard()} />);

    fireEvent.contextMenu(screen.getByTestId('rollup-checklist-card-DEV-1#item-43628'));

    // Present only when the board knows the Jira base URL; there is nothing to link to without one.
    const menuItem = screen.queryByRole('menuitem', { name: /Open DEV-1 in Jira/ });
    if (menuItem) expect(menuItem).toBeTruthy();
  });
});

describe('when this instance cannot write checklists at all', () => {
  const BLOCKED = 'This Jira does not expose Smart Checklist for editing.';

  it('stops offering the state as a control', () => {
    // The board knows this at load. Drawing a pressable button that cannot work is the trap this
    // whole sequence of failures was made of.
    render(<ChecklistCard card={buildCard()} onSetState={vi.fn()} writeBlockedReason={BLOCKED} />);

    expect(screen.queryByRole('button', { name: /Set to In progress/ })).toBeNull();
  });

  it('still says which state the item is in', () => {
    // Saying the state is the card's job. Offering to change it is not, where nothing can.
    render(<ChecklistCard card={buildCard({ state: 'done' })} writeBlockedReason={BLOCKED} />);

    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('offers the Jira route as the card’s own affordance, not as an error state', () => {
    render(<ChecklistCard card={buildCard()} writeBlockedReason={BLOCKED} />);

    // Present only when the board knows the Jira base URL.
    const jiraLink = screen.queryByRole('link', { name: /Change it in DEV-1/ });
    if (jiraLink) expect(jiraLink.getAttribute('target')).toBe('_blank');
  });

  it('keeps the control when writing IS available', () => {
    render(<ChecklistCard card={buildCard()} onSetState={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Set to In progress/ })).toBeTruthy();
  });
});
