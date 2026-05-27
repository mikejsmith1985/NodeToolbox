// ChangeModifierTab.tsx — Modify existing ServiceNow Change Requests and CTASKs
// Lets users fetch CHG by key, edit fields, manage CTASKs, and save changes back to ServiceNow.

import { type ChangeEvent, useCallback, useState } from 'react';
import type { ChangeModifierRecord } from '../hooks/useChangeModifier.ts';
import { useChangeModifier } from '../hooks/useChangeModifier.ts';
import type {
  ChgBasicInfo,
  ChgPlanningAssessment,
  ChgPlanningContent,
} from '../hooks/useCrgState.ts';

const TAB_TITLE = 'Modify Change';
const TAB_SUBTITLE = 'Fetch an existing ServiceNow CHG, edit fields and CTASKs, save changes.';
const EMPTY_VALUE = '';

interface ChangeFieldDefinition {
  key: keyof ChangeModifierRecord;
  label: string;
  type?: 'text' | 'textarea';
}

const CHANGE_FIELD_DEFINITIONS: ChangeFieldDefinition[] = [
  { key: 'shortDescription', label: 'Short Description', type: 'text' },
  { key: 'description', label: 'Description', type: 'textarea' },
  { key: 'justification', label: 'Justification', type: 'textarea' },
  { key: 'riskImpactAnalysis', label: 'Risk & Impact Analysis', type: 'textarea' },
];

interface BasicInfoFieldDefinition {
  label: string;
  fieldKey: keyof ChgBasicInfo;
}

const BASIC_INFO_FIELDS: BasicInfoFieldDefinition[] = [
  { label: 'Category', fieldKey: 'category' },
  { label: 'Change Type', fieldKey: 'changeType' },
  { label: 'Environment', fieldKey: 'environment' },
];

interface AssessmentFieldDefinition {
  label: string;
  fieldKey: keyof ChgPlanningAssessment;
}

const ASSESSMENT_FIELDS: AssessmentFieldDefinition[] = [
  { label: 'Impact', fieldKey: 'impact' },
  { label: 'System Availability Implication', fieldKey: 'systemAvailabilityImplication' },
  { label: 'Has Been Tested', fieldKey: 'hasBeenTested' },
  { label: 'Has Been Performed Previously', fieldKey: 'hasBeenPerformedPreviously' },
  { label: 'Success Probability', fieldKey: 'successProbability' },
  { label: 'Can Be Backed Out', fieldKey: 'canBeBackedOut' },
];

interface ContentFieldDefinition {
  label: string;
  fieldKey: keyof ChgPlanningContent;
}

const CONTENT_FIELDS: ContentFieldDefinition[] = [
  { label: 'Implementation Plan', fieldKey: 'implementationPlan' },
  { label: 'Backout Plan', fieldKey: 'backoutPlan' },
  { label: 'Test Plan', fieldKey: 'testPlan' },
];

/**
 * ChangeModifierTab — Modify existing ServiceNow CHG records and their CTASKs.
 * Lets users fetch by key, edit all fields, manage CTASKs, and save back to SNow.
 */
