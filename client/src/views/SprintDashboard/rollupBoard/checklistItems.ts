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

/**
 * The states a Smart Checklist item can hold.
 *
 * FOUR, not three. The app's own status menu offers TO DO, IN PROGRESS, SKIPPED and DONE, and
 * `skipped` was previously read as `open` — so an item somebody had deliberately set aside came back
 * as untouched work, which is the opposite of what it says.
 */
export type ChecklistItemState = 'open' | 'in-progress' | 'skipped' | 'done';

/** One line of a Smart Checklist, ready to draw. */
export interface ChecklistItem {
  /**
   * Stable within one issue.
   *
   * The app's OWN item id where it stored one — `Item(id=43628, …)` — falling back to the item's
   * position only for a plain-text checklist, which really has nothing else. The difference matters
   * as soon as an item is drawn as a card: a positional id renumbers every item below an insertion,
   * so drag order, selection and the pending marker would all move to the wrong line.
   */
  id: string;
  text: string;
  state: ChecklistItemState;
  /** The `@userid` the item is assigned to, without the `@`. Null when nobody is named. */
  assigneeUserId: string | null;
  /** The `# heading` this item sits under, when the checklist is grouped. */
  headingText: string | null;
  /**
   * The owner, resolved against the people on the board — see `checklistOwners.ts`.
   *
   * Filled by a second pass rather than by the parser, which sees one issue at a time and so cannot
   * know that `@C8Q6T3` is the person assigned three cards along. Optional because unresolved is a
   * real state — the mention still names somebody, just nobody this board can put a face to.
   */
  ownerFilterId?: string | null;
  ownerDisplayName?: string | null;
  /** The app's own ordering, which the board respects rather than inventing one. */
  rank?: number;
  /** The stored fragments the state was decided from, verbatim — see `readDumpStatusSource`. */
  statusSource?: string;
  /**
   * The raw status words this item's state was resolved from.
   *
   * Carried so a disagreement between Jira and the board can be settled by looking, rather than by
   * another round of guessing: when Jira says In progress and the card says To do, the useful
   * question is not what the parser decided but what it was reading when it decided.
   */
  statusWords?: string;
}

/** Marker characters, as the app writes them. */
/**
 * The app's documented text syntax, from Smart Checklist for Data Center's own formatting guide:
 *
 *     - item todo          + item done          ~ item in progress          x item cancelled
 *
 * Worth writing down because every one of these was previously guessed, and guessed wrong. The tilde
 * is IN PROGRESS, not skipped; cancelled is a bare `x`, not `[x]`; and `>` — which the board invented
 * — means nothing at all here.
 */
const STATE_BY_MARKER: Record<string, ChecklistItemState> = {
  '-': 'open',
  '*': 'open',
  '+': 'done',
  '~': 'in-progress',
  x: 'skipped',
  X: 'skipped',
};

/**
 * A bare `done/total` summary, which one of this instance's three checklist fields holds instead of
 * items. Left to a forgiving reader it becomes a single item whose text is "0/1", and — being a tie on
 * count with the real checklist — it could then be chosen as the field to read.
 */
const PROGRESS_SUMMARY_PATTERN = /^\s*\d+\s*\/\s*\d+\s*$/;

/**
 * A checklist line: an optional status marker, an optional `[CUSTOM STATUS]`, then the text.
 *
 * The MARKER is captured rather than thrown away, because on this app it is the whole status. An
 * unfinished item is stored as a bare `- this is a test`, so a reader treating `-`, `+`, `~` and `x`
 * as bullet decoration could only ever report "not started" for every line.
 *
 * The bracket holds a custom status NAME — `- [IN QA] Item text` — not a single character. Reading it
 * as one character is what made `- [x]` look like a valid way to write "done"; the app reads that as
 * a custom status called "x", fails to recognise it, and falls back to the `-` in front of it.
 */
const ITEM_LINE_PATTERN = /^\s*(?:([-*+~xX])\s+)?(?:\[([^\]]*)\]\s*)?(.*)$/;

/** A heading line, which groups the items beneath it. */
const HEADING_LINE_PATTERN = /^\s*#+\s*(.+)$/;

/** Reads a marker character into the state it represents. Anything unrecognised means not started. */
/**
 * Reads a status expressed in WORDS — a custom status name, or the app's own status display name.
 *
 * Shared by the text reader and the object-dump reader on purpose: an item marked `- [IN QA]` in text
 * and the same item read out of the app's own store must land in the same state, or the board would
 * disagree with itself depending on which field it happened to read.
 */
export function readStateFromWords(statusWords: string): ChecklistItemState | null {
  const normalized = statusWords.trim().toLowerCase();
  if (normalized === '') return null;

  if (/skip|cancel|\bn\/a\b|not applicable|won.?t/.test(normalized)) return 'skipped';
  if (/progress|doing|started|\bwip\b/.test(normalized)) return 'in-progress';
  if (/\bchecked\b|\bdone\b|complete|finished|passed/.test(normalized)) return 'done';
  if (/\bunchecked\b|\bto.?do\b|\bopen\b|\bnew\b|backlog/.test(normalized)) return 'open';
  return null;
}

