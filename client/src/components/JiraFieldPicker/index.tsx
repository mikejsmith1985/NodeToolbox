// index.tsx — Jira field picker that loads field metadata and stores the selected field ID.

import { useEffect, useMemo, useState } from 'react';

import { jiraGet } from '../../services/jiraApi.ts';
import type { JiraField } from '../../types/jira.ts';
import styles from '../JiraPicker.module.css';

const FIELDS_API_PATH = '/rest/api/2/field';
const CUSTOM_FIELD_ID_PREFIX = 'customfield_';
const DEFAULT_PLACEHOLDER = 'Select a field';
const LOADING_OPTION_LABEL = 'Loading fields…';
const ERROR_HINT_TEXT = 'Could not load Jira fields. You can still enter the field ID manually.';
const CURRENT_VALUE_LABEL_PREFIX = 'Current field';

interface JiraFieldPickerProps {
  id: string;
  label: string;
  value: string;
  onChange: (fieldId: string) => void;
  placeholder?: string;
}

function createCurrentFieldLabel(fieldId: string): string {
  return `${CURRENT_VALUE_LABEL_PREFIX} (${fieldId})`;
}

/** Loads Jira custom fields and lets settings panels store the selected Jira field ID. */
export default function JiraFieldPicker({
  id,
  label,
  value,
  onChange,
  placeholder,
}: JiraFieldPickerProps) {
  const [availableFields, setAvailableFields] = useState<JiraField[]>([]);
  const [isLoadingFields, setIsLoadingFields] = useState(true);
  const [hasLoadingError, setHasLoadingError] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadFields(): Promise<void> {
      try {
        const loadedFields = await jiraGet<JiraField[]>(FIELDS_API_PATH);
        if (!isMounted) {
          return;
        }

        const selectableFields = loadedFields
          .filter((field) => field.id.startsWith(CUSTOM_FIELD_ID_PREFIX))
          .sort((leftField, rightField) => leftField.name.localeCompare(rightField.name));
        setAvailableFields(selectableFields);
        setHasLoadingError(false);
      } catch {
        if (!isMounted) {
          return;
        }

        setAvailableFields([]);
        setHasLoadingError(true);
      } finally {
        if (isMounted) {
          setIsLoadingFields(false);
        }
      }
    }

    void loadFields();

    return () => {
      isMounted = false;
    };
  }, []);

  const hasStoredFieldValue = useMemo(
    () => value.length > 0 && !availableFields.some((field) => field.id === value),
    [availableFields, value],
  );

  if (hasLoadingError) {
    return (
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor={id}>{label}</label>
        <input
          className={styles.fallbackInput}
          id={id}
          onChange={(changeEvent) => onChange(changeEvent.target.value)}
          type="text"
          value={value}
        />
        <p className={styles.errorHint}>{ERROR_HINT_TEXT}</p>
      </div>
    );
  }

  if (isLoadingFields) {
    return (
      <div className={styles.fieldGroup}>
        <label className={styles.label} htmlFor={id}>{label}</label>
        <select className={styles.select} defaultValue="" disabled id={id}>
          <option value="">{LOADING_OPTION_LABEL}</option>
        </select>
      </div>
    );
  }

  return (
    <div className={styles.fieldGroup}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <select
        className={styles.select}
        id={id}
        onChange={(changeEvent) => onChange(changeEvent.target.value)}
        value={value}
      >
        <option disabled value="">— {placeholder ?? DEFAULT_PLACEHOLDER} —</option>
        {hasStoredFieldValue && <option value={value}>{createCurrentFieldLabel(value)}</option>}
        {availableFields.map((field) => (
          <option key={field.id} value={field.id}>
            {field.name} ({field.id})
          </option>
        ))}
      </select>
    </div>
  );
}
