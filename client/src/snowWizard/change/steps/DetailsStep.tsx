// DetailsStep.tsx — Step 2 "Tell us about the change": title, category, type and the people and system it belongs to.
//
// Category and type come from ServiceNow's own lists; people, groups and systems are picked from ServiceNow search
// results (Toolbox's SnowLookupField). Up to seven inputs show; the rest wait under "More options".

import { useId, useState } from 'react';

import { SnowLookupField } from '../../../views/SnowHub/components/SnowLookupField.tsx';
import { useCrgTemplates } from '../../../views/SnowHub/hooks/useCrgTemplates.ts';
import { useCtaskTemplates } from '../../../views/SnowHub/hooks/useCtaskTemplates.ts';
import type { SnowChoiceOptionMap } from '../../../views/SnowHub/hooks/useSnowChoiceOptions.ts';
import ChoiceSelect from '../ChoiceSelect.tsx';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';

/** Details also needs ServiceNow's choice lists, read once for the whole job. */
export interface DetailsStepProps extends ChangeStepProps {
  choiceOptions: SnowChoiceOptionMap;
}

/** A labelled text box or area writing straight to the draft. */
function TextEntry({ label, value, isMultiline = false, onChange }: { label: string; value: string; isMultiline?: boolean; onChange: (value: string) => void }) {
  const fieldId = useId();
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor={fieldId}>{label}</label>
      {isMultiline
        ? <textarea id={fieldId} className={styles.textArea} value={value} onChange={(changeEvent) => onChange(changeEvent.target.value)} />
        : <input id={fieldId} className={styles.inputField} value={value} onChange={(changeEvent) => onChange(changeEvent.target.value)} />}
    </div>
  );
}

/** A saved change template to open, when this browser has any — its linked tasks staged with it, and the job linked to it. */
function TemplatePicker({ crg, updateSession }: Pick<ChangeStepProps, 'crg' | 'updateSession'>) {
  const { templates } = useCrgTemplates();
  const { templates: ctaskTemplates } = useCtaskTemplates();
  const pickerId = useId();
  const [openedName, setOpenedName] = useState('');
  if (templates.length === 0) return null;
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor={pickerId}>Open a saved template (optional)</label>
      <select id={pickerId} className={styles.selectField} value="" onChange={(changeEvent) => {
        const chosenTemplate = templates.find((template) => template.id === changeEvent.target.value);
        if (!chosenTemplate) return;
        crg.actions.applyTemplate(chosenTemplate, ctaskTemplates);
        updateSession({ linkedTemplate: { id: chosenTemplate.id, name: chosenTemplate.name } });
        setOpenedName(chosenTemplate.name);
      }}>
        <option value="">Choose…</option>
        {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
      </select>
      {openedName ? <p className={styles.successText} role="status">{`✓ Opened template “${openedName}” — its values are filled in below.`}</p> : null}
    </div>
  );
}

/** The less common details, folded away. Opens itself while one of its texts is still empty. */
function MoreDetails({ crg }: Pick<ChangeStepProps, 'crg'>) {
  const { state, actions } = crg;
  const basicInfo = state.chgBasicInfo;
  const hasEmptyText = [state.generatedDescription, state.generatedJustification, state.generatedRiskImpact].some((text) => text.trim() === '');
  return (
    <details className={styles.moreOptions} open={hasEmptyText}>
      <summary>More options</summary>
      <TextEntry label="What is changing (description)" isMultiline value={state.generatedDescription} onChange={(text) => actions.updateGeneratedField('description', text)} />
      <TextEntry label="Why it is needed (justification)" isMultiline value={state.generatedJustification} onChange={(text) => actions.updateGeneratedField('justification', text)} />
      <TextEntry label="Risk and impact" isMultiline value={state.generatedRiskImpact} onChange={(text) => actions.updateGeneratedField('riskImpact', text)} />
      <SnowLookupField label="Change manager" tableName="sys_user" value={basicInfo.changeManager} onChange={(reference) => actions.setChgBasicInfo({ changeManager: reference })} />
      <SnowLookupField label="Tester" tableName="sys_user" value={basicInfo.tester} onChange={(reference) => actions.setChgBasicInfo({ tester: reference })} />
      <SnowLookupField label="Service manager" tableName="sys_user" value={basicInfo.serviceManager} onChange={(reference) => actions.setChgBasicInfo({ serviceManager: reference })} />
      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={basicInfo.isExpedited} onChange={(changeEvent) => actions.setChgBasicInfo({ isExpedited: changeEvent.target.checked })} />
        This change is expedited
      </label>
    </details>
  );
}

/** Step 2: the change's own details. */
export default function DetailsStep(props: DetailsStepProps) {
  const { crg, choiceOptions } = props;
  const { state, actions } = crg;
  const basicInfo = state.chgBasicInfo;
  return (
    <div>
      <p className={styles.stepIntro}>Tell us what this change is and who it belongs to. Values marked “needed” must be set.</p>
      <TemplatePicker crg={crg} updateSession={props.updateSession} />
      <TextEntry label="Title (needed)" value={state.generatedShortDescription} onChange={(text) => actions.updateGeneratedField('shortDescription', text)} />
      <div className={styles.fieldRow}>
        <ChoiceSelect label="Category" isRequired options={choiceOptions.category ?? []} value={basicInfo.category} onChange={(value) => actions.setChgBasicInfo({ category: value })} />
        <ChoiceSelect label="Change type" isRequired options={choiceOptions.type ?? []} value={basicInfo.changeType} onChange={(value) => actions.setChgBasicInfo({ changeType: value })} />
      </div>
      <SnowLookupField label="Assignment group (needed)" tableName="sys_user_group" value={basicInfo.assignmentGroup} onChange={(reference) => actions.setChgBasicInfo({ assignmentGroup: reference })} />
      <SnowLookupField label="Owner (needed)" tableName="sys_user" value={basicInfo.assignedTo} onChange={(reference) => actions.setChgBasicInfo({ assignedTo: reference })} />
      <SnowLookupField label="Requested by" tableName="sys_user" value={basicInfo.requestedBy} onChange={(reference) => actions.setChgBasicInfo({ requestedBy: reference })} />
      <SnowLookupField label="Configuration item (needed)" tableName="cmdb_ci" value={basicInfo.configItem} onChange={(reference) => actions.setChgBasicInfo({ configItem: reference })} />
      <MoreDetails crg={crg} />
    </div>
  );
}
