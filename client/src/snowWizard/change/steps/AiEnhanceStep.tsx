// AiEnhanceStep.tsx — Step 6 "Make it pass review": the SAME checks step 9 runs, live, and one AI round that rewrites
// the writing those checks flag — each change shown beside what is there now, applied right here with one button.
//
// This replaced an AI "review" whose verdict disagreed with step 9's rules (it said "ready", step 9 still said "needs
// action") and a round-by-round loop that sent people back through the wizard (owner feedback). There is now one
// judge — 039's readiness engine — so step 6 and step 9 can never disagree (surfaces agree by construction).

import { useCallback } from 'react';

import type { ReadinessItem } from '../../../views/SnowHub/guided/changeReadiness.ts';
import { buildAiDraftPrompt } from '../aiDraft.ts';
import { buildChecksFixPrompt } from '../aiRounds.ts';
import type { CrgDraftState } from '../changeDraft.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import { readStepTitle } from '../changeWizardSteps.ts';
import styles from '../ChangeWizard.module.css';
import { isWritingCheck, resolveFixStepId } from '../draftReadinessFacts.ts';
import AiDraftStep from './AiDraftStep.tsx';

/** Step 6 also needs the live checklist, built once for the whole job. */
export interface AiEnhanceStepProps extends ChangeStepProps {
  items: ReadinessItem[] | null;
  /** The changes already in ServiceNow, one line each, so the AI can quote their numbers. */
  createdChangeLines?: readonly string[];
}

const NO_CREATED_CHANGES: readonly string[] = [];

/** The checks still flagged, split into the ones the AI fixes and the ones that need a value from the user. */
function OpenChecks({ items, session, goToStep }: { items: ReadinessItem[] } & Pick<ChangeStepProps, 'session' | 'goToStep'>) {
  const openItems = items.filter((item) => item.state === 'needsAction');
  if (openItems.length === 0) return <p className={styles.successText}>Every check passes. Press Next to go on.</p>;
  const otherItems = openItems.filter((item) => !isWritingCheck(item));
  return (
    <div className={styles.card}>
      <p className={styles.noticeText}>{`${openItems.length} check(s) still need action — the same list "Will it pass review?" shows.`}</p>
      <ul className={styles.itemList} aria-label="Checks still open">
        {openItems.map((item) => <li key={item.id} className={styles.hint}>{`• ${item.label}: ${item.reason}`}</li>)}
      </ul>
      {otherItems.length > 0 ? (
        <>
          <p className={styles.hint}>These need a value from you, not writing:</p>
          <div className={styles.buttonRow}>
            {otherItems.map((item) => item.action ? (
              <button key={item.id} type="button" className={styles.secondaryButton} onClick={() => item.action && goToStep(resolveFixStepId(item.action), { shouldReturnHere: true })}>
                {`${item.label} → ${readStepTitle(resolveFixStepId(item.action), session.mode)}`}
              </button>
            ) : null)}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * "Fix all with AI": one prompt for every flagged piece of writing, and one button that applies every rewrite in
 * place — no per-check trips to other steps (owner feedback, GH #468). Shared by step 6 and step 9.
 */
export function FixAllWithAi({ items, createdChangeLines = NO_CREATED_CHANGES, ...stepProps }: ChangeStepProps & { items: ReadinessItem[]; createdChangeLines?: readonly string[] }) {
  // The prompt targets exactly the writing the checks flag; with none flagged it polishes the writing as a whole.
  const buildPrompt = useCallback(
    (draft: CrgDraftState) => buildChecksFixPrompt(draft, items, createdChangeLines) ?? buildAiDraftPrompt(draft, createdChangeLines),
    [items, createdChangeLines],
  );
  return <AiDraftStep {...stepProps} purpose="polish" buildPrompt={buildPrompt} />;
}

/** Step 6: make the change pass the checks, in one round. */
export default function AiEnhanceStep({ items, createdChangeLines, ...stepProps }: AiEnhanceStepProps) {
  if (items === null) return <p className={styles.hint} role="status">Checking your change…</p>;
  return (
    <div>
      <OpenChecks items={items} session={stepProps.session} goToStep={stepProps.goToStep} />
      <FixAllWithAi {...stepProps} items={items} createdChangeLines={createdChangeLines} />
    </div>
  );
}
