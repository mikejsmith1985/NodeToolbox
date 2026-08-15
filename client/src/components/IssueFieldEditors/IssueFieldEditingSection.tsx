// IssueFieldEditingSection.tsx — Every field this issue can be edited through, empty ones first.
//
// This used to render four hard-coded fields: summary, priority, assignee, fix version. Those were
// the four somebody had written writers for, so those were the four that could be changed — and any
// other field meant leaving for Jira.
//
// It now renders whatever `GET /issue/{key}/editmeta` says the current user may set on this issue,
// which is the same question Jira's own edit dialog asks. See `editableFieldPlan.ts` for why the
// EMPTY fields lead: Jira's detail view will happily change a field that already has a value and
// simply does not render one that is blank, so the case that costs a round trip is the case its
// shortcut never covered.
//
// Every write still goes through a writer that already shipped (Art VII: this adds shape only).

import { useMemo, useState } from 'react';

import { searchFeatureReviewUsers } from '../../views/SprintDashboard/featureReviewFixes.ts';
import type { JiraIssue } from '../../types/jira.ts';
import { AssigneeFieldEditor, SelectFieldEditor, TextFieldEditor } from './IssueFieldEditors.tsx';
import {
  buildEditableFieldPlan,
  filterFieldPlans,
  readFieldOptions,
  type EditableFieldPlan,
} from './editableFieldPlan.ts';
import { saveEditableField } from './editableFieldWrite.ts';
import { NO_FIX_VERSION_LABEL, type IssueEditMeta } from './issueFieldEditing.ts';
import styles from './IssueFieldEditors.module.css';

const SECTION_LABEL = 'Edit fields';

/** Above this many fields the list needs a way in, and below it a search box is just clutter. */
const FILTER_VISIBLE_THRESHOLD = 8;

/** The editing capability an IssueDetailPanel host supplies to turn on in-place editing. */
export interface IssueFieldEditingConfig {
  editMeta: IssueEditMeta;
  /** Called after any field save succeeds, so the host can refetch the issue. */
  onFieldSaved: () => void;
}

export interface IssueFieldEditingSectionProps extends IssueFieldEditingConfig {
  issue: JiraIssue;
}

/** Renders one field with the control its type calls for. */
function FieldEditor({
  fieldPlan,
  issueKey,
  onFieldSaved,
}: {
  fieldPlan: EditableFieldPlan;
  issueKey: string;
  onFieldSaved: () => void;
}): React.JSX.Element {
  const save = (nextValue: string) => saveEditableField(issueKey, fieldPlan, nextValue);

  if (fieldPlan.editorKind === 'user') {
    return (
      <AssigneeFieldEditor
        initialDisplayName={fieldPlan.displayValue || 'Unassigned'}
        onSearchUsers={searchFeatureReviewUsers}
        onSave={save}
        onSaved={onFieldSaved}
      />
    );
  }

  if (fieldPlan.editorKind === 'select') {
    return (
      <SelectFieldEditor
        label={fieldPlan.label}
        // Every select can be emptied. A field you can set but never unset is a trap, and clearing
        // one was another of the trips to Jira this exists to remove.
        clearOptionLabel={NO_FIX_VERSION_LABEL}
        initialValue={fieldPlan.currentValue}
        options={readFieldOptions(fieldPlan)}
        onSave={save}
        onSaved={onFieldSaved}
      />
    );
  }

  return (
    <TextFieldEditor
      label={fieldPlan.label}
      initialValue={fieldPlan.currentValue}
      inputType={fieldPlan.editorKind === 'number' ? 'number' : fieldPlan.editorKind === 'date' ? 'date' : 'text'}
      onSave={save}
      onSaved={onFieldSaved}
    />
  );
}

/** Renders the editable-field controls for every field this issue's editmeta allows. */
export function IssueFieldEditingSection({
  issue,
  editMeta,
  onFieldSaved,
}: IssueFieldEditingSectionProps): React.JSX.Element | null {
  const [filterText, setFilterText] = useState('');

  const plan = useMemo(
    () => buildEditableFieldPlan(editMeta, issue.fields as unknown as Record<string, unknown>),
    [editMeta, issue.fields],
  );

  if (plan.fields.length === 0) return null;

  const visibleFields = filterFieldPlans(plan.fields, filterText);
  const emptyFieldCount = plan.fields.filter((field) => field.isEmpty).length;

  return (
    <div className={styles.section}>
      <span className={styles.sectionLabel}>{SECTION_LABEL}</span>

      {/* Says what the panel is for, in the one number that makes the case: this many fields are
          blank on this issue, and every one of them is a field Jira would have made you open a new
          tab and find the Edit button to fill in. */}
      {emptyFieldCount > 0 ? (
        <span className={styles.fieldHint}>{emptyFieldCount} of these are not set yet</span>
      ) : null}

      {plan.fields.length > FILTER_VISIBLE_THRESHOLD ? (
        <input
          aria-label="Find a field"
          className={styles.input}
          placeholder="Find a field…"
          value={filterText}
          onChange={(changeEvent) => setFilterText(changeEvent.target.value)}
        />
      ) : null}

      {visibleFields.map((fieldPlan) => (
        <div key={fieldPlan.fieldId}>
          <FieldEditor fieldPlan={fieldPlan} issueKey={issue.key} onFieldSaved={onFieldSaved} />
          {/* Said BEFORE the save, not after it. Replacing is usually what somebody means; silently
              dropping values they could not see coming is the only unacceptable outcome. */}
          {fieldPlan.isReplacingList ? (
            <span className={styles.fieldHint}>
              This field has {fieldPlan.displayValue.split(', ').length} values
              ({fieldPlan.displayValue}). Saving replaces all of them with your choice.
            </span>
          ) : null}
        </div>
      ))}

      {visibleFields.length === 0 ? (
        <span className={styles.fieldHint}>No field here matches “{filterText}”.</span>
      ) : null}

      {/* Named, not hidden. A panel that quietly omits fields is indistinguishable from one that
          never saw them, and the promise here is that the list is what Jira actually offers. */}
      {plan.unsupported.length > 0 ? (
        <span className={styles.fieldHint}>
          {plan.unsupported.length} more field{plan.unsupported.length === 1 ? '' : 's'} Jira allows
          that this panel cannot edit yet: {plan.unsupported.map((field) => field.label).join(', ')}.
        </span>
      ) : null}
    </div>
  );
}
