// checklistItems.ts — Reading a Smart Checklist so its items can be drawn as cards.
//
// Teams break work down three ways on this board — Stories, sub-tasks, and Smart Checklist items —
// and until now the third was invisible. The card showed a bare "Checklist 2/5" count, which says how
// much is left but not what any of it IS, so the one breakdown that costs nothing to create was the
// one you had to open Jira to read.
//
// Checklist items are not Jira issues. They have no key, no assignee object, no status — only a line
// of text with a marker, an optional `@mention`, and possibly a heading above them. So they are read
// here into their own small shape rather than pretending to be board items, and drawn nested inside
// the card they belong to, where the parent/child relationship is the whole point.
//
// The syntax belongs to a third-party app, so this parser is deliberately forgiving: anything it does
// not recognise is kept as plain item text rather than dropped. An unreadable checklist should look
// odd, never empty.

/** The three states a Smart Checklist item can hold. */
export type ChecklistItemState = 'open' | 'in-progress' | 'done';

/** One line of a Smart Checklist, ready to draw. */
export interface ChecklistItem {
  /** Stable within one issue — the item's position, since items have no id of their own. */
  id: string;
  text: string;
  state: ChecklistItemState;
  /** The `@userid` the item is assigned to, without the `@`. Null when nobody is named. */
  assigneeUserId: string | null;
  /** The `# heading` this item sits under, when the checklist is grouped. */
  headingText: string | null;
}

/** Marker characters, as the app writes them. */
const DONE_MARKERS = new Set(['x', 'X']);
const IN_PROGRESS_MARKERS = new Set(['>', '~', '/']);

/** A checklist line: an optional bullet, an optional `[state]` box, then the text. */
const ITEM_LINE_PATTERN = /^\s*(?:[-*+]\s*)?(?:\[(.?)\]\s*)?(.*)$/;

/** A heading line, which groups the items beneath it. */
const HEADING_LINE_PATTERN = /^\s*#+\s*(.+)$/;

/** Reads a marker character into the state it represents. Anything unrecognised means not started. */
function readItemState(markerCharacter: string): ChecklistItemState {
  if (DONE_MARKERS.has(markerCharacter)) return 'done';
  if (IN_PROGRESS_MARKERS.has(markerCharacter)) return 'in-progress';
  return 'open';
}

/**
 * Pulls the `@userid` out of an item's text.
 *
 * Removed from the text as well as reported, because the mention is shown as its own element — leaving
 * it inline would print the owner twice.
 */
function extractAssignee(itemText: string): { text: string; assigneeUserId: string | null } {
  const mentionMatch = /@([A-Za-z0-9._-]+)/.exec(itemText);
  if (!mentionMatch) return { text: itemText.trim(), assigneeUserId: null };

  return {
    text: itemText.replace(mentionMatch[0], '').replace(/\s+/g, ' ').trim(),
    assigneeUserId: mentionMatch[1],
  };
}

/**
 * Parses a Smart Checklist field value into its items.
 *
 * Blank lines and headings never become items; a heading is carried onto the items beneath it instead,
 * so a grouped checklist keeps its grouping without inventing a card for the group itself.
 */
export function parseChecklistItems(rawChecklistValue: unknown): ChecklistItem[] {
  const checklistText = typeof rawChecklistValue === 'string' ? rawChecklistValue : '';
  if (checklistText.trim() === '') return [];

  const items: ChecklistItem[] = [];
  let currentHeading: string | null = null;

  for (const rawLine of checklistText.split(/\r?\n/)) {
    if (rawLine.trim() === '') continue;

    const headingMatch = HEADING_LINE_PATTERN.exec(rawLine);
    if (headingMatch) {
      currentHeading = headingMatch[1].trim();
      continue;
    }

    const itemMatch = ITEM_LINE_PATTERN.exec(rawLine);
    const markerCharacter = itemMatch?.[1] ?? '';
    const { text, assigneeUserId } = extractAssignee(itemMatch?.[2] ?? rawLine);
    if (text === '') continue;

    items.push({
      id: `checklist-${items.length}`,
      text,
      state: readItemState(markerCharacter),
      assigneeUserId,
      headingText: currentHeading,
    });
  }

  return items;
}

/** How much of a checklist is finished — the count the card already showed, now derived from the items. */
export function summarizeChecklist(items: readonly ChecklistItem[]): { completedCount: number; totalCount: number } | null {
  if (items.length === 0) return null;
  return {
    completedCount: items.filter((item) => item.state === 'done').length,
    totalCount: items.length,
  };
}

/**
 * Picks the Smart Checklist field from this instance's field catalogue.
 *
 * By NAME first, because a field actually called "Checklist" is a far stronger signal than one that
 * merely comes from the checklist app — an instance can carry several of the latter.
 */
export function findChecklistFieldId(
  fieldCatalog: readonly { id?: string; name?: string; schema?: { custom?: string } }[],
): string | null {
  const candidates = (fieldCatalog ?? [])
    .filter((field) => /checklist/i.test(String(field.name ?? '')) || /checklist/i.test(String(field.schema?.custom ?? '')))
    .filter((field) => String(field.id ?? '') !== '')
    .sort((firstField, secondField) => {
      const firstScore = /checklist/i.test(String(firstField.name ?? '')) ? 0 : 1;
      const secondScore = /checklist/i.test(String(secondField.name ?? '')) ? 0 : 1;
      return firstScore - secondScore;
    });

  return candidates.length > 0 ? String(candidates[0].id) : null;
}
