// ChoiceSelect.tsx — A dropdown fed by ServiceNow's own list for one value, so an exact-match value is picked, never typed.

import { useId } from 'react';

import type { SnowChoiceOption } from '../../views/SnowHub/hooks/useSnowChoiceOptions.ts';
import styles from './ChangeWizard.module.css';

interface ChoiceSelectProps {
  label: string;
  options: readonly SnowChoiceOption[];
  value: string;
  onChange: (value: string) => void;
  isRequired?: boolean;
  /** Shown instead of the list while ServiceNow's list is not available. */
  unavailableText?: string;
}

const DEFAULT_UNAVAILABLE_TEXT = 'Waiting for ServiceNow\'s list…';

/** One labelled ServiceNow list. A value already set but missing from the list is kept as its own option. */
export default function ChoiceSelect({ label, options, value, onChange, isRequired = false, unavailableText = DEFAULT_UNAVAILABLE_TEXT }: ChoiceSelectProps) {
  const selectId = useId();
  const hasOptions = options.length > 0;
  const isValueListed = value === '' || options.some((option) => option.value === value);
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor={selectId}>{isRequired ? `${label} (needed)` : label}</label>
      <select id={selectId} className={styles.selectField} value={value} disabled={!hasOptions} onChange={(changeEvent) => onChange(changeEvent.target.value)}>
        <option value="">{hasOptions ? 'Choose…' : unavailableText}</option>
        {!isValueListed ? <option value={value}>{value}</option> : null}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}
