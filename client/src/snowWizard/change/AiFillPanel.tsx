// AiFillPanel.tsx — "Don't want to type this? Let AI write it", offered right on the screens that need typing.
//
// The same round as the "Let AI write it" step (one prompt, paste the reply, fill in the ticked fields), folded into a
// panel so the AI is never more than one click away from a field the user would rather not write by hand.

import type { AiDraftStepProps } from './steps/AiDraftStep.tsx';
import AiDraftStep from './steps/AiDraftStep.tsx';
import styles from './ChangeWizard.module.css';

interface AiFillPanelProps extends AiDraftStepProps {
  /** Opens the panel on arrival — used while the screen still has empty fields. */
  isOpenAtStart: boolean;
}

/** The folded AI round, headed in plain words. */
export default function AiFillPanel({ isOpenAtStart, ...stepProps }: AiFillPanelProps) {
  return (
    <details className={styles.moreOptions} open={isOpenAtStart}>
      <summary>✨ Don&apos;t want to type this? Let AI write it</summary>
      <AiDraftStep {...stepProps} />
    </details>
  );
}
