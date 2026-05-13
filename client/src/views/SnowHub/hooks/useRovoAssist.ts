// useRovoAssist.ts — Hidden AI-assisted content generation for CHG field population.
// Activated through a keyboard shortcut and a passphrase gate.
// No external documentation — internal capability only.

import { useCallback, useState } from 'react';

import type { JiraIssue } from '../../../types/jira.ts';

// SHA-256 hex digest of the activation passphrase.
// The raw passphrase is never stored in source — only the digest is kept.
// To reproduce: node -e "const c=require('crypto');console.log(c.createHash('sha256').update('<passphrase>').digest('hex'))"
const ACTIVATION_DIGEST = '1ee58081238835ff0f8120a9c2fe8dbf480a124fb090ad9b78842f4d585ea713';

/** The four CHG text fields that Rovo AI can populate. */
export interface RovoGeneratedFields {
  shortDescription: string;
  description: string;
  justification: string;
  riskImpact: string;
}

export interface UseRovoAssistResult {
  isUnlocked: boolean;
  isGenerating: boolean;
  generationError: string | null;
  /** Hashes the passphrase and compares it to the stored digest. Sets isUnlocked on success. */
  verifyPassphrase: (passphrase: string) => Promise<boolean>;
  /** Sends selected issues and existing field content to the server-side Rovo endpoint. */
  generateChgFields: (
    selectedIssues: JiraIssue[],
    currentFields: RovoGeneratedFields,
  ) => Promise<RovoGeneratedFields | null>;
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
 * that the server sends to the Rovo API as part of the generation prompt.
 */
function buildIssueListText(selectedIssues: JiraIssue[]): string {
  if (selectedIssues.length === 0) {
    return '(no issues selected)';
  }
  return selectedIssues
    .map((issue) => `[${issue.key}] ${issue.fields.summary}`)
    .join('\n');
}

/**
 * Provides passphrase-gated AI assistance for populating CHG content fields.
 * The caller must successfully verify the passphrase before generation is available.
 *
 * @returns Unlock state, generation state, and action functions.
 */
export function useRovoAssist(): UseRovoAssistResult {
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const verifyPassphrase = useCallback(async (passphrase: string): Promise<boolean> => {
    const inputDigest = await computeSha256Hex(passphrase);
    const isPassphraseCorrect = inputDigest === ACTIVATION_DIGEST;

    if (isPassphraseCorrect) {
      setIsUnlocked(true);
    }

    return isPassphraseCorrect;
  }, []);

  const generateChgFields = useCallback(async (
    selectedIssues: JiraIssue[],
    currentFields: RovoGeneratedFields,
  ): Promise<RovoGeneratedFields | null> => {
    setIsGenerating(true);
    setGenerationError(null);

    try {
      const issueListText = buildIssueListText(selectedIssues);

      const response = await fetch('/api/rovo/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          issueList:        issueListText,
          shortDescription: currentFields.shortDescription,
          description:      currentFields.description,
          justification:    currentFields.justification,
          riskImpact:       currentFields.riskImpact,
        }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({ message: 'Unknown server error' }));
        const errorMessage = (errorPayload as { message?: string }).message ?? `Server returned ${response.status}`;
        throw new Error(errorMessage);
      }

      return await response.json() as RovoGeneratedFields;
    } catch (unknownError) {
      const errorMessage = unknownError instanceof Error ? unknownError.message : 'Generation failed';
      setGenerationError(errorMessage);
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  return { isUnlocked, isGenerating, generationError, verifyPassphrase, generateChgFields };
}
