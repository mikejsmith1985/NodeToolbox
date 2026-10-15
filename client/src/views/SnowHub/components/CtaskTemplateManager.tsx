// CtaskTemplateManager — One place to keep CTASK templates: the saved list beside one editor.
//
// Templates used to be managed through a select box, four buttons and a hidden editor, with fixed dates that went
// stale the moment a template was reused. Here every saved template is visible with its type, group and timing;
// choosing one opens it; edits are marked unsaved until saved; it can be renamed, duplicated or (after a
// confirmation) deleted; and its timing is minutes after the change starts, placed onto each change it is used on.

import { useState } from 'react';

import { describeCtaskTiming } from '../ctaskParentDefaults.ts';
import { EMPTY_DURATION_ESTIMATES, normalizeEstimates } from '../ctaskDurations.ts';
import { useChangeTaskTypeOptions } from '../hooks/useChangeTaskTypeOptions.ts';
import type { CtaskTemplate, CtaskTemplateData } from '../hooks/useCrgState.ts';
import styles from '../tabs/CreateChgTab.module.css';
import { CtaskEditForm } from './CtaskEditForm.tsx';

/** What the manager needs from its host: the saved templates and the ways to change them. */
export interface CtaskTemplateManagerProps {
  templates: CtaskTemplate[];
  /** Saves a new template and returns its id. */
  onCreateTemplate: (name: string, templateData: CtaskTemplateData) => string;
  onUpdateTemplate: (templateId: string, templateData: CtaskTemplateData, name: string) => void;
  /** Copies a template and returns the copy's id. */
  onDuplicateTemplate: (templateId: string) => string;
  onDeleteTemplate: (templateId: string) => void;
  onAddToChange: (template: CtaskTemplate) => void;
  /** Reads an existing ServiceNow CTASK as template fields. */
  onCloneCtask: (ctaskNumber: string) => Promise<CtaskTemplateData>;
}

/** The template being edited: its name and fields, as they stand in the editor. */
interface TemplateDraft {
  name: string;
  data: CtaskTemplateData;
}

function createEmptyTemplateData(): CtaskTemplateData {
  return {
    shortDescription: '',
    description: '',
    assignmentGroup: { sysId: '', displayName: '' },
    assignedTo: { sysId: '', displayName: '' },
    plannedStartDate: '',
    plannedEndDate: '',
    closeNotes: '',
    durationEstimates: { ...EMPTY_DURATION_ESTIMATES },
    changeTaskType: '',
    startOffsetMinutes: '',
    durationMinutes: '',
  };
}

/** A saved template as the editor holds it. */
function readTemplateDraft(template: CtaskTemplate): TemplateDraft {
  return {
    name: template.name,
    data: {
      shortDescription: template.shortDescription,
      description: template.description,
      assignmentGroup: template.assignmentGroup,
      assignedTo: template.assignedTo,
      plannedStartDate: template.plannedStartDate,
      plannedEndDate: template.plannedEndDate,
      closeNotes: template.closeNotes,
      durationEstimates: normalizeEstimates(template.durationEstimates),
      changeTaskType: template.changeTaskType ?? '',
      startOffsetMinutes: template.startOffsetMinutes ?? '',
      durationMinutes: template.durationMinutes ?? '',
    },
  };
}

/** What is saved: a template's timing is relative, so any fixed dates it once carried are dropped. */
function buildSavedTemplateData(draftData: CtaskTemplateData): CtaskTemplateData {
  return { ...draftData, plannedStartDate: '', plannedEndDate: '' };
}

/** Whether the editor differs from the saved template. */
function hasUnsavedChanges(draft: TemplateDraft, savedTemplate: CtaskTemplate): boolean {
  return JSON.stringify(draft) !== JSON.stringify(readTemplateDraft(savedTemplate));
}

