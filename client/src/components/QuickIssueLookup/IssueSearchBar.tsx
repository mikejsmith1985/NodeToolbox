// IssueSearchBar.tsx — The key input + Search action shared by the Quick Issue Lookup popup.
//
// Enter and the Search button are the identical action. Input is normalized (case, whitespace,
// pasted browse URL) before searching; when it is not a plausible key an inline hint appears and
// no lookup fires. The input ref is exposed so the gate can focus it on open.

import { useState } from 'react';

import { normalizeIssueKey } from './normalizeIssueKey.ts';
import styles from './QuickIssueLookup.module.css';

const INPUT_ARIA_LABEL = 'Issue key';
const INPUT_PLACEHOLDER = 'Issue key or pasted Jira link — e.g. ABC-123';
const INVALID_KEY_HINT = 'Enter an issue key like ABC-123.';
const SEARCH_LABEL = 'Search';

export interface IssueSearchBarProps {
  /** Called with a canonical key when the user searches a plausible key. */
  onSearch: (issueKey: string) => void;
  /** Optional initial text (used when pre-filling from a recent selection). */
  initialText?: string;
  /** Ref target so the gate can focus the input on open / on F2-while-open. */
  inputRef?: React.Ref<HTMLInputElement>;
}

/** Renders the issue-key input and Search button; validates before invoking onSearch. */
export function IssueSearchBar({ onSearch, initialText = '', inputRef }: IssueSearchBarProps): React.JSX.Element {
  const [text, setText] = useState(initialText);
  const [hasInvalidAttempt, setHasInvalidAttempt] = useState(false);

  function handleSearch(): void {
    const { key } = normalizeIssueKey(text);
    if (key === null) {
      setHasInvalidAttempt(true);
      return;
    }
    setHasInvalidAttempt(false);
    onSearch(key);
  }

  return (
    <div className={styles.searchBar}>
      <div className={styles.searchRow}>
        <input
          aria-label={INPUT_ARIA_LABEL}
          className={styles.searchInput}
          placeholder={INPUT_PLACEHOLDER}
          ref={inputRef}
          type="text"
          value={text}
          onChange={(changeEvent) => {
            setText(changeEvent.target.value);
            setHasInvalidAttempt(false);
          }}
          onKeyDown={(keyboardEvent) => {
            if (keyboardEvent.key === 'Enter') {
              handleSearch();
            }
          }}
        />
        <button className={styles.searchButton} type="button" onClick={handleSearch}>
          {SEARCH_LABEL}
        </button>
      </div>
      {hasInvalidAttempt ? (
        <p className={styles.hint} role="alert">{INVALID_KEY_HINT}</p>
      ) : null}
    </div>
  );
}
