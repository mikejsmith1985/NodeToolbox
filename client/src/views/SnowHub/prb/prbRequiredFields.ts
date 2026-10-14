// prbRequiredFields.ts — What Jira's create screen demands of a PRB-generated issue, found out
// BEFORE anything is posted.
//
// The PRB generator sends a fixed payload: project, summary, type, description, priority. A project
// whose Defect screen requires one more field — a root cause, a component — refused the Defect with
// "This field is required" after the SL Story had already been created (GH #384). Asking Jira what
// each screen needs first, through the same createmeta endpoints the Template Maker already uses,
// turns that into a picker shown before the click instead of an orphan issue after it.
//
// The screen is not always the whole truth: a create validator can demand a field the screen calls
// optional, and Jira then refuses the issue anyway (GH #439). A refusal therefore teaches — the field
// it names is asked for at once, and remembered per project and type so the next PRB asks first.

import { getIssueTypeFields, getProjectIssueTypes } from '../../../services/jiraApi.ts';
import type { CreateMetaFieldEntry } from '../../../types/jira.ts';
import type {
  FeatureReviewEditMetaAllowedValue,
  TransitionRequiredField,
} from '../../SprintDashboard/featureReviewFixes.ts';

/**
 * The fields the generator's own payload always carries, so a screen requiring them is satisfied.
 *
 * `reporter` is required on most screens and Jira fills it with the caller; `parent` is present on
 * the sub-task payload and never required on a screen the generator can reach without it.
 */
export const PRB_SUPPLIED_FIELD_IDS: readonly string[] = [
  'project',
  'summary',
  'issuetype',
  'description',
  'priority',
  'reporter',
  'parent',
];

/** The schema fragment Jira uses for a parent/child (cascading) select. */
const CASCADING_SELECT_SCHEMA_FRAGMENT = 'cascadingselect';

/** Thrown when the project offers no issue type by the requested name — a configuration error, not a Jira outage. */
export class MissingIssueTypeError extends Error {
  constructor(projectKey: string, issueTypeName: string) {
    super(`Project ${projectKey} has no issue type named "${issueTypeName}". Check the project key and the issue type name.`);
    this.name = 'MissingIssueTypeError';
  }
}

/** Normalizes Jira's schema info the way the transition control expects: cascading selects become 'option-with-child'. */
function readCreateFieldSchemaType(createField: CreateMetaFieldEntry): string {
  if (createField.schema?.custom?.includes(CASCADING_SELECT_SCHEMA_FRAGMENT)) {
    return 'option-with-child';
  }
  return createField.schema?.type ?? 'unknown';
}

/**
 * The required fields on a create screen that the generator's payload does not already answer.
 *
 * A field Jira fills with a default is not asked for: the screen requires it, but Jira supplies it.
 * The shape returned is the transition control's own, so the same picker that collects a required
 * transition field collects a required create field.
 */
export function readUnansweredRequiredFields(
  createFields: readonly CreateMetaFieldEntry[],
  suppliedFieldIds: readonly string[],
  refusedFieldIds: readonly string[] = [],
): TransitionRequiredField[] {
  return createFields
    .filter((createField) => !suppliedFieldIds.includes(createField.fieldId)
      // A field Jira refused the create over is required, whatever the screen and its default say.
      && (refusedFieldIds.includes(createField.fieldId)
        || (createField.required && createField.hasDefaultValue !== true)))
    .map((createField) => ({
      fieldId: createField.fieldId,
      name: createField.name?.trim() || createField.fieldId,
      schemaType: readCreateFieldSchemaType(createField),
      // Spread rather than re-shaped: a cascading select carries its child options under
      // `children`, which the createmeta type does not declare but the picker needs.
      allowedValues: (createField.allowedValues ?? []) as FeatureReviewEditMetaAllowedValue[],
    }));
}

/**
 * Asks Jira what each named issue type's create screen still needs, keyed by the name asked for.
 *
 * `refusedFieldIdsByIssueType` adds the fields Jira has refused that type over before, so a field the
 * screen calls optional but a validator demands is asked for too. One project lookup, then one screen
 * lookup per type. A name the project does not offer throws
 * `MissingIssueTypeError`, because posting an issue of a type that does not exist is a 400 the
 * operator can only fix by changing the name — better said before the other issue is created.
 */
export async function discoverRequiredFieldsByIssueType(
  projectKey: string,
  issueTypeNames: readonly string[],
  refusedFieldIdsByIssueType: Record<string, readonly string[]> = {},
): Promise<Record<string, TransitionRequiredField[]>> {
  const projectIssueTypes = (await getProjectIssueTypes(projectKey)).values ?? [];
  const requiredFieldsByIssueType: Record<string, TransitionRequiredField[]> = {};

  for (const issueTypeName of issueTypeNames) {
    const normalizedName = issueTypeName.trim().toLowerCase();
    const matchingIssueType = projectIssueTypes.find((issueType) => issueType.name.trim().toLowerCase() === normalizedName);
    if (!matchingIssueType) {
      throw new MissingIssueTypeError(projectKey, issueTypeName);
    }
    const createFields = (await getIssueTypeFields(projectKey, matchingIssueType.id)).values ?? [];
    requiredFieldsByIssueType[issueTypeName] = readUnansweredRequiredFields(
      createFields,
      PRB_SUPPLIED_FIELD_IDS,
      refusedFieldIdsByIssueType[issueTypeName] ?? [],
    );
  }

  return requiredFieldsByIssueType;
}

