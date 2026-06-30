// ArtProjectInput.tsx — Project selector for the template maker. Rather than a fully-populated
// dropdown of every Jira project, it suggests the ART-configured projects (via a datalist) while
// letting the user search/enter any project key directly. Keys are normalized to uppercase.

import styles from '../JiraTemplateMaker.module.css';

interface ArtProjectInputProps {
  id: string;
  label: string;
  value: string;
  /** ART-configured project keys shown as type-ahead suggestions. */
  artProjectKeys: string[];
  onChange: (projectKey: string) => void;
}

/** A searchable project-key input that defaults its suggestions to the ART's projects. */
export default function ArtProjectInput({ id, label, value, artProjectKeys, onChange }: ArtProjectInputProps) {
  const datalistId = `${id}-art-projects`;
  return (
    <div className={styles.fieldRow}>
      <label className={styles.fieldLabel} htmlFor={id}>{label}</label>
      <input
        autoComplete="off"
        className={styles.input}
        id={id}
        list={datalistId}
        onChange={(event) => onChange(event.target.value.trim().toUpperCase())}
        placeholder="Search by project key (e.g. ENFCT)"
        type="text"
        value={value}
      />
      <datalist id={datalistId}>
        {artProjectKeys.map((projectKey) => <option key={projectKey} value={projectKey} />)}
      </datalist>
      <span className={styles.unsupportedTag}>
        {artProjectKeys.length > 0
          ? 'Suggestions are your ART projects — or type any project key.'
          : 'Type a Jira project key (no ART projects configured yet).'}
      </span>
    </div>
  );
}