/** What a leading marker means. Anything unrecognised is an ordinary unfinished item. */
function readItemState(markerCharacter: string): ChecklistItemState {
  return STATE_BY_MARKER[markerCharacter] ?? 'open';
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

/** The item's own id, which the app assigns and keeps across edits and reorders. */
const DUMP_ITEM_ID_PATTERN = /^id=(\d+)/;

/** The app's own ordering of its items. */
const DUMP_RANK_PATTERN = /(?:^|,\s*)rank=(\d+)/;

/** The first assignee's user name, which is what a mention resolves to. */
const DUMP_ASSIGNEE_PATTERN = /Assignee\([^)]*?\buserName=([^,)]+)/;

/**
 * Pulls out one item's `status=Status(…)` group, counting brackets rather than matching them.
 *
 * A regex cannot do this. `[^)]*?` stops at the FIRST closing bracket, so the moment a Status carries
 * any nested group of its own the name is never reached — and the reader silently falls back to
 * `statusState`, which says UNCHECKED for both "to do" and "in progress". That is exactly how an item
 * set to IN PROGRESS in Jira came back to the board as To do.
 */
function extractBracketedBlock(itemBlock: string, marker: string, fromIndex = 0): {
  block: string;
  endIndex: number;
} {
  const startIndex = itemBlock.indexOf(marker, fromIndex);
  if (startIndex < 0) return { block: '', endIndex: -1 };

  let openBracketCount = 0;
  for (let index = startIndex; index < itemBlock.length; index += 1) {
    if (itemBlock[index] === '(') openBracketCount += 1;
    else if (itemBlock[index] === ')') {
      openBracketCount -= 1;
      if (openBracketCount === 0) {
        return { block: itemBlock.slice(startIndex, index + 1), endIndex: index + 1 };
      }
    }
  }
  // Unterminated — take what there is rather than nothing, since the name usually comes early.
  return { block: itemBlock.slice(startIndex), endIndex: itemBlock.length };
}

/**
 * The status this item is in NOW, read from its history rather than from its `status=` group.
 *
 * `status=Status(…)` is the app's status DEFINITION, not the item's current value — the stored block
 * for an item sitting in IN PROGRESS still reads `name=TO DO, default=true`. Reading it produced a
 * board that confidently disagreed with Jira, which is worse than one that admits it does not know.
 *
 * The item's real status is the destination of its most recent transition: each change appends a
 * `History(… from=X, to=Y, date=…)`. Chosen by the latest DATE rather than by position, because
 * nothing guarantees the app writes them oldest-first — and a list read backwards would report the
 * status an item was in when it was created, which is exactly the bug being fixed.
 */
function readLatestHistoryStatus(itemBlock: string): string {
  let searchFromIndex = 0;
  let latestDate = '';
  let latestStatus = '';

  for (;;) {
    const { block, endIndex } = extractBracketedBlock(itemBlock, 'History(', searchFromIndex);
    if (block === '') break;
    searchFromIndex = endIndex;

    const transitionTo = (/\bto=([^,)]*)/.exec(block)?.[1] ?? '').trim();
    if (transitionTo === '') continue;
    // Dates are `YYYY-MM-DD HH:MM:SS.mmm`, which compares correctly as text.
    const transitionDate = (/\bdate=([^,)]*)/.exec(block)?.[1] ?? '').trim();
    if (transitionDate >= latestDate) {
      latestDate = transitionDate;
      latestStatus = transitionTo;
    }
  }

  return latestStatus;
}

/** The status words this item carries, lower-cased, from whichever of the two fields hold them. */
export function readDumpStatusWords(itemBlock: string): string {
  // The item's own most recent transition wins over the status DEFINITION, which does not move when
  // the item does.
  const latestHistoryStatus = readLatestHistoryStatus(itemBlock);
  if (latestHistoryStatus !== '') return latestHistoryStatus.toLowerCase();

  const statusBlock = extractBracketedBlock(itemBlock, 'status=Status(').block;
  const statusName = /\bname=([^,)]*)/.exec(statusBlock)?.[1] ?? '';
  // Read from the whole item when there is no status group, but ONLY from a keyed token — matching
  // loose words against the whole block would let an item called "in progress work" set its own state.
  const statusState = /\bstatusState=([A-Za-z_ -]+)/.exec(statusBlock || itemBlock)?.[1] ?? '';
  return `${statusName} ${statusState}`.trim().toLowerCase();
}

/** How much stored status text to keep per item. Enough to diagnose, short of carrying the dump. */
const STATUS_SOURCE_LIMIT = 400;

