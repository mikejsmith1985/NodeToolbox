// issueFieldEditing.ts — Editmeta-based gating plus the shared save lifecycle for inline field editors.
//
// "Which fields are editable" is decided by the issue's edit metadata, not hard-coded: Jira only
// returns a field in editmeta when the current user may set it. useFieldEditor gives every editor the
// same behavior — toggle edit mode, save through the caller's writer, and on failure surface a
// readable inline error while leaving the committed value untouched (spec FR-010).

import { useState } from 'react';

import type { FeatureReviewEditMetaField } from '../../views/SprintDashboard/featureReviewFixes.ts';

const DEFAULT_SAVE_ERROR = 'Save failed — the field was not changed.';

/** The issue edit-metadata map: field id → its settable metadata (undefined when not editable). */
export type IssueEditMeta = Record<string, FeatureReviewEditMetaField | undefined>;

/** True when the issue's edit metadata exposes this field as settable for the current user. */
export function isFieldEditable(editMeta: IssueEditMeta, fieldId: string): boolean {
  return Boolean(editMeta[fieldId]);
}

/** The editing lifecycle a single inline field editor drives its UI from. */
export interface FieldEditor {
  isEditing: boolean;
  isSaving: boolean;
  error: string | null;
  justSaved: boolean;
  beginEdit: () => void;
  cancelEdit: () => void;
  save: (valueToSave: string) => Promise<void>;
}

/**
 * Shared editing state for one field. `onSave` is the caller's write (always an existing
 * featureReviewFixes writer); a rejection becomes an inline error and the editor stays open so the
 * committed value is never optimistically changed. `onSaved` fires only after a successful write.
 */
export function useFieldEditor(
  onSave: (nextValue: string) => Promise<void>,
  onSaved?: () => void,
): FieldEditor {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  async function save(valueToSave: string): Promise<void> {
    setIsSaving(true);
    setError(null);
    try {
      await onSave(valueToSave);
      setIsEditing(false);
      setJustSaved(true);
      onSaved?.();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : DEFAULT_SAVE_ERROR);
    } finally {
      setIsSaving(false);
    }
  }

  return {
    isEditing,
    isSaving,
    error,
    justSaved,
    beginEdit: () => {
      setError(null);
      setJustSaved(false);
      setIsEditing(true);
    },
    cancelEdit: () => {
      setError(null);
      setIsEditing(false);
    },
    save,
  };
}
