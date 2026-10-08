// useAiAssist.ts — Hidden prompt generator for CHG field population.
// Activated through a keyboard shortcut and a passphrase gate.
// No external documentation — internal capability only.

import { useCallback } from 'react';

import { setAiAssistUnlocked, useAiAssistStore } from '../../../store/aiAssistStore.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';
import {
  CHG_FIELD_REPLY_MARKERS,
  CODE_BLOCK_REPLY_INSTRUCTION,
  restoreMarkerLineBreaks,
  stripCodeFences,
} from '../chgFormula/assistantReplyText.ts';
import { buildChgContextText, type ChgPromptContext } from '../chgFormula/chgPromptContext.ts';
import {
  CHG_TEXT_FIELD_LABELS,
  renderFormulaGuidanceForField,
  type ChgTextFieldKey,
} from '../chgFormula/formulaCard.ts';

// SHA-256 hex digest of the activation passphrase ("unlock").
// The raw passphrase is never stored in source — only the digest is kept.
// To reproduce: node -e "const c=require('crypto');console.log(c.createHash('sha256').update('<passphrase>').digest('hex'))"
const ACTIVATION_DIGEST = '787600ebe6d6c75b6bc0b2db0bfd6aeec78897b67d3192e2208bc8b714237841';

/**
 * The seven CHG text fields the generated prompt targets: the four change-detail fields and the three
 * Planning-step plans (GH #395 — the plans used to be left for the user to write by hand).
 */
export type AiAssistGeneratedFields = Record<ChgTextFieldKey, string>;

export interface UseAiAssistResult {
  isUnlocked: boolean;
  /** Hashes the passphrase and compares it to the stored digest. Sets isUnlocked on success. */
  verifyPassphrase: (passphrase: string) => Promise<boolean>;
  /**
   * Builds a prompt string the user can paste into AI Assist to generate all seven CHG fields. The change
   * record's own facts, when given, go in first so the drafted text agrees with the record.
   */
  buildPrompt: (
    selectedIssues: JiraIssue[],
    currentFields: AiAssistGeneratedFields,
    changeContext?: ChgPromptContext,
  ) => string;
}

/**
 * Computes the SHA-256 hex digest of a string using the browser's Web Crypto API.
 * Called only during passphrase verification — not on every render.
 */
async function computeSha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const encodedBytes = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', encodedBytes);
  const hashByteArray = Array.from(new Uint8Array(hashBuffer));
  return hashByteArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Formats the selected issues into a compact "[KEY] Summary" list
 * suitable for inclusion in a hidden prompt.
 */
function buildIssueListText(selectedIssues: JiraIssue[]): string {
  if (selectedIssues.length === 0) {
    return '(no issues selected)';
  }
  return selectedIssues
    .map((issue) => `[${issue.key}] ${issue.fields.summary}`)
    .join('\n');
}

function readPlainTextValue(fieldValue: unknown): string {
  return normalizeRichTextToPlainText(fieldValue);
}

function buildIssueDetailLines(issue: JiraIssue): string[] {
  const detailLines = [`[${issue.key}] ${issue.fields.summary}`];
  const issueDescription = readPlainTextValue(issue.fields.description);
  const acceptanceCriteriaText = readPlainTextValue(issue.fields.customfield_10200);

  if (issueDescription) {
    detailLines.push(`Description: ${issueDescription}`);
  }
  if (acceptanceCriteriaText) {
    detailLines.push(`Acceptance Criteria: ${acceptanceCriteriaText}`);
  }
  if (!issueDescription && !acceptanceCriteriaText) {
    detailLines.push('Description: (not provided)');
    detailLines.push('Acceptance Criteria: (not provided)');
  }

  return detailLines;
}

/**
 * The selected Jira issues in full — summary, description, acceptance criteria — as the Enhance prompt shows
 * them. Exported so the risk check reads the same source the fields were written from.
 */
export function buildIssueDetailText(selectedIssues: JiraIssue[]): string {
  if (selectedIssues.length === 0) {
    return '(no issue details available)';
  }
  return selectedIssues
    .map((issue) => buildIssueDetailLines(issue).join('\n'))
    .join('\n\n');
}

// The reply markers, in the order the prompt asks for them. The parser relies on this order: each value
// runs from its marker up to the next LATER marker, so a new field must be added here in sequence.
const AI_ASSIST_RESPONSE_MARKERS: ReadonlyArray<{ marker: string; field: ChgTextFieldKey }> = [
  { marker: 'SHORT_DESCRIPTION',   field: 'shortDescription' },
  { marker: 'DESCRIPTION',         field: 'description' },
  { marker: 'JUSTIFICATION',       field: 'justification' },
  { marker: 'RISK_AND_IMPACT',     field: 'riskImpact' },
  { marker: 'IMPLEMENTATION_PLAN', field: 'implementationPlan' },
  { marker: 'TEST_PLAN',           field: 'testPlan' },
  { marker: 'BACKOUT_PLAN',        field: 'backoutPlan' },
];

/** The fields already written, so AI Assist refines them instead of starting over. Empty when none are. */
function buildExistingContentText(currentFields: AiAssistGeneratedFields): string {
  // `?? ''` because a caller built before the plans were added may still hand over only four fields.
  return AI_ASSIST_RESPONSE_MARKERS
    .filter(({ field }) => (currentFields[field] ?? '').trim() !== '')
    .map(({ field }) => `Current ${CHG_TEXT_FIELD_LABELS[field]}: ${currentFields[field]}`)
    .join('\n');
}

