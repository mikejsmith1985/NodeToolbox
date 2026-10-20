// SuggestionList.tsx — Each proposed rewrite beside the current text, with Accept / Decline per item (propose-only).
//
// Nothing is written until the user accepts. An accepted text is written as the user's own — it carries no mark
// that an AI wrote it (FR-008).

import { useState } from 'react';

import type { FieldSuggestion } from './aiRounds.ts';
import styles from './ChangeWizard.module.css';

type SuggestionDecision = 'accepted' | 'declined';

interface SuggestionListProps {
  suggestions: readonly FieldSuggestion[];
  onAccept: (suggestion: FieldSuggestion) => void;
}

/** The suggestions, each decided once. */
export default function SuggestionList({ suggestions, onAccept }: SuggestionListProps) {
  const [decisions, setDecisions] = useState<Record<string, SuggestionDecision>>({});

  function decide(suggestion: FieldSuggestion, decision: SuggestionDecision) {
    if (decision === 'accepted') onAccept(suggestion);
    setDecisions((previousDecisions) => ({ ...previousDecisions, [suggestion.fieldKey]: decision }));
  }

  if (suggestions.length === 0) return null;
  return (
    <ul className={styles.itemList} aria-label="Suggested changes">
      {suggestions.map((suggestion) => (
        <li key={suggestion.fieldKey} className={styles.card}>
          <h4 className={styles.cardTitle}>{suggestion.fieldLabel}</h4>
          <div className={styles.compareGrid}>
            <div><p className={styles.hint}>Now</p><p className={styles.compareText}>{suggestion.currentText || '(empty)'}</p></div>
            <div><p className={styles.hint}>Suggested</p><p className={styles.compareText}>{suggestion.suggestedText}</p></div>
          </div>
          {decisions[suggestion.fieldKey] ? (
            <p className={styles.hint}>{decisions[suggestion.fieldKey] === 'accepted' ? '✓ Accepted' : 'Declined — left as it was'}</p>
          ) : (
            <div className={styles.buttonRow}>
              <button type="button" className={styles.actionButton} onClick={() => decide(suggestion, 'accepted')}>Accept</button>
              <button type="button" className={styles.secondaryButton} onClick={() => decide(suggestion, 'declined')}>Decline</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
