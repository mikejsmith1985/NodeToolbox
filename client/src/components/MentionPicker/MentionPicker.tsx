// MentionPicker.tsx — The "@" type-ahead that turns a typed name into a real Jira mention.
//
// ── Why this control exists (Article VII justification) ──
// Two person type-aheads already ship, and neither can do this job:
//   • AssigneeFieldEditor (IssueFieldEditors.tsx) uses the right search and identifier shape, but it
//     is a Search BUTTON plus a <select> that REPLACES a whole field value — no debounce, no result
//     navigation, and no notion of inserting into the middle of free text.
//   • PersonFinder (FeatureCanvas) has the debounced popover shape, but searches through a different
//     function and its selection step produces a JQL clause.
// The genuinely new capability is a caret-anchored trigger that inserts at a position inside text a
// user is composing. Rather than contort either shipped control — and risk their existing callers —
// this control is built directly, reusing searchFeatureReviewUsers (the app's dominant user search,
// which already handles the Data Center legacy-parameter fallback) for the part that IS shared.
//
// The debounce/cancellation approach mirrors PersonFinder deliberately, so both behave the same.

import { useEffect, useRef, useState } from 'react';

import {
  searchFeatureReviewUsers,
  type FeatureReviewUserCandidate,
} from '../../views/SprintDashboard/featureReviewFixes.ts';
import { buildMentionToken, type MentionToken } from '../../utils/jiraMentionFormat.ts';
import { MIN_MENTION_QUERY_LENGTH } from './useMentionTrigger.ts';
import styles from './MentionPicker.module.css';

// Collapses a burst of typing into one request, matching the existing person type-ahead.
const SEARCH_DEBOUNCE_MS = 300;

const NO_MATCHES_LABEL = 'No people found.';
const SEARCH_UNAVAILABLE_LABEL = 'Person search is unavailable — you can still write your comment.';

/** One offerable person: the candidate plus the mention token that will be inserted for them. */
interface OfferablePerson {
  candidate: FeatureReviewUserCandidate;
  token: MentionToken;
}

export interface MentionPickerProps {
  /** The text typed after the "@", used as the search query. */
  query: string;
  /** Called with the token to insert when a person is chosen. */
  onSelect: (token: MentionToken) => void;
  /** Called when the user dismisses the picker, leaving the typed "@" as ordinary text. */
  onDismiss: () => void;
  /** Injectable for tests; defaults to the app's shared Jira user search. */
  searchUsers?: (query: string) => Promise<FeatureReviewUserCandidate[]>;
}

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Keeps only the people a genuinely notifying mention can be written for.
 *
 * A candidate whose identifier has no recognised flavour would have to be inserted as plain text,
 * which posts a comment that notifies nobody — so they are not offered at all rather than silently
 * failing after the user picks them.
 */
function readOfferablePeople(candidates: FeatureReviewUserCandidate[]): OfferablePerson[] {
  return candidates
    .map((candidate) => ({ candidate, token: buildMentionToken(candidate) }))
    .filter((person): person is OfferablePerson => person.token !== null);
}

/** The debounced people search, cancelling any response that a newer query has superseded. */
function usePeopleSearch(
  query: string,
  searchUsers: (query: string) => Promise<FeatureReviewUserCandidate[]>,
): { people: OfferablePerson[]; status: SearchStatus } {
  const [people, setPeople] = useState<OfferablePerson[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');

  useEffect(() => {
    if (query.trim().length < MIN_MENTION_QUERY_LENGTH) {
      setPeople([]);
      setStatus('idle');
      return undefined;
    }

    let isCancelled = false;
    const timeoutId = window.setTimeout(() => {
      setStatus('loading');
      searchUsers(query.trim())
        .then((candidates) => {
          if (isCancelled) {
            return;
          }
          setPeople(readOfferablePeople(candidates));
          setStatus('ready');
        })
        .catch(() => {
          if (!isCancelled) {
            setPeople([]);
            setStatus('error');
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [query, searchUsers]);

  return { people, status };
}

/**
 * The popover listing people matching what the user typed after "@". Selecting one reports the
 * mention token to insert; the composer owns the text and the caret.
 */
export default function MentionPicker({
  query,
  onSelect,
  onDismiss,
  searchUsers = searchFeatureReviewUsers,
}: MentionPickerProps): React.JSX.Element {
  const { people, status } = usePeopleSearch(query, searchUsers);
  const [activeIndex, setActiveIndex] = useState(0);
  // Read inside the key handler so the listener does not need re-binding on every result change.
  const peopleRef = useRef(people);
  peopleRef.current = people;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  // A new set of results always starts from the top, so Enter picks the best match.
  useEffect(() => {
    setActiveIndex(0);
  }, [people]);

  useEffect(() => {
    function handleKeyDown(keyboardEvent: KeyboardEvent): void {
      const currentPeople = peopleRef.current;
      if (keyboardEvent.key === 'Escape') {
        keyboardEvent.preventDefault();
        onDismiss();
        return;
      }
      if (currentPeople.length === 0) {
        return;
      }
      if (keyboardEvent.key === 'ArrowDown' || keyboardEvent.key === 'ArrowUp') {
        keyboardEvent.preventDefault();
        const step = keyboardEvent.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex((currentIndex) => (currentIndex + step + currentPeople.length) % currentPeople.length);
        return;
      }
      if (keyboardEvent.key === 'Enter' || keyboardEvent.key === 'Tab') {
        keyboardEvent.preventDefault();
        onSelect(currentPeople[activeIndexRef.current].token);
      }
    }

    // Captured at the document so the keys work while focus stays in the composer — the user never
    // loses their place in the text they are writing.
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onDismiss, onSelect]);

  return (
    <div className={styles.picker}>
      {status === 'error' && (
        <p className={styles.pickerMessage} role="alert">{SEARCH_UNAVAILABLE_LABEL}</p>
      )}
      {status === 'ready' && people.length === 0 && (
        <p className={styles.pickerMessage}>{NO_MATCHES_LABEL}</p>
      )}
      {people.length > 0 && (
        <ul aria-label="People matching your search" className={styles.pickerList} role="listbox">
          {people.map((person, personIndex) => (
            <li
              aria-selected={personIndex === activeIndex}
              className={personIndex === activeIndex ? `${styles.pickerOption} ${styles.pickerOptionActive}` : styles.pickerOption}
              key={person.candidate.userIdentifier}
              onMouseDown={(mouseEvent) => {
                // mousedown, not click: the composer must not lose focus before the insert lands.
                mouseEvent.preventDefault();
                onSelect(person.token);
              }}
              role="option"
            >
              <span className={styles.pickerName}>{person.candidate.displayName}</span>
              {person.candidate.emailAddress && (
                <span className={styles.pickerEmail}> · {person.candidate.emailAddress}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