/** Each field's reply marker followed by the Release Manager's Formula Card rules it must satisfy. */
function buildFieldRulesText(): string {
  return AI_ASSIST_RESPONSE_MARKERS
    .map(({ marker, field }) => `${marker} (${CHG_TEXT_FIELD_LABELS[field]}) must satisfy:\n${renderFormulaGuidanceForField(field)}`)
    .join('\n\n');
}

/**
 * Builds the complete prompt text to paste into AI Assist: the record facts and delivery path, the Jira
 * issues, any fields already written, the Formula Card rules for each field, then the exact reply format.
 */
function buildAiAssistPromptText(
  selectedIssues: JiraIssue[],
  currentFields: AiAssistGeneratedFields,
  changeContext?: ChgPromptContext,
): string {
  const existingContent = buildExistingContentText(currentFields);

  return [
    'You are assisting with a ServiceNow Change Request for a planned software release.',
    'Write every field so it passes the Release Manager\'s Change Request Formula Card review first time.',
    '',
    changeContext ? `${buildChgContextText(changeContext)}\n` : '',
    'Jira issues included in this release:',
    buildIssueListText(selectedIssues),
    '',
    'Jira issue details for better CHG drafting:',
    buildIssueDetailText(selectedIssues),
    '',
    existingContent ? `Existing content to refine:\n${existingContent}\n` : '',
    'Formula Card rules for each field:',
    buildFieldRulesText(),
    '',
    'Generate all seven CHG fields. Respond ONLY in this exact format with no extra commentary. Each value may',
    'span several lines; write the plans as numbered steps.',
    '',
    'SHORT_DESCRIPTION: [one line: domain | action | object | version or scope | environment]',
    'DESCRIPTION: [current state, what changes, how, what does not change, why now]',
    'JUSTIFICATION: [driver, benefit or risk avoided, consequence of deferral]',
    'RISK_AND_IMPACT: [risk rating and rationale, failure impact, failure modes, blast radius, dependencies, conflicts]',
    'IMPLEMENTATION_PLAN: [numbered steps: actor, action, expected result, verification, time, checkpoints]',
    'TEST_PLAN: [Dev and INT testing done, testing in this environment, success criteria, monitoring, validation owner]',
    'BACKOUT_PLAN: [triggers, decision owner, restoration steps, recovery point and time, post-backout validation]',
    '',
    CODE_BLOCK_REPLY_INSTRUCTION,
  ].join('\n');
}

/**
 * Parses AI Assist's deterministic "KEY: value" response into the seven CHG fields.
 * Each value runs from its marker up to the next marker (so multi-line values are
 * preserved). A leading line boundary on each marker prevents the "DESCRIPTION"
 * marker from matching inside "SHORT_DESCRIPTION". Missing fields are omitted.
 *
 * @param responseText - The raw text AI Assist returned.
 * @returns Only the fields that were found, trimmed.
 */
export function parseAiAssistChgResponse(responseText: string): Partial<AiAssistGeneratedFields> {
  const parsedFields: Partial<AiAssistGeneratedFields> = {};
  if (typeof responseText !== 'string') {
    return parsedFields;
  }
  // A code-block reply loses its fences, and a flattened paste gets its markers back on their own lines.
  const restoredResponse = restoreMarkerLineBreaks(stripCodeFences(responseText), CHG_FIELD_REPLY_MARKERS);

  for (let markerIndex = 0; markerIndex < AI_ASSIST_RESPONSE_MARKERS.length; markerIndex += 1) {
    const { marker, field } = AI_ASSIST_RESPONSE_MARKERS[markerIndex];
    const laterMarkers = AI_ASSIST_RESPONSE_MARKERS.slice(markerIndex + 1).map((entry) => entry.marker);
    // Stop at the next known marker OR end of input — so a value works whether or
    // not later markers are present in the response.
    const stopAhead = laterMarkers.length > 0 ? `(?=\\n\\s*(?:${laterMarkers.join('|')})\\s*:|$)` : '$';
    const fieldRegExp = new RegExp(`(?:^|\\n)\\s*${marker}\\s*:\\s*([\\s\\S]*?)${stopAhead}`, 'i');

    const match = restoredResponse.match(fieldRegExp);
    if (match && match[1].trim()) {
      parsedFields[field] = match[1].trim();
    }
  }

  return parsedFields;
}

/**
 * Provides passphrase-gated prompt generation for populating CHG content fields.
 * Generates a prompt string the user pastes directly into AI Assist — no API calls made.
 *
 * @returns Unlock state and action functions.
 */
export function useAiAssist(): UseAiAssistResult {
  // Unlock state is shared app-wide via aiAssistStore, so one passphrase entry
  // unlocks every AI Assist affordance and the Admin Hub config section.
  const isUnlocked = useAiAssistStore((state) => state.isAiAssistUnlocked);

  const verifyPassphrase = useCallback(async (passphrase: string): Promise<boolean> => {
    const inputDigest = await computeSha256Hex(passphrase);
    const isPassphraseCorrect = inputDigest === ACTIVATION_DIGEST;

    if (isPassphraseCorrect) {
      setAiAssistUnlocked(true);
    }

    return isPassphraseCorrect;
  }, []);

  const buildPrompt = useCallback((
    selectedIssues: JiraIssue[],
    currentFields: AiAssistGeneratedFields,
    changeContext?: ChgPromptContext,
  ): string => {
    return buildAiAssistPromptText(selectedIssues, currentFields, changeContext);
  }, []);

  return { isUnlocked, verifyPassphrase, buildPrompt };
}
