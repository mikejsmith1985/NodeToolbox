// editableFieldPlan.ts — Every field this issue can actually be edited through, empty ones first.
//
// This is the product's whole argument for existing, so it is worth stating precisely.
//
// Jira's own detail view will let you change a field that ALREADY HAS a value. A field that is empty
// is simply not rendered — so setting a fix version on an issue that has none means opening the issue
// in a new tab, finding the Edit button, waiting for the edit dialog, and scrolling for the field.
// The one case where the shortcut is most needed is the one case the shortcut does not cover.
//
// Nothing about that is a law of Jira. `GET /issue/{key}/editmeta` returns every field the CURRENT
// USER may set on THIS issue, with its type and its allowed values, whether or not the field has a
// value today. Everything below is read out of that answer. The board previously hard-coded four
// fields (summary, priority, assignee, fix version) and so could only ever edit four; asking Jira
// instead means the list is correct on every issue type, in every project, without being maintained.
//
// Empty fields are listed FIRST and counted, because they are the ones that cost a trip to Jira.

import {
  readFeatureReviewSelectOptions,
  type FeatureReviewEditMetaField,
} from '../../views/SprintDashboard/featureReviewFixes.ts';
import { readFixVersionOptions, type IssueEditMeta } from './issueFieldEditing.ts';

/** How a field is edited — one per control the panel knows how to draw. */
export type FieldEditorKind = 'text' | 'multiline' | 'number' | 'date' | 'select' | 'user';

/** One editable field, ready to render. */
export interface EditableFieldPlan {
  fieldId: string;
  label: string;
  editorKind: FieldEditorKind;
  /** What the issue holds now, as the control's own value. Empty string means unset. */
  currentValue: string;
  /** What to show when not editing — a name rather than an id, where the two differ. */
  displayValue: string;
  /** True when the issue has no value here. The reason this module exists. */
  isEmpty: boolean;
  /** True when the writer replaces a whole array, so the panel can say so before it happens. */
  isReplacingList: boolean;
  editMetaField: FeatureReviewEditMetaField | undefined;
}

/** A field Jira offered that the panel has no control for, kept so the count can be honest. */
export interface UnsupportedField {
  fieldId: string;
  label: string;
  reason: string;
}

export interface EditableFieldPlanResult {
  fields: EditableFieldPlan[];
  unsupported: UnsupportedField[];
}

/**
 * Fields deliberately left out, each for its own reason — never because they were awkward.
 *
 * `description` is the important one: this instance stores wiki markup, and a plain text box would
 * hand back a flattened copy that silently destroyed the formatting. It stays read-only until there
 * is an editor that round-trips the markup, which is a separate piece of work.
 */
const EXCLUDED_FIELD_IDS = new Set([
  'description',
  'comment',
  'attachment',
  'issuelinks',
  'worklog',
  'timetracking',
  'project',
  'issuetype',
]);

/** Schema types that map onto a select, because Jira supplies the permitted values. */
const SELECT_SCHEMA_TYPES = new Set([
  'option', 'priority', 'resolution', 'version', 'component', 'securitylevel', 'option-with-child',
]);

/** Reads a field's value out of an issue as the string its control uses. */
function readCurrentValue(rawValue: unknown, editorKind: FieldEditorKind): { value: string; display: string } {
  if (rawValue === null || rawValue === undefined) return { value: '', display: '' };

  // An array field: the first entry drives the control, and the panel warns that saving replaces all.
  if (Array.isArray(rawValue)) {
    const names = rawValue.map((entry) => readSingleName(entry)).filter((name) => name !== '');
    return { value: names[0] ?? '', display: names.join(', ') };
  }

  if (editorKind === 'date' && typeof rawValue === 'string') {
    // Jira returns datetimes as `2026-08-15T09:00:00.000+0000`; a date input wants the day alone.
    const dayOnly = rawValue.slice(0, 10);
    return { value: dayOnly, display: dayOnly };
  }

  const name = readSingleName(rawValue);
  return { value: name, display: name };
}

/** The readable name of one Jira value, whatever shape the field wraps it in. */
function readSingleName(rawValue: unknown): string {
  if (rawValue === null || rawValue === undefined) return '';
  if (typeof rawValue === 'string' || typeof rawValue === 'number') return String(rawValue);
  const objectValue = rawValue as Record<string, unknown>;
  const named = objectValue.displayName ?? objectValue.name ?? objectValue.value ?? objectValue.key;
  return named === undefined ? '' : String(named);
}

