// PersonFinder.tsx — A type-ahead that resolves a person's name to their Jira assignee identifier.
//
// Jira stores assignee by an internal id (accountId on Cloud, username on Data Center), not by
// display name — so a hand-written `assignee = "Jane"` clause usually fails. This popover lets the
// user search by name/email, then inserts the correct `assignee = "<id>"` clause into the JQL box
// for them. It only reads users and proposes a clause; it never runs a query itself.

import { useEffect, useState } from 'react';

import { searchUsers } from '../../../services/jiraApi.ts';
import type { JiraUser } from '../../../types/jira.ts';
import { buildAssigneeClause } from './assigneeClause.ts';

/** Props for the person finder. */
export interface PersonFinderProps {
  /** Called with a ready-to-use JQL clause, e.g. `assignee = "557058:abc"`, when a person is picked. */
  onInsertClause: (clause: string) => void;
}

// Wait this long after the last keystroke before searching, so typing a name is one request, not one
// per character.
const SEARCH_DEBOUNCE_MS = 300;
// Ignore very short queries — a single letter matches too much to be useful and wastes a round-trip.
const MIN_QUERY_LENGTH = 2;

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

/** The person-search popover that inserts an assignee clause into the JQL box. */
export function PersonFinder({ onInsertClause }: PersonFinderProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<JiraUser[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  // Debounced search. All state updates happen inside the timer/promise callbacks (never
  // synchronously in the effect body) so a burst of keystrokes collapses into one request and a
  // stale response is dropped by the cancel flag rather than overwriting a newer one.
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    let isCancelled = false;
    const trimmedQuery = query.trim();
    const timeoutId = window.setTimeout(() => {
      // Too-short queries reset to idle without a round-trip (a single letter matches too much).
      if (trimmedQuery.length < MIN_QUERY_LENGTH) {
        setStatus('idle');
        setResults([]);
        return;
      }
      setStatus('loading');
      searchUsers(trimmedQuery)
        .then((users) => {
          if (isCancelled) {
            return;
          }
          setResults(users);
          setStatus('ready');
          setError(null);
        })
        .catch((searchError: unknown) => {
          if (isCancelled) {
            return;
          }
          setResults([]);
          setStatus('error');
          setError(searchError instanceof Error ? searchError.message : 'User search failed.');
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [isOpen, query]);

  const handlePick = (user: JiraUser): void => {
    const clause = buildAssigneeClause(user);
    if (clause === null) {
      setError('That user has no identifier to filter on.');
      return;
    }
    onInsertClause(clause);
    setIsOpen(false);
    setQuery('');
    setResults([]);
    setStatus('idle');
  };

  return (
    <div style={{ position: 'relative' }}>
      <button type="button" onClick={() => setIsOpen((open) => !open)} title="Find a person to filter by assignee" style={{ padding: '4px 10px', borderRadius: 6, cursor: 'pointer', border: '1px solid #334155', background: 'transparent', color: 'inherit' }}>
        👤 Find person
      </button>
      {isOpen && (
        <div style={{ position: 'absolute', left: 0, top: 36, width: 300, padding: 12, background: '#0f172a', border: '1px solid #334155', borderRadius: 8, zIndex: 30, color: '#e2e8f0' }}>
          <input
            aria-label="Search people by name or email"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or email"
            autoFocus
            style={{ width: '100%', marginBottom: 6 }}
          />
          {status === 'loading' && <p style={{ fontSize: 12, opacity: 0.7 }}>Searching…</p>}
          {status === 'error' && <p role="alert" style={{ color: '#ef4444', fontSize: 12 }}>{error}</p>}
          {status === 'ready' && results.length === 0 && <p style={{ fontSize: 12, opacity: 0.7 }}>No people found.</p>}
          {results.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 220, overflowY: 'auto' }}>
              {results.map((user) => (
                <li key={user.accountId || user.name || user.key || user.emailAddress}>
                  <button
                    type="button"
                    onClick={() => handlePick(user)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 6px', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
                  >
                    <span>{user.displayName}</span>
                    {user.emailAddress && <span style={{ opacity: 0.6, fontSize: 11 }}> · {user.emailAddress}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
