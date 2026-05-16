// useRovoAssist.ts — Hidden AI-prompt generator for CHG field population.
// Activated through a keyboard shortcut and a passphrase gate.
// No external documentation — internal capability only.

import { useCallback, useState } from 'react';

import type { JiraIssue } from '../../../types/jira.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';

// SHA-256 hex digest of the activation passphrase.
// The raw passphrase is never stored in source — only the digest is kept.
// To reproduce: node -e "const c=require('crypto');console.log(c.createHash('sha256').update('<passphrase>').digest('hex'))"
const ACTIVATION_DIGEST = '1ee58081238835ff0f8120a9c2fe8dbf480a124fb090ad9b78842f4d585ea713';

/** The four CHG text fields that the generated prompt targets. */
export interface RovoGeneratedFields {
  shortDescription: string;
  description: string;
  justification: string;
  riskImpact: string;
}

export interface UseRovoAssistResult {
  isUnlocked: boolean;
  /** Hashes the passphrase and compares it to the stored digest. Sets isUnlocked on success. */
  verifyPassphrase: (passphrase: string) => Promise<boolean>;
  /** Builds a prompt string the user can paste into Rovo to generate all four CHG fields. */
  buildPrompt: (
    selectedIssues: JiraIssue[],
    currentFields: RovoGeneratedFields,
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
 * suitable for inclusion in an AI prompt.
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
 * Builds the complete prompt text to paste into Rovo.
 * Any currently-populated CHG fields are included so Rovo can refine them.
 */
function buildRovoPromptText(selectedIssues: JiraIssue[], currentFields: RovoGeneratedFields): string {
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

/**
 * Provides passphrase-gated prompt generation for populating CHG content fields.
 * Generates a prompt string the user pastes directly into Rovo — no API calls made.
 *
 * @returns Unlock state and action functions.
 */
export function useRovoAssist(): UseRovoAssistResult {
  const [isUnlocked, setIsUnlocked] = useState(false);

  const verifyPassphrase = useCallback(async (passphrase: string): Promise<boolean> => {
    const inputDigest = await computeSha256Hex(passphrase);
    const isPassphraseCorrect = inputDigest === ACTIVATION_DIGEST;

    if (isPassphraseCorrect) {
      setIsUnlocked(true);
    }

    return isPassphraseCorrect;
  }, []);

  const buildPrompt = useCallback((
    selectedIssues: JiraIssue[],
    currentFields: RovoGeneratedFields,
  ): string => {
    return buildRovoPromptText(selectedIssues, currentFields);
  }, []);

  return { isUnlocked, verifyPassphrase, buildPrompt };
}
