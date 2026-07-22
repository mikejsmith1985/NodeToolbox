// MentionDraftSummary.tsx — "Tagging: Jane Doe, Bob Wilson" shown beneath a comment composer.
//
// A comment box holds plain text, so an inserted mention sits in it as the literal token Jira needs
// ("[~accountid:557058:ab-12]") — correct, but not something a person can read back. A textarea
// cannot style or hide part of its own value, so the only way to make the draft readable without a
// rich-text editor is to say it alongside.
//
// Crucially this changes nothing about what gets posted: the names are derived from the draft, never
// written into it, so what the author sees in the box remains exactly what Jira receives.

import { useMentionDirectoryStore } from '../../store/mentionDirectoryStore.ts';
import {
  extractMentionTokens,
  formatMentionForDisplay,
  readMentionDirectoryKey,
} from '../../utils/jiraMentionFormat.ts';
import styles from './MentionPicker.module.css';

export interface MentionDraftSummaryProps {
  /** The comment currently being composed. */
  draftText: string;
}

/** Lists, by name, everyone the draft comment will tag. Renders nothing when it tags no one. */
export default function MentionDraftSummary({ draftText }: MentionDraftSummaryProps): React.JSX.Element | null {
  const entriesByIdentifier = useMentionDirectoryStore((state) => state.entriesByIdentifier);

  const taggedPeople = extractMentionTokens(draftText).map((token) => ({
    directoryKey: readMentionDirectoryKey(token),
    label: formatMentionForDisplay(token, entriesByIdentifier[readMentionDirectoryKey(token)])
      .replace(/^@/, ''),
  }));

  // Tagging the same person twice is one person, so the summary says their name once.
  const uniquePeople = taggedPeople.filter(
    (person, personIndex) => taggedPeople.findIndex((other) => other.directoryKey === person.directoryKey) === personIndex,
  );

  if (uniquePeople.length === 0) {
    return null;
  }

  return (
    <p className={styles.draftSummary}>
      Tagging:{' '}
      {uniquePeople.map((person, personIndex) => (
        <span key={person.directoryKey}>
          {personIndex > 0 && ', '}
          <span className={styles.draftSummaryName}>{person.label}</span>
        </span>
      ))}
    </p>
  );
}
