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
import type { ChecklistItem, ChecklistItemState } from './checklistItems.ts';

/** The marker each state is written back as. */
const MARKER_BY_STATE: Record<ChecklistItemState, string> = {
  open: ' ',
  // The app's own "in progress" marker. The reader accepts `>`, `~` and `/`, so a checklist edited
  // elsewhere with either of the others still round-trips through here unchanged in meaning.
  'in-progress': '>',
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
  return 'open';
}

/** The words for a state — always beside the marker, so the state never rests on a shape alone. */
export function describeChecklistState(state: ChecklistItemState): string {
  if (state === 'done') return 'Done';
  return state === 'in-progress' ? 'Working' : 'To do';
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
 * A field is offered here only because Jira's own edit metadata listed it, which is the one reliable
 * test of whether a write will be accepted — guessing by name is what sent the flag through six
 * releases. The field the board READS is preferred when it is also writable, so the change appears
 * where the board is looking rather than somewhere it will have to be told about.
 */
export function chooseWritableChecklistFieldId(
  editableFieldIds: readonly string[],
  candidateFieldIds: readonly string[],
  readableFieldId: string | null,
): string | null {
  const editable = new Set(editableFieldIds);
  if (readableFieldId !== null && editable.has(readableFieldId)) return readableFieldId;
  return candidateFieldIds.find((fieldId) => editable.has(fieldId)) ?? null;
}

/** What a checklist write did, or why it could not be attempted. */
export interface ChecklistWriteResult {
  isWritten: boolean;
  /** Said on the card, not in a toast — the same place every other per-card failure is reported. */
  message: string;
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

  const targetFieldId = chooseWritableChecklistFieldId(
    editableFieldIds,
    input.candidateFieldIds,
    input.readableFieldId,
  );
  if (targetFieldId === null) {
    return {
      isWritten: false,
      // Names the reason rather than the symptom: this is an issue-screen configuration, and somebody
      // with Jira admin can change it.
      message: `No checklist field on ${input.issueKey}'s edit screen, so the board can read this `
        + 'checklist but cannot write to it. Add the checklist text field to the edit screen in Jira.',
    };
  }

  const nextText = buildChecklistText(withItemState(input.items, input.itemId, input.nextState));
  try {
    await saveFeatureReviewSimpleField(input.issueKey, targetFieldId, nextText);
  } catch (writeError) {
    return { isWritten: false, message: `Jira refused the checklist change: ${String(writeError)}` };
  }

  return { isWritten: true, message: '' };
}
