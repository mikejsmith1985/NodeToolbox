// templateShareFormat.ts — Checks a shared change template field by field, keeping only the values the Wizard knows about.
//
// A shared template arrives from someone else (pasted from Teams or email, or a file), so nothing in it is trusted:
// every known value must be the right kind, anything unknown is dropped, and any problem stops with a plain reason.

import type { CrgTemplate, CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import { PLAN_ENVIRONMENT_KEYS, type PlanEnvironmentKey } from './ctaskEnvironmentPlan.ts';

/** Thrown inside this module only; decodeTemplateShare turns it into a plain-English answer for the user. */
export class TemplateShareFormatError extends Error {}

/** The plain reason for a value of the wrong kind or shape. */
export const DAMAGED_TEMPLATE_MESSAGE = 'This template code is damaged or was changed after it was shared. Ask for it again.';
const MISSING_DETAILS_MESSAGE = 'This template is missing some of its details, so it cannot be added. Ask for it again.';
const NO_NAME_MESSAGE = 'This template has no readable name, so it cannot be added. Ask for it again.';
const TOO_MANY_TASKS_MESSAGE = 'This template has more tasks than the Wizard can keep. Ask for a smaller one.';
// The same ceiling Toolbox's own task template store keeps (useCtaskTemplates).
const MAX_SHARED_TASKS = 100;

type FieldKind = 'text' | 'flag' | 'person';
type FieldSpec = Readonly<Record<string, FieldKind>>;
type PlainObject = Record<string, unknown>;

const PERSON_SPEC: FieldSpec = { sysId: 'text', displayName: 'text' };
const BASIC_INFO_SPEC: FieldSpec = {
  category: 'text', changeType: 'text', environment: 'text', requestedBy: 'person', configItem: 'person', assignmentGroup: 'person',
  assignedTo: 'person', changeManager: 'person', tester: 'person', serviceManager: 'person', isExpedited: 'flag',
};
const ASSESSMENT_SPEC: FieldSpec = {
  impact: 'text', systemAvailabilityImplication: 'text', hasBeenTested: 'text', impactedPersonsAware: 'text',
  hasBeenPerformedPreviously: 'text', successProbability: 'text', canBeBackedOut: 'text',
};
const CONTENT_SPEC: FieldSpec = { implementationPlan: 'text', backoutPlan: 'text', testPlan: 'text' };
const TITLE_PARTS_SPEC: FieldSpec = { application: 'text', team: 'text', changeDetailsOverride: 'text' };
const ENVIRONMENT_SPEC: FieldSpec = {
  isEnabled: 'flag', plannedStartDate: 'text', plannedEndDate: 'text', configItem: 'person', impactedPersonsAware: 'text', snowEnvironmentValue: 'text',
};
const TASK_SPEC: FieldSpec = {
  shortDescription: 'text', description: 'text', assignmentGroup: 'person', assignedTo: 'person', plannedStartDate: 'text', plannedEndDate: 'text', closeNotes: 'text',
};
const OPTIONAL_TASK_TEXTS = ['changeTaskType', 'startOffsetMinutes', 'durationMinutes'] as const;
const ESTIMATES_SPEC: FieldSpec = { implementationMinutes: 'text', validationMinutes: 'text', backoutMinutes: 'text' };
const ENVIRONMENT_KEYS = ['relEnvironment', 'prdEnvironment', 'pfixEnvironment'] as const;

/** Whether a value is a plain `{ … }` object (not a list, not empty). */
export function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One known value: absent becomes empty; the wrong kind stops the import. */
function readField(value: unknown, kind: FieldKind): unknown {
  if (kind === 'person') return readSpecObject(value ?? {}, PERSON_SPEC);
  const emptyValue = kind === 'flag' ? false : '';
  if (value === undefined || value === null) return emptyValue;
  if (typeof value !== (kind === 'flag' ? 'boolean' : 'string')) throw new TemplateShareFormatError(DAMAGED_TEMPLATE_MESSAGE);
  return value;
}

/** A known group of values, every listed field read and everything else dropped. */
function readSpecObject(value: unknown, spec: FieldSpec): PlainObject {
  if (!isPlainObject(value)) throw new TemplateShareFormatError(DAMAGED_TEMPLATE_MESSAGE);
  return Object.fromEntries(Object.entries(spec).map(([fieldKey, kind]) => [fieldKey, readField(value[fieldKey], kind)]));
}

/** A group the template cannot do without. */
function readRequiredSection(value: unknown, spec: FieldSpec): PlainObject {
  if (!isPlainObject(value)) throw new TemplateShareFormatError(MISSING_DETAILS_MESSAGE);
  return readSpecObject(value, spec);
}

/** A non-empty name. */
function readName(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new TemplateShareFormatError(NO_NAME_MESSAGE);
  return value.trim();
}

/** The optional parts of a template, each kept only when present and well formed. */
function readOptionalTemplateParts(rawTemplate: PlainObject): Partial<CrgTemplate> {
  const optionalParts: PlainObject = {};
  if (rawTemplate.shortDescriptionConfig !== undefined) optionalParts.shortDescriptionConfig = readSpecObject(rawTemplate.shortDescriptionConfig, TITLE_PARTS_SPEC);
  for (const environmentKey of ENVIRONMENT_KEYS) {
    if (rawTemplate[environmentKey] !== undefined) optionalParts[environmentKey] = readSpecObject(rawTemplate[environmentKey], ENVIRONMENT_SPEC);
  }
  if (rawTemplate.reconcileAutoCtasks !== undefined) optionalParts.reconcileAutoCtasks = readField(rawTemplate.reconcileAutoCtasks, 'flag');
  return optionalParts as Partial<CrgTemplate>;
}

/** The linked task ids, kept only when each one is a task that travels with the template. */
function readLinkedTaskIds(value: unknown, sharedTaskIds: ReadonlySet<string>): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((linkedId) => typeof linkedId !== 'string')) throw new TemplateShareFormatError(DAMAGED_TEMPLATE_MESSAGE);
  return (value as string[]).filter((linkedId) => sharedTaskIds.has(linkedId));
}

