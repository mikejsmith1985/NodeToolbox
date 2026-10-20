// aiDraft.ts — The "Let AI write it" round (pure): one prompt that asks for every text and pick-from-a-list answer the
// user would otherwise fill in by hand, and a reader that turns the pasted reply into suggestions to accept.
//
// Framework-first: the seven texts use Toolbox's own AI Assist prompt and reply parser (buildAiAssistPromptText,
// parseAiAssistChgResponse), so the Wizard and Toolbox write to the same Formula Card rules. Only the "PICK" lines are
// new — Toolbox's prompt never asked for list answers. A pick is accepted ONLY when it matches a value on ServiceNow's
// own list; anything else is reported and left for the user (pick, don't type). Nothing is written until accepted.

import { CHG_TEXT_FIELD_LABELS, type ChgTextFieldKey } from '../../views/SnowHub/chgFormula/formulaCard.ts';
import { buildAiAssistPromptText, parseAiAssistChgResponse } from '../../views/SnowHub/hooks/useAiAssist.ts';
import type { SnowChoiceOption, SnowChoiceOptionMap } from '../../views/SnowHub/hooks/useSnowChoiceOptions.ts';
import { buildWizardPromptContext } from './aiRounds.ts';
import { DETAIL_CHOICES, MAIN_ASSESSMENT_QUESTIONS, MORE_ASSESSMENT_QUESTIONS } from './assessmentQuestions.ts';
import { applyChangeTextField, readChangeTextFields, readSelectedIssues, type CrgDraftState, type CrgHook } from './changeDraft.ts';

/** The draft setters an accepted suggestion writes through — the same ones the screens use. */
export type AiDraftWriters = Pick<CrgHook['actions'], 'updateGeneratedField' | 'setChgPlanningContent' | 'setChgBasicInfo' | 'setChgPlanningAssessment'>;

/** One proposed value for one field, shown beside what is there now. */
export interface AiDraftSuggestion {
  suggestionId: string;
  fieldLabel: string;
  currentText: string;
  suggestedText: string;
  apply: (writers: AiDraftWriters) => void;
}

/** A pasted reply, read. */
export interface AiDraftReply {
  isUsable: boolean;
  message: string;
  suggestions: AiDraftSuggestion[];
  /** Picks that were not on ServiceNow's list, in plain words. */
  rejectedPicks: string[];
}

/** One pick-from-a-list question the AI may answer. */
interface PickQuestion {
  choiceListName: string;
  question: string;
  readCurrentValue: (draft: CrgDraftState) => string;
  apply: (writers: AiDraftWriters, value: string) => void;
}

