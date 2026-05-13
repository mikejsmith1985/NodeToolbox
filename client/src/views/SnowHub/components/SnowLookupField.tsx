// SnowLookupField — A typeahead search input that queries a ServiceNow reference table
// and lets the user pick a record by display name while capturing its sys_id internally.

import { useCallback, useEffect, useRef, useState } from 'react';

import { snowFetch } from '../../../services/snowApi.ts';
import type { SnowReference } from '../hooks/useCrgState.ts';
import styles from './SnowLookupField.module.css';

// Milliseconds of idle time after the user stops typing before the search fires.
const DEBOUNCE_DELAY_MS = 300;
// Maximum number of suggestions shown beneath the input at one time.
const MAX_LOOKUP_RESULTS = 10;

/** Names of SNow tables that this component can search. */
export type SnowLookupTable = 'sys_user' | 'sys_user_group' | 'cmdb_ci';

interface SnowTableRecord {
  sys_id: { value: string } | string;
  name: { value: string; display_value?: string } | string;
}

interface SnowTableResponse {
  result: SnowTableRecord[];
}

interface SnowLookupFieldProps {
  label: string;
  /** The SNow table to query (sys_user, sys_user_group, cmdb_ci). */
  tableName: SnowLookupTable;
  /** Currently selected reference — shows checkmark when sysId is populated. */
  value: SnowReference;
  onChange: (reference: SnowReference) => void;
  /** Whether the field is currently disabled (e.g. during form submission). */
  isDisabled?: boolean;
}

/**
 * Extracts a plain string value from a SNow field that may be a raw string
 * or a { value, display_value } object (when sysparm_display_value=all is used).
 */
function extractDisplayName(raw: SnowTableRecord['name']): string {
  if (typeof raw === 'string') return raw;
  return raw.display_value ?? raw.value ?? '';
}

function extractSysId(raw: SnowTableRecord['sys_id']): string {
  if (typeof raw === 'string') return raw;
  return raw.value ?? '';
}

/**
 * SnowLookupField — Renders a text input that debounce-searches a SNow reference table.
 * Once a result is selected from the dropdown the sys_id is stored in `value.sysId` and
 * a small checkmark badge confirms the selection to the user.
 * Clearing the input resets the sysId so the field goes back to "unresolved" state.
 */
export function SnowLookupField({
  label,
  tableName,
  value,
  onChange,
  isDisabled = false,
}: SnowLookupFieldProps) {
  const [inputText, setInputText] = useState<string>(value.displayName);
  const [suggestions, setSuggestions] = useState<SnowReference[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep the input text in sync if a parent clones a CHG and fills the value externally.
  useEffect(() => {
    setInputText(value.displayName);
  }, [value.displayName]);

  // Close the dropdown when the user clicks outside this component.
  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  const searchSnow = useCallback(
    async (searchText: string) => {
      if (searchText.trim().length < 2) {
        setSuggestions([]);
        setIsOpen(false);
        return;
      }

      setIsSearching(true);
      try {
        const encodedQuery = encodeURIComponent(`nameCONTAINS${searchText}`);
        const path = `/api/now/table/${tableName}?sysparm_query=${encodedQuery}&sysparm_fields=sys_id,name&sysparm_limit=${MAX_LOOKUP_RESULTS}`;
        const response = await snowFetch(path) as SnowTableResponse;

        const mapped: SnowReference[] = (response.result ?? []).map((record) => ({
          sysId:       extractSysId(record.sys_id),
          displayName: extractDisplayName(record.name),
        }));

        setSuggestions(mapped);
        setIsOpen(mapped.length > 0);
      } catch {
        // A failed lookup is non-critical — the user can still type a manual value.
        setSuggestions([]);
        setIsOpen(false);
      } finally {
        setIsSearching(false);
      }
    },
    [tableName],
  );

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>) {
    const newText = event.target.value;
    setInputText(newText);

    // Clear the resolved reference whenever the user edits the text so the
    // checkmark disappears until they pick a new result from the dropdown.
    if (value.sysId) {
      onChange({ sysId: '', displayName: newText });
    }

    // Debounce the SNow search to avoid hammering the API on every keystroke.
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      void searchSnow(newText);
    }, DEBOUNCE_DELAY_MS);
  }

  function handleSuggestionClick(suggestion: SnowReference) {
    setInputText(suggestion.displayName);
    setSuggestions([]);
    setIsOpen(false);
    onChange(suggestion);
  }

  const isResolved = Boolean(value.sysId);

  return (
    <div className={styles.lookupContainer} ref={containerRef}>
      <label className={styles.lookupLabel}>{label}</label>
      <div className={styles.inputWrapper}>
        <input
          type="text"
          className={`${styles.lookupInput} ${isResolved ? styles.resolved : ''}`}
          value={inputText}
          onChange={handleInputChange}
          disabled={isDisabled}
          placeholder={`Search ${label}…`}
          aria-label={label}
          aria-expanded={isOpen}
          aria-autocomplete="list"
          autoComplete="off"
        />
        {isSearching && <span className={styles.spinner} aria-hidden="true" />}
        {isResolved && !isSearching && (
          <span className={styles.checkmark} title="Record resolved" aria-label="resolved">✓</span>
        )}
      </div>
      {isOpen && suggestions.length > 0 && (
        <ul className={styles.suggestionList} role="listbox" aria-label={`${label} suggestions`}>
          {suggestions.map((suggestion) => (
            <li
              key={suggestion.sysId}
              className={styles.suggestionItem}
              role="option"
              aria-selected={suggestion.sysId === value.sysId}
              onMouseDown={() => { handleSuggestionClick(suggestion); }}
            >
              {suggestion.displayName}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
