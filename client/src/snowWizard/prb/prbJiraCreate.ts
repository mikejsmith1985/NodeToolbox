// prbJiraCreate.ts — Creates a problem's Defect, SL Story and QE Story in Jira, puts them on the Epic and links the
// stories to the Defect — and on a retry makes only what is still missing.
//
// Framework-first: every write goes through Toolbox's own jiraApi (createIssue, createIssueLink, createmeta readers)
// and the Epic Link field is found BY NAME through jiraFieldMapping. What is custom is only the order and the
// "what already exists" bookkeeping, which Toolbox's PRB Generator (Defect + sub-tasks, no Epic, no retry) lacks.

import {
  createIssue,
  createIssueLink,
  getIssueTypeFields,
  getProjectIssueTypes,
  jiraGet,
} from '../../services/jiraApi.ts';
import { FIELD_MAPPING_ENTRIES, readFieldMappingOverrides, resolveFieldMapping } from '../../services/jiraFieldMapping.ts';
import type { CreateMetaFieldEntry, CreateMetaIssueType } from '../../types/jira.ts';
import { escapeJqlValue } from '../../utils/jqlValue.ts';
import { buildPrbLabel, PRB_JIRA_ROLES, readRoleFromLabels, type PrbJiraDraft, type PrbJiraRole } from './prbJiraPlan.ts';

// ── Types ──

/** What exists so far: the key made for each role, and which stories are already linked to the Defect. */
export interface PrbCreateProgress {
  createdKeys: Partial<Record<PrbJiraRole, string>>;
  linkedRoles: PrbJiraRole[];
}

/** One thing that did not happen, in words the user can act on. */
export interface PrbCreateFailure {
  role: PrbJiraRole;
  stage: 'prepare' | 'create' | 'link';
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
  projectKey: string;
  epicKey: string;
  drafts: readonly PrbJiraDraft[];
  /** What earlier presses already made (empty on the first). */
  startingProgress: PrbCreateProgress;
  /** True to look Jira up for items already made for this problem and reuse them; false only for "make a new set". */
  shouldReuseExisting: boolean;
}

/** Nothing made yet. */
export const EMPTY_PRB_PROGRESS: PrbCreateProgress = { createdKeys: {}, linkedRoles: [] };

/** The Jira link type joining each story to the Defect. */
export const RELATES_LINK_TYPE_NAME = 'Relates';

const STORY_ROLES: readonly PrbJiraRole[] = ['sl', 'qe'];
const EXISTING_SEARCH_MAX_RESULTS = 50;
const EXISTING_SEARCH_FIELDS = 'labels,issuetype,summary,issuelinks';
const PARENT_FIELD_ID = 'parent';
const EPIC_LINK_SETTINGS_KEY = 'epicLinkFieldId';
const DEFECT_TYPE_NAMES = ['defect', 'bug'];
const STORY_TYPE_NAMES = ['story'];
const CHECK_EXISTING_FAILED = 'Could not check Jira for items already made for this problem, so nothing was created';
const UNKNOWN_FAILURE = 'Jira refused the request';

// ── Existing work ──

interface ExistingIssue {
  key: string;
  fields?: {
    labels?: string[];
    issuetype?: { name?: string };
    summary?: string;
    issuelinks?: Array<{ inwardIssue?: { key?: string }; outwardIssue?: { key?: string } }>;
  };
}

/** Which role an existing item plays: its role label first, then its type and summary for items made by hand. */
function readExistingRole(issue: ExistingIssue, prbNumber: string): PrbJiraRole | null {
  const labelledRole = readRoleFromLabels(issue.fields?.labels ?? [], prbNumber);
  if (labelledRole) return labelledRole;
  if (DEFECT_TYPE_NAMES.includes((issue.fields?.issuetype?.name ?? '').toLowerCase())) return 'defect';
  const summary = (issue.fields?.summary ?? '').trim();
  if (/^SL\b/i.test(summary)) return 'sl';
  return /^QE\b/i.test(summary) ? 'qe' : null;
}

function isLinkedTo(issue: ExistingIssue, otherKey: string | undefined): boolean {
  if (!otherKey) return false;
  return (issue.fields?.issuelinks ?? []).some((link) => link.inwardIssue?.key === otherKey || link.outwardIssue?.key === otherKey);
}

/**
 * Looks Jira up for items already made for this problem (by its `prb-<number>` label) and says which role each
 * plays and which stories are already linked to the Defect. The first item found for a role wins.
 */
export async function findExistingPrbWork(prbNumber: string): Promise<PrbCreateProgress> {
  const jql = `labels = "${escapeJqlValue(buildPrbLabel(prbNumber))}" ORDER BY created ASC`;
  const response = await jiraGet<{ issues?: ExistingIssue[] }>(
    `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${EXISTING_SEARCH_FIELDS}&maxResults=${EXISTING_SEARCH_MAX_RESULTS}`,
  );
  const issues = response?.issues ?? [];
  const issueByRole = new Map<PrbJiraRole, ExistingIssue>();
  for (const issue of issues) {
    const role = readExistingRole(issue, prbNumber);
    if (role && !issueByRole.has(role)) issueByRole.set(role, issue);
  }
  const createdKeys: Partial<Record<PrbJiraRole, string>> = {};
  issueByRole.forEach((issue, role) => { createdKeys[role] = issue.key; });
  const linkedRoles = STORY_ROLES.filter((role) => {
    const storyIssue = issueByRole.get(role);
    return storyIssue !== undefined && isLinkedTo(storyIssue, createdKeys.defect);
  });
  return { createdKeys, linkedRoles };
}

