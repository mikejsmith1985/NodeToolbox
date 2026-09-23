// smartChecklist.ts — Reads an Epic's Definition of Ready / Definition of Done checklist, and ticks items on it.
//
// The checklist lives in Jira as one block of text (the Smart Checklist field's markdown). That matters for how
// this module is written: ticking an item means writing the WHOLE field back, so a careless writer loses whatever
// else was in there — headers, notes, item metadata, the PO's own wording. So the rule here is that ticking an
// item changes exactly one character on exactly one line, and every other byte of the field is returned as it
// arrived. Everything else in this module exists to make that possible.

/** How an item is marked in the text. Smart Checklist uses more than two states, and they must round-trip. */
export type ChecklistItemState = 'open' | 'done' | 'skipped' | 'inProgress';

/** One line of the checklist that is an item, located precisely enough to be rewritten in place. */
export interface ChecklistItem {
  /** Stable within one parse: the line it came from. Used as the id the AI must quote back. */
  id: string;
  /** Zero-based index into the field's own lines — how the tick finds the line again. */
  lineIndex: number;
  /** The item's words, without the bullet, the checkbox, or trailing metadata. */
  text: string;
  state: ChecklistItemState;
  /** The nearest header above it ("Business Readiness"), or '' when the checklist has no headers. */
  section: string;
  /**
   * The top-level header above it ("Definition of Ready (DoR)"), which is what says whether the item is a
   * readiness criterion or a done criterion. Kept apart from `section` because the team's checklist nests the
   * group inside the definition, and the group alone cannot tell them apart.
   */
  definitionHeading: string;
}

/** A parsed checklist: its items, and the exact text they came from. */
export interface ParsedChecklist {
  items: ChecklistItem[];
  /** The field's text, unchanged. Ticking works from this, never from a re-rendered version. */
  sourceText: string;
}

/**
 * Item lines, as the Smart Checklist field writes them.
 *
 * Deliberately generous: instances and people write `- [ ]`, `* [ ]`, `+ [ ]` or a bare `[ ]`, with any
 * indentation. Being strict here would mean silently seeing no items on a checklist that plainly has them.
 */
const ITEM_LINE_PATTERN = /^(\s*)(?:[-*+]\s*)?\[( |x|X|~|>)\]\s?(.*)$/;

/** Header lines: Smart Checklist's `# Heading`, and the `---` separator form some teams use. */
const HEADER_LINE_PATTERN = /^\s*(#+|---+)\s*(.+?)\s*$/;

/** Item metadata Smart Checklist keeps after a `~` (due dates, assignees). Kept in the line, dropped from `text`. */
const ITEM_METADATA_PATTERN = /\s+~\s.*$/;

/** Which marker character means which state. */
const STATE_BY_MARKER: Record<string, ChecklistItemState> = {
  ' ': 'open',
  x:   'done',
  X:   'done',
  '~': 'skipped',
  '>': 'inProgress',
};

/** The marker written back when an item is ticked. */
const DONE_MARKER = 'x';

/** Reads one line's item, or null when the line is not an item. */
function readItemLine(
  line: string,
  lineIndex: number,
  section: string,
  definitionHeading: string,
): ChecklistItem | null {
  const lineMatch = ITEM_LINE_PATTERN.exec(line);
  if (!lineMatch) {
    return null;
  }
  const [, , marker, itemBody] = lineMatch;

  return {
    id: `line-${lineIndex}`,
    lineIndex,
    text: itemBody.replace(ITEM_METADATA_PATTERN, '').trim(),
    state: STATE_BY_MARKER[marker] ?? 'open',
    section,
    definitionHeading,
  };
}

/**
 * Parses the checklist field's text into items.
 *
 * Never throws and never rejects: a field holding something this module does not recognise simply yields no
 * items, which the screen reports as "no checklist items found" rather than as an error about syntax.
 */
export function parseSmartChecklist(fieldText: string): ParsedChecklist {
  const items: ChecklistItem[] = [];
  let currentSection = '';
  let currentDefinitionHeading = '';

  fieldText.split('\n').forEach((line, lineIndex) => {
    const item = readItemLine(line, lineIndex, currentSection, currentDefinitionHeading);
    if (item) {
      items.push(item);
      return;
    }
    const headerMatch = HEADER_LINE_PATTERN.exec(line);
    if (!headerMatch) {
      return;
    }
    const [, headerMarker, headerText] = headerMatch;
    currentSection = headerText.trim();
    // A single `#`, or a `---` separator, opens a definition; deeper headers are groups inside it.
    if (headerMarker === '#' || headerMarker.startsWith('---')) {
      currentDefinitionHeading = headerText.trim();
    }
  });

  return { items, sourceText: fieldText };
}

/** The items worth asking about: anything not already ticked. */
export function listOpenItems(checklist: ParsedChecklist): ChecklistItem[] {
  return checklist.items.filter((item) => item.state !== 'done');
}

/** How many of the checklist's items are done — the number a PO reads as progress. */
export function countCompletedItems(checklist: ParsedChecklist): { doneCount: number; totalCount: number } {
  return {
    doneCount: checklist.items.filter((item) => item.state === 'done').length,
    totalCount: checklist.items.length,
  };
}

/**
 * Ticks the given items and returns the field's new text.
 *
 * The one guarantee this module exists for: every line that is not being ticked comes back byte-for-byte, and a
 * ticked line changes only its marker. Headers, notes, indentation, item metadata and the PO's own wording all
 * survive, because writing the checklist back means writing the whole field.
 *
 * Ids that are not open items are ignored rather than rejected — an item ticked in Jira between the analysis and
 * the save is not an error, it is simply already done.
 */
export function applyChecklistCompletions(checklist: ParsedChecklist, itemIdsToTick: readonly string[]): string {
  const lineIndexesToTick = new Set(
    checklist.items
      .filter((item) => item.state !== 'done' && itemIdsToTick.includes(item.id))
      .map((item) => item.lineIndex),
  );

  if (lineIndexesToTick.size === 0) {
    return checklist.sourceText;
  }

  return checklist.sourceText
    .split('\n')
    .map((line, lineIndex) => (lineIndexesToTick.has(lineIndex) ? tickLine(line) : line))
    .join('\n');
}

/** Replaces only the marker inside the first checkbox on the line, leaving everything else alone. */
function tickLine(line: string): string {
  return line.replace(/\[( |x|X|~|>)\]/, `[${DONE_MARKER}]`);
}
