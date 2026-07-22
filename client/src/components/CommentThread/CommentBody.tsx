// CommentBody.tsx — Renders one Jira comment body with its @-mentions shown as people's names.
//
// Jira stores a mention as a machine identifier, so without this the reader sees
// "[~accountid:557058:ab-12]" — or, for rich-editor comments, nothing at all, because the shared
// plain-text normalizer silently drops mention nodes. This component splits the body into text and
// mention pieces and renders each mention as a name looked up in the session directory.
//
// A mention still being looked up is rendered differently from one that cannot be identified: those
// are different facts, and showing "unknown user" for a person who is merely slow to load would tell
// the reader something untrue (spec FR-005a).

import { useMentionDirectoryStore } from '../../store/mentionDirectoryStore.ts';
import {
  formatMentionForDisplay,
  parseCommentMentions,
  readMentionDirectoryKey,
  type MentionToken,
} from '../../utils/jiraMentionFormat.ts';
import styles from './CommentThread.module.css';

export interface CommentBodyProps {
  /** The raw comment body from Jira: a wiki-markup string or an ADF document. */
  body: unknown;
  /**
   * Directory keys belonging to the person reading. A mention matching one of these is marked so it
   * stands out when scanning a thread. Omitted by callers that do not know who is reading.
   */
  currentUserDirectoryKeys?: string[];
}

/** Picks the CSS class matching a mention's resolution status. */
function readMentionStatusClass(status: string, isSelfMention: boolean): string {
  if (isSelfMention) {
    return `${styles.mention} ${styles.mentionSelf}`;
  }
  if (status === 'pending') {
    return `${styles.mention} ${styles.mentionPending}`;
  }
  if (status === 'unresolvable') {
    return `${styles.mention} ${styles.mentionUnresolvable}`;
  }
  return styles.mention;
}

/** Renders a single mention as the person's name, a loading marker, or the unknown placeholder. */
function MentionRunView({
  token,
  isSelfMention,
}: {
  token: MentionToken;
  isSelfMention: boolean;
}): React.JSX.Element {
  const directoryKey = readMentionDirectoryKey(token);
  const entry = useMentionDirectoryStore((state) => state.entriesByIdentifier[directoryKey]);
  const status = entry?.status ?? 'pending';

  return (
    <span
      className={readMentionStatusClass(status, isSelfMention)}
      data-mention-status={status}
      {...(isSelfMention ? { 'data-mention-self': 'true' } : {})}
      // A mention still resolving is a live region only in the sense that its text changes; announcing
      // every swap would be noise, so it is left silent and the final name is read in context.
      title={status === 'unresolvable' ? 'This person could not be found in Jira' : undefined}
    >
      {formatMentionForDisplay(token, entry)}
    </span>
  );
}

/**
 * Renders a comment body, substituting each mention with the mentioned person's display name.
 * Text either side of a mention is rendered in its own element so that swapping a name in when the
 * lookup lands cannot disturb the surrounding prose (spec FR-005b).
 */
export default function CommentBody({ body, currentUserDirectoryKeys = [] }: CommentBodyProps): React.JSX.Element {
  const runs = parseCommentMentions(body);
  const selfKeys = new Set(currentUserDirectoryKeys);

  return (
    <p className={styles.commentBody}>
      {runs.map((run, runIndex) => {
        if (run.kind === 'text') {
          return (
            // Index keys are safe here: runs are derived from immutable body text, so a given
            // position always holds the same piece of that comment.
            <span data-mention-sibling key={`text-${runIndex}`}>
              {run.text}
            </span>
          );
        }
        return (
          <MentionRunView
            isSelfMention={selfKeys.has(readMentionDirectoryKey(run.token))}
            key={`mention-${runIndex}`}
            token={run.token}
          />
        );
      })}
    </p>
  );
}