export default function ChangeModifierTab(): React.ReactElement {
  const { state, actions } = useChangeModifier();
  const [inputChangeKey, setInputChangeKey] = useState(EMPTY_VALUE);

  const handleChangeKeyChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setInputChangeKey(event.target.value);
  }, []);

  const handleFetchChange = useCallback(async () => {
    await actions.fetchChangeByKey(inputChangeKey);
  }, [actions, inputChangeKey]);

  const handleChangeFieldChange = useCallback(
    (fieldKey: string, value: string) => {
      actions.updateChangeField(fieldKey, value);
    },
    [actions],
  );

  const handleBasicInfoFieldChange = useCallback(
    (fieldKey: keyof ChgBasicInfo, value: string) => {
      actions.updateChangeField(`chgBasicInfo.${fieldKey}`, value);
    },
    [actions],
  );

  const handleAssessmentFieldChange = useCallback(
    (fieldKey: keyof ChgPlanningAssessment, value: string) => {
      actions.updateChangeField(`chgPlanningAssessment.${fieldKey}`, value);
    },
    [actions],
  );

  const handleContentFieldChange = useCallback(
    (fieldKey: keyof ChgPlanningContent, value: string) => {
      actions.updateChangeField(`chgPlanningContent.${fieldKey}`, value);
    },
    [actions],
  );

  const handleRemoveCtask = useCallback(
    (ctaskId: string) => {
      actions.removeCtask(ctaskId);
    },
    [actions],
  );

  const handleSaveChange = useCallback(async () => {
    await actions.saveChange();
  }, [actions]);

  return (
    <div className="change-modifier-tab">
      <div className="tab-header">
        <h1>{TAB_TITLE}</h1>
        <p className="subtitle">{TAB_SUBTITLE}</p>
      </div>

      {/* Change Key Lookup Section */}
      <section className="lookup-section">
        <h2>Fetch Change</h2>
        <div className="lookup-input-group">
          <input
            type="text"
            placeholder="e.g., CHG0123456"
            value={inputChangeKey}
            onChange={handleChangeKeyChange}
            disabled={state.isLoading}
            className="change-key-input"
          />
          <button
            onClick={handleFetchChange}
            disabled={state.isLoading || !inputChangeKey.trim()}
            className="fetch-button"
          >
            {state.isLoading ? 'Fetching...' : 'Fetch'}
          </button>
        </div>

        {state.error && (
          <div className="error-message">
            {state.error}
          </div>
        )}

        {state.isSavingSuccess && (
          <div className="success-message">
            ✓ Changes saved successfully
          </div>
        )}
      </section>

      {/* Change Details Form */}
      {state.change && (
        <>
          <section className="change-details-section">
            <h2>Change Details</h2>
            <div className="change-info">
              <div className="info-row">
                <strong>Number:</strong>
                <span>{state.change.number}</span>
              </div>
            </div>

            {/* Generated Fields */}
            <div className="form-section">
              <h3>Summary & Description</h3>
              {CHANGE_FIELD_DEFINITIONS.map((fieldDef) => {
                const fieldValue = state.change?.[fieldDef.key];
                const displayValue = typeof fieldValue === 'string' ? fieldValue : '';
                return (
                  <div key={fieldDef.key} className="form-group">
                    <label htmlFor={fieldDef.key}>{fieldDef.label}</label>
                    {fieldDef.type === 'textarea' ? (
                      <textarea
                        id={fieldDef.key}
                        value={displayValue}
                        onChange={(event) => handleChangeFieldChange(fieldDef.key, event.target.value)}
                        className="field-textarea"
                        rows={4}
                      />
                    ) : (
                      <input
                        id={fieldDef.key}
                        type="text"
                        value={displayValue}
                        onChange={(event) => handleChangeFieldChange(fieldDef.key, event.target.value)}
                        className="field-input"
                      />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Basic Info Fields */}
            <div className="form-section">
              <h3>Basic Information</h3>
              <div className="field-grid">
                {BASIC_INFO_FIELDS.map((fieldDef) => {
                  const basicInfo = state.change?.chgBasicInfo;
                  const fieldValue = basicInfo?.[fieldDef.fieldKey];
                  const displayValue = typeof fieldValue === 'string' ? fieldValue : '';
                  return (
                    <div key={fieldDef.fieldKey} className="form-group">
                      <label htmlFor={`basic-${fieldDef.fieldKey}`}>{fieldDef.label}</label>
                      <input
                        id={`basic-${fieldDef.fieldKey}`}
                        type="text"
                        value={displayValue}
                        onChange={(event) => handleBasicInfoFieldChange(fieldDef.fieldKey, event.target.value)}
                        className="field-input"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Planning Assessment Fields */}
            <div className="form-section">
              <h3>Planning Assessment</h3>
              <div className="field-grid">
                {ASSESSMENT_FIELDS.map((fieldDef) => {
                  const assessment = state.change?.chgPlanningAssessment;
                  const fieldValue = assessment?.[fieldDef.fieldKey];
                  const displayValue = typeof fieldValue === 'string' ? fieldValue : '';
                  return (
                    <div key={fieldDef.fieldKey} className="form-group">
                      <label htmlFor={`assess-${fieldDef.fieldKey}`}>{fieldDef.label}</label>
                      <input
                        id={`assess-${fieldDef.fieldKey}`}
                        type="text"
                        value={displayValue}
                        onChange={(event) => handleAssessmentFieldChange(fieldDef.fieldKey, event.target.value)}
                        className="field-input"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Planning Content Fields */}
            <div className="form-section">
              <h3>Planning Content</h3>
              {CONTENT_FIELDS.map((fieldDef) => {
                const content = state.change?.chgPlanningContent;
                const fieldValue = content?.[fieldDef.fieldKey];
                const displayValue = typeof fieldValue === 'string' ? fieldValue : '';
                return (
                  <div key={fieldDef.fieldKey} className="form-group">
                    <label htmlFor={`content-${fieldDef.fieldKey}`}>{fieldDef.label}</label>
                    <textarea
                      id={`content-${fieldDef.fieldKey}`}
                      value={displayValue}
                      onChange={(event) => handleContentFieldChange(fieldDef.fieldKey, event.target.value)}
                      className="field-textarea"
                      rows={3}
                    />
                  </div>
                );
              })}
            </div>
          </section>

          {/* CTASKs Section */}
          {state.ctasks.length > 0 && (
            <section className="ctasks-section">
              <h2>Change Tasks (CTASKs)</h2>
              <div className="ctasks-list">
                {state.ctasks.map((ctask) => (
                  <div key={ctask.sysId} className="ctask-card">
                    <div className="ctask-header">
                      <h4>{ctask.number}</h4>
                      <button
                        onClick={() => handleRemoveCtask(ctask.sysId)}
                        className="remove-button"
                        title="Remove this CTASK"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="ctask-details">
                      <div className="detail-field">
                        <strong>Short Description:</strong>
                        <p>{ctask.shortDescription}</p>
                      </div>
                      {ctask.description && (
                        <div className="detail-field">
                          <strong>Description:</strong>
                          <p>{ctask.description}</p>
                        </div>
                      )}
                      {ctask.assignmentGroup.sysId && (
                        <div className="detail-field">
                          <strong>Assignment Group:</strong>
                          <p>{ctask.assignmentGroup.displayName}</p>
                        </div>
                      )}
                      {ctask.assignedTo.sysId && (
                        <div className="detail-field">
                          <strong>Assigned To:</strong>
                          <p>{ctask.assignedTo.displayName}</p>
                        </div>
                      )}
                      {ctask.plannedStartDate && (
                        <div className="detail-field">
                          <strong>Planned Start:</strong>
                          <p>{ctask.plannedStartDate}</p>
                        </div>
                      )}
                      {ctask.plannedEndDate && (
                        <div className="detail-field">
                          <strong>Planned End:</strong>
                          <p>{ctask.plannedEndDate}</p>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Save Button */}
          <section className="actions-section">
            <button
              onClick={handleSaveChange}
              disabled={!state.isDirty || state.isSaving}
              className="save-button"
            >
              {state.isSaving ? 'Saving...' : 'Save Changes'}
            </button>
            {!state.isDirty && (
              <p className="no-changes-hint">No unsaved changes</p>
            )}
          </section>
        </>
      )}

      {/* Empty State */}
      {!state.change && !state.isLoading && (
        <div className="empty-state">
          <p>Enter a change key above to fetch and modify a ServiceNow Change Request.</p>
        </div>
      )}
    </div>
  );
}
