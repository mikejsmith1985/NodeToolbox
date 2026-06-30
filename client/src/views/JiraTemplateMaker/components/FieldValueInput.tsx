// FieldValueInput.tsx — Renders the right input for a field based on its internal type, sourcing
// dropdown options from the field's live allowedValues so only valid choices are selectable.

import type { FieldDescriptor } from '../lib/templateTypes.ts';
import styles from '../JiraTemplateMaker.module.css';
import LabelsInput from './LabelsInput.tsx';
import WikiMarkupEditor from './WikiMarkupEditor.tsx';

interface FieldValueInputProps {
  descriptor: FieldDescriptor;
  value: unknown;
  onChange: (value: unknown) => void;
}

/** Reads the selected option id from a stored `{ id }` or string value. */
function readOptionId(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return '';
}

/** Reads the selected option ids from a stored array of `{ id }`/string values. */
function readOptionIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(readOptionId).filter(Boolean);
}

/** Dispatches to a type-appropriate control for one templated field's value. */
export default function FieldValueInput({ descriptor, value, onChange }: FieldValueInputProps) {
  const inputId = `tmpl-field-${descriptor.fieldId}`;
  const options = descriptor.allowedValues ?? [];

  switch (descriptor.internalType) {
    case 'text':
      return <WikiMarkupEditor id={inputId} value={typeof value === 'string' ? value : ''} onChange={onChange} />;

    case 'choice':
      return (
        <select
          className={styles.select}
          id={inputId}
          onChange={(event) => onChange(event.target.value ? { id: event.target.value } : undefined)}
          value={readOptionId(value)}
        >
          <option value="">— Select —</option>
          {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      );

    case 'multiChoice':
    case 'components':
    case 'versions':
      return (
        <select
          className={styles.select}
          id={inputId}
          multiple
          onChange={(event) => {
            const selectedIds = Array.from(event.target.selectedOptions).map((option) => option.value);
            onChange(selectedIds.map((id) => ({ id })));
          }}
          value={readOptionIds(value)}
        >
          {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      );

    case 'labels':
      return (
        <LabelsInput
          id={inputId}
          onChange={onChange}
          value={Array.isArray(value) ? (value as string[]) : []}
        />
      );

    case 'user':
      return (
        <input
          className={styles.input}
          id={inputId}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Jira username"
          type="text"
          value={typeof value === 'string' ? value : ''}
        />
      );

    case 'date':
      return (
        <input className={styles.input} id={inputId} type="date"
          onChange={(event) => onChange(event.target.value)} value={typeof value === 'string' ? value : ''} />
      );

    case 'datetime':
      return (
        <input className={styles.input} id={inputId} type="datetime-local"
          onChange={(event) => onChange(event.target.value)} value={typeof value === 'string' ? value : ''} />
      );

    case 'number':
      return (
        <input className={styles.input} id={inputId} type="number"
          onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
          value={typeof value === 'number' ? value : ''} />
      );

    default:
      return null;
  }
}
