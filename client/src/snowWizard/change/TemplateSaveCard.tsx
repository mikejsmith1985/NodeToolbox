// TemplateSaveCard.tsx — "Save the picks as a template (optional)": this change's picks (never its writing or dates),
// saved into the template it was opened from or as a new one.
//
// Shown at the end of the picking steps and again on the last step. Owner feedback: saving only on the very last step,
// after the change was created, meant the option was never seen.

import type { ChangeStepProps } from './changeWizardSession.ts';
import styles from './ChangeWizard.module.css';
import SaveTemplateControl from './SaveTemplateControl.tsx';
import { buildPicksOnlyDraft, TEMPLATE_KEEPS_TEXT } from './templatePicks.ts';
import type { TemplateLibrary } from './useTemplateLibrary.ts';

/** What the card needs: the change, its job (for the linked template) and the template library. */
export type TemplateSaveCardProps = Pick<ChangeStepProps, 'crg' | 'session' | 'updateSession'> & { library: TemplateLibrary };

/** Saves this change's picks as a template — updating the one it was opened from, or as a new one. */
export default function TemplateSaveCard({ crg, session, updateSession, library }: TemplateSaveCardProps) {
  return (
    <section className={styles.card} aria-labelledby="template-save-heading">
      <h3 id="template-save-heading" className={styles.cardTitle}>Save the picks as a template (optional)</h3>
      <p className={styles.hint}>{TEMPLATE_KEEPS_TEXT}</p>
      {session.linkedTemplate ? <p className={styles.hint}>{`This change was opened from “${session.linkedTemplate.name}”.`}</p> : null}
      <SaveTemplateControl draft={buildPicksOnlyDraft(crg.state)} library={library} linkedTemplate={session.linkedTemplate} onLinkTemplate={(linkedTemplate) => updateSession({ linkedTemplate })} />
    </section>
  );
}
