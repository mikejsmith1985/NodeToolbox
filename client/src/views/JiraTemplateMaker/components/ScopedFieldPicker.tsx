// ScopedFieldPicker.tsx — Lists the fields available on the chosen issue type. Supported fields
// are addable; unsupported types (e.g. cascading selects) are shown but disabled so the user
// understands why a field is unavailable rather than wondering where it went (FR-1.3, FR-2.1).

import type { FieldDescriptor } from '../lib/templateTypes.ts';
import styles from '../JiraTemplateMaker.module.css';

interface ScopedFieldPickerProps {
  descriptors: FieldDescriptor[];
  addedFieldIds: string[];
  onAdd: (descriptor: FieldDescriptor) => void;
}

/** Renders the addable / unsupported field list for the selected issue type. */
export default function ScopedFieldPicker({ descriptors, addedFieldIds, onAdd }: ScopedFieldPickerProps) {
  const addedFieldIdSet = new Set(addedFieldIds);

  return (
    <ul aria-label="Available fields" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {descriptors.map((descriptor) => {
        const isAlreadyAdded = addedFieldIdSet.has(descriptor.fieldId);
        return (
          <li
            className={`${styles.fieldPickerItem} ${descriptor.isSupported ? '' : styles.unsupported}`}
            key={descriptor.fieldId}
          >
            <span>
              {descriptor.name}
              {descriptor.required && <span className={styles.required} title="Required">*</span>}
              {!descriptor.isSupported && <span className={styles.unsupportedTag}>unsupported field type</span>}
            </span>
            <button
              className={styles.toolbarButton}
              disabled={!descriptor.isSupported || isAlreadyAdded}
              onClick={() => onAdd(descriptor)}
              type="button"
            >
              {isAlreadyAdded ? 'Added' : 'Add'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
