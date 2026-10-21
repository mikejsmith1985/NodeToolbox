// aiDraft.ts — The "Let AI write it" round (pure): one prompt asking for the change's seven texts, and a reader that
// turns the pasted reply into suggestions to accept.
//
// Framework-first: Toolbox's own AI Assist prompt and reply parser (buildAiAssistPromptText, parseAiAssistChgResponse),
// so the Wizard and Toolbox write to the same Formula Card rules. The AI writes TEXT only — every pick-from-a-list
// value stays as the user (or their template) set it (owner's decision). Nothing is written until accepted.

import { CHG_TEXT_FIELD_LABELS, type ChgTextFieldKey } from '../../views/SnowHub/chgFormula/formulaCard.ts';
import { buildAiAssistPromptText, parseAiAssistChgResponse } from '../../views/SnowHub/hooks/useAiAssist.ts';
import { buildCreatedRecordsNote, buildMultiChangeNote, buildWizardPromptContext } from './aiRounds.ts';
import { applyChangeTextField, readChangeTextFields, readSelectedIssues, type CrgDraftState, type CrgHook } from './changeDraft.ts';

/** The draft setters an accepted suggestion writes through — the same ones the screens use. */
export type AiDraftWriters = Pick<CrgHook['actions'], 'updateGeneratedField' | 'setChgPlanningContent'>;

/** One proposed text for one field, shown beside what is there now. */
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
}

const NOT_A_DRAFT_MESSAGE = 'That reply does not look like the AI draft. Copy the whole reply from the assistant and paste it again.';
const NOTHING_NEW_MESSAGE = 'The reply is in, but everything it suggested is already written the same way.';
// Overrides the shared [CONFIRM: ...] rule for the Wizard: a marker left in the text fails the Formula Card checks and
// sends the user hunting through steps to delete it (GH #468), so missing facts are asked for in the AI's own chat.
const BEST_GUESS_INSTRUCTION = 'Make your best guess for every field from the facts above. Do not write [CONFIRM: ...] '
  + 'placeholders in this round: if a fact you need is missing, ask me for it here in this chat first, then write the fields.';

/**
 * The whole prompt: Toolbox's seven-field AI Assist prompt, seeded with the chosen Jira work, the change's own picks
 * (category, type, environments, planning answers) as facts, and anything already written.
 */
export function buildAiDraftPrompt(draft: CrgDraftState, createdChangeLines: readonly string[] = []): string {
  const basePrompt = buildAiAssistPromptText(readSelectedIssues(draft), readChangeTextFields(draft), buildWizardPromptContext(draft));
  return [basePrompt, ...buildMultiChangeNote(draft), ...buildCreatedRecordsNote(createdChangeLines), '', BEST_GUESS_INSTRUCTION].join('\n');
}

/** The draft prompt for a job whose changes may already exist, quoting their numbers (empty before they are created). */
export function aiDraftPromptFor(createdChangeLines: readonly string[]): (draft: CrgDraftState) => string {
  return (draft) => buildAiDraftPrompt(draft, createdChangeLines);
}

/** Reads a pasted reply into one suggestion per text, skipping any that already say the same thing. */
export function readAiDraftReply(replyText: string, draft: CrgDraftState): AiDraftReply {
  const parsedFields = parseAiAssistChgResponse(replyText);
  const parsedFieldKeys = (Object.keys(CHG_TEXT_FIELD_LABELS) as ChgTextFieldKey[]).filter((fieldKey) => Boolean(parsedFields[fieldKey]));
  if (parsedFieldKeys.length === 0) return { isUsable: false, message: NOT_A_DRAFT_MESSAGE, suggestions: [] };
  const currentFields = readChangeTextFields(draft);
  const suggestions = parsedFieldKeys
    .filter((fieldKey) => parsedFields[fieldKey] !== currentFields[fieldKey].trim())
    .map((fieldKey): AiDraftSuggestion => {
      const suggestedText = parsedFields[fieldKey] as string;
      return {
        suggestionId: fieldKey, fieldLabel: CHG_TEXT_FIELD_LABELS[fieldKey], currentText: currentFields[fieldKey], suggestedText,
        apply: (writers) => applyChangeTextField(writers, fieldKey, suggestedText),
      };
    });
  const message = suggestions.length === 0 ? NOTHING_NEW_MESSAGE
    : `Found ${suggestions.length} ${suggestions.length === 1 ? 'field' : 'fields'} to fill in. Untick any you don't want, then fill them in.`;
  return { isUsable: true, message, suggestions };
}
