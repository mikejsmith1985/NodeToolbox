// IssueFieldEditors.tsx — Reusable inline editors (text, single-select, assignee) for a Jira issue.
//
// These add editor SHAPE only: every save is delegated by the caller to an existing
// featureReviewFixes writer (the recorded Art VII drift — writes stay single-sourced). While editing,
// each editor offers Save/Cancel and surfaces an inline error on failure without changing the
// committed value (spec FR-008/FR-010).
//
// The VALUE ITSELF is the control that starts an edit, rather than a separate Edit button beside it.
// A button was more explicit, but it also doubled the width of every row and put the affordance
// where the eye was not — and the fields that most need editing are the EMPTY ones, where there was
// nothing to click next to. Those now read "Click to edit" in words, so nothing is left to infer.

import { useState } from 'react';

import type {
  FeatureReviewSelectOption,
  FeatureReviewUserCandidate,
} from '../../views/SprintDashboard/featureReviewFixes.ts';
import { useFieldEditor } from './issueFieldEditing.ts';
import styles from './IssueFieldEditors.module.css';

const SAVE_LABEL = 'Save';
const CANCEL_LABEL = 'Cancel';
const EDIT_HINT_LABEL = 'Click to edit';
const SEARCH_LABEL = 'Search';
const SAVED_FLASH = '✓ Saved';
const EDIT_ACTION_PREFIX = 'Edit';
const CHOOSE_OPTION_LABEL = 'Choose…';
const NO_MATCHES_LABEL = 'No matching users';

/** Shared Saved-flash + inline-error footer for every editor. */
function EditorFeedback({ error, justSaved }: { error: string | null; justSaved: boolean }): React.JSX.Element | null {
  if (error) {
    return <p className={styles.error} role="alert">{error}</p>;
  }
  if (justSaved) {
    return <span className={styles.saved} role="status">{SAVED_FLASH}</span>;
  }
  return null;
}

/**
 * The resting state of every editor: the field's value, rendered as the control that edits it.
 *
 * `aria-label` names the ACTION rather than echoing the value, so a screen reader announces
 * "Edit Priority" instead of reading back "High" with no clue it can be changed — and so the button
 * has a stable name even when the field is empty.
 */
function FieldValueButton({
  label,
  displayValue,
  onBeginEdit,
}: {
  label: string;
  displayValue: string;
  onBeginEdit: () => void;
}): React.JSX.Element {
  const hasValue = displayValue.trim() !== '';

  return (
    <button
      aria-label={`${EDIT_ACTION_PREFIX} ${label}`}
      className={styles.valueButton}
      title={EDIT_HINT_LABEL}
      type="button"
      onClick={onBeginEdit}
    >
      <span className={hasValue ? styles.fieldValue : styles.emptyValue}>
        {hasValue ? displayValue : EDIT_HINT_LABEL}
      </span>
      <span aria-hidden="true" className={styles.editHint}>✎</span>
    </button>
  );
}

export interface TextFieldEditorProps {
  label: string;
  initialValue: string;
  /**
   * The HTML input type — `text` unless the field is a number or a date.
   *
   * A date field gets a real date picker rather than a box somebody has to guess Jira's format for,
   * which is the difference between setting a Target End here and giving up and opening Jira.
   */
  inputType?: 'text' | 'number' | 'date';
  onSave: (nextValue: string) => Promise<void>;
  onSaved?: () => void;
}

/** Inline editor for a plain single-line field — text, a number, or a date. */
export function TextFieldEditor({ label, initialValue, inputType = 'text', onSave, onSaved }: TextFieldEditorProps): React.JSX.Element {
  const editor = useFieldEditor(onSave, onSaved);
  const [draft, setDraft] = useState(initialValue);

  return (
    <div className={styles.fieldRow}>
      <span className={styles.fieldLabel}>{label}</span>
      {editor.isEditing ? (
        <div className={styles.controls}>
          <input
            aria-label={`${label} value`}
            className={styles.input}
            disabled={editor.isSaving}
            type={inputType}
            value={draft}
            onChange={(changeEvent) => setDraft(changeEvent.target.value)}
          />
          <button className={styles.saveButton} disabled={editor.isSaving} type="button" onClick={() => editor.save(draft)}>
            {SAVE_LABEL}
          </button>
          <button className={styles.cancelButton} disabled={editor.isSaving} type="button" onClick={editor.cancelEdit}>
            {CANCEL_LABEL}
          </button>
        </div>
      ) : (
        <FieldValueButton
          displayValue={initialValue}
          label={label}
          onBeginEdit={() => { setDraft(initialValue); editor.beginEdit(); }}
        />
      )}
      <EditorFeedback error={editor.error} justSaved={editor.justSaved} />
    </div>
  );
}

export interface SelectFieldEditorProps {
  label: string;
  initialValue: string;
  options: FeatureReviewSelectOption[];
  onSave: (nextValue: string) => Promise<void>;
  onSaved?: () => void;
  /**
   * Label for the blank option, when saving it is a real choice rather than an unfinished one.
   *
   * Most select fields cannot meaningfully be emptied — a priority of "nothing" is not a value — so
   * saving a blank draft is refused by default. A fix version genuinely can be removed, and without
   * this the only way to take one off an issue would be to leave the popup for Jira.
   */
  clearOptionLabel?: string;
}

