// aiDraft.ts — The "Let AI write it" round (pure): one prompt asking for the change's seven texts, and a reader that
// turns the pasted reply into suggestions to accept.
//
// Framework-first: Toolbox's own AI Assist prompt and reply parser (buildAiAssistPromptText, parseAiAssistChgResponse),
// so the Wizard and Toolbox write to the same Formula Card rules. The AI writes TEXT only — every pick-from-a-list
// value stays as the user (or their template) set it (owner's decision). Nothing is written until accepted.

import { CHG_TEXT_FIELD_LABELS, type ChgTextFieldKey } from '../../views/SnowHub/chgFormula/formulaCard.ts';
import { buildAiAssistPromptText, parseAiAssistChgResponse } from '../../views/SnowHub/hooks/useAiAssist.ts';
import { buildMultiChangeNote, buildWizardPromptContext } from './aiRounds.ts';
import { applyChangeTextField, readChangeTextFields, readSelectedIssues, type CrgDraftState, type CrgHook } from './changeDraft.ts';
import type { JiraEvidenceAttachment } from './jiraEvidence.ts';
import { fitPromptToBudget } from './promptBudget.ts';

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

// The plans must carry the timeline and the durations the CAB asks for, worked out from the task estimates above.
const TIMELINE_INSTRUCTION = 'The Implementation Plan must follow the task timeline above: the tasks in the order they run, each '
  + 'with its planned start and end, then the Implementation, Validation and Backout Duration and the window length, taken from '
  + 'the task estimates. Never write "not estimated", "TBD" or "unknown" for a duration — use the estimates given.';
// What the Test Plan must say about the evidence, so it is judged by the files rather than by the words alone.
const EVIDENCE_INSTRUCTION = 'The Test Plan must name every Jira issue key above with the evidence file(s) that show it was '
  + 'tested. For an issue with no file, say plainly that its test evidence is not attached yet; never cite evidence it does not have.';

/** The files each chosen Jira issue holds — the test evidence zipped onto the change — one line per issue. */
function describeEvidenceByIssue(draft: CrgDraftState, jiraEvidence: readonly JiraEvidenceAttachment[]): string[] {
  const issueLines = readSelectedIssues(draft).map((issue) => {
    const fileNames = jiraEvidence.filter((evidence) => evidence.issueKey === issue.key).map((evidence) => evidence.attachment.filename);
    return `  ${issue.key}: ${fileNames.length > 0 ? fileNames.join(', ') : 'no files — no test evidence for this issue'}`;
  });
  if (issueLines.length === 0) return [];
  return ['', 'Test evidence (the files on each Jira issue — they are zipped and attached to the change):', ...issueLines, EVIDENCE_INSTRUCTION];
}

/**
 * The whole prompt: Toolbox's seven-field AI Assist prompt, seeded with the chosen Jira work, the change's own picks
 * (category, type, environments, planning answers) and its task timeline as facts, the test evidence on each issue, and
 * anything already written.
 */
export function buildAiDraftPrompt(draft: CrgDraftState, jiraEvidence: readonly JiraEvidenceAttachment[] = []): string {
  const selectedIssues = readSelectedIssues(draft);
  // The Jira details are already in the base prompt, so the record facts do not repeat them: carrying them twice is
  // what took this prompt past Copilot's 128,000-character limit (GH #475). Toolbox's own Enhance prompt does the same.
  const promptContext = { ...buildWizardPromptContext(draft), jiraSourceText: undefined };
  return fitPromptToBudget(selectedIssues, (issueDetailText) => [
    buildAiAssistPromptText(selectedIssues, readChangeTextFields(draft), promptContext, issueDetailText),
    ...buildMultiChangeNote(draft), ...describeEvidenceByIssue(draft, jiraEvidence), '', TIMELINE_INSTRUCTION, '', BEST_GUESS_INSTRUCTION,
  ].join('\n')).promptText;
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
