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

/**
 * A bare `done/total` summary, which one of this instance's three checklist fields holds instead of
 * items. Left to a forgiving reader it becomes a single item whose text is "0/1", and — being a tie on
 * count with the real checklist — it could then be chosen as the field to read.
 */
const PROGRESS_SUMMARY_PATTERN = /^\s*\d+\s*\/\s*\d+\s*$/;

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


// ── The Smart Checklist app's own field ──
//
// The app stores its checklist as a Java object graph rendered by `toString()`, wrapped in an array:
//
//   ["Checklist(id=88538, issueId=305985, _items=[Item(id=43628, value=this is a test @C8Q6T3,
//     rank=0, status=Status(id=1, statusState=UNCHECKED, name=TO DO, ...), assignees=[...])], ...)"]
//
// Not a format anybody designed to be read, and not one to be clever about. Only three things are
// taken from each item — its text, its state and its owner — and anything unrecognised is skipped
// rather than guessed at.

/**
 * The marker that starts each item.
 *
 * Split on rather than matched, because an item contains nested `Status(...)` and `History(...)`
 * groups and no regex over unbalanced parentheses gets that right — the first attempt swallowed the
 * second item of every pair.
 */
const DUMP_ITEM_MARKER = /Item\(/;

/** The item's text, which runs to the next known key rather than to a delimiter it may contain. */
const DUMP_VALUE_PATTERN = /(?:^|,\s*)value=([\s\S]*?)(?=,\s*(?:rank|status|quotes|assignees|history|mandatory|description|weight|removeStatus)=)/;

/** Whether the app considers the item ticked. */
const DUMP_STATUS_STATE_PATTERN = /statusState=([A-Z_]+)/;

/** The status's display name, which is the only place "in progress" is expressible. */
const DUMP_STATUS_NAME_PATTERN = /status=Status\([^)]*?\bname=([^,)]+)/;

/** The first assignee's user name, which is what a mention resolves to. */
const DUMP_ASSIGNEE_PATTERN = /Assignee\([^)]*?\buserName=([^,)]+)/;

/** Status names that mean work has started. Compared loosely because they are display strings. */
const DUMP_IN_PROGRESS_NAMES = ['in progress', 'in-progress', 'doing', 'started'];

/** Reads one item block's state from its status, preferring the name where it says more. */
function readDumpItemState(itemBlock: string): ChecklistItemState {
  const statusName = (DUMP_STATUS_NAME_PATTERN.exec(itemBlock)?.[1] ?? '').trim().toLowerCase();
  if (DUMP_IN_PROGRESS_NAMES.includes(statusName)) return 'in-progress';

  const statusState = (DUMP_STATUS_STATE_PATTERN.exec(itemBlock)?.[1] ?? '').trim().toUpperCase();
  return statusState === 'CHECKED' ? 'done' : 'open';
}

/** True when a value looks like the Smart Checklist app's object dump rather than checklist text. */
export function isSmartChecklistDump(rawValue: unknown): boolean {
  const candidateText = typeof rawValue === 'string' ? rawValue : '';
  return candidateText.includes('Item(') && candidateText.includes('value=');
}

/** Reads the items out of the Smart Checklist app's own stored value. */
export function parseSmartChecklistDump(rawValue: unknown): ChecklistItem[] {
  const dumpText = typeof rawValue === 'string' ? rawValue : '';
  if (dumpText === '') return [];

  const items: ChecklistItem[] = [];
  // The text before the first marker is the checklist's own header, never an item.
  const [, ...itemBlocks] = dumpText.split(DUMP_ITEM_MARKER);

  for (const itemBlock of itemBlocks) {
    const itemText = (DUMP_VALUE_PATTERN.exec(itemBlock)?.[1] ?? '').trim();
    if (itemText === '') continue;

    // The mention is part of the stored text, so it is lifted out here exactly as it is for markdown.
    const { text, assigneeUserId } = extractAssignee(itemText);
    items.push({
      id: `checklist-${items.length}`,
      text,
      state: readDumpItemState(itemBlock),
      assigneeUserId: assigneeUserId ?? (DUMP_ASSIGNEE_PATTERN.exec(itemBlock)?.[1] ?? null),
      headingText: null,
    });
  }

  return items;
}

/**
 * Parses a Smart Checklist field value into its items.
 *
 * Blank lines and headings never become items; a heading is carried onto the items beneath it instead,
 * so a grouped checklist keeps its grouping without inventing a card for the group itself.
 */
export function parseChecklistItems(rawChecklistValue: unknown): ChecklistItem[] {
  // The app wraps its dump in a single-element array, so the array case is unwrapped rather than
  // rejected — a shape this instance really uses, discovered by the Board setup diagnostic.
  if (Array.isArray(rawChecklistValue)) {
    return rawChecklistValue.flatMap((element) => parseChecklistItems(element));
  }
  if (isSmartChecklistDump(rawChecklistValue)) return parseSmartChecklistDump(rawChecklistValue);

  const checklistText = typeof rawChecklistValue === 'string' ? rawChecklistValue : '';
  if (checklistText.trim() === '') return [];
  if (PROGRESS_SUMMARY_PATTERN.test(checklistText)) return [];

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

/**
 * Picks the checklist field to READ, by what its value actually yields on a real issue.
 *
 * Name alone chose wrong on a live instance. Three fields matched: "Smart Checklist" (the app's own
 * object dump), "Smart Checklist Progress" (the string "0/1"), and "Checklists" (the readable text).
 * Sorting by name put the dump first — and at the time nothing could read a dump, so the board showed
 * an empty checklist while two other fields held the same items in plain sight.
 *
 * So the choice is made on evidence: whichever candidate parses to the most items wins. A field that
 * yields nothing cannot be the right one to read, whatever it is called.
 */
export function chooseChecklistFieldByValue(
  candidateFieldIds: readonly string[],
  issueFields: Record<string, unknown>,
): string | null {
  let bestFieldId: string | null = null;
  let bestItemCount = 0;

  for (const fieldId of candidateFieldIds ?? []) {
    const itemCount = parseChecklistItems(issueFields?.[fieldId]).length;
    if (itemCount > bestItemCount) {
      bestFieldId = fieldId;
      bestItemCount = itemCount;
    }
  }

  return bestFieldId;
}

/** Every checklist-ish field id on this instance, in name-first order. */
export function listChecklistFieldIds(
  fieldCatalog: readonly { id?: string; name?: string; schema?: { custom?: string } }[],
): string[] {
  return (fieldCatalog ?? [])
    .filter((field) => /checklist/i.test(String(field.name ?? '')) || /checklist/i.test(String(field.schema?.custom ?? '')))
    .map((field) => String(field.id ?? ''))
    .filter((fieldId) => fieldId !== '');
}
