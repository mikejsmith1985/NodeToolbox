// SuggestionList.tsx — Each proposed rewrite beside the current text, with Accept / Decline per item (propose-only).
//
// Nothing is written until the user accepts. An accepted text is written as the user's own — it carries no mark
// that an AI wrote it (FR-008). The decisions can be kept by the caller (the review loop keeps them in the job's
// session, so they survive leaving the step); otherwise the list keeps them itself.

import { useState } from 'react';

import type { ChgTextFieldKey } from '../../views/SnowHub/chgFormula/formulaCard.ts';
import type { FieldSuggestion, SuggestionDecision } from './aiRounds.ts';
import styles from './ChangeWizard.module.css';

type DecisionMap = Partial<Record<ChgTextFieldKey, SuggestionDecision>>;

interface SuggestionListProps {
  suggestions: readonly FieldSuggestion[];
  onAccept: (suggestion: FieldSuggestion) => void;
  /** Decisions kept by the caller; when given, the caller records each new one through onDecide. */
  decisions?: DecisionMap;
  onDecide?: (suggestion: FieldSuggestion, decision: SuggestionDecision) => void;
  /** Records several decisions at once (Accept all) — needed when the caller keeps the decisions. */
  onDecideAll?: (suggestions: FieldSuggestion[], decision: SuggestionDecision) => void;
}

/** The suggestions, each decided once. */
export default function SuggestionList({ suggestions, onAccept, decisions, onDecide, onDecideAll }: SuggestionListProps) {
  const [ownDecisions, setOwnDecisions] = useState<DecisionMap>({});
  const shownDecisions = decisions ?? ownDecisions;

  function decide(suggestion: FieldSuggestion, decision: SuggestionDecision) {
    if (decision === 'accepted') onAccept(suggestion);
    if (onDecide) onDecide(suggestion, decision);
    else setOwnDecisions((previousDecisions) => ({ ...previousDecisions, [suggestion.fieldKey]: decision }));
  }

  // One click writes every fix still waiting — the owner wants all problems solved at once, not one at a time.
  function acceptAll() {
    const waitingSuggestions = suggestions.filter((suggestion) => !shownDecisions[suggestion.fieldKey]);
    waitingSuggestions.forEach(onAccept);
    if (onDecideAll) onDecideAll(waitingSuggestions, 'accepted');
    else if (!decisions) {
      setOwnDecisions((previousDecisions) => ({ ...previousDecisions, ...Object.fromEntries(waitingSuggestions.map((suggestion) => [suggestion.fieldKey, 'accepted'])) }));
    }
  }

  if (suggestions.length === 0) return null;
  const waitingCount = suggestions.filter((suggestion) => !shownDecisions[suggestion.fieldKey]).length;
  return (
    <>
    {waitingCount > 1 ? (
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} onClick={acceptAll}>{`Accept all ${waitingCount} fixes`}</button>
      </div>
    ) : null}
    <ul className={styles.itemList} aria-label="Suggested changes">
      {suggestions.map((suggestion) => (
        <li key={suggestion.fieldKey} className={styles.card}>
          <h4 className={styles.cardTitle}>{suggestion.fieldLabel}</h4>
          <div className={styles.compareGrid}>
            <div><p className={styles.hint}>Now</p><p className={styles.compareText}>{suggestion.currentText || '(empty)'}</p></div>
            <div><p className={styles.hint}>Suggested</p><p className={styles.compareText}>{suggestion.suggestedText}</p></div>
          </div>
          {shownDecisions[suggestion.fieldKey] ? (
            <p className={styles.hint}>{shownDecisions[suggestion.fieldKey] === 'accepted' ? '✓ Accepted' : 'Declined — left as it was'}</p>
          ) : (
            <div className={styles.buttonRow}>
              <button type="button" className={styles.actionButton} onClick={() => decide(suggestion, 'accepted')}>Accept</button>
              <button type="button" className={styles.secondaryButton} onClick={() => decide(suggestion, 'declined')}>Decline</button>
            </div>
          )}
        </li>
      ))}
    </ul>
    </>
  );
}
