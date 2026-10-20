// AiDraftStep.tsx — Step "Let AI write it" (optional, right after choosing the Jira work): copy one prompt, paste the
// reply, and fill in every text and pick-from-a-list answer at once instead of typing them.
//
// Visible to everyone (no AI unlock in the Wizard). Every suggestion starts ticked; the user can untick any, and only
// the ticked ones are written, through the same setters the screens use. Filled values carry no AI mark (FR-008).

import { useMemo, useState } from 'react';

import { buildAiDraftPrompt, readAiDraftReply, type AiDraftReply } from '../aiDraft.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';
import PromptRound from '../PromptRound.tsx';

/** The AI draft needs only the shared step props (it writes texts, never list values). */
export type AiDraftStepProps = ChangeStepProps;

/** The suggestions with a tick each, and one button that fills in the ticked ones. */
function SuggestionPicker({ draftReply, onFill }: { draftReply: AiDraftReply; onFill: (suggestionIds: string[]) => void }) {
  const [untickedIds, setUntickedIds] = useState<ReadonlySet<string>>(new Set());
  const tickedIds = draftReply.suggestions.map((suggestion) => suggestion.suggestionId).filter((suggestionId) => !untickedIds.has(suggestionId));

  function toggle(suggestionId: string) {
    setUntickedIds((previousIds) => {
      const nextIds = new Set(previousIds);
      if (nextIds.has(suggestionId)) nextIds.delete(suggestionId); else nextIds.add(suggestionId);
      return nextIds;
    });
  }

  return (
    <div className={styles.card}>
      <ul className={styles.itemList} aria-label="What the AI will fill in">
        {draftReply.suggestions.map((suggestion) => (
          <li key={suggestion.suggestionId}>
            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={!untickedIds.has(suggestion.suggestionId)} onChange={() => toggle(suggestion.suggestionId)} />
              <span><strong>{suggestion.fieldLabel}</strong>{suggestion.currentText ? ' (replaces what is there now)' : ''}</span>
            </label>
            <p className={styles.compareText}>{suggestion.suggestedText}</p>
          </li>
        ))}
      </ul>
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} disabled={tickedIds.length === 0} onClick={() => onFill(tickedIds)}>
          {`Fill in ${tickedIds.length} ${tickedIds.length === 1 ? 'field' : 'fields'}`}
        </button>
      </div>
    </div>
  );
}

/** Step: let the AI write the change from the chosen Jira work. */
export default function AiDraftStep({ crg }: AiDraftStepProps) {
  const [draftReply, setDraftReply] = useState<AiDraftReply | null>(null);
  const [filledCount, setFilledCount] = useState<number | null>(null);
  const promptText = useMemo(() => buildAiDraftPrompt(crg.state), [crg.state]);

  function handleReadReply(replyText: string): string {
    const readReply = readAiDraftReply(replyText, crg.state);
    setFilledCount(null);
    setDraftReply(readReply.isUsable ? readReply : null);
    return readReply.message;
  }

  function fillTicked(suggestionIds: string[]) {
    draftReply?.suggestions.filter((suggestion) => suggestionIds.includes(suggestion.suggestionId)).forEach((suggestion) => suggestion.apply(crg.actions));
    setFilledCount(suggestionIds.length);
    setDraftReply(null);
  }

  return (
    <div>
      <p className={styles.stepIntro}>
        Optional, and the quickest way through. Your AI assistant writes the title, description, justification, risk
        and the three plans from the Jira work you chose. Your dropdown choices stay as they are. You check everything
        on the next screens, or skip this step and type it yourself.
      </p>
      <PromptRound promptText={promptText} copyLabel="Copy the prompt" readButtonLabel="Read the reply" onReadReply={handleReadReply} />
      {draftReply && draftReply.suggestions.length > 0 ? <SuggestionPicker draftReply={draftReply} onFill={fillTicked} /> : null}
      {filledCount !== null ? (
        <p className={styles.successText} role="status">{`✓ Filled in ${filledCount} ${filledCount === 1 ? 'field' : 'fields'}. Press Next to check them.`}</p>
      ) : null}
    </div>
  );
}
