// IssueFieldEditors.tsx — Reusable inline editors (text, single-select, assignee) for a Jira issue.
//
// These add editor SHAPE only: every save is delegated by the caller to an existing
// featureReviewFixes writer (the recorded Art VII drift — writes stay single-sourced). Each editor
// shows the current value with an Edit affordance; while editing it offers Save/Cancel and surfaces
// an inline error on failure without changing the committed value (spec FR-008/FR-010).

import { useState } from 'react';

import type {
  FeatureReviewSelectOption,
  FeatureReviewUserCandidate,
} from '../../views/SprintDashboard/featureReviewFixes.ts';
import { useFieldEditor } from './issueFieldEditing.ts';
import styles from './IssueFieldEditors.module.css';

const SAVE_LABEL = 'Save';
const CANCEL_LABEL = 'Cancel';
const EDIT_LABEL = 'Edit';
const SEARCH_LABEL = 'Search';
const SAVED_FLASH = '✓ Saved';
const EMPTY_DISPLAY = '—';
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

export interface TextFieldEditorProps {
  label: string;
  initialValue: string;
  onSave: (nextValue: string) => Promise<void>;
  onSaved?: () => void;
}

/** Inline editor for a plain single-line text field (e.g. summary). */
export function TextFieldEditor({ label, initialValue, onSave, onSaved }: TextFieldEditorProps): React.JSX.Element {
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
        <div className={styles.controls}>
          <span className={styles.fieldValue}>{initialValue || EMPTY_DISPLAY}</span>
          <button className={styles.editButton} type="button" onClick={() => { setDraft(initialValue); editor.beginEdit(); }}>
            {EDIT_LABEL}
          </button>
        </div>
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
}

/** Inline editor for a single-select option field (e.g. priority). */
export function SelectFieldEditor({ label, initialValue, options, onSave, onSaved }: SelectFieldEditorProps): React.JSX.Element {
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
            <option value="">{CHOOSE_OPTION_LABEL}</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            className={styles.saveButton}
            disabled={editor.isSaving || draft.trim() === ''}
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
        <div className={styles.controls}>
          <span className={styles.fieldValue}>{initialValue || EMPTY_DISPLAY}</span>
          <button className={styles.editButton} type="button" onClick={() => { setDraft(initialValue); editor.beginEdit(); }}>
            {EDIT_LABEL}
          </button>
        </div>
      )}
      <EditorFeedback error={editor.error} justSaved={editor.justSaved} />
    </div>
  );
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
        <div className={styles.controls}>
          <span className={styles.fieldValue}>{initialDisplayName || EMPTY_DISPLAY}</span>
          <button className={styles.editButton} type="button" onClick={editor.beginEdit}>{EDIT_LABEL}</button>
        </div>
      )}
      <EditorFeedback error={editor.error} justSaved={editor.justSaved} />
    </div>
  );
}
