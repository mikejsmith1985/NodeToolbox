// StartFromCard.tsx — "Start from (optional)" on a new change's first step: open a saved template, or copy the picks
// from a change raised before. Either way only the picks come in — the writing is this change's own.
//
// This is the one place a template is opened (owner feedback: templates were scattered and it was unclear what they
// held). Each action says plainly what it did, or that it did not.

import { useEffect, useId, useState } from 'react';

import { useCrgTemplates } from '../../../views/SnowHub/hooks/useCrgTemplates.ts';
import { useCtaskTemplates } from '../../../views/SnowHub/hooks/useCtaskTemplates.ts';
import { applyChangeTextField, readChangeTextFields } from '../changeDraft.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';
import MyOpenChangesPicker from '../MyOpenChangesPicker.tsx';
import { buildPicksOnlyTemplate, keepTaskPicks, TEMPLATE_KEEPS_TEXT } from '../templatePicks.ts';

/** What the last "start from" did, said plainly. */
type StartResult = { kind: 'none' } | { kind: 'working'; text: string } | { kind: 'done'; text: string } | { kind: 'failed'; text: string };

// A ServiceNow change number: "CHG" and its digits.
const CHANGE_NUMBER_PATTERN = /^CHG\d+$/;

/** Opens a saved template onto the change: its picks only, and the job remembers it for "Update template". */
function TemplateOpener({ crg, updateSession, onResult }: Pick<ChangeStepProps, 'crg' | 'updateSession'> & { onResult: (result: StartResult) => void }) {
  const { templates } = useCrgTemplates();
  const { templates: ctaskTemplates } = useCtaskTemplates();
  const pickerId = useId();
  if (templates.length === 0) return <p className={styles.hint}>No saved templates yet — save one on the last step of a change.</p>;
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor={pickerId}>Open a saved template</label>
      <select id={pickerId} className={styles.selectField} value="" onChange={(changeEvent) => {
        const chosenTemplate = templates.find((template) => template.id === changeEvent.target.value);
        if (!chosenTemplate) return;
        crg.actions.applyTemplate(buildPicksOnlyTemplate(chosenTemplate, crg.state), ctaskTemplates.map(keepTaskPicks));
        updateSession({ linkedTemplate: { id: chosenTemplate.id, name: chosenTemplate.name } });
        onResult({ kind: 'done', text: `✓ Opened template “${chosenTemplate.name}” — its picks are filled in on the next steps.` });
      }}>
        <option value="">Choose…</option>
        {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
      </select>
    </div>
  );
}

/**
 * Copies the picks from a change raised before, with Toolbox's own clone (cloneFromChg reads the number from the
 * draft, so the number goes in first and the copy runs once it is there); its writing is then cleared.
 */
function useCopyPicksFromChange(crg: ChangeStepProps['crg'], onResult: (result: StartResult) => void) {
  const [pendingNumber, setPendingNumber] = useState('');
  const [isClearing, setIsClearing] = useState(false);
  const { cloneFromChg, setCloneChgNumber } = crg.actions;
  const cloneNumberInDraft = crg.state.cloneChgNumber;
  useEffect(() => {
    if (!pendingNumber || cloneNumberInDraft !== pendingNumber) return;
    const copiedNumber = pendingNumber;
    queueMicrotask(() => {
      setPendingNumber('');
      void cloneFromChg().then(() => setIsClearing(true)).catch(() => onResult({ kind: 'failed', text: `✗ Could not copy ${copiedNumber}.` }));
    });
  }, [pendingNumber, cloneNumberInDraft, cloneFromChg, onResult]);
  // Once the copy is in the draft, its writing and task descriptions go — only the picks stay.
  useEffect(() => {
    if (!isClearing || crg.state.isCloning) return;
    queueMicrotask(() => {
      setIsClearing(false);
      if (crg.state.cloneError) { onResult({ kind: 'failed', text: `✗ Nothing was copied: ${crg.state.cloneError}` }); return; }
      for (const fieldKey of Object.keys(readChangeTextFields(crg.state)) as Array<Parameters<typeof applyChangeTextField>[1]>) applyChangeTextField(crg.actions, fieldKey, '');
      for (const task of crg.state.changeTasks) crg.actions.updateChangeTask(task.id, keepTaskPicks(task));
      onResult({ kind: 'done', text: `✓ Copied the picks from ${crg.state.cloneChgNumber} — its writing and dates are left out, so this change gets its own.` });
    });
  }, [isClearing, crg, onResult]);
  return (changeNumber: string) => {
    onResult({ kind: 'working', text: `Copying the picks from ${changeNumber}…` });
    setPendingNumber(changeNumber);
    setCloneChgNumber(changeNumber);
  };
}

/** "Copy the picks from a change you raised before": type or pick its number. */
function ChangeCopier({ crg, onResult }: Pick<ChangeStepProps, 'crg'> & { onResult: (result: StartResult) => void }) {
  const numberFieldId = useId();
  const [typedNumber, setTypedNumber] = useState('');
  const copyPicks = useCopyPicksFromChange(crg, onResult);
  const changeNumber = typedNumber.trim().toUpperCase();
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor={numberFieldId}>Or copy the picks from a change you raised before</label>
      <div className={styles.buttonRow}>
        <input id={numberFieldId} className={styles.inputField} value={typedNumber} placeholder="CHG0012345" onChange={(changeEvent) => setTypedNumber(changeEvent.target.value)} />
        <button type="button" className={styles.secondaryButton} disabled={!CHANGE_NUMBER_PATTERN.test(changeNumber)} onClick={() => copyPicks(changeNumber)}>Copy its picks</button>
      </div>
      <MyOpenChangesPicker label="Or pick one of my open changes" onPick={setTypedNumber} />
    </div>
  );
}

/** The card itself: both ways to start, and what happened. */
export default function StartFromCard({ crg, updateSession }: Pick<ChangeStepProps, 'crg' | 'updateSession'>) {
  const [result, setResult] = useState<StartResult>({ kind: 'none' });
  return (
    <details className={styles.card} open>
      <summary className={styles.cardTitle}>Start from (optional)</summary>
      <p className={styles.hint}>{TEMPLATE_KEEPS_TEXT}</p>
      <TemplateOpener crg={crg} updateSession={updateSession} onResult={setResult} />
      <ChangeCopier crg={crg} onResult={setResult} />
      {result.kind === 'working' ? <p className={styles.hint} role="status">{result.text}</p> : null}
      {result.kind === 'done' ? <p className={styles.successText} role="status">{result.text}</p> : null}
      {result.kind === 'failed' ? <p className={styles.errorText} role="status">{result.text}</p> : null}
    </details>
  );
}
