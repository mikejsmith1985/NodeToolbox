// RiskCheckSection.tsx — Toolbox's own Risk Check, run on the real ticket: the change and every one of its CTASKs.
//
// The owner asked for Toolbox's AI interaction, unchanged, just guided. This mounts Toolbox's ExistingChgRiskCheck
// (the Modify CHG check: one prompt per round covering the change and its tasks, a review with gaps, a fix round, and
// CTASK backout plans written to ServiceNow on request). Change-field fixes land in this job's draft and are written
// by "Save to ServiceNow", exactly as Modify CHG's are written by its Save.

import { useEffect, useId, useMemo, useState } from 'react';

import type { ChgTextFieldKey } from '../../../views/SnowHub/chgFormula/formulaCard.ts';
import { ExistingChgRiskCheck } from '../../../views/SnowHub/tabs/ExistingChgRiskCheck.tsx';
import { buildWizardPromptContext } from '../aiRounds.ts';
import { applyChangeTextField, DRAFT_ENVIRONMENTS, readChangeTextFields, readEnabledPlanEnvironments, type CrgDraftState } from '../changeDraft.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';
import type { PlanEnvironmentKey } from '../ctaskEnvironmentPlan.ts';
import { fetchChangeForModify } from '../modifyLoad.ts';

/** One change the check can run on. */
interface RiskCheckTarget {
  changeNumber: string;
  environmentLabel: PlanEnvironmentKey | null;
  /** Known for a loaded change; looked up by number otherwise. */
  changeSysId?: string;
}

const PRODUCTION_LABELS: readonly (PlanEnvironmentKey | null)[] = ['PRD', 'PFIX'];

/**
 * The changes the check can run on: a new change's created ones (Production first — it is held to the most rules),
 * or the change a modify loaded. Empty before anything exists in ServiceNow.
 */
function listRiskCheckTargets(session: ChangeStepProps['session'], draft: CrgDraftState): RiskCheckTarget[] {
  if (session.mode === 'modify') {
    return session.modify ? [{ changeNumber: session.modify.changeNumber, environmentLabel: readEnabledPlanEnvironments(draft)[0] ?? null, changeSysId: session.modify.changeSysId }] : [];
  }
  const targets = session.createdChanges.map((createdChange) => ({ changeNumber: createdChange.changeNumber, environmentLabel: createdChange.environmentLabel }));
  return [...targets].sort((first, second) => Number(PRODUCTION_LABELS.includes(second.environmentLabel)) - Number(PRODUCTION_LABELS.includes(first.environmentLabel)));
}

/** The configuration item the change on this environment carries: its own, else the change's. */
function readTargetConfigItem(draft: CrgDraftState, environmentLabel: PlanEnvironmentKey | null) {
  const environment = DRAFT_ENVIRONMENTS.find(({ label }) => label === environmentLabel);
  const environmentItem = environment ? draft[environment.stateKey].configItem : null;
  return environmentItem?.sysId ? environmentItem : draft.chgBasicInfo.configItem;
}

/** The change's id, looked up by number when the job does not hold it. */
function useTargetSysId(target: RiskCheckTarget | undefined) {
  const [answer, setAnswer] = useState<{ changeNumber: string; changeSysId: string; failureText: string } | null>(null);
  const targetNumber = target?.changeNumber ?? '';
  const knownSysId = target?.changeSysId ?? '';
  useEffect(() => {
    if (targetNumber === '' || knownSysId !== '') return undefined;
    let isCurrent = true;
    fetchChangeForModify(targetNumber)
      .then((loadedChange) => { if (isCurrent) setAnswer({ changeNumber: targetNumber, changeSysId: loadedChange.changeSysId, failureText: '' }); })
      .catch((readError: unknown) => { if (isCurrent) setAnswer({ changeNumber: targetNumber, changeSysId: '', failureText: readError instanceof Error ? readError.message : String(readError) }); });
    return () => { isCurrent = false; };
  }, [targetNumber, knownSysId]);
  if (!target) return { changeSysId: '', failureText: '' };
  if (target.changeSysId) return { changeSysId: target.changeSysId, failureText: '' };
  return answer?.changeNumber === target.changeNumber ? answer : { changeSysId: '', failureText: '' };
}

/** The Risk Check, on the change the user picks. */
export default function RiskCheckSection({ crg, session }: Pick<ChangeStepProps, 'crg' | 'session'>) {
  const pickerId = useId();
  const targets = listRiskCheckTargets(session, crg.state);
  const [chosenNumber, setChosenNumber] = useState('');
  const target = targets.find((candidate) => candidate.changeNumber === chosenNumber) ?? targets[0];
  const { changeSysId, failureText } = useTargetSysId(target);
  const draft = crg.state;
  const promptContext = useMemo(() => buildWizardPromptContext(draft), [draft]);
  const fieldValues = useMemo(() => readChangeTextFields(draft), [draft]);

  if (!target) {
    return (
      <section className={styles.card} aria-labelledby="risk-check-heading">
        <h3 id="risk-check-heading" className={styles.cardTitle}>🛡️ AI Risk Check — on the real ticket</h3>
        <p className={styles.hint}>The Risk Check runs on the real ticket, once your change is in ServiceNow.</p>
      </section>
    );
  }
  const applyChangeFields = (fields: Partial<Record<ChgTextFieldKey, string>>) => {
    const fieldEntries = Object.entries(fields) as Array<[ChgTextFieldKey, string]>;
    fieldEntries.forEach(([fieldKey, fieldText]) => applyChangeTextField(crg.actions, fieldKey, fieldText));
    return fieldEntries.length;
  };
  return (
    <section className={styles.card} aria-labelledby="risk-check-heading">
      <h3 id="risk-check-heading" className={styles.cardTitle}>🛡️ AI Risk Check — on the real ticket</h3>
      <p className={styles.hint}>The same Risk Check as Toolbox: it reads the change and every CTASK from ServiceNow. Fixes to the change&apos;s writing land here and are saved on the last step; backout plans for tasks are written straight to ServiceNow when you press their button.</p>
      {targets.length > 1 ? (
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor={pickerId}>Check which change?</label>
          <select id={pickerId} className={styles.selectField} value={target.changeNumber} onChange={(changeEvent) => setChosenNumber(changeEvent.target.value)}>
            {targets.map((candidate) => <option key={candidate.changeNumber} value={candidate.changeNumber}>{`${candidate.environmentLabel ?? 'Change'} — ${candidate.changeNumber}`}</option>)}
          </select>
          <p className={styles.hint}>Production is first: it is held to the most rules. The writing is shared, so a fix covers both changes.</p>
        </div>
      ) : null}
      {failureText ? <p className={styles.errorText}>{`Could not open ${target.changeNumber} for the check: ${failureText}`}</p> : null}
      {changeSysId ? (
        <ExistingChgRiskCheck
          key={changeSysId}
          changeSysId={changeSysId}
          changeConfigItem={readTargetConfigItem(draft, target.environmentLabel)}
          promptContext={promptContext}
          fieldValues={fieldValues}
          isProduction={PRODUCTION_LABELS.includes(target.environmentLabel)}
          onApplyChangeFields={applyChangeFields}
        />
      ) : (failureText ? null : <p className={styles.hint} role="status">{`Opening ${target.changeNumber}…`}</p>)}
    </section>
  );
}
