// prbJiraCreate.ts — Makes the problem's Jira work the user chose: creates the items wanted new (Defect, SL Story,
// QE Story) on the Epic, labels any issue picked from Jira so it counts as this problem's, links each story to the
// Defect — and on a retry does only what is still missing.
//
// Framework-first: every write goes through Toolbox's own jiraApi (createIssue, createIssueLink, jiraPut, createmeta
// readers) and the Epic Link field is found BY NAME through jiraFieldMapping. What is custom is only the order and the
// "what already exists" bookkeeping, which Toolbox's PRB Generator (Defect + sub-tasks, no Epic, no retry) lacks.

import {
  createIssue,
  createIssueLink,
  getIssueTypeFields,
  getProjectIssueTypes,
  jiraGet,
  jiraPut,
} from '../../services/jiraApi.ts';
import { FIELD_MAPPING_ENTRIES, readFieldMappingOverrides, resolveFieldMapping } from '../../services/jiraFieldMapping.ts';
import type { CreateMetaFieldEntry, CreateMetaIssueType } from '../../types/jira.ts';
import { escapeJqlValue } from '../../utils/jqlValue.ts';
import {
  buildPrbLabel,
  buildPrbRoleLabel,
  hasPrbRoleLabel,
  PRB_JIRA_ROLES,
  readNewRoles,
  readRoleFromLabels,
  type PrbExistingIssue,
  type PrbJiraDraft,
  type PrbJiraRole,
  type PrbRoleChoices,
} from './prbJiraPlan.ts';
import { EXISTING_ISSUE_FIELDS, readExistingIssue, type JiraSearchIssue } from './prbLookups.ts';
import { stampDefectKeyOnProblem, statementHasDefectKey } from './prbProblemStatement.ts';

// ── Types ──

/**
 * What is done so far: the key for each item (made or picked), which stories are linked to the Defect, and which
 * picked issues carry the problem's labels.
 */
export interface PrbCreateProgress {
  createdKeys: Partial<Record<PrbJiraRole, string>>;
  linkedRoles: PrbJiraRole[];
  labelledRoles: PrbJiraRole[];
  /** True once the problem's Problem statement ends with the Defect's key (GH #475). */
  isProblemStamped: boolean;
}

/** One thing that did not happen, in words the user can act on. */
export interface PrbCreateFailure {
  role: PrbJiraRole;
  stage: 'prepare' | 'create' | 'label' | 'link' | 'problem';
  message: string;
}

/** The outcome of one Create (or Retry) press. */
export interface PrbCreateResult {
  progress: PrbCreateProgress;
  failures: PrbCreateFailure[];
  isComplete: boolean;
}

/** Everything one Create press needs. */
export interface PrbCreateRequest {
  prbNumber: string;
  /** The problem's ServiceNow record, whose Problem statement gets the Defect's key. */
  problemSysId: string;
  /** The Problem statement as last read, so a key already on it is not written again. */
  problemStatement: string;
  projectKey: string;
  epicKey: string;
  drafts: readonly PrbJiraDraft[];
  /** For each item: make it new, use an issue already in Jira, or leave it out. */
  roleChoices: PrbRoleChoices;
  /** What earlier presses already did (empty on the first). */
  startingProgress: PrbCreateProgress;
}

/** Nothing done yet. */
export const EMPTY_PRB_PROGRESS: PrbCreateProgress = { createdKeys: {}, linkedRoles: [], labelledRoles: [], isProblemStamped: false };

/** The Jira link type joining each story to the Defect. */
export const RELATES_LINK_TYPE_NAME = 'Relates';

const STORY_ROLES: readonly PrbJiraRole[] = ['sl', 'qe'];
const EXISTING_SEARCH_MAX_RESULTS = 50;
const PARENT_FIELD_ID = 'parent';
const EPIC_LINK_SETTINGS_KEY = 'epicLinkFieldId';
const DEFECT_TYPE_NAMES = ['defect', 'bug'];
const STORY_TYPE_NAMES = ['story'];
/** The Defect's environment: a PRB is always a problem found in Production (owner's rule). Found BY NAME on the form. */
const DEFECT_ENVIRONMENT_FIELD_NAME = 'defect environment';
const DEFECT_ENVIRONMENT_VALUE = 'production';
const UNKNOWN_FAILURE = 'Jira refused the request';

