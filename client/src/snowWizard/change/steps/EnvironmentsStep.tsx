// EnvironmentsStep.tsx — Step 4 "Where and when?": which environments get a change, and each one's planned window.
//
// One change is raised per environment ticked. The ServiceNow environment value is picked automatically from
// ServiceNow's own list (or chosen under "More options"); it is never typed.

import { useId } from 'react';

import { SnowLookupField } from '../../../views/SnowHub/components/SnowLookupField.tsx';
import type { SnowChoiceOptionMap } from '../../../views/SnowHub/hooks/useSnowChoiceOptions.ts';
import ChoiceSelect from '../ChoiceSelect.tsx';
import { DRAFT_ENVIRONMENTS, buildEnvironmentValueByKey } from '../changeDraft.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';

/** Environments also needs ServiceNow's environment list, read once for the whole job. */
export interface EnvironmentsStepProps extends ChangeStepProps {
  choiceOptions: SnowChoiceOptionMap;
}

type DraftEnvironmentEntry = (typeof DRAFT_ENVIRONMENTS)[number];

const ENVIRONMENT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  REL: 'REL — the release (pre-production) environment',
  PRD: 'PRD — Production',
  PFIX: 'PFIX — the Production fix environment',
};
const MODIFY_ENVIRONMENT_NOTE = 'A change belongs to one environment. Keep only the one this change is for.';

/** One environment's start and end. */
function WindowFields({ crg, entry }: Pick<ChangeStepProps, 'crg'> & { entry: DraftEnvironmentEntry }) {
  const startId = useId();
  const endId = useId();
  const environment = crg.state[entry.stateKey];
  return (
    <div className={styles.fieldRow}>
      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} htmlFor={startId}>{`${entry.label} starts`}</label>
        <input id={startId} type="datetime-local" className={styles.inputField} value={environment.plannedStartDate} onChange={(changeEvent) => crg.actions.updateEnvironment(entry.key, { plannedStartDate: changeEvent.target.value })} />
      </div>
      <div className={styles.fieldGroup}>
        <label className={styles.fieldLabel} htmlFor={endId}>{`${entry.label} ends`}</label>
        <input id={endId} type="datetime-local" className={styles.inputField} value={environment.plannedEndDate} onChange={(changeEvent) => crg.actions.updateEnvironment(entry.key, { plannedEndDate: changeEvent.target.value })} />
      </div>
    </div>
  );
}

/** The label ServiceNow shows for one of its environment values. */
function readChoiceLabel(environmentChoices: EnvironmentsStepProps['choiceOptions'][string], choiceValue: string | undefined): string {
  return environmentChoices.find((environmentChoice) => environmentChoice.value === choiceValue)?.label ?? 'none found';
}

/** Per-environment overrides, folded away: the exact ServiceNow environment and a different configuration item. */
function EnvironmentOverrides({ crg, choiceOptions }: EnvironmentsStepProps) {
  const environmentChoices = choiceOptions.u_environment ?? [];
  const automaticValues = buildEnvironmentValueByKey(environmentChoices);
  const enabledEntries = DRAFT_ENVIRONMENTS.filter(({ stateKey }) => crg.state[stateKey].isEnabled);
  return (
    <details className={styles.moreOptions}>
      <summary>More options</summary>
      {enabledEntries.map((entry) => (
        <div key={entry.key} className={styles.card}>
          <ChoiceSelect
            label={`${entry.label}: ServiceNow environment (automatic: ${readChoiceLabel(environmentChoices, automaticValues[entry.key])})`}
            options={environmentChoices}
            value={crg.state[entry.stateKey].snowEnvironmentValue}
            onChange={(value) => crg.actions.updateEnvironment(entry.key, { snowEnvironmentValue: value })}
          />
          <SnowLookupField label={`${entry.label}: a different configuration item`} tableName="cmdb_ci" value={crg.state[entry.stateKey].configItem} onChange={(reference) => crg.actions.updateEnvironment(entry.key, { configItem: reference })} />
        </div>
      ))}
    </details>
  );
}

/** Step 4: the environments and their windows. */
export default function EnvironmentsStep(props: EnvironmentsStepProps) {
  const { crg, session } = props;
  return (
    <div>
      <p className={styles.stepIntro}>Tick each environment this change goes to, then set when the work starts and ends.</p>
      {session.mode === 'modify' ? <p className={styles.hint}>{MODIFY_ENVIRONMENT_NOTE}</p> : null}
      {DRAFT_ENVIRONMENTS.map((entry) => (
        <div key={entry.key} className={styles.card}>
          <label className={styles.checkboxRow}>
            <input type="checkbox" checked={crg.state[entry.stateKey].isEnabled} onChange={(changeEvent) => crg.actions.updateEnvironment(entry.key, { isEnabled: changeEvent.target.checked })} />
            {ENVIRONMENT_DESCRIPTIONS[entry.label]}
          </label>
          {crg.state[entry.stateKey].isEnabled ? <WindowFields crg={crg} entry={entry} /> : null}
        </div>
      ))}
      <EnvironmentOverrides {...props} />
    </div>
  );
}
