// AiEnhanceStep.tsx — Step 5 "Make it better with AI" (optional): copy a review prompt, paste the reply, accept or decline each fix.
//
// Visible to everyone — the Wizard has no AI unlock (spec clarification). The prompt is Toolbox's own Release Manager
// review; nothing is sent automatically, nothing is written until accepted, and accepted text carries no AI mark.

import { useMemo, useState } from 'react';

import { buildEnhancePrompt, readEnhanceReply, type EnhanceReply } from '../aiRounds.ts';
import { applyChangeTextField } from '../changeDraft.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';
import PromptRound from '../PromptRound.tsx';
import SuggestionList from '../SuggestionList.tsx';

/** The reviewer's verdict in plain words. */
function VerdictLine({ isReady }: { isReady: boolean }) {
  return isReady
    ? <p className={styles.successText}>The review says this change is ready for approval.</p>
    : <p className={styles.noticeText}>The review found things to improve before approval.</p>;
}

/** Step 5: an optional AI review of the whole change. */
export default function AiEnhanceStep({ crg, updateSession }: ChangeStepProps) {
  const [enhanceReply, setEnhanceReply] = useState<EnhanceReply | null>(null);
  const promptText = useMemo(() => buildEnhancePrompt(crg.state), [crg.state]);

  function handleReadReply(replyText: string): string {
    const readReply = readEnhanceReply(replyText, crg.state);
    if (readReply.isUsable) {
      setEnhanceReply(readReply);
      updateSession({ riskReview: { isReady: readReply.isReady } });
    }
    return readReply.message;
  }

  return (
    <div>
      <p className={styles.stepIntro}>
        Optional. Ask your AI assistant to review this change the way Release Management will, then choose which
        suggestions to keep. You can skip this step.
      </p>
      <PromptRound promptText={promptText} copyLabel="Copy the review prompt" readButtonLabel="Read the reply" onReadReply={handleReadReply} />
      {enhanceReply ? <VerdictLine isReady={enhanceReply.isReady} /> : null}
      {enhanceReply && enhanceReply.gapLines.length > 0 ? (
        <ul className={styles.itemList} aria-label="What the review found">
          {enhanceReply.gapLines.map((gapLine) => <li key={gapLine} className={styles.hint}>{`• ${gapLine}`}</li>)}
        </ul>
      ) : null}
      {enhanceReply ? (
        <SuggestionList suggestions={enhanceReply.suggestions} onAccept={(suggestion) => applyChangeTextField(crg.actions, suggestion.fieldKey, suggestion.suggestedText)} />
      ) : null}
    </div>
  );
}