/** Which control a field's schema calls for, or null when the panel cannot edit it safely. */
export function resolveEditorKind(
  editMetaField: FeatureReviewEditMetaField | undefined,
): FieldEditorKind | null {
  if (editMetaField === undefined) return null;
  const itemType = editMetaField.schema?.items ?? '';

  // Allowed values settle it regardless of type: Jira has said exactly what it will accept, so a
  // select is both the safest control and the only one that cannot produce a rejected write.
  if ((editMetaField.allowedValues?.length ?? 0) > 0) return 'select';

  // No declared type at all is different from a type this does not recognise. Jira omits the schema
  // on a few plain fields, and treating that as unsupported would drop fields it can perfectly well
  // edit; an UNRECOGNISED type still falls through to unsupported below, because guessing a control
  // for it would write a shape Jira refuses.
  if (editMetaField.schema?.type === undefined) return 'text';
  const schemaType = editMetaField.schema.type;

  if (schemaType === 'user') return 'user';
  if (schemaType === 'number') return 'number';
  if (schemaType === 'date' || schemaType === 'datetime') return 'date';
  if (schemaType === 'string') return 'text';
  if (schemaType === 'any') return 'text';
  if (SELECT_SCHEMA_TYPES.has(schemaType)) return 'select';

  // An array of free text — labels being the usual one. Comma-separated is how Jira's own edit
  // dialog reads them back, so it is the shape people already expect.
  if (schemaType === 'array' && (itemType === 'string' || itemType === '')) return 'text';
  if (schemaType === 'array' && itemType === 'user') return 'user';
  if (schemaType === 'array') return 'select';

  return null;
}

/**
 * Builds the panel's field list from Jira's edit metadata and the issue's current values.
 *
 * Empty fields sort first, then everything else, each group alphabetical — so the fields that
 * actually cost a trip to Jira are the ones under the cursor when the panel opens.
 */
export function buildEditableFieldPlan(
  editMeta: IssueEditMeta,
  issueFields: Record<string, unknown>,
): EditableFieldPlanResult {
  const fields: EditableFieldPlan[] = [];
  const unsupported: UnsupportedField[] = [];

  for (const [fieldId, editMetaField] of Object.entries(editMeta ?? {})) {
    if (EXCLUDED_FIELD_IDS.has(fieldId)) continue;
    const label = editMetaField?.name ?? fieldId;

    const editorKind = resolveEditorKind(editMetaField);
    if (editorKind === null) {
      // Named, not hidden. A panel that silently drops fields is indistinguishable from one that
      // never saw them, and the whole promise here is that the list is complete.
      unsupported.push({
        fieldId,
        label,
        reason: `no editor for ${editMetaField?.schema?.type ?? 'unknown'} fields yet`,
      });
      continue;
    }

    const rawValue = (issueFields ?? {})[fieldId];
    const { value, display } = readCurrentValue(rawValue, editorKind);
    fields.push({
      fieldId,
      label,
      editorKind,
      currentValue: value,
      displayValue: display,
      isEmpty: display === '',
      isReplacingList: Array.isArray(rawValue) && rawValue.length > 1,
      editMetaField,
    });
  }

  fields.sort((leftField, rightField) => {
    if (leftField.isEmpty !== rightField.isEmpty) return leftField.isEmpty ? -1 : 1;
    return leftField.label.localeCompare(rightField.label);
  });

  return { fields, unsupported };
}

/**
 * The choices a select offers for one field.
 *
 * Version fields need their OWN reader, and the reason is a silent-corruption bug rather than a
 * preference. The general reader prefers an option's `id`, which is right for priority — but the
 * fix-version writer sends `{ name }`, so an id-keyed option would post a numeric id as though it
 * were a version name. It also drops released and archived versions, which Jira refuses to add.
 */
export function readFieldOptions(fieldPlan: EditableFieldPlan): Array<{ label: string; value: string }> {
  const isVersionField = fieldPlan.fieldId === 'fixVersions'
    || fieldPlan.editMetaField?.schema?.items === 'version'
    || fieldPlan.editMetaField?.schema?.type === 'version';

  return isVersionField
    ? readFixVersionOptions(fieldPlan.editMetaField)
    : readFeatureReviewSelectOptions(fieldPlan.editMetaField);
}

/** Narrows the list to what somebody typed, so a 50-field issue stays usable. */
export function filterFieldPlans(
  fields: readonly EditableFieldPlan[],
  queryText: string,
): EditableFieldPlan[] {
  const normalizedQuery = queryText.trim().toLowerCase();
  if (normalizedQuery === '') return [...fields];
  return fields.filter((field) => field.label.toLowerCase().includes(normalizedQuery));
}
