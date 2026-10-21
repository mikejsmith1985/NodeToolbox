// AiWriteStep.tsx — The one AI step: part 1, the AI writes the change; part 2, the same checks Release Management makes,
// with one AI round that rewrites whatever they flag.
//
// These used to be two steps ("Let AI write it", then "Make it pass review"), two AI moments the user had to tell apart
// (owner feedback). One screen now holds both, in order: part 1 folds away once the plans are written, and part 2 is
// the live checklist with its "Fix all with AI" round — the same pieces as before, side by side.

import type { ReadinessItem } from '../../../views/SnowHub/guided/changeReadiness.ts';
import type { SnowChoiceOptionMap } from '../../../views/SnowHub/hooks/useSnowChoiceOptions.ts';
import { aiDraftPromptFor } from '../aiDraft.ts';
import { readPlanningGaps } from '../changeDraft.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';
import AiDraftStep from './AiDraftStep.tsx';
import AiEnhanceStep from './AiEnhanceStep.tsx';

/** The step needs the live checklist and the changes already in ServiceNow, for the prompts. */
export interface AiWriteStepProps extends ChangeStepProps {
  choiceOptions: SnowChoiceOptionMap;
  items: ReadinessItem[] | null;
  createdChangeLines: readonly string[];
}

/** Step: the AI writes the change, then makes it pass review — one screen, two numbered parts. */
export default function AiWriteStep({ items, createdChangeLines, ...stepProps }: AiWriteStepProps) {
  const hasAllPlans = readPlanningGaps(stepProps.crg.state).length === 0;
  return (
    <div>
      <details className={styles.card} open={!hasAllPlans}>
        <summary className={styles.cardTitle}>{hasAllPlans ? '1 · AI writes it ✓ (open to write it again)' : '1 · AI writes it'}</summary>
        <AiDraftStep {...stepProps} buildPrompt={aiDraftPromptFor(createdChangeLines)} />
      </details>
      <section className={styles.card} aria-labelledby="pass-review-heading">
        <h3 id="pass-review-heading" className={styles.cardTitle}>2 · Make it pass review</h3>
        {hasAllPlans
          ? <AiEnhanceStep {...stepProps} items={items} createdChangeLines={createdChangeLines} />
          : <p className={styles.hint}>Do part 1 first. Once the three plans are written, the checks Release Management makes show here, with one AI round to fix them all.</p>}
      </section>
    </div>
  );
}