/** Inline editor for a single-select option field (e.g. priority). */
export function SelectFieldEditor({ label, initialValue, options, onSave, onSaved, clearOptionLabel }: SelectFieldEditorProps): React.JSX.Element {
  const editor = useFieldEditor(onSave, onSaved);
  const [draft, setDraft] = useState(initialValue);

  return (
    <div className={styles.fieldRow}>
      <span className={styles.fieldLabel}>{label}</span>
      {editor.isEditing ? (
        <div className={styles.controls}>
          <select
            aria-label={`${label} value`}
            className={styles.select}
            disabled={editor.isSaving}
            value={draft}
            onChange={(changeEvent) => setDraft(changeEvent.target.value)}
          >
            <option value="">{clearOptionLabel ?? CHOOSE_OPTION_LABEL}</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            className={styles.saveButton}
            disabled={editor.isSaving || (draft.trim() === '' && clearOptionLabel === undefined)}
            type="button"
            onClick={() => editor.save(draft)}
          >
            {SAVE_LABEL}
          </button>
          <button className={styles.cancelButton} disabled={editor.isSaving} type="button" onClick={editor.cancelEdit}>
            {CANCEL_LABEL}
          </button>
        </div>
      ) : (
        <FieldValueButton
          // The option's own label, never the id behind it. `initialValue` is whatever the writer
          // resolves against — for priority that is a numeric Jira id, and showing "3" where the
          // user expects "High" is exactly the backend leak this panel must not produce.
          displayValue={readOptionLabel(options, initialValue)}
          label={label}
          onBeginEdit={() => { setDraft(initialValue); editor.beginEdit(); }}
        />
      )}
      <EditorFeedback error={editor.error} justSaved={editor.justSaved} />
    </div>
  );
}

/** The human label for a stored option value, falling back to the value when Jira no longer lists it. */
function readOptionLabel(options: FeatureReviewSelectOption[], storedValue: string): string {
  return options.find((option) => option.value === storedValue)?.label ?? storedValue;
}

export interface AssigneeFieldEditorProps {
  initialDisplayName: string;
  onSearchUsers: (query: string) => Promise<FeatureReviewUserCandidate[]>;
  onSave: (userIdentifier: string) => Promise<void>;
  onSaved?: () => void;
}

/** Inline editor for the assignee: search Jira users, pick one, save the account id. */
export function AssigneeFieldEditor({ initialDisplayName, onSearchUsers, onSave, onSaved }: AssigneeFieldEditorProps): React.JSX.Element {
  const editor = useFieldEditor(onSave, onSaved);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<FeatureReviewUserCandidate[]>([]);
  const [selectedIdentifier, setSelectedIdentifier] = useState('');
  const [hasSearched, setHasSearched] = useState(false);

  async function runSearch(): Promise<void> {
    const found = await onSearchUsers(query);
    setCandidates(found);
    setHasSearched(true);
    setSelectedIdentifier(found.length > 0 ? found[0].userIdentifier : '');
  }

  return (
    <div className={styles.fieldRow}>
      <span className={styles.fieldLabel}>Assignee</span>
      {editor.isEditing ? (
        <div className={styles.controls}>
          <input
            aria-label="Assignee search"
            className={styles.input}
            disabled={editor.isSaving}
            placeholder="Search people…"
            value={query}
            onChange={(changeEvent) => setQuery(changeEvent.target.value)}
          />
          <button className={styles.editButton} disabled={editor.isSaving} type="button" onClick={() => void runSearch()}>
            {SEARCH_LABEL}
          </button>
          {hasSearched && candidates.length === 0 ? <span className={styles.fieldValue}>{NO_MATCHES_LABEL}</span> : null}
          {candidates.length > 0 ? (
            <select
              aria-label="Assignee candidate"
              className={styles.select}
              disabled={editor.isSaving}
              value={selectedIdentifier}
              onChange={(changeEvent) => setSelectedIdentifier(changeEvent.target.value)}
            >
              {candidates.map((candidate) => (
                <option key={candidate.userIdentifier} value={candidate.userIdentifier}>{candidate.displayName}</option>
              ))}
            </select>
          ) : null}
          <button
            className={styles.saveButton}
            disabled={editor.isSaving || selectedIdentifier === ''}
            type="button"
            onClick={() => editor.save(selectedIdentifier)}
          >
            {SAVE_LABEL}
          </button>
          <button className={styles.cancelButton} disabled={editor.isSaving} type="button" onClick={editor.cancelEdit}>
            {CANCEL_LABEL}
          </button>
        </div>
      ) : (
        <FieldValueButton displayValue={initialDisplayName} label="Assignee" onBeginEdit={editor.beginEdit} />
      )}
      <EditorFeedback error={editor.error} justSaved={editor.justSaved} />
    </div>
  );
}
