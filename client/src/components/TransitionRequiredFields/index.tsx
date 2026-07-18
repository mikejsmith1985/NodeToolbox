// index.tsx — Inline inputs for the fields a Jira workflow transition's screen REQUIRES.
//
// Posting a bare transition id 400s when the workflow demands screen fields ("The following
// fields are required: Application Component Selection, Defect Root Cause" — GH #177 follow-up).
// This component collects those answers inline for the shapes it can honestly render — option
// dropdowns (incl. cascading parent/child) and plain text — and says so plainly when a field's
// shape can only be completed in Jira. Used by every transition surface (hygiene fix control,
// issue detail panel) so the behavior can never drift between them.

import {
  isTransitionFieldSupported,
  type FeatureReviewEditMetaAllowedValue,
  type TransitionFieldSelection,
  type TransitionRequiredField,
} from '../../views/SprintDashboard/featureReviewFixes.ts';
import styles from './TransitionRequiredFields.module.css';

const UNSUPPORTED_FIELD_NOTE = 'must be completed in Jira — its input type cannot be edited here.';

export interface TransitionRequiredFieldsProps {
  requiredFields: readonly TransitionRequiredField[];
  selectionByFieldId: Record<string, TransitionFieldSelection>;
  isDisabled?: boolean;
  onSelectionChange: (fieldId: string, selection: TransitionFieldSelection) => void;
}

/** Reads the human label for one allowed option. */
function readOptionLabel(allowedValue: FeatureReviewEditMetaAllowedValue): string {
  return allowedValue.value ?? allowedValue.name ?? allowedValue.id ?? '';
}

/** Renders one labelled input per required transition field; unsupported shapes state it plainly. */
export function TransitionRequiredFields({
  requiredFields,
  selectionByFieldId,
  isDisabled = false,
  onSelectionChange,
}: TransitionRequiredFieldsProps) {
  if (requiredFields.length === 0) return null;

  return (
    <div className={styles.requiredFields}>
      {requiredFields.map((requiredField) => {
        if (!isTransitionFieldSupported(requiredField)) {
          return (
            <p className={styles.unsupportedNote} key={requiredField.fieldId}>
              ⚠ “{requiredField.name}” {UNSUPPORTED_FIELD_NOTE}
            </p>
          );
        }

        const fieldSelection = selectionByFieldId[requiredField.fieldId] ?? {};

        if (requiredField.schemaType === 'string') {
          return (
            <label className={styles.fieldLabel} key={requiredField.fieldId}>
              {requiredField.name}
              <input
                aria-label={requiredField.name}
                className={styles.textInput}
                disabled={isDisabled}
                type="text"
                value={fieldSelection.text ?? ''}
                onChange={(changeEvent) =>
                  onSelectionChange(requiredField.fieldId, { text: changeEvent.target.value })}
              />
            </label>
          );
        }

        const chosenParentOption = requiredField.allowedValues.find(
          (allowedValue) => allowedValue.id === fieldSelection.optionId,
        );
        const childOptions = chosenParentOption?.children ?? [];

        return (
          <div className={styles.fieldGroup} key={requiredField.fieldId}>
            <label className={styles.fieldLabel}>
              {requiredField.name}
              <select
                aria-label={requiredField.name}
                className={styles.select}
                disabled={isDisabled}
                value={fieldSelection.optionId ?? ''}
                onChange={(changeEvent) =>
                  onSelectionChange(requiredField.fieldId, { optionId: changeEvent.target.value })}
              >
                <option value="">{`Choose ${requiredField.name.toLowerCase()}…`}</option>
                {requiredField.allowedValues.map((allowedValue) => (
                  <option key={allowedValue.id ?? readOptionLabel(allowedValue)} value={allowedValue.id}>
                    {readOptionLabel(allowedValue)}
                  </option>
                ))}
              </select>
            </label>
            {childOptions.length > 0 && (
              <label className={styles.fieldLabel}>
                {`${requiredField.name} — detail`}
                <select
                  aria-label={`${requiredField.name} — detail`}
                  className={styles.select}
                  disabled={isDisabled}
                  value={fieldSelection.childOptionId ?? ''}
                  onChange={(changeEvent) =>
                    onSelectionChange(requiredField.fieldId, {
                      optionId: fieldSelection.optionId,
                      childOptionId: changeEvent.target.value,
                    })}
                >
                  <option value="">Choose detail…</option>
                  {childOptions.map((childOption) => (
                    <option key={childOption.id ?? readOptionLabel(childOption)} value={childOption.id}>
                      {readOptionLabel(childOption)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}
