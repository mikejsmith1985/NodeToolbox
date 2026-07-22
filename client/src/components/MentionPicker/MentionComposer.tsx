// MentionComposer.tsx — Wraps a comment textarea so typing "@" opens the person picker.
//
// This is the single control every comment box in the app uses, so tagging someone behaves and looks
// identical wherever a user happens to be writing (spec FR-019). It is deliberately additive: the
// host keeps owning the textarea's value, its styling, and its posting behaviour — this only watches
// the caret, offers people, and hands back the edited text.

import { useRef, useState } from 'react';

import type { MentionToken } from '../../utils/jiraMentionFormat.ts';
import MentionDraftSummary from './MentionDraftSummary.tsx';
import MentionPicker from './MentionPicker.tsx';
import styles from './MentionPicker.module.css';
import { insertMentionAtTrigger, readActiveMentionQuery, type ActiveMentionQuery } from './useMentionTrigger.ts';

export interface MentionComposerProps {
  /** The comment being written. Owned by the host, exactly as before. */
  value: string;
  /** Called with the new draft text, whether typed or produced by inserting a mention. */
  onChange: (nextValue: string) => void;
  /** Props forwarded to the textarea (id, className, rows, aria-label, …) so hosts keep their styling. */
  textareaProps?: React.TextareaHTMLAttributes<HTMLTextAreaElement>;
}

/**
 * A comment textarea with "@" mention support: the picker opens when an "@" begins a word, and a
 * summary line beneath names everyone the draft will tag.
 */
export default function MentionComposer({ value, onChange, textareaProps }: MentionComposerProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [activeQuery, setActiveQuery] = useState<ActiveMentionQuery | null>(null);
  // Tracked separately so dismissing with Escape keeps the picker shut until the user starts a NEW
  // mention, rather than reopening on the next keystroke of the same one.
  const [dismissedAtIndex, setDismissedAtIndex] = useState<number | null>(null);

  function syncActiveQuery(draftText: string, caretIndex: number): void {
    const query = readActiveMentionQuery(draftText, caretIndex);
    setActiveQuery(query);
    if (query === null || query.atIndex !== dismissedAtIndex) {
      setDismissedAtIndex((currentDismissed) => (query === null ? null : currentDismissed));
    }
  }

  function handleChange(changeEvent: React.ChangeEvent<HTMLTextAreaElement>): void {
    const draftText = changeEvent.target.value;
    onChange(draftText);
    syncActiveQuery(draftText, changeEvent.target.selectionStart ?? draftText.length);
  }

  /** Re-evaluates the mention query after the caret moves without the text changing. */
  function handleCaretMove(caretEvent: React.SyntheticEvent<HTMLTextAreaElement>): void {
    const textarea = caretEvent.currentTarget;
    syncActiveQuery(textarea.value, textarea.selectionStart ?? textarea.value.length);
  }

  function handleSelect(token: MentionToken): void {
    if (!activeQuery) {
      return;
    }
    const caretIndex = textareaRef.current?.selectionStart ?? value.length;
    const insertion = insertMentionAtTrigger(value, activeQuery.atIndex, caretIndex, token.raw);
    onChange(insertion.text);
    setActiveQuery(null);
    setDismissedAtIndex(null);

    // Put the caret straight after the inserted mention so the user simply carries on typing.
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(insertion.caretIndex, insertion.caretIndex);
      }
    });
  }

  const isPickerOpen = activeQuery !== null && activeQuery.atIndex !== dismissedAtIndex;

  return (
    <div className={styles.composerAnchor}>
      <textarea
        {...textareaProps}
        onChange={handleChange}
        onClick={handleCaretMove}
        onKeyUp={handleCaretMove}
        ref={textareaRef}
        value={value}
      />
      {isPickerOpen && (
        <MentionPicker
          onDismiss={() => setDismissedAtIndex(activeQuery.atIndex)}
          onSelect={handleSelect}
          query={activeQuery.query}
        />
      )}
      <MentionDraftSummary draftText={value} />
    </div>
  );
}
