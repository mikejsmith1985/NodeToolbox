// IssueTypePicker.tsx — Lets the user pick from the issue types the chosen project actually offers.

import type { CreateMetaIssueType } from '../../../types/jira.ts';
import styles from '../JiraTemplateMaker.module.css';

interface IssueTypePickerProps {
  id: string;
  label: string;
  issueTypes: CreateMetaIssueType[];
  value: string;
  onChange: (issueTypeId: string, issueTypeName: string) => void;
}

/** A select populated only with the project's real issue types (FR-1.2). */
export default function IssueTypePicker({ id, label, issueTypes, value, onChange }: IssueTypePickerProps) {
  return (
    <div className={styles.fieldRow}>
      <label className={styles.fieldLabel} htmlFor={id}>{label}</label>
      <select
        className={styles.select}
        id={id}
        onChange={(event) => {
          const selectedType = issueTypes.find((issueType) => issueType.id === event.target.value);
          onChange(event.target.value, selectedType?.name ?? '');
        }}
        value={value}
      >
        <option disabled value="">— Select an issue type —</option>
        {issueTypes.map((issueType) => (
          <option key={issueType.id} value={issueType.id}>{issueType.name}</option>
        ))}
      </select>
    </div>
  );
}
