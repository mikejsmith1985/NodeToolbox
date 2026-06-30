// LabelsInput.tsx — Comma-separated labels input that is case-sensitive, de-duplicates entries,
// and clearly flags labels Jira would reject (those containing spaces) instead of silently
// dropping them (FR-3.1, FR-3.2, FR-3.4).

import { useState } from 'react';

import { dedupeLabels, isValidLabel } from '../lib/labels.ts';
import styles from '../JiraTemplateMaker.module.css';

interface LabelsInputProps {
  id: string;
  value: string[];
  onChange: (labels: string[]) => void;
}

/** Splits raw input into valid (deduped) labels and the rejected tokens for messaging. */
function partitionLabels(rawText: string): { valid: string[]; rejected: string[] } {
  const tokens = rawText.split(',').map((token) => token.trim()).filter(Boolean);
  const valid = dedupeLabels(tokens.filter((token) => isValidLabel(token)));
  const rejected = tokens.filter((token) => !isValidLabel(token));
  return { valid, rejected };
}

/** Controlled labels editor keeping its own raw text so the user can type freely. */
export default function LabelsInput({ id, value, onChange }: LabelsInputProps) {
  const [rawText, setRawText] = useState<string>(value.join(', '));
  const [rejectedLabels, setRejectedLabels] = useState<string[]>([]);

  function handleChange(nextRawText: string): void {
    setRawText(nextRawText);
    const { valid, rejected } = partitionLabels(nextRawText);
    setRejectedLabels(rejected);
    onChange(valid);
  }

  return (
    <div>
      <input
        className={styles.input}
        id={id}
        onChange={(event) => handleChange(event.target.value)}
        placeholder="comma,separated,labels"
        type="text"
        value={rawText}
      />
      {rejectedLabels.length > 0 && (
        <p className={styles.unsupportedTag} role="alert">
          Labels can’t contain spaces — ignored: {rejectedLabels.join(', ')}
        </p>
      )}
    </div>
  );
}
