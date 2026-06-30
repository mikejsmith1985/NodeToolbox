// ArtProjectInput.tsx — Searchable project-key combobox for the template maker. Suggestions
// default to the ART-configured projects and the user can type/search any project key. Uses a
// custom themed dropdown (not a native datalist) so it matches the rest of the application.

import { useRef, useState } from 'react';

import styles from '../JiraTemplateMaker.module.css';

interface ArtProjectInputProps {
  id: string;
  label: string;
  value: string;
  /** ART-configured project keys shown as suggestions. */
  artProjectKeys: string[];
  onChange: (projectKey: string) => void;
}

/** Filters the ART project keys by the current input (case-insensitive substring). */
function filterSuggestions(artProjectKeys: string[], query: string): string[] {
  const normalizedQuery = query.trim().toUpperCase();
  if (!normalizedQuery) {
    return artProjectKeys;
  }
  return artProjectKeys.filter((projectKey) => projectKey.includes(normalizedQuery));
}

/** A themed project-key combobox seeded with the ART's projects. */
export default function ArtProjectInput({ id, label, value, artProjectKeys, onChange }: ArtProjectInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  // Delay close on blur so a suggestion click registers before the list unmounts.
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const suggestions = filterSuggestions(artProjectKeys, value);
  const shouldShowDropdown = isOpen && suggestions.length > 0;

  function handleSelect(projectKey: string): void {
    onChange(projectKey);
    setIsOpen(false);
  }

  return (
    <div className={`${styles.fieldRow} ${styles.combobox}`}>
      <label className={styles.fieldLabel} htmlFor={id}>{label}</label>
      <input
        aria-autocomplete="list"
        aria-expanded={shouldShowDropdown}
        autoComplete="off"
        className={styles.input}
        id={id}
        onBlur={() => { blurTimerRef.current = setTimeout(() => setIsOpen(false), 120); }}
        onChange={(event) => { onChange(event.target.value.trim().toUpperCase()); setIsOpen(true); }}
        onFocus={() => { if (blurTimerRef.current) { clearTimeout(blurTimerRef.current); } setIsOpen(true); }}
        placeholder="Search by project key (e.g. ENFCT)"
        role="combobox"
        type="text"
        value={value}
      />
      {shouldShowDropdown && (
        <div className={styles.suggestionDropdown}>
          <ul className={styles.suggestionList} role="listbox" aria-label="ART project suggestions">
            {suggestions.map((projectKey) => (
              <li
                className={styles.suggestionItem}
                key={projectKey}
                onMouseDown={() => handleSelect(projectKey)}
                role="option"
                aria-selected={projectKey === value}
              >
                {projectKey}
              </li>
            ))}
          </ul>
        </div>
      )}
      <span className={styles.unsupportedTag}>
        {artProjectKeys.length > 0
          ? 'Suggestions are your ART projects — or type any project key.'
          : 'Type a Jira project key (no ART projects configured yet).'}
      </span>
    </div>
  );
}