// ── Existing work ──

/** Which role an existing item plays: its role label first, then its type and summary for items made by hand. */
function readExistingRole(issue: PrbExistingIssue, prbNumber: string): PrbJiraRole | null {
  const labelledRole = readRoleFromLabels(issue.labels, prbNumber);
  if (labelledRole) return labelledRole;
  if (DEFECT_TYPE_NAMES.includes(issue.issueTypeName.toLowerCase())) return 'defect';
  const summary = issue.summary.trim();
  // Both the bracketed "[SL] …" naming and the older "SL: …" are recognised for items made by hand.
  if (/^\[?SL\b/i.test(summary)) return 'sl';
  return /^\[?QE\b/i.test(summary) ? 'qe' : null;
}

/**
 * Looks Jira up for items already made for this problem (by its `prb-<number>` label) and says which role each plays.
 * The first item found for a role wins.
 */
export async function findExistingPrbIssues(prbNumber: string): Promise<Partial<Record<PrbJiraRole, PrbExistingIssue>>> {
  const jql = `labels = "${escapeJqlValue(buildPrbLabel(prbNumber))}" ORDER BY created ASC`;
  const response = await jiraGet<{ issues?: JiraSearchIssue[] }>(
    `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${EXISTING_ISSUE_FIELDS}&maxResults=${EXISTING_SEARCH_MAX_RESULTS}`,
  );
  const foundIssues: Partial<Record<PrbJiraRole, PrbExistingIssue>> = {};
  for (const issue of (response?.issues ?? []).map(readExistingIssue)) {
    const role = readExistingRole(issue, prbNumber);
    if (role && !foundIssues[role]) foundIssues[role] = issue;
  }
  return foundIssues;
}

// ── Progress from the choices ──

function readPickedIssue(choices: PrbRoleChoices, role: PrbJiraRole): PrbExistingIssue | null {
  const choice = choices[role];
  return choice.mode === 'existing' ? choice.issue : null;
}

/** True when Jira already shows a link between the two picked issues, from either side. */
function arePickedIssuesLinked(defectIssue: PrbExistingIssue | null, storyIssue: PrbExistingIssue | null): boolean {
  if (!defectIssue || !storyIssue) return false;
  return storyIssue.linkedKeys.includes(defectIssue.key) || defectIssue.linkedKeys.includes(storyIssue.key);
}

/**
 * Where a press starts: what earlier presses did, plus every issue the user picked from Jira — with the labels and
 * links those picked issues already carry, and a Problem statement that already names the Defect, so nothing is done
 * twice.
 */
export function buildStartingProgress(
  prbNumber: string,
  choices: PrbRoleChoices,
  earlierProgress: PrbCreateProgress,
  problemStatement = '',
): PrbCreateProgress {
  const progress: PrbCreateProgress = {
    createdKeys: { ...earlierProgress.createdKeys },
    linkedRoles: [...earlierProgress.linkedRoles],
    labelledRoles: [...earlierProgress.labelledRoles],
    isProblemStamped: earlierProgress.isProblemStamped,
  };
  for (const role of PRB_JIRA_ROLES) {
    const pickedIssue = readPickedIssue(choices, role);
    if (!pickedIssue || progress.createdKeys[role]) continue;
    progress.createdKeys[role] = pickedIssue.key;
    if (hasPrbRoleLabel(pickedIssue, prbNumber, role)) progress.labelledRoles.push(role);
  }
  const defectIssue = readPickedIssue(choices, 'defect');
  for (const role of STORY_ROLES) {
    if (!progress.linkedRoles.includes(role) && arePickedIssuesLinked(defectIssue, readPickedIssue(choices, role))) progress.linkedRoles.push(role);
  }
  const defectKey = progress.createdKeys.defect;
  if (defectKey && statementHasDefectKey(problemStatement, defectKey)) progress.isProblemStamped = true;
  return progress;
}

/**
 * True when every chosen item is in Jira, every picked one is labelled, every story is linked to the Defect, and the
 * problem's Problem statement names the Defect.
 */
export function isPrbWorkComplete(progress: PrbCreateProgress, choices: PrbRoleChoices): boolean {
  const isEveryItemThere = PRB_JIRA_ROLES.every((role) => choices[role].mode === 'skip' || Boolean(progress.createdKeys[role]));
  const isEveryPickLabelled = PRB_JIRA_ROLES.every((role) => choices[role].mode !== 'existing' || progress.labelledRoles.includes(role));
  const isEveryStoryLinked = !progress.createdKeys.defect
    || STORY_ROLES.every((role) => !progress.createdKeys[role] || progress.linkedRoles.includes(role));
  const isProblemStamped = !progress.createdKeys.defect || progress.isProblemStamped;
  return isEveryItemThere && isEveryPickLabelled && isEveryStoryLinked && isProblemStamped;
}

/** True when pressing Create would change anything in Jira — false when everything chosen is already done. */
export function hasPrbWorkToDo(prbNumber: string, choices: PrbRoleChoices, problemStatement = ''): boolean {
  return !isPrbWorkComplete(buildStartingProgress(prbNumber, choices, EMPTY_PRB_PROGRESS, problemStatement), choices);
}

// ── Create screens ──

/** How one issue type takes its Epic: a named Epic Link field, or the newer parent field. */
interface EpicPlacement {
  issueTypeId: string;
  epicFieldId: string;
  /** Fields this role always carries, already in Jira's write shape (the Defect's environment). */
  fixedFields: Record<string, unknown>;
  /** Field id → its name on the form, so a refusal can name the field instead of hiding its id. */
  fieldNames: Record<string, string>;
}

// "Jira POST /rest/api/2/issue failed: " — the request line means nothing to the person reading it.
const REQUEST_PREFIX_PATTERN = /^Jira \w+ \S+ failed:\s*/;
// "<internal field id>: " before Jira's own sentence — internal ids are never shown on screen.
const INTERNAL_FIELD_ID_PATTERN = /\b\w*field_\d+:\s*/gi;

/**
 * Jira's refusal in its own words, without the request line. An internal field id becomes the field's name on the form
 * when it is known ("Defect Environment: This field is required"), and is dropped otherwise.
 */
export function describeJiraRefusal(caught: unknown, fieldNames: Record<string, string> = {}): string {
  if (!(caught instanceof Error) || caught.message.trim() === '') return UNKNOWN_FAILURE;
  const plainMessage = caught.message
    .replace(REQUEST_PREFIX_PATTERN, '')
    .replace(INTERNAL_FIELD_ID_PATTERN, (matchedText) => {
      const fieldName = fieldNames[matchedText.replace(/:\s*$/, '')];
      return fieldName ? `${fieldName}: ` : '';
    })
    .trim();
  return plainMessage === '' ? UNKNOWN_FAILURE : plainMessage;
}

function findIssueType(issueTypes: readonly CreateMetaIssueType[], wantedNames: readonly string[], projectKey: string): CreateMetaIssueType {
  const normalTypes = issueTypes.filter((issueType) => !issueType.subtask);
  for (const wantedName of wantedNames) {
    const match = normalTypes.find((issueType) => issueType.name.trim().toLowerCase() === wantedName);
    if (match) return match;
  }
  throw new Error(`Jira project ${projectKey} has no "${wantedNames[0]}" type of issue`);
}

function readSavedFieldOverrides(): Partial<Record<string, string>> {
  try {
    return readFieldMappingOverrides(window.localStorage);
  } catch {
    return {};
  }
}

/** The Epic field on one create screen: a saved choice or a field NAMED like Epic Link, else the parent field. */
function findEpicFieldId(screenFields: readonly CreateMetaFieldEntry[], typeName: string): string {
  const epicEntry = FIELD_MAPPING_ENTRIES.find((entry) => entry.settingsKey === EPIC_LINK_SETTINGS_KEY);
  const screenFieldIds = new Set(screenFields.map((field) => field.fieldId));
  if (epicEntry) {
    const catalogue = screenFields.map((field) => ({ id: field.fieldId, name: field.name }));
    const resolution = resolveFieldMapping(epicEntry, catalogue, readSavedFieldOverrides());
    const candidates = [resolution.chosenFieldId, ...resolution.discoveredFieldIds];
    const onScreen = candidates.find((fieldId) => fieldId !== null && screenFieldIds.has(fieldId));
    if (onScreen) return onScreen;
  }
  if (screenFieldIds.has(PARENT_FIELD_ID)) return PARENT_FIELD_ID;
  throw new Error(`Jira's form for a new ${typeName} has no Epic Link, so it cannot be put on the Epic`);
}

/**
 * The Defect Environment set to Production, when the Defect's form has that field. It is a cascading select, so only
 * the parent option is written; a form without the field (or without a Production option) gets nothing, and Jira's
 * own answer then says what it needs.
 */
export function buildDefectEnvironmentField(screenFields: readonly CreateMetaFieldEntry[]): Record<string, unknown> {
  const environmentField = screenFields.find((field) => field.name.trim().toLowerCase() === DEFECT_ENVIRONMENT_FIELD_NAME);
  const productionOption = (environmentField?.allowedValues ?? [])
    .find((option) => (option.value ?? option.name ?? '').trim().toLowerCase() === DEFECT_ENVIRONMENT_VALUE);
  if (!environmentField || !productionOption) return {};
  return { [environmentField.fieldId]: { id: productionOption.id } };
}

async function readEpicPlacement(projectKey: string, issueType: CreateMetaIssueType, isDefect: boolean): Promise<EpicPlacement> {
  const screenFields = (await getIssueTypeFields(projectKey, issueType.id))?.values ?? [];
  return {
    issueTypeId: issueType.id,
    epicFieldId: findEpicFieldId(screenFields, issueType.name),
    fixedFields: isDefect ? buildDefectEnvironmentField(screenFields) : {},
    fieldNames: Object.fromEntries(screenFields.map((field) => [field.fieldId, field.name])),
  };
}

/** Reads the project's live issue types and create screens, once, for the roles still to be made. */
async function readPlacements(projectKey: string, roles: readonly PrbJiraRole[]): Promise<Map<PrbJiraRole, EpicPlacement>> {
  const issueTypes = (await getProjectIssueTypes(projectKey))?.values ?? [];
  const defectType = roles.includes('defect') ? findIssueType(issueTypes, DEFECT_TYPE_NAMES, projectKey) : null;
  const needsStory = roles.some((role) => role !== 'defect');
  const storyType = needsStory ? findIssueType(issueTypes, STORY_TYPE_NAMES, projectKey) : null;
  const defectPlacement = defectType ? await readEpicPlacement(projectKey, defectType, true) : null;
  const storyPlacement = storyType ? await readEpicPlacement(projectKey, storyType, false) : null;
  const placements = new Map<PrbJiraRole, EpicPlacement>();
  for (const role of roles) {
    const placement = role === 'defect' ? defectPlacement : storyPlacement;
    if (placement) placements.set(role, placement);
  }
  return placements;
}

// ── Writes ──

function buildIssueFields(draft: PrbJiraDraft, request: PrbCreateRequest, placement: EpicPlacement): Record<string, unknown> {
  const epicValue = placement.epicFieldId === PARENT_FIELD_ID ? { key: request.epicKey } : request.epicKey;
  return {
    project: { key: request.projectKey },
    issuetype: { id: placement.issueTypeId },
    summary: draft.summary.trim(),
    description: draft.description,
    labels: draft.labels,
    ...placement.fixedFields,
    [placement.epicFieldId]: epicValue,
  };
}

async function labelPickedIssues(request: PrbCreateRequest, progress: PrbCreateProgress): Promise<PrbCreateFailure[]> {
  const failures: PrbCreateFailure[] = [];
  for (const role of PRB_JIRA_ROLES) {
    const issueKey = progress.createdKeys[role];
    if (request.roleChoices[role].mode !== 'existing' || !issueKey || progress.labelledRoles.includes(role)) continue;
    try {
      // "add" keeps every label the issue already has; these two are how a later run finds it again.
      const labelAdds = [buildPrbLabel(request.prbNumber), buildPrbRoleLabel(request.prbNumber, role)].map((label) => ({ add: label }));
      await jiraPut(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, { update: { labels: labelAdds } });
      progress.labelledRoles = [...progress.labelledRoles, role];
    } catch (caught) {
      failures.push({ role, stage: 'label', message: describeJiraRefusal(caught) });
    }
  }
  return failures;
}

async function createMissingIssues(
  request: PrbCreateRequest,
  progress: PrbCreateProgress,
  placements: Map<PrbJiraRole, EpicPlacement>,
): Promise<PrbCreateFailure[]> {
  const failures: PrbCreateFailure[] = [];
  for (const role of readNewRoles(request.roleChoices)) {
    const draft = request.drafts.find((candidate) => candidate.role === role);
    const placement = placements.get(role);
    if (progress.createdKeys[role] || !draft || !placement) continue;
    try {
      const created = await createIssue({ fields: buildIssueFields(draft, request, placement) });
      progress.createdKeys[role] = created.key;
    } catch (caught) {
      failures.push({ role, stage: 'create', message: describeJiraRefusal(caught, placement.fieldNames) });
    }
  }
  return failures;
}

async function linkStoriesToDefect(progress: PrbCreateProgress): Promise<PrbCreateFailure[]> {
  const defectKey = progress.createdKeys.defect;
  if (!defectKey) return [];
  const failures: PrbCreateFailure[] = [];
  for (const role of STORY_ROLES) {
    const storyKey = progress.createdKeys[role];
    if (!storyKey || progress.linkedRoles.includes(role)) continue;
    try {
      await createIssueLink({ type: { name: RELATES_LINK_TYPE_NAME }, inwardIssue: { key: storyKey }, outwardIssue: { key: defectKey } });
      progress.linkedRoles = [...progress.linkedRoles, role];
    } catch (caught) {
      failures.push({ role, stage: 'link', message: describeJiraRefusal(caught) });
    }
  }
  return failures;
}

/** Ends the problem's Problem statement with " - <Defect key>" once the Defect exists (GH #475). */
async function stampProblemStatement(request: PrbCreateRequest, progress: PrbCreateProgress): Promise<PrbCreateFailure[]> {
  const defectKey = progress.createdKeys.defect;
  if (!defectKey || progress.isProblemStamped) return [];
  try {
    await stampDefectKeyOnProblem(request.problemSysId, defectKey);
    progress.isProblemStamped = true;
    return [];
  } catch (caught) {
    const message = caught instanceof Error && caught.message.trim() !== '' ? caught.message : 'ServiceNow refused the change';
    return [{ role: 'defect', stage: 'problem', message }];
  }
}

function prepareFailures(roles: readonly PrbJiraRole[], message: string): PrbCreateFailure[] {
  return roles.map((role) => ({ role, stage: 'prepare', message }));
}

/**
 * Does what the user chose for this problem, in order: labels any issue picked from Jira, makes each item wanted new
 * (Defect, SL Story, QE Story) on the Epic, links each story to the Defect, then puts the Defect's key on the end of
 * the problem's Problem statement. Anything that fails is reported per
 * item and left for "Retry the rest"; what is already done is never done twice.
 */
export async function createPrbJiraWork(request: PrbCreateRequest): Promise<PrbCreateResult> {
  const progress = buildStartingProgress(request.prbNumber, request.roleChoices, request.startingProgress, request.problemStatement);
  const missingRoles = readNewRoles(request.roleChoices).filter((role) => !progress.createdKeys[role]);
  let placements = new Map<PrbJiraRole, EpicPlacement>();
  try {
    if (missingRoles.length > 0) placements = await readPlacements(request.projectKey, missingRoles);
  } catch (caught) {
    return { progress, failures: prepareFailures(missingRoles, describeJiraRefusal(caught)), isComplete: false };
  }
  const labelFailures = await labelPickedIssues(request, progress);
  const createFailures = await createMissingIssues(request, progress, placements);
  const linkFailures = await linkStoriesToDefect(progress);
  const problemFailures = await stampProblemStatement(request, progress);
  const failures = [...labelFailures, ...createFailures, ...linkFailures, ...problemFailures];
  return { progress, failures, isComplete: isPrbWorkComplete(progress, request.roleChoices) };
}
