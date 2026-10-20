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

/**
 * "write" fills empty fields from the Jira work (step 2 and the folded panels); "polish" improves what is already
 * written the way Release Management will read it (step 6). Same round either way: one prompt, one reply, every
 * proposed change shown as Now / AI suggests, applied in place with one button.
 */
export type AiDraftPurpose = 'write' | 'polish';

/** The shared step props, plus what the round is for. */
export interface AiDraftStepProps extends ChangeStepProps {
  purpose?: AiDraftPurpose;
  /** Builds the prompt from the draft; defaults to the seven-field writing prompt. */
  buildPrompt?: (draft: ChangeStepProps['crg']['state']) => string;
}

const PURPOSE_WORDS: Readonly<Record<AiDraftPurpose, { intro: string; applyVerb: string; doneVerb: string }>> = {
  write: {
    intro: 'Optional, and the quickest way through. Your AI assistant writes the title, description, justification, risk '
      + 'and the three plans from the Jira work you chose. Your dropdown choices stay as they are. You check everything on '
      + 'the next screens, or skip this step and type it yourself.',
    applyVerb: 'Fill in',
    doneVerb: 'Filled in',
  },
  polish: {
    intro: 'Optional. Your AI assistant reads everything you wrote the way Release Management will, and rewrites what '
      + 'would not pass. You see each change next to what is there now, and one button applies them all right here.',
    applyVerb: 'Apply',
    doneVerb: 'Applied',
  },
};

/** "1 field", "3 fields". */
function countFields(fieldCount: number): string {
  return `${fieldCount} ${fieldCount === 1 ? 'field' : 'fields'}`;
}

/** One proposed change: what is there now beside what the AI suggests (just the suggestion when the field is empty). */
function SuggestionComparison({ suggestion }: { suggestion: AiDraftReply['suggestions'][number] }) {
  if (!suggestion.currentText.trim()) return <p className={styles.compareText}>{suggestion.suggestedText}</p>;
  return (
    <div className={styles.compareGrid}>
      <div><p className={styles.hint}>Now</p><p className={styles.compareText}>{suggestion.currentText}</p></div>
      <div><p className={styles.hint}>AI suggests</p><p className={styles.compareText}>{suggestion.suggestedText}</p></div>
    </div>
  );
}

/** The suggestions with a tick each, and one button that fills in the ticked ones. */
function SuggestionPicker({ draftReply, applyVerb, onFill }: { draftReply: AiDraftReply; applyVerb: string; onFill: (suggestionIds: string[]) => void }) {
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
              <span><strong>{suggestion.fieldLabel}</strong></span>
            </label>
            <SuggestionComparison suggestion={suggestion} />
          </li>
        ))}
      </ul>
      <div className={styles.buttonRow}>
        <button type="button" className={styles.actionButton} disabled={tickedIds.length === 0} onClick={() => onFill(tickedIds)}>
          {`${applyVerb} ${countFields(tickedIds.length)}`}
        </button>
      </div>
    </div>
  );
}

/** Step: let the AI write the change from the chosen Jira work. */
export default function AiDraftStep({ crg, purpose = 'write', buildPrompt = buildAiDraftPrompt }: AiDraftStepProps) {
  const words = PURPOSE_WORDS[purpose];
  const [draftReply, setDraftReply] = useState<AiDraftReply | null>(null);
  const [filledCount, setFilledCount] = useState<number | null>(null);
  const promptText = useMemo(() => buildPrompt(crg.state), [buildPrompt, crg.state]);

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
      <p className={styles.stepIntro}>{words.intro}</p>
      <PromptRound promptText={promptText} copyLabel="Copy the prompt" readButtonLabel="Read the reply" onReadReply={handleReadReply} />
      {draftReply && draftReply.suggestions.length > 0 ? <SuggestionPicker draftReply={draftReply} applyVerb={words.applyVerb} onFill={fillTicked} /> : null}
      {filledCount !== null ? (
        <p className={styles.successText} role="status">{`✓ ${words.doneVerb} ${countFields(filledCount)}. Press Next to go on.`}</p>
      ) : null}
    </div>
  );
}
