// IssueFieldEditingSection.tsx — Wires the inline editors to the existing featureReviewFixes writers.
//
// This is the single place that maps a field to its writer, so every write stays single-sourced
// (Art VII: the editors add shape only). Only fields the issue's editmeta marks settable render an
// editor; description stays read-only, and labels have no safe array writer so they are not offered
// here (spec FR-008 editmeta-conditional / FR-009).

import {
  readFeatureReviewSelectOptions,
  saveFeatureReviewFixVersion,
  saveFeatureReviewOptionField,
  saveFeatureReviewSimpleField,
  saveFeatureReviewUserField,
  searchFeatureReviewUsers,
} from '../../views/SprintDashboard/featureReviewFixes.ts';
import type { JiraIssue } from '../../types/jira.ts';
import { AssigneeFieldEditor, SelectFieldEditor, TextFieldEditor } from './IssueFieldEditors.tsx';
import {
  NO_FIX_VERSION_LABEL,
  isFieldEditable,
  readFixVersionOptions,
  readIssueFixVersionNames,
  type IssueEditMeta,
} from './issueFieldEditing.ts';
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
  const canEditFixVersions = isFieldEditable(editMeta, 'fixVersions');

  if (!canEditSummary && !canEditPriority && !canEditAssignee && !canEditFixVersions) {
    return null;
  }

  // The writer replaces the whole fixVersions array, so an issue carrying several would quietly lose
  // the others. That is stated rather than prevented — replacing is usually what is wanted, and
  // silently dropping a version the user could not see coming is the only unacceptable outcome.
  const currentFixVersionNames = readIssueFixVersionNames(issue);

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

      {canEditFixVersions ? (
        <>
          <SelectFieldEditor
            label="Fix Version"
            clearOptionLabel={NO_FIX_VERSION_LABEL}
            initialValue={currentFixVersionNames[0] ?? ''}
            options={readFixVersionOptions(editMeta.fixVersions)}
            onSave={(nextValue) => saveFeatureReviewFixVersion(issue.key, nextValue)}
            onSaved={onFieldSaved}
          />
          {currentFixVersionNames.length > 1 ? (
            <span className={styles.fieldHint}>
              This issue has {currentFixVersionNames.length} fix versions
              ({currentFixVersionNames.join(', ')}). Saving replaces all of them with your choice.
            </span>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
