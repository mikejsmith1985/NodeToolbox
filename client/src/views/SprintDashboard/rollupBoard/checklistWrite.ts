// checklistWrite.ts — Ticking a Smart Checklist item off from the board.
//
// Reading a checklist told you what the work was; it could not be acted on, so anybody who wanted to
// tick one line off still had to open Jira. That is the same trip the board exists to remove.
//
// Writing one is harder than reading one, for a reason worth stating plainly. The Smart Checklist app
// stores its checklist in a field holding a Java object dump — the app's own internal state, rendered
// by `toString()`. That is readable with care and is NOT writable: it is not a format anybody could
// hand back and expect the app to accept. So the write goes to whichever checklist field this issue's
// EDIT SCREEN actually offers, which is the app's plain-text field, and the text is rebuilt from the
// items the board already parsed.
//
// The board asks Jira which field that is rather than assuming one, because field ids are per-instance
// — the same lesson the sub-status, the flag and the checklist read each taught in turn.

import { fetchFeatureReviewEditMeta, saveFeatureReviewSimpleField } from '../featureReviewFixes.ts';
import { isSmartChecklistDump, type ChecklistItem, type ChecklistItemState } from './checklistItems.ts';

/** The marker each state is written back as. */
const MARKER_BY_STATE: Record<ChecklistItemState, string> = {
  open: ' ',
  'in-progress': '>',
  skipped: '~',
  done: 'x',
};

/**
 * The state a click moves an item to.
 *
 * A cycle rather than a plain tick, because the third state is the one people asked to SEE: a line
 * that is not finished is either untouched or being worked on right now, and a two-state checkbox
 * cannot say which. Ticking straight to done stays one click from the start, which is the common case.
 */
export function nextChecklistState(currentState: ChecklistItemState): ChecklistItemState {
  if (currentState === 'open') return 'in-progress';
  if (currentState === 'in-progress') return 'done';
  // Done goes back to the start rather than on to Skipped: skipping is a deliberate act, not
  // somewhere you should arrive by clicking one too many times.
  return 'open';
}

/** The words for a state — always beside the marker, so the state never rests on a shape alone. */
export function describeChecklistState(state: ChecklistItemState): string {
  if (state === 'done') return 'Done';
  if (state === 'skipped') return 'Skipped';
  // The app calls it "In progress"; the board's own columns call it Working. The app's word wins,
  // because this label names a value that lives in the app and is edited there too.
  return state === 'in-progress' ? 'In progress' : 'To do';
}

/** One item's state changed, the rest untouched. */
export function withItemState(
  items: readonly ChecklistItem[],
  itemId: string,
  nextState: ChecklistItemState,
): ChecklistItem[] {
  return items.map((item) => (item.id === itemId ? { ...item, state: nextState } : item));
}

/**
 * Rebuilds the checklist's text from its items.
 *
 * Headings are re-emitted where they change, so a grouped checklist stays grouped; the owner mention
 * is put back on the end of the line it was lifted out of when the item was read.
 */
export function buildChecklistText(items: readonly ChecklistItem[]): string {
  const lines: string[] = [];
  let lastHeading: string | null = null;

  for (const item of items) {
    if (item.headingText !== null && item.headingText !== lastHeading) {
      lines.push(`# ${item.headingText}`);
      lastHeading = item.headingText;
    }
    const mention = item.assigneeUserId === null ? '' : ` @${item.assigneeUserId}`;
    lines.push(`- [${MARKER_BY_STATE[item.state]}] ${item.text}${mention}`);
  }

  return lines.join('\n');
}

/**
 * Picks the checklist field this issue can actually be written through.
 *
 * Two tests, and the second is the one that was missing. Jira's edit metadata says whether a write
 * will be ACCEPTED — that part was right. It says nothing about whether the write will MEAN anything,
 * and the app's own field holds a Java object dump: Jira takes a string for it happily, the request
 * returns 204, and the checklist does not change. That is the silent failure this now refuses to
 * produce. A field whose current value is a dump is never written to, however editable Jira says it is.
 */
export function chooseWritableChecklistFieldId(
  editableFieldIds: readonly string[],
  candidateFieldIds: readonly string[],
  readableFieldId: string | null,
  issueFields: Record<string, unknown> = {},
  nominatedFieldId?: string,
): string | null {
  const editable = new Set(editableFieldIds);
  /** Editable, and holding something this can legitimately rewrite. */
  const isWritable = (fieldId: string): boolean =>
    editable.has(fieldId) && !isSmartChecklistDump(issueFields[fieldId]);

  // A team that has nominated a field has information the board does not: which custom field the
  // checklist app actually reads. That beats every guess below it — but not the dump check, because
  // writing there produces a change that looks like it worked and did not.
  if (nominatedFieldId && isWritable(nominatedFieldId)) return nominatedFieldId;

  if (readableFieldId !== null && isWritable(readableFieldId)) return readableFieldId;
  return candidateFieldIds.find(isWritable) ?? null;
}