const PICK_LINE_PATTERN = /^\s*PICK\s+([A-Za-z_]+)\s*:\s*(.+?)\s*$/gm;
// Non-global twin for a yes/no test (a global pattern's .test() keeps state between calls).
const HAS_PICK_LINE_PATTERN = /^\s*PICK\s+[A-Za-z_]+\s*:/im;
// Quotes, brackets or a trailing full stop the assistant may wrap a value in.
const VALUE_WRAPPER_PATTERN = /^["'“”[(<]+|["'“”\])>.]+$/g;
const NOT_A_DRAFT_MESSAGE = 'That reply does not look like the AI draft. Copy the whole reply from the assistant and paste it again.';
const NOTHING_NEW_MESSAGE = 'The reply is in, but everything it suggested is already filled in the same way.';

/** Every pick-from-a-list question, in the order the screens show them. */
const PICK_QUESTIONS: readonly PickQuestion[] = [
  ...DETAIL_CHOICES.map((detailChoice): PickQuestion => ({
    choiceListName: detailChoice.choiceListName,
    question: detailChoice.question,
    readCurrentValue: (draft) => draft.chgBasicInfo[detailChoice.stateKey],
    apply: (writers, value) => writers.setChgBasicInfo({ [detailChoice.stateKey]: value }),
  })),
  ...[...MAIN_ASSESSMENT_QUESTIONS, ...MORE_ASSESSMENT_QUESTIONS].map((assessmentQuestion): PickQuestion => ({
    choiceListName: assessmentQuestion.choiceListName,
    question: assessmentQuestion.question,
    readCurrentValue: (draft) => draft.chgPlanningAssessment[assessmentQuestion.stateKey],
    apply: (writers, value) => writers.setChgPlanningAssessment({ [assessmentQuestion.stateKey]: value }),
  })),
];

/** The questions ServiceNow gave a list for — a question with no list cannot be answered safely. */
function listAnswerableQuestions(choiceOptions: SnowChoiceOptionMap): PickQuestion[] {
  return PICK_QUESTIONS.filter((pickQuestion) => (choiceOptions[pickQuestion.choiceListName] ?? []).length > 0);
}

/** The PICK section appended to Toolbox's seven-field prompt. */
function buildPickSection(choiceOptions: SnowChoiceOptionMap): string[] {
  const pickLines = listAnswerableQuestions(choiceOptions).map((pickQuestion) => {
    const optionLabels = (choiceOptions[pickQuestion.choiceListName] ?? []).map((option) => option.label).join(' | ');
    return `PICK ${pickQuestion.choiceListName}: one of ${optionLabels}   (${pickQuestion.question})`;
  });
  if (pickLines.length === 0) return [];
  return [
    '',
    'ALSO answer each question below with exactly ONE of its listed values, written exactly as listed.',
    'Start your reply with these PICK lines, BEFORE SHORT_DESCRIPTION, one per line, e.g. "PICK impact: 3 - Low".',
    ...pickLines,
  ];
}

/**
 * The whole prompt: Toolbox's seven-field AI Assist prompt seeded with the chosen Jira work and anything already
 * written, plus the pick-from-a-list questions. The assistant is told to make its best guesses from the facts and to
 * ask in its own chat only when something essential is missing.
 */
export function buildAiDraftPrompt(draft: CrgDraftState, choiceOptions: SnowChoiceOptionMap): string {
  const basePrompt = buildAiAssistPromptText(readSelectedIssues(draft), readChangeTextFields(draft), buildWizardPromptContext(draft));
  return [
    basePrompt,
    ...buildPickSection(choiceOptions),
    '',
    'Make your best guess for every field from the facts above. Only if something essential is missing, ask me here in this chat first.',
  ].join('\n');
}

/** The list option a picked value names, by its label or its value, ignoring case and wrapping punctuation. */
function findListedOption(options: readonly SnowChoiceOption[], pickedValue: string): SnowChoiceOption | null {
  const normalizedPick = pickedValue.replace(VALUE_WRAPPER_PATTERN, '').trim().toLowerCase();
  return options.find((option) => option.label.toLowerCase() === normalizedPick || option.value.toLowerCase() === normalizedPick) ?? null;
}

/** The picks in a reply, each kept as a suggestion or reported as not on the list. */
function readPickSuggestions(replyText: string, draft: CrgDraftState, choiceOptions: SnowChoiceOptionMap) {
  const suggestions: AiDraftSuggestion[] = [];
  const rejectedPicks: string[] = [];
  for (const [, choiceListName, pickedValue] of replyText.matchAll(PICK_LINE_PATTERN)) {
    const pickQuestion = PICK_QUESTIONS.find((question) => question.choiceListName === choiceListName);
    if (!pickQuestion) continue;
    const options = choiceOptions[choiceListName] ?? [];
    const listedOption = findListedOption(options, pickedValue);
    if (!listedOption) {
      rejectedPicks.push(`${pickQuestion.question}: “${pickedValue}” is not on ServiceNow's list, so it was left for you.`);
      continue;
    }
    const currentValue = pickQuestion.readCurrentValue(draft);
    if (currentValue === listedOption.value) continue;
    const currentLabel = options.find((option) => option.value === currentValue)?.label ?? currentValue;
    suggestions.push({
      suggestionId: `pick:${choiceListName}`, fieldLabel: pickQuestion.question, currentText: currentLabel,
      suggestedText: listedOption.label, apply: (writers) => pickQuestion.apply(writers, listedOption.value),
    });
  }
  return { suggestions, rejectedPicks };
}

/** The seven texts in a reply, skipping any that already say the same thing. */
function readTextSuggestions(replyText: string, draft: CrgDraftState): AiDraftSuggestion[] {
  // The PICK lines go first in the reply, but strip them anyway so a misplaced one never lands inside a plan.
  const parsedFields = parseAiAssistChgResponse(replyText.replace(PICK_LINE_PATTERN, ''));
  const currentFields = readChangeTextFields(draft);
  return (Object.keys(CHG_TEXT_FIELD_LABELS) as ChgTextFieldKey[])
    .filter((fieldKey) => parsedFields[fieldKey] && parsedFields[fieldKey] !== currentFields[fieldKey].trim())
    .map((fieldKey) => ({
      suggestionId: `text:${fieldKey}`, fieldLabel: CHG_TEXT_FIELD_LABELS[fieldKey], currentText: currentFields[fieldKey],
      suggestedText: parsedFields[fieldKey] as string,
      apply: (writers: AiDraftWriters) => applyChangeTextField(writers, fieldKey, parsedFields[fieldKey] as string),
    }));
}

/** Reads a pasted reply into suggestions (picks first, in screen order, then the texts). */
export function readAiDraftReply(replyText: string, draft: CrgDraftState, choiceOptions: SnowChoiceOptionMap): AiDraftReply {
  const pickResult = readPickSuggestions(replyText, draft, choiceOptions);
  const textSuggestions = readTextSuggestions(replyText, draft);
  const suggestions = [...pickResult.suggestions, ...textSuggestions];
  const hasRecognisedAnything = suggestions.length > 0 || pickResult.rejectedPicks.length > 0;
  if (!hasRecognisedAnything && !HAS_PICK_LINE_PATTERN.test(replyText) && !/SHORT_DESCRIPTION\s*:/i.test(replyText)) {
    return { isUsable: false, message: NOT_A_DRAFT_MESSAGE, suggestions: [], rejectedPicks: [] };
  }
  const message = suggestions.length === 0 ? NOTHING_NEW_MESSAGE
    : `Found ${suggestions.length} ${suggestions.length === 1 ? 'field' : 'fields'} to fill in. Untick any you don't want, then fill them in.`;
  return { isUsable: true, message, suggestions, rejectedPicks: pickResult.rejectedPicks };
}