/**
 * Every distinct field across the issue types, in first-seen order, each listed once.
 *
 * A field two screens share (a Team, say) is asked once — one answer serves both issues, and asking
 * twice would invite two different answers for what Jira treats as one thing.
 */
export function mergeRequiredFields(
  requiredFieldsByIssueType: Record<string, readonly TransitionRequiredField[]>,
): TransitionRequiredField[] {
  const mergedByFieldId = new Map<string, TransitionRequiredField>();
  for (const requiredFields of Object.values(requiredFieldsByIssueType)) {
    for (const requiredField of requiredFields) {
      if (!mergedByFieldId.has(requiredField.fieldId)) {
        mergedByFieldId.set(requiredField.fieldId, requiredField);
      }
    }
  }
  return [...mergedByFieldId.values()];
}

/**
 * "Defect needs: Defect Root Cause, Team. Sub-task needs: Team." — which screen wants what.
 *
 * Named per issue type because the fix differs: a field only the Defect wants is a Defect screen
 * setting, and the operator deciding whether to create it as a Story instead needs to know that.
 * Types that need nothing are left out; an empty string means nothing is needed at all.
 */
export function describeRequiredFieldNeeds(
  requiredFieldsByIssueType: Record<string, readonly TransitionRequiredField[]>,
): string {
  return Object.entries(requiredFieldsByIssueType)
    .filter(([, requiredFields]) => requiredFields.length > 0)
    .map(([issueTypeName, requiredFields]) =>
      `${issueTypeName} needs: ${requiredFields.map((requiredField) => requiredField.name).join(', ')}.`)
    .join(' ');
}

// ── Learning from a refusal ──

/** Where the fields each project and type was refused over are kept, across sessions. */
const REFUSED_FIELDS_STORAGE_KEY = 'tbxPrbRefusedRequiredFields';
/** Separates the error segments Jira's client joins together ("a: msg; b: msg"). */
const ERROR_SEGMENT_SEPARATOR = /;\s*|\s+—\s+/;
/** One "fieldId: message" segment whose message says the field is required. */
const REQUIRED_FIELD_SEGMENT_PATTERN = /^([A-Za-z][\w.]*):\s.*\brequired\b/i;

/**
 * The field ids a create refusal says are required, in the order Jira listed them.
 *
 * Reads the message `jiraApi` builds, which carries each field key beside its message. A refusal
 * that names no field ("Issue Type is required.") yields nothing — there is nothing to ask for.
 */
export function readRefusedRequiredFieldIds(errorMessage: string): string[] {
  const refusedFieldIds = errorMessage
    .split(ERROR_SEGMENT_SEPARATOR)
    .map((errorSegment) => REQUIRED_FIELD_SEGMENT_PATTERN.exec(errorSegment.trim())?.[1])
    .filter((fieldId): fieldId is string => typeof fieldId === 'string');
  return [...new Set(refusedFieldIds)];
}

type RefusedFieldIdsByProject = Record<string, Record<string, string[]>>;

/** Reads everything remembered; unreadable or missing storage means nothing has been learned. */
function readAllRefusedFieldIds(): RefusedFieldIdsByProject {
  try {
    const storedValue = JSON.parse(localStorage.getItem(REFUSED_FIELDS_STORAGE_KEY) ?? '{}') as unknown;
    return storedValue !== null && typeof storedValue === 'object' ? storedValue as RefusedFieldIdsByProject : {};
  } catch {
    return {};
  }
}

/** The fields each issue type in this project has been refused over before, keyed by issue type name. */
export function readRememberedRefusedFieldIds(projectKey: string): Record<string, string[]> {
  return readAllRefusedFieldIds()[projectKey.trim().toUpperCase()] ?? {};
}

/**
 * Remembers that Jira refused this project's issue type over these fields, so the next PRB asks for
 * them before posting. A storage failure only costs the reminder, never the create, so it is swallowed.
 */
export function rememberRefusedFieldIds(projectKey: string, issueTypeName: string, refusedFieldIds: readonly string[]): void {
  if (refusedFieldIds.length === 0) return;
  const allRefusedFieldIds = readAllRefusedFieldIds();
  const normalizedProjectKey = projectKey.trim().toUpperCase();
  const projectRefusals = allRefusedFieldIds[normalizedProjectKey] ?? {};
  projectRefusals[issueTypeName] = [...new Set([...(projectRefusals[issueTypeName] ?? []), ...refusedFieldIds])];
  allRefusedFieldIds[normalizedProjectKey] = projectRefusals;
  try {
    localStorage.setItem(REFUSED_FIELDS_STORAGE_KEY, JSON.stringify(allRefusedFieldIds));
  } catch {
    // Private mode or a full quota: this session still asks, from state.
  }
}