/**
 * A change template rebuilt from known fields only. Personal field pins (`customSnowFields`) never travel: they name
 * raw ServiceNow columns, so a shared one could quietly set values nobody sees on screen.
 */
export function readSharedTemplate(value: unknown, sharedTaskIds: ReadonlySet<string>): CrgTemplate {
  if (!isPlainObject(value)) throw new TemplateShareFormatError('This code has no template in it. Ask for it again.');
  return {
    id: typeof value.id === 'string' ? value.id : '',
    name: readName(value.name),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    chgBasicInfo: readRequiredSection(value.chgBasicInfo, BASIC_INFO_SPEC) as unknown as CrgTemplate['chgBasicInfo'],
    chgPlanningAssessment: readRequiredSection(value.chgPlanningAssessment, ASSESSMENT_SPEC) as unknown as CrgTemplate['chgPlanningAssessment'],
    chgPlanningContent: readRequiredSection(value.chgPlanningContent, CONTENT_SPEC) as unknown as CrgTemplate['chgPlanningContent'],
    ...readOptionalTemplateParts(value),
    ctaskTemplateIds: readLinkedTaskIds(value.ctaskTemplateIds, sharedTaskIds),
  };
}

/** The environments a task goes on: only REL / PRD / PFIX are kept; anything that is not a list of words stops the import. */
function readEnvironmentKeys(value: unknown): PlanEnvironmentKey[] {
  if (!Array.isArray(value) || value.some((environmentKey) => typeof environmentKey !== 'string')) throw new TemplateShareFormatError(DAMAGED_TEMPLATE_MESSAGE);
  return PLAN_ENVIRONMENT_KEYS.filter((environmentKey) => (value as string[]).includes(environmentKey));
}

/** One task template rebuilt from known fields only; the id is kept just long enough to relink it. */
function readSharedTask(value: unknown): CtaskTemplate {
  if (!isPlainObject(value) || typeof value.id !== 'string' || value.id === '') throw new TemplateShareFormatError(DAMAGED_TEMPLATE_MESSAGE);
  const sharedTask: PlainObject = { id: value.id, name: readName(value.name), createdAt: '', ...readSpecObject(value, TASK_SPEC) };
  for (const optionalKey of OPTIONAL_TASK_TEXTS) if (value[optionalKey] !== undefined) sharedTask[optionalKey] = readField(value[optionalKey], 'text');
  if (value.durationEstimates !== undefined) sharedTask.durationEstimates = readSpecObject(value.durationEstimates, ESTIMATES_SPEC);
  if (value.environmentKeys !== undefined) sharedTask.environmentKeys = readEnvironmentKeys(value.environmentKeys);
  return sharedTask as unknown as CtaskTemplate;
}

/** Every shared task template, checked. Absent means none. */
export function readSharedTasks(value: unknown): CtaskTemplate[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TemplateShareFormatError(DAMAGED_TEMPLATE_MESSAGE);
  if (value.length > MAX_SHARED_TASKS) throw new TemplateShareFormatError(TOO_MANY_TASKS_MESSAGE);
  return value.map(readSharedTask);
}
