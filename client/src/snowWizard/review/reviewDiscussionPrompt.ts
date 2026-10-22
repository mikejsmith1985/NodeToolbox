// reviewDiscussionPrompt.ts — Builds the prompt a reviewer pastes into their AI assistant (Copilot) to talk a change
// through: the change as ServiceNow holds it, every check's verdict, and the rules behind them, with instructions to
// test the Wizard's findings and look further — in a conversation with the reviewer, never by guessing facts.
//
// The conversation happens in the assistant's own chat. When the reviewer says "write the note", the assistant answers
// with the agreed findings between two marker lines, and that reply is pasted back to become the coaching note.

import { CHG_TEXT_FIELD_LABELS, type ChgTextFieldKey } from '../../views/SnowHub/chgFormula/formulaCard.ts';
import type { ReadinessItem, ReadinessItemState } from '../../views/SnowHub/guided/changeReadiness.ts';
import type { ReadinessRuleGuideEntry } from '../../views/SnowHub/guided/changeReadinessGuide.ts';
import type { ChangeReviewResult } from './changeReview.ts';

const VERDICT_WORDS: Record<ReadinessItemState, string> = {
  done: 'PASSED',
  needsAction: 'NEEDS ACTION',
  notApplicable: 'DOES NOT APPLY',
  couldNotCheck: 'COULD NOT CHECK',
};

/** The lines the assistant puts around the coaching note, so the Wizard can lift it out of a chatty reply. */
export const NOTE_START_MARKER = 'COACHING NOTE START';
export const NOTE_END_MARKER = 'COACHING NOTE END';
/** What the reviewer types in the assistant's chat to get the note. */
export const WRITE_NOTE_COMMAND = 'write the note';

const NOT_READ_TEXT = '(could not be read)';
const EMPTY_TEXT = '(empty)';

const ROLE_AND_TASK = [
  'You are helping a Release Management reviewer decide whether a ServiceNow change is ready for approval.',
  'The SNow Wizard has already run its automatic checks. Your job is to test its findings and look further, in a conversation with me.',
];

const INSTRUCTIONS = [
  'How to work:',
  '1. Start with a short verdict of your own (ready / not ready / unsure) and the three things that worry you most.',
  '2. For every check marked NEEDS ACTION or COULD NOT CHECK, say whether you agree, using the change text below as evidence.',
  '3. For checks marked PASSED, look for passes that are only on paper — a field that is filled in but would not help anyone (vague steps, a test plan that tests nothing, a backout plan that just says "revert").',
  '4. Check the pieces agree: the description, implementation plan, test plan, backout plan and planned window should describe the same change.',
  '5. Use only the facts below. When something is missing, say what you would need and give your best guess, clearly marked as a guess.',
  '6. Then ask me one question at a time to settle what you could not decide. Keep answers short.',
];

/** The closing instruction: how to hand the agreed findings back as a coaching note. */
function buildNoteInstruction(review: ChangeReviewResult): string {
  const creatorName = review.coachingChange.creatorName.trim() || 'the change\'s creator';
  return [
    `7. When I say "${WRITE_NOTE_COMMAND}", write a coaching note to ${creatorName}, who raised ${review.changeNumber}, covering only the findings we agreed on.`,
    '   Plain English, friendly and specific: greet them by name, then a numbered list — for each point, what is missing, why it matters, and what good looks like. No blame, no jargon, no sign-off.',
    `   Put the note, and nothing else, between a line "${NOTE_START_MARKER}" and a line "${NOTE_END_MARKER}".`,
  ].join('\n');
}

function describeTextField(fieldKey: ChgTextFieldKey, textFields: ChangeReviewResult['facts']['textFields']): string {
  if (textFields === null) return `${CHG_TEXT_FIELD_LABELS[fieldKey]}: ${NOT_READ_TEXT}`;
  const fieldText = (textFields[fieldKey] ?? '').trim();
  return `${CHG_TEXT_FIELD_LABELS[fieldKey]}:\n${fieldText === '' ? EMPTY_TEXT : fieldText}`;
}

function describeRecord(review: ChangeReviewResult): string[] {
  const { change, plannedWindow, isProduction } = review.facts;
  const windowText = plannedWindow === null ? NOT_READ_TEXT
    : `${plannedWindow.plannedStartUtc ?? '(no start)'} to ${plannedWindow.plannedEndUtc ?? '(no end)'} (UTC)`;
  const productionText = isProduction === null ? NOT_READ_TEXT : isProduction ? 'Production' : 'Not Production';
  return [
    `Change: ${review.changeNumber}`,
    `State: ${change?.stateLabel.trim() || NOT_READ_TEXT}`,
    `Owner: ${change?.ownerName.trim() || EMPTY_TEXT}`,
    `Configuration item: ${change?.configItemName.trim() || EMPTY_TEXT}`,
    `Environment: ${productionText}`,
    `Planned window: ${windowText}`,
  ];
}

function describeCheck(item: ReadinessItem): string {
  return `- ${item.label}: ${VERDICT_WORDS[item.state]} — ${item.reason}`;
}

function describeRule(entry: ReadinessRuleGuideEntry): string[] {
  const ruleLine = `- ${entry.label} (applies to: ${entry.appliesTo}) Passes when: ${entry.passesWhen}`;
  return [ruleLine, ...(entry.subRules ?? []).map((subRule) => `    • ${subRule.title}: ${subRule.passesWhen}`)];
}

/**
 * The whole discussion prompt for one reviewed change: role, the change record and text, every check's verdict, the
 * rules the checks apply, and how to run the conversation.
 */
export function buildReviewDiscussionPrompt(review: ChangeReviewResult, ruleGuide: readonly ReadinessRuleGuideEntry[]): string {
  const textFieldKeys = Object.keys(CHG_TEXT_FIELD_LABELS) as ChgTextFieldKey[];
  return [
    ROLE_AND_TASK.join(' '),
    ['THE CHANGE', ...describeRecord(review)].join('\n'),
    ['THE CHANGE TEXT', ...textFieldKeys.map((fieldKey) => describeTextField(fieldKey, review.facts.textFields))].join('\n\n'),
    ['WHAT THE WIZARD FOUND', ...review.items.map(describeCheck)].join('\n'),
    ['THE RULES THOSE CHECKS APPLY', ...ruleGuide.flatMap(describeRule)].join('\n'),
    [...INSTRUCTIONS, buildNoteInstruction(review)].join('\n'),
  ].join('\n\n');
}

// A line holding only the marker, allowing the bold, heading, quote and code marks chat assistants add around it.
function buildMarkerLinePattern(marker: string): RegExp {
  return new RegExp(`^[\\s*#>_\`]*${marker}[\\s*_\`:]*$`, 'im');
}

// A code-fence line the assistant wrapped around the note; it is not part of the note.
const CODE_FENCE_LINE_PATTERN = /^\s*```[a-z]*\s*$/gim;

/**
 * The coaching note out of the assistant's reply: the text between the marker lines, trimmed. Null when the reply has
 * no complete note (the assistant asked a question, or the note was not requested yet).
 */
export function readCopilotCoachingNote(replyText: string): string | null {
  const startMatch = buildMarkerLinePattern(NOTE_START_MARKER).exec(replyText);
  if (!startMatch) return null;
  const afterStart = replyText.slice(startMatch.index + startMatch[0].length);
  const endMatch = buildMarkerLinePattern(NOTE_END_MARKER).exec(afterStart);
  if (!endMatch) return null;
  const noteText = afterStart.slice(0, endMatch.index).replace(CODE_FENCE_LINE_PATTERN, '').trim();
  return noteText === '' ? null : noteText;
}
