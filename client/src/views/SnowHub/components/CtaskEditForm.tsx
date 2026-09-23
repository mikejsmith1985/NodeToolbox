// CtaskEditForm — Reusable CTASK form component for creating and modifying CTASKs
// Used in both CreateChgTab (create flow) and ModifyChgTab (modify flow).

import type { ChangeEvent } from 'react';
import { useState } from 'react';

import type { CtaskTemplateData, SnowReference } from '../hooks/useCrgState.ts';
import {
  checkWindowCoversEstimates,
  describeWindowCoverage,
  DURATION_PHASES,
  normalizeEstimates,
  type DurationEstimates,
} from '../ctaskDurations.ts';
import { SnowLookupField } from './SnowLookupField.tsx';
import styles from '../tabs/CreateChgTab.module.css';

/** Template type — a saved CTASK form that can be loaded and applied. */
export interface CtaskTemplate {
  id: string;
  name: string;
  createdAt: string;
  shortDescription: string;
  description: string;
  assignmentGroup: SnowReference;
  assignedTo: SnowReference;
  plannedStartDate: string;
  plannedEndDate: string;
  closeNotes: string;
  /** How long implementation, validation and backout are each expected to take (the CAB asks for all three). */
  durationEstimates?: DurationEstimates;
}

/** Props for CtaskEditForm component. */
export interface CtaskEditFormProps {
  /** Current CTASK form state — all editable fields. */
  ctaskData: CtaskTemplateData;
  /** Available CTASK templates to pick from and load. */
  templates: CtaskTemplate[];
  /** Called when any field changes — passes the updated form state. */
  onDataChange: (updatedData: CtaskTemplateData) => void;
  /** Optional callback to save the current form state as a new template. */
  onSaveAsTemplate?: (templateName: string) => void;
  /** Optional flag for compact layout (inline editing or embedded contexts). */
  isCompact?: boolean;
}

/**
 * CtaskEditForm — Renders an editable CTASK form with all standard ServiceNow fields.
 *
 * Displays:
 * - Short Description (text input)
 * - Description (textarea)
 * - Assignment Group (SNow lookup typeahead)
 * - Assigned To (SNow lookup typeahead)
 * - Planned Start Date (datetime input)
 * - Planned End Date (datetime input)
 * - Close Notes (textarea)
 * - Template picker dropdown
 * - Save as template option (if onSaveAsTemplate is provided)
 *
 * All field changes call onDataChange() to update parent state.
 * Template picker loads template and calls onDataChange() with loaded data.
 */
