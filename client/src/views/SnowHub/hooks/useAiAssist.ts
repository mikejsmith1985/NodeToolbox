// useAiAssist.ts — Hidden prompt generator for CHG field population.
// Activated through a keyboard shortcut and a passphrase gate.
// No external documentation — internal capability only.

import { useCallback } from 'react';

import { setAiAssistUnlocked, useAiAssistStore } from '../../../store/aiAssistStore.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';

// SHA-256 hex digest of the activation passphrase ("unlock").
// The raw passphrase is never stored in source — only the digest is kept.
// To reproduce: node -e "const c=require('crypto');console.log(c.createHash('sha256').update('<passphrase>').digest('hex'))"
const ACTIVATION_DIGEST = '787600ebe6d6c75b6bc0b2db0bfd6aeec78897b67d3192e2208bc8b714237841';

/** The four CHG text fields that the generated prompt targets. */
export interface AiAssistGeneratedFields {
  shortDescription: string;
  description: string;
  justification: string;
  riskImpact: string;
}

export interface UseAiAssistResult {
  isUnlocked: boolean;
  /** Hashes the passphrase and compares it to the stored digest. Sets isUnlocked on success. */
  verifyPassphrase: (passphrase: string) => Promise<boolean>;
  /** Builds a prompt string the user can paste into AI Assist to generate all four CHG fields. */
  buildPrompt: (
    selectedIssues: JiraIssue[],
    currentFields: AiAssistGeneratedFields,
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

function buildIssueDetailText(selectedIssues: JiraIssue[]): string {
  if (selectedIssues.length === 0) {
    return '(no issue details available)';
  }
  return selectedIssues
    .map((issue) => buildIssueDetailLines(issue).join('\n'))
    .join('\n\n');
}

/**
 * Builds the complete prompt text to paste into AI Assist.
 * Any currently-populated CHG fields are included so AI Assist can refine them.
 */
function buildAiAssistPromptText(selectedIssues: JiraIssue[], currentFields: AiAssistGeneratedFields): string {
  const issueListText = buildIssueListText(selectedIssues);
  const issueDetailText = buildIssueDetailText(selectedIssues);

  // Only include existing content if at least one field is non-empty.
  const existingContent = [
    currentFields.shortDescription && `Current Short Description: ${currentFields.shortDescription}`,
    currentFields.description      && `Current Description: ${currentFields.description}`,
    currentFields.justification    && `Current Justification: ${currentFields.justification}`,
    currentFields.riskImpact       && `Current Risk & Impact: ${currentFields.riskImpact}`,
  ].filter(Boolean).join('\n');

  return [
    'You are assisting with a ServiceNow Change Request for a planned software release.',
    '',
    'Jira issues included in this release:',
    issueListText,
    '',
    'Jira issue details for better CHG drafting:',
    issueDetailText,
    '',
    existingContent ? `Existing content to refine:\n${existingContent}\n` : '',
    'Generate the following four CHG fields. Respond ONLY in this exact format with no extra commentary:',
    '',
    'SHORT_DESCRIPTION: [one-line summary under 100 characters]',
    'DESCRIPTION: [multi-line description of what is being deployed and why]',
    'JUSTIFICATION: [business justification for this change]',
    'RISK_AND_IMPACT: [risk assessment and business impact analysis]',
  ].join('\n');
}

// Maps each deterministic response marker to the CHG field it populates. The
// prompt forces AI Assist to emit exactly these markers, so parsing is reliable.
const AI_ASSIST_RESPONSE_MARKERS: ReadonlyArray<{ marker: string; field: keyof AiAssistGeneratedFields }> = [
  { marker: 'SHORT_DESCRIPTION', field: 'shortDescription' },
  { marker: 'DESCRIPTION',       field: 'description' },
  { marker: 'JUSTIFICATION',     field: 'justification' },
  { marker: 'RISK_AND_IMPACT',   field: 'riskImpact' },
];

/**
 * Parses AI Assist's deterministic "KEY: value" response into the four CHG fields.
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

  for (let markerIndex = 0; markerIndex < AI_ASSIST_RESPONSE_MARKERS.length; markerIndex += 1) {
    const { marker, field } = AI_ASSIST_RESPONSE_MARKERS[markerIndex];
    const laterMarkers = AI_ASSIST_RESPONSE_MARKERS.slice(markerIndex + 1).map((entry) => entry.marker);
    // Stop at the next known marker OR end of input — so a value works whether or
    // not later markers are present in the response.
    const stopAhead = laterMarkers.length > 0 ? `(?=\\n\\s*(?:${laterMarkers.join('|')})\\s*:|$)` : '$';
    const fieldRegExp = new RegExp(`(?:^|\\n)\\s*${marker}\\s*:\\s*([\\s\\S]*?)${stopAhead}`, 'i');

    const match = responseText.match(fieldRegExp);
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
  ): string => {
    return buildAiAssistPromptText(selectedIssues, currentFields);
  }, []);

  return { isUnlocked, verifyPassphrase, buildPrompt };
}
