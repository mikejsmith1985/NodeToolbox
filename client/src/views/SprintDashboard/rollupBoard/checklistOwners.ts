// checklistOwners.ts — Turning a checklist's `@C8Q6T3` into the person it names.
//
// A Smart Checklist item carries its owner as a bare Jira user id — `@C8Q6T3` — because that is what
// somebody typed into a text field. Jira renders it as a name; the board was printing the id, which
// is unreadable to everyone including the person it belongs to.
//
// The id is also why the assignee filter appeared to lose work. The filter compares against the value
// the board uses to identify a person, and on this Data Center instance that is whichever of
// `accountId` / `name` / `key` Jira supplied first — so a checklist mention written as the username
// and a card assigned by account id are the SAME person under two strings, and matched neither each
// other nor the filter.
//
// Both problems are one problem: nothing was mapping a user's several ids onto one person. That map
// is built here, from the people already on the board, and applied once — so the name a card shows
// and the person the filter matches come from the same resolution and cannot disagree.

import type { ChecklistItem } from './checklistItems.ts';

/** The parts of a board item this needs: who it is assigned to, and its checklist. */
export interface ChecklistOwnerCandidate {
  /** The identifier the filter compares against. */
  assigneeAccountId: string | null;
  assigneeDisplayName: string | null;
  /** Every id flavour Jira gave for this assignee — account id, username, user key. */
  assigneeIdentifiers?: readonly string[];
  checklistItems: ChecklistItem[];
}

/** One person, under every id they are known by. */
export interface DirectoryEntry {
  /** What the assignee filter holds for this person, so a checklist match and a card match agree. */
  filterId: string;
  displayName: string;
}

/**
 * Every person on the board, indexed by every id they answer to.
 *
 * Lower-cased keys because a user id is written by hand in a checklist and Jira does not care about
 * its case — insisting on it here would leave `@c8q6t3` unresolved beside `@C8Q6T3`.
 */
export function buildOwnerDirectory(
  items: readonly ChecklistOwnerCandidate[],
): Map<string, DirectoryEntry> {
  const directory = new Map<string, DirectoryEntry>();

  for (const item of items) {
    if (item.assigneeAccountId === null) continue;
    const entry: DirectoryEntry = {
      filterId: item.assigneeAccountId,
      displayName: item.assigneeDisplayName ?? item.assigneeAccountId,
    };

    const identifiers = [item.assigneeAccountId, ...(item.assigneeIdentifiers ?? [])];
    for (const identifier of identifiers) {
      const directoryKey = identifier.trim().toLowerCase();
      // First writer wins: an id seen on an assignee is authoritative, and a later item naming the
      // same person adds nothing but a chance to overwrite the name with a worse one.
      if (directoryKey !== '' && !directory.has(directoryKey)) directory.set(directoryKey, entry);
    }
  }

  return directory;
}

/** Looks one checklist mention up. Unknown ids stay unknown rather than being guessed at. */
export function resolveOwner(
  directory: ReadonlyMap<string, DirectoryEntry>,
  assigneeUserId: string | null,
): DirectoryEntry | null {
  if (assigneeUserId === null) return null;
  return directory.get(assigneeUserId.trim().toLowerCase()) ?? null;
}

/**
 * Fills in every checklist item's owner across a whole board.
 *
 * Run as a second pass rather than while each item is built, because resolving one card's checklist
 * needs the people from all the OTHER cards — the person a checklist names is very often assigned
 * somewhere else on the board, which is exactly what makes them findable without asking Jira again.
 */
export function resolveChecklistOwners<TItem extends ChecklistOwnerCandidate>(
  items: readonly TItem[],
): TItem[] {
  const directory = buildOwnerDirectory(items);

  return items.map((item) => ({
    ...item,
    checklistItems: item.checklistItems.map((checklistItem) => {
      const owner = resolveOwner(directory, checklistItem.assigneeUserId);
      return {
        ...checklistItem,
        ownerFilterId: owner?.filterId ?? checklistItem.assigneeUserId,
        ownerDisplayName: owner?.displayName ?? null,
      };
    }),
  }));
}

/**
 * True when a checklist item belongs to the person being filtered for.
 *
 * Falls back to comparing the raw id so a mention naming somebody who holds no card on this board is
 * still matchable — the filter would not offer them, but a deep link or a saved filter might.
 */
export function isChecklistItemOwnedBy(checklistItem: ChecklistItem, filterId: string): boolean {
  const ownerId = checklistItem.ownerFilterId ?? checklistItem.assigneeUserId;
  return ownerId !== null && ownerId.trim().toLowerCase() === filterId.trim().toLowerCase();
}