export function CtaskEditForm({
  ctaskData,
  templates,
  onDataChange,
  onSaveAsTemplate,
  isCompact = false,
}: CtaskEditFormProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [showSaveAsTemplate, setShowSaveAsTemplate] = useState<boolean>(false);
  const [saveAsTemplateName, setSaveAsTemplateName] = useState<string>('');

  // Handle string field changes (text inputs and textareas).
  function handleStringFieldChange(
    fieldName: keyof Pick<
      CtaskTemplateData,
      'shortDescription' | 'description' | 'plannedStartDate' | 'plannedEndDate' | 'closeNotes'
    >,
    value: string,
  ): void {
    onDataChange({ ...ctaskData, [fieldName]: value });
  }

  // Handle template selection and load selected template data.
  function handleTemplateChange(event: ChangeEvent<HTMLSelectElement>): void {
    const nextTemplateId = event.target.value;
    setSelectedTemplateId(nextTemplateId);

    if (!nextTemplateId) {
      return;
    }

    const nextTemplate = templates.find((template) => template.id === nextTemplateId);
    if (!nextTemplate) return;

    // Load template data into form by converting CtaskTemplate to CtaskTemplateData (omit id, name, createdAt).
    const templateData: CtaskTemplateData = {
      shortDescription: nextTemplate.shortDescription,
      description: nextTemplate.description,
      assignmentGroup: nextTemplate.assignmentGroup,
      assignedTo: nextTemplate.assignedTo,
      plannedStartDate: nextTemplate.plannedStartDate,
      plannedEndDate: nextTemplate.plannedEndDate,
      closeNotes: nextTemplate.closeNotes,
      durationEstimates: normalizeEstimates(nextTemplate.durationEstimates),
    };
    onDataChange(templateData);
    setSelectedTemplateId('');
  }

  // Handle save-as-template action.
  function handleSaveAsTemplate(): void {
    if (!saveAsTemplateName.trim() || !onSaveAsTemplate) return;
    onSaveAsTemplate(saveAsTemplateName.trim());
    setSaveAsTemplateName('');
    setShowSaveAsTemplate(false);
  }

  // Changes one of the three duration estimates, keeping the other two as they were.
  function handleEstimateChange(phaseKey: keyof DurationEstimates, typedMinutes: string): void {
    onDataChange({
      ...ctaskData,
      durationEstimates: { ...normalizeEstimates(ctaskData.durationEstimates), [phaseKey]: typedMinutes },
    });
  }

  const durationEstimates = normalizeEstimates(ctaskData.durationEstimates);
  // The approver's actual question — does the planned window hold implementation, validation AND a full backout —
  // answered live, in the form, rather than in a work note three days after submission.
  const windowCoverage = checkWindowCoversEstimates(
    durationEstimates,
    ctaskData.plannedStartDate,
    ctaskData.plannedEndDate,
  );

  const formClassName = isCompact ? `${styles.ctaskEditorGrid} ${styles.compactForm}` : styles.ctaskEditorGrid;

  return (
    <div className={formClassName}>
      {/* Template picker — load a saved template */}
      <label className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Load from template</span>
        <select aria-label="Load CTASK template" className={styles.input} onChange={handleTemplateChange} value={selectedTemplateId}>
          <option value="">Select a CTASK template…</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
      </label>

      {/* Short Description */}
      <label className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Short description</span>
        <input
          aria-label="CTASK short description"
          className={styles.input}
          onChange={(event) => handleStringFieldChange('shortDescription', event.target.value)}
          placeholder="Brief summary of the CTASK"
          type="text"
          value={ctaskData.shortDescription}
        />
      </label>

      {/* Description */}
      <label className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Description</span>
        <textarea
          aria-label="CTASK description"
          className={styles.textArea}
          onChange={(event) => handleStringFieldChange('description', event.target.value)}
          placeholder="Detailed description of work to be performed"
          value={ctaskData.description}
        />
      </label>

      {/* Assignment Group */}
      <SnowLookupField
        label="Assignment Group"
        onChange={(assignmentGroup) => onDataChange({ ...ctaskData, assignmentGroup })}
        tableName="sys_user_group"
        value={ctaskData.assignmentGroup}
      />

      {/* Assigned To */}
      <SnowLookupField
        label="Assigned To"
        onChange={(assignedTo) => onDataChange({ ...ctaskData, assignedTo })}
        tableName="sys_user"
        value={ctaskData.assignedTo}
      />

      {/* Planned Start Date */}
      <label className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Planned start date</span>
        <input
          aria-label="CTASK planned start date"
          className={styles.input}
          onChange={(event) => handleStringFieldChange('plannedStartDate', event.target.value)}
          type="datetime-local"
          value={ctaskData.plannedStartDate}
        />
      </label>

      {/* Planned End Date */}
      <label className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Planned end date</span>
        <input
          aria-label="CTASK planned end date"
          className={styles.input}
          onChange={(event) => handleStringFieldChange('plannedEndDate', event.target.value)}
          type="datetime-local"
          value={ctaskData.plannedEndDate}
        />
      </label>

      {/* Estimated duration — required on every CTASK by the change approvers (work note, 2026-09-22) */}
      <div className={styles.durationSection} style={{ gridColumn: 'span 2' }}>
        <span className={styles.fieldLabel}>Estimated duration (minutes)</span>
        <div className={styles.durationInputs}>
          {DURATION_PHASES.map((phase) => (
            <label className={styles.fieldGroup} key={phase.key}>
              <span className={styles.fieldLabel}>{phase.label}</span>
              <input
                aria-label={`${phase.label} estimated minutes`}
                className={styles.input}
                min="0"
                onChange={(event) => handleEstimateChange(phase.key, event.target.value)}
                placeholder="e.g. 45"
                type="number"
                value={durationEstimates[phase.key]}
              />
            </label>
          ))}
        </div>
        {/* Deliberately not role="status": several surfaces already own the page's one status line, and this
            verdict is read where it sits rather than announced over whatever else just happened. */}
        <p aria-label="Planned window verdict" className={windowCoverage.isSufficient ? styles.successText : styles.panelHint}>
          {describeWindowCoverage(windowCoverage)}
        </p>
      </div>

      {/* Close Notes */}
      <label className={styles.fieldGroup}>
        <span className={styles.fieldLabel}>Close notes</span>
        <textarea
          aria-label="CTASK close notes"
          className={styles.textArea}
          onChange={(event) => handleStringFieldChange('closeNotes', event.target.value)}
          placeholder="Notes to be added when closing this CTASK"
          value={ctaskData.closeNotes}
        />
      </label>

      {/* Save as template section (only if onSaveAsTemplate callback is provided) */}
      {onSaveAsTemplate && (
        <>
          <label className={styles.fieldGroup} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>
              <input
                aria-label="Save as template checkbox"
                checked={showSaveAsTemplate}
                onChange={(event) => setShowSaveAsTemplate(event.target.checked)}
                type="checkbox"
              />
              {' Save as template'}
            </span>
          </label>
          {showSaveAsTemplate && (
            <label className={styles.fieldGroup} style={{ gridColumn: 'span 2' }}>
              <span className={styles.fieldLabel}>Template name</span>
              <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
                <input
                  aria-label="Template name"
                  className={styles.input}
                  onChange={(event) => setSaveAsTemplateName(event.target.value)}
                  placeholder="e.g., Daily Database Backups"
                  style={{ flex: 1 }}
                  type="text"
                  value={saveAsTemplateName}
                />
                <button
                  className={styles.primaryButton}
                  disabled={!saveAsTemplateName.trim()}
                  onClick={handleSaveAsTemplate}
                  type="button"
                >
                  Save
                </button>
              </div>
            </label>
          )}
        </>
      )}
    </div>
  );
}
