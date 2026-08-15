// checklistOwners.test.ts — Proves a person's several Jira ids resolve to one person.

import { describe, expect, it } from 'vitest';

import type { ChecklistItem } from './checklistItems.ts';
import {
  buildOwnerDirectory,
  isChecklistItemOwnedBy,
  resolveChecklistOwners,
  resolveOwner,
} from './checklistOwners.ts';

/** One checklist item, with only the fields this cares about set. */
function buildChecklistItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: 'checklist-0',
    text: 'this is a test',
    state: 'open',
    assigneeUserId: null,
    headingText: null,
    ownerFilterId: null,
    ownerDisplayName: null,
    ...overrides,
  };
}

const MICHAEL = {
  assigneeAccountId: 'acc-11',
  assigneeDisplayName: 'Smith, Michael (CTR)',
  assigneeIdentifiers: ['acc-11', 'C8Q6T3', 'JIRAUSER11'],
  checklistItems: [],
};

describe('buildOwnerDirectory', () => {
  it('indexes one person under every id Jira gave for them', () => {
    const directory = buildOwnerDirectory([MICHAEL]);

    expect(resolveOwner(directory, 'C8Q6T3')?.displayName).toBe('Smith, Michael (CTR)');
    expect(resolveOwner(directory, 'JIRAUSER11')?.displayName).toBe('Smith, Michael (CTR)');
  });

  it('reports the id the ASSIGNEE FILTER holds, not whichever id was matched', () => {
    // The whole point: a checklist mention written as the username has to answer with the same value
    // a card assigned by account id answers with, or the filter matches one and not the other.
    expect(resolveOwner(buildOwnerDirectory([MICHAEL]), 'C8Q6T3')?.filterId).toBe('acc-11');
  });

  it('ignores the case a user id was typed in', () => {
    // Somebody types the mention by hand into a text field; Jira does not care about its case.
    expect(resolveOwner(buildOwnerDirectory([MICHAEL]), 'c8q6t3')).not.toBeNull();
  });

  it('leaves an unknown id unresolved rather than guessing at a person', () => {
    expect(resolveOwner(buildOwnerDirectory([MICHAEL]), 'NOBODY')).toBeNull();
  });

  it('skips unassigned cards, which name nobody', () => {
    const directory = buildOwnerDirectory([
      { assigneeAccountId: null, assigneeDisplayName: null, checklistItems: [] },
    ]);

    expect(directory.size).toBe(0);
  });
});

describe('resolveChecklistOwners', () => {
  it('resolves a mention against a person assigned somewhere ELSE on the board', () => {
    // The reason this is a second pass: the card carrying the checklist is very often not the card
    // that identifies the person the checklist names.
    const [, cardWithChecklist] = resolveChecklistOwners([
      MICHAEL,
      {
        assigneeAccountId: 'acc-22',
        assigneeDisplayName: 'Somagutta, Bhargavi (CTR)',
        assigneeIdentifiers: ['acc-22'],
        checklistItems: [buildChecklistItem({ assigneeUserId: 'C8Q6T3' })],
      },
    ]);

    expect(cardWithChecklist.checklistItems[0].ownerDisplayName).toBe('Smith, Michael (CTR)');
    expect(cardWithChecklist.checklistItems[0].ownerFilterId).toBe('acc-11');
  });

  it('keeps the raw id as the owner when nobody on the board matches', () => {
    // Honest: the item is still filterable by that id, and the card still shows something.
    const [card] = resolveChecklistOwners([
      { ...MICHAEL, checklistItems: [buildChecklistItem({ assigneeUserId: 'GHOST' })] },
    ]);

    expect(card.checklistItems[0].ownerFilterId).toBe('GHOST');
    expect(card.checklistItems[0].ownerDisplayName).toBeNull();
  });

  it('leaves an unassigned checklist item owned by nobody', () => {
    const [card] = resolveChecklistOwners([{ ...MICHAEL, checklistItems: [buildChecklistItem()] }]);

    expect(card.checklistItems[0].ownerFilterId).toBeNull();
  });
});

describe('isChecklistItemOwnedBy', () => {
  it('matches on the resolved filter id, so it agrees with the card filter', () => {
    const item = buildChecklistItem({ assigneeUserId: 'C8Q6T3', ownerFilterId: 'acc-11' });

    expect(isChecklistItemOwnedBy(item, 'acc-11')).toBe(true);
  });

  it('still matches an unresolved mention by its raw id', () => {
    expect(isChecklistItemOwnedBy(buildChecklistItem({ assigneeUserId: 'GHOST' }), 'GHOST')).toBe(true);
  });

  it('does not match somebody else', () => {
    const item = buildChecklistItem({ assigneeUserId: 'C8Q6T3', ownerFilterId: 'acc-11' });

    expect(isChecklistItemOwnedBy(item, 'acc-22')).toBe(false);
  });
});
