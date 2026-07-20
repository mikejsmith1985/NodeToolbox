// IssueFieldEditingSection.tsx — Wires the inline editors to the existing featureReviewFixes writers.
//
// This is the single place that maps a field to its writer, so every write stays single-sourced
// (Art VII: the editors add shape only). Only fields the issue's editmeta marks settable render an
// editor; description stays read-only, and labels have no safe array writer so they are not offered
// here (spec FR-008 editmeta-conditional / FR-009).

import {
  readFeatureReviewSelectOptions,
  saveFeatureReviewOptionField,
  saveFeatureReviewSimpleField,
  saveFeatureReviewUserField,
  searchFeatureReviewUsers,
} from '../../views/SprintDashboard/featureReviewFixes.ts';
import type { JiraIssue } from '../../types/jira.ts';
import { AssigneeFieldEditor, SelectFieldEditor, TextFieldEditor } from './IssueFieldEditors.tsx';
import { isFieldEditable, type IssueEditMeta } from './issueFieldEditing.ts';
import styles from './IssueFieldEditors.module.css';

const SECTION_LABEL = 'Edit fields';

/** The editing capability an IssueDetailPanel host supplies to turn on in-place editing. */
export interface IssueFieldEditingConfig {
  editMeta: IssueEditMeta;
  /** Called after any field save succeeds, so the host can refetch the issue. */
  onFieldSaved: () => void;
}

export interface IssueFieldEditingSectionProps extends IssueFieldEditingConfig {
  issue: JiraIssue;
}

/** Renders the editable-field controls for the fields this issue's editmeta allows. */
export function IssueFieldEditingSection({ issue, editMeta, onFieldSaved }: IssueFieldEditingSectionProps): React.JSX.Element | null {
  const canEditSummary = isFieldEditable(editMeta, 'summary');
  const canEditPriority = isFieldEditable(editMeta, 'priority');
  const canEditAssignee = isFieldEditable(editMeta, 'assignee');

  if (!canEditSummary && !canEditPriority && !canEditAssignee) {
    return null;
  }

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>{SECTION_LABEL}</span>

      {canEditSummary ? (
        <TextFieldEditor
          label="Summary"
          initialValue={issue.fields.summary}
          onSave={(nextValue) => saveFeatureReviewSimpleField(issue.key, 'summary', nextValue)}
          onSaved={onFieldSaved}
        />
      ) : null}

      {canEditPriority ? (
        <SelectFieldEditor
          label="Priority"
          initialValue={issue.fields.priority?.name ?? ''}
          options={readFeatureReviewSelectOptions(editMeta.priority)}
          onSave={(nextValue) => saveFeatureReviewOptionField(issue.key, 'priority', nextValue, editMeta.priority)}
          onSaved={onFieldSaved}
        />
      ) : null}

      {canEditAssignee ? (
        <AssigneeFieldEditor
          initialDisplayName={issue.fields.assignee?.displayName ?? 'Unassigned'}
          onSearchUsers={searchFeatureReviewUsers}
          onSave={(userIdentifier) => saveFeatureReviewUserField(issue.key, 'assignee', userIdentifier)}
          onSaved={onFieldSaved}
        />
      ) : null}
    </div>
  );
}