// ── Create screens ──

/** How one issue type takes its Epic: a named Epic Link field, or the newer parent field. */
interface EpicPlacement {
  issueTypeId: string;
  epicFieldId: string;
}

// "Jira POST /rest/api/2/issue failed: " — the request line means nothing to the person reading it.
const REQUEST_PREFIX_PATTERN = /^Jira \w+ \S+ failed:\s*/;
// "<internal field id>: " before Jira's own sentence — internal ids are never shown on screen.
const INTERNAL_FIELD_ID_PATTERN = /\b\w*field_\d+:\s*/gi;

/** Jira's refusal in its own words, without the request line or internal field ids. */
export function describeJiraRefusal(caught: unknown): string {
  if (!(caught instanceof Error) || caught.message.trim() === '') return UNKNOWN_FAILURE;
  const plainMessage = caught.message.replace(REQUEST_PREFIX_PATTERN, '').replace(INTERNAL_FIELD_ID_PATTERN, '').trim();
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

async function readEpicPlacement(projectKey: string, issueType: CreateMetaIssueType): Promise<EpicPlacement> {
  const screen = await getIssueTypeFields(projectKey, issueType.id);
  return { issueTypeId: issueType.id, epicFieldId: findEpicFieldId(screen?.values ?? [], issueType.name) };
}

/** Reads the project's live issue types and create screens, once, for the roles still to be made. */
async function readPlacements(projectKey: string, roles: readonly PrbJiraRole[]): Promise<Map<PrbJiraRole, EpicPlacement>> {
  const issueTypes = (await getProjectIssueTypes(projectKey))?.values ?? [];
  const defectType = roles.includes('defect') ? findIssueType(issueTypes, DEFECT_TYPE_NAMES, projectKey) : null;
  const needsStory = roles.some((role) => role !== 'defect');
  const storyType = needsStory ? findIssueType(issueTypes, STORY_TYPE_NAMES, projectKey) : null;
  const defectPlacement = defectType ? await readEpicPlacement(projectKey, defectType) : null;
  const storyPlacement = storyType ? await readEpicPlacement(projectKey, storyType) : null;
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
    [placement.epicFieldId]: epicValue,
  };
}

async function createMissingIssues(
  request: PrbCreateRequest,
  progress: PrbCreateProgress,
  placements: Map<PrbJiraRole, EpicPlacement>,
): Promise<PrbCreateFailure[]> {
  const failures: PrbCreateFailure[] = [];
  for (const role of PRB_JIRA_ROLES) {
    const draft = request.drafts.find((candidate) => candidate.role === role);
    const placement = placements.get(role);
    if (progress.createdKeys[role] || !draft || !placement) continue;
    try {
      const created = await createIssue({ fields: buildIssueFields(draft, request, placement) });
      progress.createdKeys[role] = created.key;
    } catch (caught) {
      failures.push({ role, stage: 'create', message: describeJiraRefusal(caught) });
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

function isProgressComplete(progress: PrbCreateProgress): boolean {
  const hasEveryItem = PRB_JIRA_ROLES.every((role) => Boolean(progress.createdKeys[role]));
  return hasEveryItem && STORY_ROLES.every((role) => progress.linkedRoles.includes(role));
}

function prepareFailures(roles: readonly PrbJiraRole[], message: string): PrbCreateFailure[] {
  return roles.map((role) => ({ role, stage: 'prepare', message }));
}

async function readStartingProgress(request: PrbCreateRequest): Promise<PrbCreateProgress> {
  const startingCopy = { createdKeys: { ...request.startingProgress.createdKeys }, linkedRoles: [...request.startingProgress.linkedRoles] };
  if (!request.shouldReuseExisting) return startingCopy;
  const existing = await findExistingPrbWork(request.prbNumber);
  return {
    createdKeys: { ...existing.createdKeys, ...startingCopy.createdKeys },
    linkedRoles: [...new Set([...existing.linkedRoles, ...startingCopy.linkedRoles])],
  };
}

/**
 * Makes whatever is still missing for this problem, in order — Defect, SL Story, QE Story — each on the Epic, then
 * links each story to the Defect. Anything that fails is reported per item and left for "Retry the rest"; what
 * already exists is never made twice. If Jira cannot be checked first, nothing is created at all.
 */
export async function createPrbJiraWork(request: PrbCreateRequest): Promise<PrbCreateResult> {
  let progress: PrbCreateProgress;
  try {
    progress = await readStartingProgress(request);
  } catch {
    return { progress: request.startingProgress, failures: prepareFailures(PRB_JIRA_ROLES, CHECK_EXISTING_FAILED), isComplete: false };
  }
  const missingRoles = PRB_JIRA_ROLES.filter((role) => !progress.createdKeys[role]);
  let placements = new Map<PrbJiraRole, EpicPlacement>();
  try {
    if (missingRoles.length > 0) placements = await readPlacements(request.projectKey, missingRoles);
  } catch (caught) {
    return { progress, failures: prepareFailures(missingRoles, describeJiraRefusal(caught)), isComplete: false };
  }
  const createFailures = await createMissingIssues(request, progress, placements);
  const linkFailures = await linkStoriesToDefect(progress);
  return { progress, failures: [...createFailures, ...linkFailures], isComplete: isProgressComplete(progress) };
}