/**
 * Why this issue's checklist cannot be written, in words somebody can act on.
 *
 * Separate from the attempt so the same explanation can be shown BEFORE anybody tries — on the card's
 * own detail, rather than only after a drag has quietly done nothing.
 */
export function describeChecklistWriteBlock(input: {
  issueKey: string;
  editableFieldIds: readonly string[];
  candidateFieldIds: readonly string[];
  issueFields: Record<string, unknown>;
}): string | null {
  const editable = new Set(input.editableFieldIds);
  const editableChecklistFieldIds = input.candidateFieldIds.filter((fieldId) => editable.has(fieldId));

  if (editableChecklistFieldIds.length === 0) {
    return `No checklist field appears on ${input.issueKey}'s edit screen, so the board can read this `
      + 'checklist but cannot change it. A Jira admin can add the checklist TEXT field to the edit '
      + 'screen for this issue type; until then, change the item in Jira.';
  }

  if (editableChecklistFieldIds.every((fieldId) => isSmartChecklistDump(input.issueFields[fieldId]))) {
    return `The only checklist field on ${input.issueKey}'s edit screen holds the checklist app's own `
      + 'internal data. Jira would accept a write to it and the app would then ignore it, so the board '
      + 'refuses to make a change that would look like it worked. Ask a Jira admin to add the '
      + 'checklist TEXT field to the edit screen for this issue type.';
  }

  return null;
}

/** What a checklist write did, or why it could not be attempted. */
export interface ChecklistWriteResult {
  isWritten: boolean;
  /** Said on the card, not in a toast — the same place every other per-card failure is reported. */
  message: string;
  /** Which field the change was sent to, so the card's detail can report it. */
  targetFieldId?: string;
}

/**
 * Writes one item's new state back to Jira.
 *
 * Refusing before trying is deliberately NOT the shape here: the only thing that decides whether a
 * write lands is Jira, so the only case handled up front is having nowhere at all to write to — which
 * is a fact about the issue's edit screen, not a guess about it.
 */
export async function saveChecklistItemState(input: {
  issueKey: string;
  items: readonly ChecklistItem[];
  itemId: string;
  nextState: ChecklistItemState;
  candidateFieldIds: readonly string[];
  readableFieldId: string | null;
  /** The issue's current field values, so a field holding the app's own dump can be ruled out. */
  issueFields?: Record<string, unknown>;
  /** The field this team nominated in Board setup, when they have. */
  nominatedFieldId?: string;
}): Promise<ChecklistWriteResult> {
  let editableFieldIds: string[] = [];
  try {
    editableFieldIds = Object.keys(await fetchFeatureReviewEditMeta(input.issueKey));
  } catch (metaError) {
    return {
      isWritten: false,
      message: `Could not ask Jira which fields ${input.issueKey} accepts: ${String(metaError)}`,
    };
  }

  const issueFields = input.issueFields ?? {};
  const targetFieldId = chooseWritableChecklistFieldId(
    editableFieldIds,
    input.candidateFieldIds,
    input.readableFieldId,
    issueFields,
    input.nominatedFieldId,
  );
  if (targetFieldId === null) {
    return {
      isWritten: false,
      // Names the reason rather than the symptom: this is an issue-screen configuration, and somebody
      // with Jira admin can change it.
      message: describeChecklistWriteBlock({
        issueKey: input.issueKey,
        editableFieldIds,
        candidateFieldIds: input.candidateFieldIds,
        issueFields,
      }) ?? `No checklist field on ${input.issueKey} can be written.`,
    };
  }

  const nextText = buildChecklistText(withItemState(input.items, input.itemId, input.nextState));
  try {
    await saveFeatureReviewSimpleField(input.issueKey, targetFieldId, nextText);
  } catch (writeError) {
    return { isWritten: false, message: `Jira refused the checklist change: ${String(writeError)}` };
  }

  return { isWritten: true, message: '', targetFieldId };
}

/**
 * What somebody should DO after a write the checklist app ignored.
 *
 * Two genuinely different situations, and telling them apart matters more than the words do. If some
 * other field on this instance is editable plain text, one of them is probably the one the app reads
 * and naming it fixes this for good. If none is, no amount of picking will help: this instance simply
 * does not expose the checklist for writing, and the board should say so instead of sending somebody
 * round a list where nothing works.
 */