/**
 * The stored fragments an item's state was decided from, kept verbatim.
 *
 * `statusWords` is this module's INTERPRETATION, and twice now the interpretation has been the thing
 * that was wrong — reporting it alone means every disagreement costs another round of guessing at
 * data only the operator can see. The fragments themselves cost a few hundred bytes an item and end
 * the argument.
 */
export function readDumpStatusSource(itemBlock: string): string {
  const fragments: string[] = [];

  const statusBlock = extractBracketedBlock(itemBlock, 'status=Status(').block;
  if (statusBlock !== '') fragments.push(statusBlock);

  let searchFromIndex = 0;
  for (;;) {
    const { block, endIndex } = extractBracketedBlock(itemBlock, 'History(', searchFromIndex);
    if (block === '') break;
    searchFromIndex = endIndex;
    fragments.push(block);
  }

  const joined = fragments.join(' ');
  return joined.length > STATUS_SOURCE_LIMIT ? `${joined.slice(0, STATUS_SOURCE_LIMIT)}…` : joined;
}

/**
 * Reads one item block's state from its status.
 *
 * Matched by WORDS rather than against a list of exact values, because these are display strings from
 * a third-party app: "IN PROGRESS", "In Progress" and a custom "In progress (dev)" all mean the same
 * thing, and an exact-match list turns every one it has not seen into "not started" — the quietest
 * possible way to be wrong.
 *
 * Order is load-bearing. "In progress" is UNCHECKED as far as `statusState` is concerned, so the
 * progress test has to come before the unchecked one or it never fires.
 */
function readDumpItemState(itemBlock: string): ChecklistItemState {
  const statusWords = readDumpStatusWords(itemBlock);

  return readStateFromWords(statusWords) ?? 'open';
}

/**
 * True when a value looks like the Smart Checklist app's object dump rather than checklist text.
 *
 * An EMPTY checklist is the case this originally missed. The app stores one as
 * `Checklist(id=84509, issueId=302462, _items=[])` — no `Item(` and no `value=` anywhere — so the
 * dump fell through to the forgiving markdown reader, which turned that one line of Java into a
 * single checklist item and made every card with an empty checklist read "Checklist 0/1".
 */
export function isSmartChecklistDump(rawValue: unknown): boolean {
  const candidateText = typeof rawValue === 'string' ? rawValue : '';
  if (candidateText.includes('Item(') && candidateText.includes('value=')) return true;
  return candidateText.includes('Checklist(') && candidateText.includes('_items=');
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
    const storedItemId = DUMP_ITEM_ID_PATTERN.exec(itemBlock)?.[1] ?? null;
    const storedRank = DUMP_RANK_PATTERN.exec(itemBlock)?.[1];
    items.push({
      // The app's own id when it stored one, which survives inserts, deletes and reordering.
      id: storedItemId === null ? `checklist-${items.length}` : `item-${storedItemId}`,
      rank: storedRank === undefined ? items.length : Number(storedRank),
      statusWords: readDumpStatusWords(itemBlock),
      statusSource: readDumpStatusSource(itemBlock),
      text,
      state: readDumpItemState(itemBlock),
      assigneeUserId: assigneeUserId ?? (DUMP_ASSIGNEE_PATTERN.exec(itemBlock)?.[1] ?? null),
      headingText: null,
      ownerFilterId: null,
      ownerDisplayName: null,
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
    const customStatusName = itemMatch?.[2] ?? '';
    const { text, assigneeUserId } = extractAssignee(itemMatch?.[3] ?? rawLine);
    if (text === '') continue;

    items.push({
      // A plain-text checklist genuinely has no id, so position is all there is.
      id: `checklist-${items.length}`,
      rank: items.length,
      text,
      // A custom status name says more than the marker in front of it, so it wins where the board can
      // recognise it. Where it cannot — a status this team invented that means nothing here — the
      // marker decides, which is exactly what the app itself falls back to.
      state: readStateFromWords(customStatusName) ?? readItemState(markerCharacter),
      assigneeUserId,
      headingText: currentHeading,
      ownerFilterId: null,
      ownerDisplayName: null,
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

/**
 * Every checklist-ish field on this instance, with its name.
 *
 * The ids alone were enough while the board only READ a checklist. Choosing which field to WRITE to
 * is a decision a person has to make, and `customfield_10252` is not something anybody can choose
 * between — the names are what make the list mean anything.
 */
export function listChecklistFieldOptions(
  fieldCatalog: readonly { id?: string; name?: string; schema?: { custom?: string } }[],
): Array<{ id: string; name: string }> {
  return (fieldCatalog ?? [])
    .filter((field) => /checklist/i.test(String(field.name ?? '')) || /checklist/i.test(String(field.schema?.custom ?? '')))
    .map((field) => ({ id: String(field.id ?? ''), name: String(field.name ?? field.id ?? '') }))
    .filter((option) => option.id !== '');
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
