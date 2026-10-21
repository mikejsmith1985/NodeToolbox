// WritingEditor.tsx — The change's seven pieces of writing as boxes the user can edit directly, whatever the AI wrote.
//
// Owner feedback: after AI Assist filled the text, there was nowhere to change it by hand before the change was created
// — the AI's text was only shown as "AI suggests". Every box here writes straight to the draft (the same writers the
// other steps use), so an edit is the change's text from then on.

import { useId } from 'react';

import { CHG_TEXT_FIELD_LABELS, type ChgTextFieldKey } from '../../views/SnowHub/chgFormula/formulaCard.ts';
import { applyChangeTextField, readChangeTextFields, type CrgHook } from './changeDraft.ts';
import styles from './ChangeWizard.module.css';

const FIELD_ORDER: readonly ChgTextFieldKey[] = ['shortDescription', 'description', 'justification', 'riskImpact', 'implementationPlan', 'testPlan', 'backoutPlan'];

/** One editable piece of writing. */
function WritingBox({ crg, fieldKey, text }: { crg: CrgHook; fieldKey: ChgTextFieldKey; text: string }) {
  const fieldId = useId();
  const isShortField = fieldKey === 'shortDescription';
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor={fieldId}>{CHG_TEXT_FIELD_LABELS[fieldKey]}</label>
      {isShortField
        ? <input id={fieldId} className={styles.inputField} value={text} onChange={(changeEvent) => applyChangeTextField(crg.actions, fieldKey, changeEvent.target.value)} />
        : <textarea id={fieldId} className={styles.textArea} value={text} onChange={(changeEvent) => applyChangeTextField(crg.actions, fieldKey, changeEvent.target.value)} />}
    </div>
  );
}

/** "Your change's writing — edit anything": all seven boxes, open by default. */
export default function WritingEditor({ crg, title = 'Your change’s writing — edit anything', isOpenAtStart = true }: { crg: CrgHook; title?: string; isOpenAtStart?: boolean }) {
  const fieldTexts = readChangeTextFields(crg.state);
  return (
    <details className={styles.card} open={isOpenAtStart}>
      <summary className={styles.cardTitle}>{title}</summary>
      <p className={styles.hint}>This is exactly what goes into ServiceNow. Change any of it by hand — your edits are kept.</p>
      {FIELD_ORDER.map((fieldKey) => <WritingBox key={fieldKey} crg={crg} fieldKey={fieldKey} text={fieldTexts[fieldKey]} />)}
    </details>
  );
}