/** The saved templates, each showing its type, group and timing; the open one is marked. */
function TemplateList({ templates, selectedTemplateId, onSelect }: {
  templates: CtaskTemplate[];
  selectedTemplateId: string | null;
  onSelect: (template: CtaskTemplate) => void;
}) {
  const { typeOptions } = useChangeTaskTypeOptions();
  if (templates.length === 0) {
    return <p className={styles.panelHint}>No CTASK templates yet. Start one with + New CTASK template, or load an existing CTASK.</p>;
  }
  const readTypeLabel = (typeValue: string | undefined) =>
    typeOptions.find((typeOption) => typeOption.value === typeValue)?.label ?? (typeValue || 'ServiceNow default type');
  return (
    <ul aria-label="Saved CTASK templates" className={styles.templateList}>
      {templates.map((template) => (
        <li key={template.id}>
          <button
            aria-pressed={template.id === selectedTemplateId}
            className={styles.templateListItem}
            onClick={() => onSelect(template)}
            type="button"
          >
            <strong>{template.name}</strong>
            <span className={styles.templateListMeta}>
              {`${readTypeLabel(template.changeTaskType)} · ${template.assignmentGroup.displayName || 'No group'}`}
            </span>
            <span className={styles.templateListMeta}>{describeCtaskTiming(template)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The template's timing, typed as minutes relative to whichever change it is used on. */
function TemplateTimingFields({ data, onChange }: { data: CtaskTemplateData; onChange: (nextData: CtaskTemplateData) => void }) {
  return (
    <div className={styles.ctaskEditorGrid}>
      <label className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Starts (minutes after the change starts)</span>
        <input
          className={styles.input}
          min="0"
          onChange={(event) => onChange({ ...data, startOffsetMinutes: event.target.value })}
          placeholder="Blank = with the change"
          type="number"
          value={data.startOffsetMinutes ?? ''}
        />
      </label>
      <label className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Runs for (minutes)</span>
        <input
          className={styles.input}
          min="0"
          onChange={(event) => onChange({ ...data, durationMinutes: event.target.value })}
          placeholder="Blank = to the change's end"
          type="number"
          value={data.durationMinutes ?? ''}
        />
      </label>
      <p className={styles.panelHint} style={{ gridColumn: '1 / -1' }}>{describeCtaskTiming(data)}</p>
    </div>
  );
}

/** Loads an existing ServiceNow CTASK as the starting point for a new template. */
function CloneCtaskRow({ onCloned, onCloneCtask }: {
  onCloned: (ctaskNumber: string, clonedData: CtaskTemplateData) => void;
  onCloneCtask: (ctaskNumber: string) => Promise<CtaskTemplateData>;
}) {
  const [ctaskNumber, setCtaskNumber] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const [cloneStatus, setCloneStatus] = useState<string | null>(null);

  async function handleClone(): Promise<void> {
    const normalizedNumber = ctaskNumber.trim().toUpperCase();
    setCloneStatus(null);
    if (!normalizedNumber) {
      setCloneError('Enter a CTASK number before cloning a template.');
      return;
    }
    setIsCloning(true);
    setCloneError(null);
    try {
      onCloned(normalizedNumber, await onCloneCtask(normalizedNumber));
      setCloneStatus(`${normalizedNumber} loaded into the CTASK template editor.`);
    } catch (cloneFailure) {
      setCloneError(cloneFailure instanceof Error ? cloneFailure.message : 'Failed to clone CTASK template.');
    } finally {
      setIsCloning(false);
    }
  }

  return (
    <>
      <div className={styles.cloneInputRow}>
        <label className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Existing CTASK for template clone</span>
          <input
            aria-label="Existing CTASK for template clone"
            className={styles.input}
            disabled={isCloning}
            onChange={(event) => setCtaskNumber(event.target.value.toUpperCase())}
            placeholder="CTASK0001234"
            value={ctaskNumber}
          />
        </label>
        <button className={styles.secondaryButton} disabled={isCloning} onClick={() => void handleClone()} type="button">
          {isCloning ? 'Loading CTASK…' : 'Load CTASK as Template'}
        </button>
      </div>
      {cloneError ? <p className={styles.errorText} role="alert">{cloneError}</p> : null}
      {cloneStatus ? <p className={styles.successText} role="status">{cloneStatus}</p> : null}
    </>
  );
}

/** The buttons under a saved template: save, add to the change, duplicate, and a two-step delete. */
function SavedTemplateActions({ savedTemplate, isDirty, props, onSave }: {
  savedTemplate: CtaskTemplate;
  isDirty: boolean;
  props: CtaskTemplateManagerProps;
  onSave: () => void;
}) {
  const [isDeleteConfirmPending, setIsDeleteConfirmPending] = useState(false);
  return (
    <div className={styles.buttonRow}>
      <button className={styles.primaryButton} disabled={!isDirty} onClick={onSave} type="button">Save changes</button>
      <button className={styles.secondaryButton} onClick={() => props.onAddToChange(savedTemplate)} type="button">Add to this change</button>
      <button className={styles.secondaryButton} onClick={() => props.onDuplicateTemplate(savedTemplate.id)} type="button">Duplicate</button>
      {isDeleteConfirmPending ? (
        <>
          <button className={styles.dangerButton} onClick={() => props.onDeleteTemplate(savedTemplate.id)} type="button">
            Confirm delete
          </button>
          <button className={styles.linkButton} onClick={() => setIsDeleteConfirmPending(false)} type="button">Cancel</button>
        </>
      ) : (
        <button className={styles.linkButton} onClick={() => setIsDeleteConfirmPending(true)} type="button">Delete template</button>
      )}
    </div>
  );
}

/** The CTASK template manager. */
export function CtaskTemplateManager(props: CtaskTemplateManagerProps) {
  const { templates, onCreateTemplate, onUpdateTemplate, onCloneCtask } = props;
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const savedTemplate = templates.find((template) => template.id === selectedTemplateId) ?? null;
  const isNewTemplate = draft !== null && savedTemplate === null;
  const isDirty = draft !== null && savedTemplate !== null && hasUnsavedChanges(draft, savedTemplate);

  const openTemplate = (template: CtaskTemplate) => {
    setSelectedTemplateId(template.id);
    setDraft(readTemplateDraft(template));
  };
  const startNewTemplate = (name = '', data = createEmptyTemplateData()) => {
    setSelectedTemplateId(null);
    setDraft({ name, data });
  };
  const saveDraft = () => {
    if (draft === null || draft.name.trim() === '') return;
    if (savedTemplate) {
      onUpdateTemplate(savedTemplate.id, buildSavedTemplateData(draft.data), draft.name.trim());
      return;
    }
    setSelectedTemplateId(onCreateTemplate(draft.name.trim(), buildSavedTemplateData(draft.data)));
  };

  return (
    <div className={styles.clonePanel}>
      <div className={styles.templateEditorHeader}>
        <h4 className={styles.panelSectionTitle}>CTASK Templates</h4>
        <button className={styles.secondaryButton} onClick={() => startNewTemplate()} type="button">+ New CTASK template</button>
      </div>
      <CloneCtaskRow onCloneCtask={onCloneCtask} onCloned={(ctaskNumber, clonedData) => startNewTemplate(clonedData.shortDescription || ctaskNumber, { ...createEmptyTemplateData(), ...clonedData })} />
      <div className={styles.templateManagerLayout}>
        <TemplateList onSelect={openTemplate} selectedTemplateId={selectedTemplateId} templates={templates} />
        {draft === null ? (
          <p className={styles.panelHint}>Choose a template to edit it, or start a new one.</p>
        ) : (
          <TemplateEditor
            draft={draft}
            isDirty={isDirty}
            isNewTemplate={isNewTemplate}
            onCancelNew={() => setDraft(null)}
            onChange={setDraft}
            onSave={saveDraft}
            props={props}
            savedTemplate={savedTemplate}
          />
        )}
      </div>
    </div>
  );
}

/** The open template: its name, timing and CTASK fields, with the actions that fit a new or a saved template. */
function TemplateEditor({ draft, isDirty, isNewTemplate, savedTemplate, props, onChange, onSave, onCancelNew }: {
  draft: TemplateDraft;
  isDirty: boolean;
  isNewTemplate: boolean;
  savedTemplate: CtaskTemplate | null;
  props: CtaskTemplateManagerProps;
  onChange: (nextDraft: TemplateDraft) => void;
  onSave: () => void;
  onCancelNew: () => void;
}) {
  const isNameMissing = draft.name.trim() === '';
  const updateData = (nextData: CtaskTemplateData) => onChange({ ...draft, data: nextData });
  return (
    <div>
      <div className={styles.templateEditorHeader}>
        <label className={styles.fieldGroup} style={{ flex: 1 }}>
          <span className={styles.fieldLabel}>CTASK template name</span>
          <input
            aria-label="CTASK template name"
            className={styles.input}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            value={draft.name}
          />
        </label>
        {isDirty ? <span className={styles.ctaskCardWarning}>Unsaved changes</span> : null}
      </div>
      {isNameMissing ? <p className={styles.panelHint}>Give the template a name to save it.</p> : null}
      <TemplateTimingFields data={draft.data} onChange={updateData} />
      <CtaskEditForm ctaskData={draft.data} isTemplateEditor onDataChange={updateData} templates={[]} />
      {isNewTemplate || savedTemplate === null ? (
        <div className={styles.buttonRow}>
          <button className={styles.primaryButton} disabled={isNameMissing} onClick={onSave} type="button">Save CTASK Template</button>
          <button className={styles.linkButton} onClick={onCancelNew} type="button">Cancel</button>
        </div>
      ) : (
        <SavedTemplateActions isDirty={isDirty && !isNameMissing} onSave={onSave} props={props} savedTemplate={savedTemplate} />
      )}
    </div>
  );
}