export function describeChecklistWriteAdvice(
  verdicts: readonly ChecklistFieldVerdict[],
  attemptedFieldId: string,
): string {
  const otherViableFields = verdicts.filter((verdict) =>
    verdict.id !== attemptedFieldId && verdict.holds !== 'app-data' && verdict.isOnEditScreen);

  if (otherViableFields.length === 0) {
    return 'No other checklist field on this instance can be written to, so the board cannot change '
      + 'checklist items here at all — this Jira does not expose the checklist app’s own store as an '
      + 'editable field. The board will keep READING checklists; change the items in Jira. '
      + 'If your admin can add the checklist text field to the edit screen, that would change this.';
  }

  const names = otherViableFields.map((verdict) => `${verdict.name} (${verdict.id})`).join(', ');
  return `Try naming a different field in Board setup → “Where checklist items go” → “Write checklist `
    + `changes to”. The other editable candidates on this instance are: ${names}. To find the right `
    + 'one, change an item in Jira, reload the board, and see which field’s contents moved with it.';
}

/** One checklist field, judged as a place to WRITE to. */
export interface ChecklistFieldVerdict {
  id: string;
  name: string;
  /** What is in it now, reduced to the only distinction that matters for writing. */
  holds: 'app-data' | 'text' | 'empty';
  /** True when this issue's edit screen exposes it, which is Jira's own answer. */
  isOnEditScreen: boolean;
  /** Plain-English summary, so the picker never asks somebody to interpret two flags. */
  summary: string;
}

/**
 * Judges each checklist field as a write target, from evidence rather than from its name.
 *
 * The picker this feeds exists because the board guessed wrong twice: the app's own field looks
 * writable to Jira and is not, and a plain-text checklist field can be perfectly writable while
 * being a MIRROR the app never reads back. Nothing the board can see distinguishes the mirror from
 * the real one — but somebody who changes an item in Jira and looks at this list can.
 */
export function judgeChecklistFields(input: {
  candidates: readonly { id: string; name: string }[];
  editableFieldIds: readonly string[];
  issueFields: Record<string, unknown>;
}): ChecklistFieldVerdict[] {
  const editable = new Set(input.editableFieldIds);

  return input.candidates.map((candidate) => {
    const rawValue = input.issueFields[candidate.id];
    const isOnEditScreen = editable.has(candidate.id);
    const holds: ChecklistFieldVerdict['holds'] = isSmartChecklistDump(rawValue)
      ? 'app-data'
      : (rawValue === null || rawValue === undefined || rawValue === '' ? 'empty' : 'text');

    return { id: candidate.id, name: candidate.name, holds, isOnEditScreen, summary: describeVerdict(holds, isOnEditScreen) };
  });
}

/** One sentence per field, saying whether it can be written and what would happen. */
function describeVerdict(holds: ChecklistFieldVerdict['holds'], isOnEditScreen: boolean): string {
  if (holds === 'app-data') {
    return 'the checklist app’s own data — Jira would accept a write and the app would ignore it';
  }
  if (!isOnEditScreen) return 'not on this issue’s edit screen, so Jira would refuse a write';
  return holds === 'empty' ? 'editable, currently empty' : 'editable plain text — a likely write target';
}

/**
 * Confirms the change actually took, by reading the checklist back.
 *
 * A 204 from Jira proves only that Jira stored a string. The checklist itself is owned by a
 * third-party app that may or may not act on that string, so treating the 204 as success is exactly
 * how a drag ends up doing nothing at all while reporting nothing at all. This is the check that
 * turns that into a sentence somebody can act on.
 */
export function verifyChecklistItemState(
  reReadItems: readonly ChecklistItem[],
  itemId: string,
  expectedState: ChecklistItemState,
  targetFieldId: string,
): ChecklistWriteResult {
  const writtenItem = reReadItems.find((item) => item.id === itemId);

  if (writtenItem === undefined) {
    return {
      isWritten: false,
      message: 'Jira accepted the change, but the item is no longer in the checklist it was read from. '
        + 'Reload the board before changing anything else here.',
    };
  }

  if (writtenItem.state !== expectedState) {
    return {
      isWritten: false,
      // The FACT only. What to do about it depends on which fields this instance has, which is a
      // different question — see describeChecklistWriteAdvice.
      message: `Jira accepted the change to ${targetFieldId}, but the checklist still reads `
        + `"${describeChecklistState(writtenItem.state)}" — the checklist app ignored it.`,
    };
  }

  return { isWritten: true, message: '' };
}
