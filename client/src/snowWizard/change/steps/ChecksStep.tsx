// ChecksStep.tsx — Step 9 "Will it pass review?": every Release Management check, each with one fix.
//
// The verdicts are 039's shared engine (the same ones the Review job shows). A failing check says what is wrong and
// offers one button that returns to the step that fixes it; writing gaps can also go to a propose-only AI fix round.
// "Could not check" is never a pass: it holds Create until the user says they understand and want to go on.

import { useMemo, useState } from 'react';

import { isReady, type ReadinessItem, type ReadinessItemState } from '../../../views/SnowHub/guided/changeReadiness.ts';
import { buildChecksFixPrompt, readFixReply, type FieldSuggestion } from '../aiRounds.ts';
import { applyChangeTextField } from '../changeDraft.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';
import { resolveFixStepId } from '../draftReadinessFacts.ts';
import PromptRound from '../PromptRound.tsx';
import SuggestionList from '../SuggestionList.tsx';

/** The checks also need the checklist, built once for the whole job. */
export interface ChecksStepProps extends ChangeStepProps {
  items: ReadinessItem[] | null;
}

/** Each state in words, so it never depends on colour. */
const STATE_WORDS: Readonly<Record<ReadinessItemState, string>> = {
  done: 'Done',
  needsAction: 'Needs action',
  notApplicable: 'Not needed',
  couldNotCheck: 'Could not check',
};

/** One check: its state, its reason, and its one fix. */
function CheckLine({ item, onFix }: { item: ReadinessItem; onFix: (item: ReadinessItem) => void }) {
  return (
    <li className={styles.checkItem}>
      <div className={styles.checkHeader}>
        <span className={styles.statePill} data-state={item.state}>{STATE_WORDS[item.state]}</span>
        <span>{item.label}</span>
      </div>
      <p className={styles.hint}>{item.reason}</p>
      {item.state === 'needsAction' && item.action ? (
        <div className={styles.buttonRow}>
          <button type="button" className={styles.secondaryButton} onClick={() => onFix(item)}>{item.action.label}</button>
        </div>
      ) : null}
    </li>
  );
}

/** The propose-only AI round for the checks a rewrite of the writing can close. */
function WritingFixRound({ crg, items }: Pick<ChecksStepProps, 'crg'> & { items: ReadinessItem[] }) {
  const [suggestions, setSuggestions] = useState<FieldSuggestion[]>([]);
  const promptText = useMemo(() => buildChecksFixPrompt(crg.state, items), [crg.state, items]);
  if (promptText === null) return null;
  return (
    <details className={styles.moreOptions}>
      <summary>Ask AI to fix the writing</summary>
      <PromptRound promptText={promptText} copyLabel="Copy the fix prompt" readButtonLabel="Read the reply" onReadReply={(replyText) => {
        const readSuggestions = readFixReply(replyText, crg.state);
        setSuggestions(readSuggestions);
        return readSuggestions.length > 0 ? `${readSuggestions.length} suggested change(s) — accept or decline each one.` : 'That reply held no rewritten text to offer.';
      }} />
      <SuggestionList suggestions={suggestions} onAccept={(suggestion) => applyChangeTextField(crg.actions, suggestion.fieldKey, suggestion.suggestedText)} />
    </details>
  );
}

/** The "go on anyway" acknowledgement, shown only while something is not done. */
function Acknowledgement({ items, session, updateSession }: Pick<ChecksStepProps, 'session' | 'updateSession'> & { items: ReadinessItem[] }) {
  const hasUnchecked = items.some((item) => item.state === 'couldNotCheck');
  return (
    <div className={styles.card}>
      {hasUnchecked ? <p className={styles.noticeText}>Some checks could not be made. Create stays locked until you tick the box below.</p> : null}
      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={session.areChecksAcknowledged} onChange={(changeEvent) => updateSession({ areChecksAcknowledged: changeEvent.target.checked })} />
        I understand these are not all done, and Release Management may send the change back. Go on anyway.
      </label>
    </div>
  );
}

/**
 * When the AI review is the only check left and it has already been run, say so: an AI review rarely answers
 * "ready", so without this the checks kept sending people back to step 6 (owner feedback).
 */
function readOnlyAiReviewLeftNote(items: readonly ReadinessItem[], session: ChecksStepProps['session']): string | null {
  const needsActionIds = items.filter((item) => item.state === 'needsAction').map((item) => item.id);
  const reviewLoop = session.reviewLoop;
  if (needsActionIds.length !== 1 || needsActionIds[0] !== 'riskCheck' || !reviewLoop?.latestReview) return null;
  const roundCount = reviewLoop.roundNumber;
  return `Only the AI review is left — you have run it ${roundCount} ${roundCount === 1 ? 'time' : 'times'}. Its suggestions are optional: tick “Go on anyway” below to continue.`;
}

/** Step 9: the Release Management checks. */
export default function ChecksStep({ crg, session, updateSession, goToStep, items }: ChecksStepProps) {
  if (items === null) return <p className={styles.hint} role="status">Checking your change…</p>;
  const needsActionCount = items.filter((item) => item.state === 'needsAction').length;
  const isAllReady = isReady(items);
  const aiReviewLeftNote = readOnlyAiReviewLeftNote(items, session);
  return (
    <div>
      <p className={styles.stepIntro}>These are the checks Release Management makes before approving a change.</p>
      {isAllReady
        ? <p className={styles.successText}>Everything that applies is done. This change should pass review.</p>
        : <p className={styles.noticeText}>{aiReviewLeftNote ?? `${needsActionCount} check(s) need action. Each one has a button that takes you to the fix.`}</p>}
      <ul className={styles.itemList} aria-label="Checks">
        {items.map((item) => <CheckLine key={item.id} item={item} onFix={(fixItem) => fixItem.action && goToStep(resolveFixStepId(fixItem.action))} />)}
      </ul>
      <WritingFixRound crg={crg} items={items} />
      {isAllReady ? null : <Acknowledgement items={items} session={session} updateSession={updateSession} />}
    </div>
  );
}
