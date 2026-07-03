// blueprintHierarchy.ts — Legacy-compatible bottom-up Jira query flow for the Art View Blueprint tab.

import { jiraGet } from '../../services/jiraApi.ts';
import type { DependencySourceIssue, DependencySourceIssueLink } from './dependencyGraph.ts';
import type { ArtTeam } from './hooks/useArtData.ts';

export type BlueprintViewMode = 'hierarchy' | 'by-team' | 'features' | 'flat';
export type BlueprintHealthStatus = 'green' | 'yellow' | 'red' | 'blue' | 'gray';

interface BlueprintLinkedIssueValue {
  key?: string;
  data?: { key?: string };
  inwardIssue?: { key?: string };
}

interface BlueprintIssueLinkObject extends DependencySourceIssueLink {
  id?: string;
}

interface BlueprintIssueFields {
  summary?: string;
  status?: { name?: string; statusCategory?: { key?: string } };
  issuetype?: { name?: string };
  assignee?: {
    displayName?: string;
    avatarUrls?: Record<string, string>;
  } | null;
  priority?: { name?: string } | null;
  project?: { key?: string };
  labels?: string[];
  parent?: { key?: string; fields?: { summary?: string } } | null;
  subtasks?: Array<{ key?: string }>;
  issuelinks?: BlueprintIssueLinkObject[];
  customfield_10014?: string | BlueprintLinkedIssueValue | null;
  customfield_10016?: number | null;
  customfield_10028?: number | null;
  customfield_10100?: string | BlueprintLinkedIssueValue | null;
  customfield_10108?: string | BlueprintLinkedIssueValue | null;
  [fieldId: string]: unknown;
}

interface BlueprintIssueRecord {
  id: string;
  key: string;
  fields: BlueprintIssueFields;
  _teamName?: string;
  _teamProjectKey?: string;
  _boardId?: string;
  _featureKey?: string | null;
  _peKey?: string | null;
  _isExternal?: boolean;
}

export interface BlueprintOffTrainReason {
  code: 'UNKNOWN_PROJECT' | 'MISSING_PI';
  label: string;
  canFix?: boolean;
}

export interface BlueprintSubtaskNode {
  type: 'subtask';
  key: string;
  summary: string;
  status: string;
  assignee: string | null;
  issueType: string;
}

export interface BlueprintStoryNode {
  type: 'story';
  key: string;
  summary: string;
  status: string;
  statusCategoryKey?: string | null;
  issueType: string;
  assignee: string | null;
  assigneeAvatar: string | null;
  storyPoints: number | null;
  teamName: string | null;
  isOffTrain: boolean;
  offTrainReasons: BlueprintOffTrainReason[];
  subtasks: BlueprintSubtaskNode[];
}

export interface BlueprintFeatureNode {
  type: 'feature';
  key: string;
  summary: string;
  status: string;
  health: BlueprintHealthStatus;
  completionPercent: number;
  children: BlueprintStoryNode[];
  offTrain: BlueprintStoryNode[];
  isExternal: boolean;
}

export interface BlueprintProgramEpicNode {
  type: 'pe';
  key: string;
  summary: string;
  status: string | null;
  health: BlueprintHealthStatus;
  completionPercent: number;
  features: BlueprintFeatureNode[];
}

interface ArtAdvancedSettings {
  featureLinkField?: string;
  parentLinkField?: string;
  piFieldId?: string;
}

interface BlueprintQuerySourceData {
  allTeamIssues: BlueprintIssueRecord[];
  featureIssueMap: Map<string, BlueprintIssueRecord>;
  programEpicIssueMap: Map<string, BlueprintIssueRecord>;
  allFeatureChildrenMap: Map<string, BlueprintIssueRecord[]>;
  subtaskMap: Map<string, BlueprintIssueRecord[]>;
  piFieldId: string;
  trimmedPiName: string;
  artProjectKeys: string[];
}

const DEFAULT_FEATURE_LINK_FIELD = 'customfield_10108';
const DEFAULT_PARENT_LINK_FIELD = 'customfield_10100';
const DEFAULT_EPIC_LINK_FIELD = 'customfield_10014';
const DEFAULT_PI_FIELD_ID = 'customfield_10301';
const PI_ISSUE_MAX_RESULTS = 500;
const OPEN_SPRINT_MAX_RESULTS = 200;
const OPEN_SPRINT_JQL = 'sprint in openSprints()';
const FEATURE_BATCH_SIZE = 50;
const FEATURE_CHILD_BATCH_SIZE = 20;
const SUBTASK_BATCH_SIZE = 50;
const SEARCH_BATCH_MAX_RESULTS = 200;
const PROGRAM_EPIC_EMPTY_BUCKET_KEY = '_none_';
const DONE_STATUS_KEYWORDS = ['done', 'closed', 'resolved', 'complete'];
const BLOCKED_STATUS_KEYWORDS = ['blocked', 'impediment'];
const WORKING_STATUS_KEYWORDS = ['work', 'working', 'in progress', 'implementing'];
const TESTING_STATUS_KEYWORDS = ['test', 'testing'];
const READY_TO_ACCEPT_KEYWORD = 'ready to accept';
const DEFAULT_UNPOINTED_STORY_WEIGHT = 1;

function loadArtSettings(): ArtAdvancedSettings {
  try {
    return JSON.parse(localStorage.getItem('tbxARTSettings') || '{}') as ArtAdvancedSettings;
  } catch {
    return {};
  }
}

function readUniqueFieldIds(fieldIds: Array<string | undefined>): string[] {
  return Array.from(new Set(fieldIds.filter((fieldId): fieldId is string => Boolean(fieldId))));
}

function extractIssueKeyFromLinkValue(rawValue: unknown): string | null {
  if (typeof rawValue === 'string' && rawValue.includes('-')) {
    return rawValue;
  }

  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const linkedIssueValue = rawValue as BlueprintLinkedIssueValue;
  return linkedIssueValue.key
    ?? linkedIssueValue.data?.key
    ?? linkedIssueValue.inwardIssue?.key
    ?? null;
}

function readFeatureLinkCandidateKeys(featureLinkField: string): string[] {
  return readUniqueFieldIds([featureLinkField, DEFAULT_FEATURE_LINK_FIELD, DEFAULT_EPIC_LINK_FIELD]);
}

function readParentLinkCandidateKeys(parentLinkField: string): string[] {
  return readUniqueFieldIds([parentLinkField, DEFAULT_PARENT_LINK_FIELD]);
}

function extractFeatureKeyFromIssue(issueFields: BlueprintIssueFields, featureLinkField: string): string | null {
  for (const fieldId of readFeatureLinkCandidateKeys(featureLinkField)) {
    const linkedIssueKey = extractIssueKeyFromLinkValue(issueFields[fieldId]);
    if (linkedIssueKey) {
      return linkedIssueKey;
    }
  }

  return issueFields.parent?.key ?? null;
}

function extractProgramEpicKeyFromIssue(issueFields: BlueprintIssueFields, parentLinkField: string): string | null {
  for (const fieldId of readParentLinkCandidateKeys(parentLinkField)) {
    const linkedIssueKey = extractIssueKeyFromLinkValue(issueFields[fieldId]);
    if (linkedIssueKey) {
      return linkedIssueKey;
    }
  }

  return issueFields.parent?.key ?? null;
}

function isStatusDone(statusName: string): boolean {
  const normalizedStatusName = statusName.toLowerCase();
  return DONE_STATUS_KEYWORDS.some((keyword) => normalizedStatusName.includes(keyword));
}

function computeBlueprintHealth(storyNodes: BlueprintStoryNode[]): BlueprintHealthStatus {
  if (storyNodes.length === 0) {
    return 'gray';
  }

  const blockedCount = storyNodes.filter((storyNode) =>
    BLOCKED_STATUS_KEYWORDS.includes(storyNode.status.toLowerCase()),
  ).length;

  if (blockedCount > 0) {
    return 'red';
  }

  const doneCount = storyNodes.filter((storyNode) => isStatusDone(storyNode.status)).length;
  const completionRatio = doneCount / storyNodes.length;
  if (doneCount === storyNodes.length || completionRatio >= 0.7) {
    return 'green';
  }

  if (completionRatio >= 0.4) {
    return 'yellow';
  }

  return 'blue';
}

function readStoryCompletionWeight(storyNode: BlueprintStoryNode): number {
  const normalizedStatusName = storyNode.status.toLowerCase();
  const normalizedStatusCategoryKey = storyNode.statusCategoryKey?.toLowerCase() ?? '';

  if (normalizedStatusCategoryKey === 'done') {
    return 1;
  }

  if (normalizedStatusName.includes(READY_TO_ACCEPT_KEYWORD)) {
    return 0.9;
  }

  if (TESTING_STATUS_KEYWORDS.some((statusKeyword) => normalizedStatusName.includes(statusKeyword))) {
    return 0.5;
  }

  if (WORKING_STATUS_KEYWORDS.some((statusKeyword) => normalizedStatusName.includes(statusKeyword))) {
    return 0.2;
  }

  return 0;
}

function computeCompletionPercent(storyNodes: BlueprintStoryNode[]): number {
  if (storyNodes.length === 0) {
    return 0;
  }

  const completionWeightTotal = storyNodes.reduce(
    (runningTotal, storyNode) => runningTotal + (readStoryCompletionWeight(storyNode) * readStoryPointWeight(storyNode)),
    0,
  );
  const storyPointWeightTotal = storyNodes.reduce(
    (runningTotal, storyNode) => runningTotal + readStoryPointWeight(storyNode),
    0,
  );
  return storyPointWeightTotal > 0 ? Math.round((completionWeightTotal / storyPointWeightTotal) * 100) : 0;
}

function readStoryPointWeight(storyNode: BlueprintStoryNode): number {
  return typeof storyNode.storyPoints === 'number' && storyNode.storyPoints > 0
    ? storyNode.storyPoints
    : DEFAULT_UNPOINTED_STORY_WEIGHT;
}

function detectOffTrainReasons(
  issue: BlueprintIssueRecord,
  artProjectKeys: string[],
  piName: string,
  piFieldId: string,
): BlueprintOffTrainReason[] {
  const issueFields = issue.fields ?? {};
  const issueProjectKey = issueFields.project?.key?.toUpperCase() ?? issue.key.split('-')[0]?.toUpperCase() ?? '';
  const offTrainReasons: BlueprintOffTrainReason[] = [];

  if (issueProjectKey && artProjectKeys.length > 0 && !artProjectKeys.includes(issueProjectKey)) {
    offTrainReasons.push({
      code: 'UNKNOWN_PROJECT',
      label: `Project ${issueProjectKey} is not in the ART team configuration`,
    });
  }

  if (!piName) {
    return offTrainReasons;
  }

  const piFieldValue = issueFields[piFieldId];
  const hasMatchingPi = Array.isArray(piFieldValue)
    ? piFieldValue.some((value) => {
      if (typeof value === 'string') {
        return value === piName;
      }

      if (value && typeof value === 'object') {
        const piOption = value as { value?: string; name?: string };
        return piOption.value === piName || piOption.name === piName;
      }

      return false;
    })
    : typeof piFieldValue === 'string'
      ? piFieldValue === piName
      : Boolean(
        piFieldValue
        && typeof piFieldValue === 'object'
        && (((piFieldValue as { value?: string }).value === piName)
          || ((piFieldValue as { name?: string }).name === piName)),
      );

  if (!hasMatchingPi) {
    offTrainReasons.push({
      code: 'MISSING_PI',
      label: `Missing PI assignment ${piName}`,
      canFix: true,
    });
  }

  return offTrainReasons;
}

function createTeamIssueSearchFields(
  featureLinkField: string,
  parentLinkField: string,
  piFieldId: string,
): string {
  return readUniqueFieldIds([
    'summary',
    'status',
    'issuetype',
    'assignee',
    'priority',
    'project',
    'labels',
    'issuelinks',
    'parent',
    'subtasks',
    'customfield_10016',
    'customfield_10028',
    featureLinkField,
    DEFAULT_FEATURE_LINK_FIELD,
    DEFAULT_EPIC_LINK_FIELD,
    parentLinkField,
    DEFAULT_PARENT_LINK_FIELD,
    piFieldId,
    DEFAULT_PI_FIELD_ID,
  ]).join(',');
}

function createFeatureDetailsFields(parentLinkField: string): string {
  return readUniqueFieldIds([
    'summary',
    'status',
    'issuetype',
    'assignee',
    'priority',
    'labels',
    'fixVersions',
    'issuelinks',
    'subtasks',
    parentLinkField,
    DEFAULT_PARENT_LINK_FIELD,
    DEFAULT_EPIC_LINK_FIELD,
  ]).join(',');
}

function createChildIssueFields(featureLinkField: string, piFieldId: string): string {
  return readUniqueFieldIds([
    'summary',
    'status',
    'issuetype',
    'assignee',
    'priority',
    'project',
    'labels',
    'issuelinks',
    'parent',
    'customfield_10016',
    'customfield_10028',
    piFieldId,
    DEFAULT_PI_FIELD_ID,
    DEFAULT_EPIC_LINK_FIELD,
    DEFAULT_FEATURE_LINK_FIELD,
    featureLinkField,
  ]).join(',');
}

function createIssueSearchPath(jql: string, fields: string, maxResults: number): string {
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fields)}&maxResults=${maxResults}`;
}

function createBoardIssueSearchPath(boardId: string, jql: string, fields: string, maxResults: number): string {
  return `/rest/agile/1.0/board/${boardId}/issue?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fields)}&maxResults=${maxResults}`;
}

function createAnnotatedTeamIssues(teams: ArtTeam[], teamIssueResults: Array<{ issues?: BlueprintIssueRecord[] }>): BlueprintIssueRecord[] {
  return teams.flatMap((team, teamIndex) =>
    (teamIssueResults[teamIndex]?.issues ?? []).map((issue) => ({
      ...issue,
      _teamName: team.name,
      _teamProjectKey: team.projectKey?.toUpperCase() ?? '',
      _boardId: team.boardId,
    })));
}

async function fetchTeamIssuesForBlueprint(
  teams: ArtTeam[],
  selectedPiName: string,
  featureLinkField: string,
  parentLinkField: string,
  piFieldId: string,
): Promise<BlueprintIssueRecord[]> {
  const issueFields = createTeamIssueSearchFields(featureLinkField, parentLinkField, piFieldId);
  const piFieldNumber = piFieldId.replace('customfield_', '');
  const trimmedPiName = selectedPiName.trim();

  const teamIssueResults = await Promise.all(
    teams.map((team) => {
      const trimmedProjectKey = team.projectKey?.trim();
      const hasPiScopedQuery = Boolean(trimmedPiName) && Boolean(trimmedProjectKey);
      const hasProjectScopedOpenSprintQuery = !hasPiScopedQuery && Boolean(trimmedProjectKey);

      if (hasPiScopedQuery) {
        const jql = `project = "${trimmedProjectKey!}" AND cf[${piFieldNumber}] = "${trimmedPiName}"`;
        return jiraGet<{ issues?: BlueprintIssueRecord[] }>(createIssueSearchPath(jql, issueFields, PI_ISSUE_MAX_RESULTS));
      }

      if (hasProjectScopedOpenSprintQuery) {
        const jql = `project = "${trimmedProjectKey!}" AND ${OPEN_SPRINT_JQL}`;
        return jiraGet<{ issues?: BlueprintIssueRecord[] }>(createIssueSearchPath(jql, issueFields, OPEN_SPRINT_MAX_RESULTS));
      }

      return jiraGet<{ issues?: BlueprintIssueRecord[] }>(
        createBoardIssueSearchPath(team.boardId, OPEN_SPRINT_JQL, issueFields, OPEN_SPRINT_MAX_RESULTS),
      );
    }),
  );

  return createAnnotatedTeamIssues(teams, teamIssueResults);
}

function createFeatureKeySet(allTeamIssues: BlueprintIssueRecord[], featureLinkField: string): string[] {
  const featureKeySet = new Set<string>();
  for (const issue of allTeamIssues) {
    const featureKey = extractFeatureKeyFromIssue(issue.fields, featureLinkField);
    issue._featureKey = featureKey;
    if (featureKey) {
      featureKeySet.add(featureKey);
    }
  }

  return Array.from(featureKeySet);
}

async function fetchIssuesByKeys(
  issueKeys: string[],
  fields: string,
  batchSize: number,
): Promise<BlueprintIssueRecord[]> {
  if (issueKeys.length === 0) {
    return [];
  }

  const batchedIssueKeys: string[][] = [];
  for (let issueIndex = 0; issueIndex < issueKeys.length; issueIndex += batchSize) {
    batchedIssueKeys.push(issueKeys.slice(issueIndex, issueIndex + batchSize));
  }

  const batchResults = await Promise.all(
    batchedIssueKeys.map((issueKeyBatch) =>
      jiraGet<{ issues?: BlueprintIssueRecord[] }>(
        createIssueSearchPath(
          `key in (${issueKeyBatch.join(',')})`,
          fields,
          Math.max(issueKeyBatch.length, SEARCH_BATCH_MAX_RESULTS),
        ),
      )),
  );

  return batchResults.flatMap((batchResult) => batchResult.issues ?? []);
}

function createProgramEpicKeySet(featureIssueMap: Map<string, BlueprintIssueRecord>, parentLinkField: string): string[] {
  const programEpicKeySet = new Set<string>();
  for (const featureIssue of featureIssueMap.values()) {
    const programEpicKey = extractProgramEpicKeyFromIssue(featureIssue.fields, parentLinkField);
    featureIssue._peKey = programEpicKey;
    if (programEpicKey) {
      programEpicKeySet.add(programEpicKey);
    }
  }

  return Array.from(programEpicKeySet);
}

async function discoverProgramEpicChildren(
  featureIssueMap: Map<string, BlueprintIssueRecord>,
  programEpicKeys: string[],
  parentLinkField: string,
): Promise<void> {
  if (programEpicKeys.length === 0) {
    return;
  }

  const featureFields = createFeatureDetailsFields(parentLinkField);
  const parentFieldNumber = parentLinkField.replace('customfield_', '');
  const dualQueryResults = await Promise.all([
    jiraGet<{ issues?: BlueprintIssueRecord[] }>(
      createIssueSearchPath(`parent in (${programEpicKeys.join(',')})`, featureFields, SEARCH_BATCH_MAX_RESULTS),
    ).catch((error) => {
      console.warn('Blueprint native Program Epic child query failed.', error);
      return { issues: [] };
    }),
    jiraGet<{ issues?: BlueprintIssueRecord[] }>(
      createIssueSearchPath(`cf[${parentFieldNumber}] in (${programEpicKeys.join(',')})`, featureFields, SEARCH_BATCH_MAX_RESULTS),
    ).catch((error) => {
      console.warn('Blueprint parent-link Program Epic child query failed.', error);
      return { issues: [] };
    }),
  ]);

  for (const issue of dualQueryResults.flatMap((result) => result.issues ?? [])) {
    if (featureIssueMap.has(issue.key)) {
      continue;
    }

    issue._isExternal = true;
    issue._peKey = extractProgramEpicKeyFromIssue(issue.fields, parentLinkField);
    featureIssueMap.set(issue.key, issue);
  }
}

async function fetchAllFeatureChildren(
  featureIssueMap: Map<string, BlueprintIssueRecord>,
  featureLinkField: string,
  piFieldId: string,
): Promise<Map<string, BlueprintIssueRecord[]>> {
  const featureKeys = Array.from(featureIssueMap.keys());
  const childIssueMap = new Map<string, BlueprintIssueRecord[]>();
  if (featureKeys.length === 0) {
    return childIssueMap;
  }

  const childIssueFields = createChildIssueFields(featureLinkField, piFieldId);
  const featureKeyBatches: string[][] = [];
  for (let featureIndex = 0; featureIndex < featureKeys.length; featureIndex += FEATURE_CHILD_BATCH_SIZE) {
    featureKeyBatches.push(featureKeys.slice(featureIndex, featureIndex + FEATURE_CHILD_BATCH_SIZE));
  }

  const childBatchResults = await Promise.all(
    featureKeyBatches.map((featureKeyBatch) =>
      jiraGet<{ issues?: BlueprintIssueRecord[] }>(
        createIssueSearchPath(
          `"Epic Link" in (${featureKeyBatch.join(',')}) OR parent in (${featureKeyBatch.join(',')})`,
          childIssueFields,
          SEARCH_BATCH_MAX_RESULTS,
        ),
      ).catch((error) => {
        console.warn('Blueprint feature child query failed.', error);
        return { issues: [] };
      })),
  );

  for (const childIssue of childBatchResults.flatMap((result) => result.issues ?? [])) {
    const parentKey = childIssue.fields.parent?.key ?? null;
    const epicLinkKey = extractIssueKeyFromLinkValue(childIssue.fields[DEFAULT_EPIC_LINK_FIELD])
      ?? extractIssueKeyFromLinkValue(childIssue.fields[DEFAULT_FEATURE_LINK_FIELD])
      ?? extractIssueKeyFromLinkValue(childIssue.fields[featureLinkField]);
    const featureKey = parentKey ?? epicLinkKey;
    if (!featureKey || !featureIssueMap.has(featureKey)) {
      continue;
    }

    const existingChildren = childIssueMap.get(featureKey) ?? [];
    existingChildren.push(childIssue);
    childIssueMap.set(featureKey, existingChildren);
  }

  return childIssueMap;
}

async function fetchSubtaskMap(allTeamIssues: BlueprintIssueRecord[]): Promise<Map<string, BlueprintIssueRecord[]>> {
  const storyKeys = allTeamIssues.map((issue) => issue.key);
  const subtaskMap = new Map<string, BlueprintIssueRecord[]>();
  if (storyKeys.length === 0) {
    return subtaskMap;
  }

  const storyKeyBatches: string[][] = [];
  for (let issueIndex = 0; issueIndex < storyKeys.length; issueIndex += SUBTASK_BATCH_SIZE) {
    storyKeyBatches.push(storyKeys.slice(issueIndex, issueIndex + SUBTASK_BATCH_SIZE));
  }

  const subtaskResults = await Promise.all(
    storyKeyBatches.map((storyKeyBatch) =>
      jiraGet<{ issues?: BlueprintIssueRecord[] }>(
        createIssueSearchPath(
          `parent in (${storyKeyBatch.join(',')})`,
          'summary,status,issuetype,assignee,priority,parent',
          SEARCH_BATCH_MAX_RESULTS,
        ),
      ).catch((error) => {
        console.warn('Blueprint subtask query failed.', error);
        return { issues: [] };
      })),
  );

  for (const subtaskIssue of subtaskResults.flatMap((result) => result.issues ?? [])) {
    const parentStoryKey = subtaskIssue.fields.parent?.key;
    if (!parentStoryKey) {
      continue;
    }

    const existingSubtasks = subtaskMap.get(parentStoryKey) ?? [];
    existingSubtasks.push(subtaskIssue);
    subtaskMap.set(parentStoryKey, existingSubtasks);
  }

  return subtaskMap;
}

function createBlueprintSubtaskNode(issue: BlueprintIssueRecord): BlueprintSubtaskNode {
  return {
    type: 'subtask',
    key: issue.key,
    summary: issue.fields.summary ?? issue.key,
    status: issue.fields.status?.name ?? 'Unknown',
    assignee: issue.fields.assignee?.displayName ?? null,
    issueType: issue.fields.issuetype?.name ?? 'Sub-task',
  };
}

function createBlueprintStoryNode(
  issue: BlueprintIssueRecord,
  subtasks: BlueprintIssueRecord[],
  isOffTrain: boolean,
  artProjectKeys: string[],
  piName: string,
  piFieldId: string,
): BlueprintStoryNode {
  return {
    type: 'story',
    key: issue.key,
    summary: issue.fields.summary ?? issue.key,
    status: issue.fields.status?.name ?? 'Unknown',
    statusCategoryKey: issue.fields.status?.statusCategory?.key ?? null,
    issueType: issue.fields.issuetype?.name ?? 'Story',
    assignee: issue.fields.assignee?.displayName ?? null,
    assigneeAvatar: issue.fields.assignee?.avatarUrls?.['24x24']
      ?? issue.fields.assignee?.avatarUrls?.['32x32']
      ?? null,
    storyPoints: issue.fields.customfield_10016 ?? issue.fields.customfield_10028 ?? null,
    teamName: issue._teamName ?? null,
    isOffTrain,
    offTrainReasons: isOffTrain ? detectOffTrainReasons(issue, artProjectKeys, piName, piFieldId) : [],
    subtasks: subtasks.map(createBlueprintSubtaskNode),
  };
}

function createBlueprintFeatureNode(
  featureKey: string,
  featureIssue: BlueprintIssueRecord | undefined,
  teamIssues: BlueprintIssueRecord[],
  allChildren: BlueprintIssueRecord[],
  subtaskMap: Map<string, BlueprintIssueRecord[]>,
  artProjectKeys: string[],
  piName: string,
  piFieldId: string,
): BlueprintFeatureNode {
  const inTrainStoryKeys = new Set(teamIssues.map((issue) => issue.key));
  const childStories = teamIssues
    .map((issue) => createBlueprintStoryNode(issue, subtaskMap.get(issue.key) ?? [], false, artProjectKeys, piName, piFieldId))
    .sort((leftStory, rightStory) => {
      const isLeftDone = isStatusDone(leftStory.status);
      const isRightDone = isStatusDone(rightStory.status);
      if (isLeftDone !== isRightDone) {
        return isLeftDone ? 1 : -1;
      }

      return leftStory.key.localeCompare(rightStory.key);
    });

  const offTrainStories = allChildren
    .filter((issue) => !inTrainStoryKeys.has(issue.key))
    .map((issue) => createBlueprintStoryNode(issue, [], true, artProjectKeys, piName, piFieldId));

  const allFeatureStories = [...childStories, ...offTrainStories];
  return {
    type: 'feature',
    key: featureKey,
    summary: featureIssue?.fields.summary ?? featureKey,
    status: featureIssue?.fields.status?.name ?? 'Unknown',
    health: computeBlueprintHealth(childStories),
    completionPercent: computeCompletionPercent(allFeatureStories),
    children: childStories,
    offTrain: offTrainStories,
    isExternal: Boolean(featureIssue?._isExternal),
  };
}

/** Fetches the feature issues for an explicit key set (summary/status for each node header). */
async function fetchFeatureIssuesByKeysForBlueprint(
  featureKeys: string[],
  featureLinkField: string,
  piFieldId: string,
): Promise<Map<string, BlueprintIssueRecord>> {
  const featureFields = createChildIssueFields(featureLinkField, piFieldId);
  const featureIssueMap = new Map<string, BlueprintIssueRecord>();
  const featureKeyBatches: string[][] = [];
  for (let featureIndex = 0; featureIndex < featureKeys.length; featureIndex += FEATURE_BATCH_SIZE) {
    featureKeyBatches.push(featureKeys.slice(featureIndex, featureIndex + FEATURE_BATCH_SIZE));
  }

  const batchResults = await Promise.all(
    featureKeyBatches.map((featureKeyBatch) =>
      jiraGet<{ issues?: BlueprintIssueRecord[] }>(
        createIssueSearchPath(`key in (${featureKeyBatch.join(',')})`, featureFields, SEARCH_BATCH_MAX_RESULTS),
      ).catch((error) => {
        console.warn('Blueprint feature-issue query failed.', error);
        return { issues: [] };
      })),
  );

  for (const featureIssue of batchResults.flatMap((result) => result.issues ?? [])) {
    featureIssueMap.set(featureIssue.key, featureIssue);
  }
  return featureIssueMap;
}

/**
 * Builds feature nodes (with health/completion + child stories) for an **arbitrary** set of feature
 * keys, independent of any PI/team scope. It reuses the exact same child-discovery query and node
 * builder as the PI-scoped blueprint, so health and completion are computed identically. Every
 * discovered child is treated as in-train (there is no PI-based off-train split here), so a feature's
 * health/completion reflect all of its children. Used by the Feature Canvas's query-driven surfacing.
 */
export async function fetchFeatureNodesByKeys(featureKeys: string[]): Promise<BlueprintFeatureNode[]> {
  const uniqueFeatureKeys = Array.from(new Set(featureKeys.filter(Boolean)));
  if (uniqueFeatureKeys.length === 0) {
    return [];
  }

  const artSettings = loadArtSettings();
  const featureLinkField = artSettings.featureLinkField || DEFAULT_FEATURE_LINK_FIELD;
  const piFieldId = artSettings.piFieldId || DEFAULT_PI_FIELD_ID;

  const featureIssueMap = await fetchFeatureIssuesByKeysForBlueprint(uniqueFeatureKeys, featureLinkField, piFieldId);
  const childIssueMap = await fetchAllFeatureChildren(featureIssueMap, featureLinkField, piFieldId);
  const emptySubtaskMap = new Map<string, BlueprintIssueRecord[]>();

  return uniqueFeatureKeys.map((featureKey) => {
    const children = childIssueMap.get(featureKey) ?? [];
    // teamIssues === allChildren → offTrain is empty; artProjectKeys/piName are unused for in-train stories.
    return createBlueprintFeatureNode(featureKey, featureIssueMap.get(featureKey), children, children, emptySubtaskMap, [], '', piFieldId);
  });
}

function createBlueprintProgramEpicNodes(
  featureIssueMap: Map<string, BlueprintIssueRecord>,
  programEpicIssueMap: Map<string, BlueprintIssueRecord>,
  allTeamIssues: BlueprintIssueRecord[],
  subtaskMap: Map<string, BlueprintIssueRecord[]>,
  allFeatureChildrenMap: Map<string, BlueprintIssueRecord[]>,
  piName: string,
  piFieldId: string,
  artProjectKeys: string[],
): BlueprintProgramEpicNode[] {
  const featureToTeamIssues = new Map<string, BlueprintIssueRecord[]>();
  for (const teamIssue of allTeamIssues) {
    if (!teamIssue._featureKey) {
      continue;
    }

    const existingIssues = featureToTeamIssues.get(teamIssue._featureKey) ?? [];
    existingIssues.push(teamIssue);
    featureToTeamIssues.set(teamIssue._featureKey, existingIssues);
  }

  const programEpicBuckets = new Map<string, string[]>();
  for (const featureKey of featureIssueMap.keys()) {
    const featureIssue = featureIssueMap.get(featureKey);
    const programEpicKey = featureIssue?._peKey ?? PROGRAM_EPIC_EMPTY_BUCKET_KEY;
    const bucketFeatures = programEpicBuckets.get(programEpicKey) ?? [];
    bucketFeatures.push(featureKey);
    programEpicBuckets.set(programEpicKey, bucketFeatures);
  }

  return Array.from(programEpicBuckets.entries())
    .map(([programEpicKey, featureKeys]) => {
      const featureNodes = featureKeys.map((featureKey) =>
        createBlueprintFeatureNode(
          featureKey,
          featureIssueMap.get(featureKey),
          featureToTeamIssues.get(featureKey) ?? [],
          allFeatureChildrenMap.get(featureKey) ?? [],
          subtaskMap,
          artProjectKeys,
          piName,
          piFieldId,
        ));
      const inTrainProgramEpicStories = featureNodes.flatMap((featureNode) => featureNode.children);
      const allProgramEpicStories = featureNodes.flatMap((featureNode) => [...featureNode.children, ...featureNode.offTrain]);
      const programEpicIssue = programEpicIssueMap.get(programEpicKey);
      return {
        type: 'pe' as const,
        key: programEpicKey,
        summary: programEpicIssue?.fields.summary ?? 'No Program Epic',
        status: programEpicIssue?.fields.status?.name ?? null,
        health: computeBlueprintHealth(inTrainProgramEpicStories),
        completionPercent: computeCompletionPercent(allProgramEpicStories),
        features: featureNodes,
      };
    })
    .sort((leftProgramEpic, rightProgramEpic) => {
      if (leftProgramEpic.key === PROGRAM_EPIC_EMPTY_BUCKET_KEY) {
        return 1;
      }

      if (rightProgramEpic.key === PROGRAM_EPIC_EMPTY_BUCKET_KEY) {
        return -1;
      }

      return leftProgramEpic.key.localeCompare(rightProgramEpic.key);
    });
}

function buildProgramEpicIssueMap(programEpicIssues: BlueprintIssueRecord[]): Map<string, BlueprintIssueRecord> {
  return new Map(programEpicIssues.map((issue) => [issue.key, issue]));
}

function buildFeatureIssueMap(featureIssues: BlueprintIssueRecord[]): Map<string, BlueprintIssueRecord> {
  return new Map(featureIssues.map((issue) => [issue.key, issue]));
}

async function fetchBlueprintQuerySourceData(
  teams: ArtTeam[],
  selectedPiName: string,
): Promise<BlueprintQuerySourceData | null> {
  const settings = loadArtSettings();
  const featureLinkField = settings.featureLinkField?.trim() || DEFAULT_FEATURE_LINK_FIELD;
  const parentLinkField = settings.parentLinkField?.trim() || DEFAULT_PARENT_LINK_FIELD;
  const piFieldId = settings.piFieldId?.trim() || DEFAULT_PI_FIELD_ID;
  const allTeamIssues = await fetchTeamIssuesForBlueprint(teams, selectedPiName, featureLinkField, parentLinkField, piFieldId);
  const featureKeys = createFeatureKeySet(allTeamIssues, featureLinkField);
  if (featureKeys.length === 0) {
    return null;
  }

  const featureIssueMap = buildFeatureIssueMap(
    await fetchIssuesByKeys(featureKeys, createFeatureDetailsFields(parentLinkField), FEATURE_BATCH_SIZE),
  );
  const programEpicKeys = createProgramEpicKeySet(featureIssueMap, parentLinkField);
  const programEpicIssueMap = buildProgramEpicIssueMap(
    await fetchIssuesByKeys(
      programEpicKeys,
      'summary,status,issuetype,assignee,priority,labels,issuelinks',
      FEATURE_BATCH_SIZE,
    ),
  );

  await discoverProgramEpicChildren(featureIssueMap, programEpicKeys, parentLinkField);
  const artProjectKeys = teams
    .map((team) => team.projectKey?.toUpperCase())
    .filter((projectKey): projectKey is string => Boolean(projectKey));
  const allFeatureChildrenMap = await fetchAllFeatureChildren(featureIssueMap, featureLinkField, piFieldId);
  const subtaskMap = await fetchSubtaskMap(allTeamIssues);

  return {
    allTeamIssues,
    featureIssueMap,
    programEpicIssueMap,
    allFeatureChildrenMap,
    subtaskMap,
    trimmedPiName: selectedPiName.trim(),
    piFieldId,
    artProjectKeys,
  };
}

function readIssueProjectKey(issue: BlueprintIssueRecord): string {
  return issue.fields.project?.key?.toUpperCase() ?? issue.key.split('-')[0]?.toUpperCase() ?? '';
}

function createTeamNameByProjectKey(teams: ArtTeam[]): Map<string, string> {
  return new Map(
    teams
      .filter((team) => Boolean(team.projectKey?.trim()))
      .map((team) => [team.projectKey!.trim().toUpperCase(), team.name]),
  );
}

function createDependencySourceIssue(
  issue: BlueprintIssueRecord,
  nodeType: 'pe' | 'feature' | 'story',
  teamNameByProjectKey: Map<string, string>,
  artProjectKeys: string[],
  featureKey: string | null,
  programEpicKey: string | null,
): DependencySourceIssue {
  const issueProjectKey = readIssueProjectKey(issue);
  return {
    key: issue.key,
    summary: issue.fields.summary ?? issue.key,
    status: issue.fields.status?.name ?? 'Unknown',
    issueType: issue.fields.issuetype?.name ?? 'Story',
    nodeType,
    teamName: issue._teamName ?? teamNameByProjectKey.get(issueProjectKey) ?? null,
    projectKey: issueProjectKey,
    inTeam: artProjectKeys.includes(issueProjectKey),
    featureKey,
    programEpicKey,
    issueLinks: issue.fields.issuelinks ?? [],
  };
}

function collectDependencySourceIssues(
  sourceData: BlueprintQuerySourceData,
  teams: ArtTeam[],
): DependencySourceIssue[] {
  const teamNameByProjectKey = createTeamNameByProjectKey(teams);
  const sourceIssuesByKey = new Map<string, DependencySourceIssue>();

  for (const programEpicIssue of sourceData.programEpicIssueMap.values()) {
    sourceIssuesByKey.set(
      programEpicIssue.key,
      createDependencySourceIssue(
        programEpicIssue,
        'pe',
        teamNameByProjectKey,
        sourceData.artProjectKeys,
        null,
        programEpicIssue.key,
      ),
    );
  }

  for (const featureIssue of sourceData.featureIssueMap.values()) {
    sourceIssuesByKey.set(
      featureIssue.key,
      createDependencySourceIssue(
        featureIssue,
        'feature',
        teamNameByProjectKey,
        sourceData.artProjectKeys,
        featureIssue.key,
        featureIssue._peKey ?? null,
      ),
    );
  }

  for (const [featureKey, childIssues] of sourceData.allFeatureChildrenMap.entries()) {
    const featureIssue = sourceData.featureIssueMap.get(featureKey);
    const programEpicKey = featureIssue?._peKey ?? null;
    for (const childIssue of childIssues) {
      sourceIssuesByKey.set(
        childIssue.key,
        createDependencySourceIssue(
          childIssue,
          'story',
          teamNameByProjectKey,
          sourceData.artProjectKeys,
          featureKey,
          programEpicKey,
        ),
      );
    }
  }

  for (const teamIssue of sourceData.allTeamIssues) {
    if (sourceIssuesByKey.has(teamIssue.key)) {
      continue;
    }

    sourceIssuesByKey.set(
      teamIssue.key,
      createDependencySourceIssue(
        teamIssue,
        'story',
        teamNameByProjectKey,
        sourceData.artProjectKeys,
        teamIssue._featureKey ?? null,
        sourceData.featureIssueMap.get(teamIssue._featureKey ?? '')?._peKey ?? null,
      ),
    );
  }

  return Array.from(sourceIssuesByKey.values());
}

/** Fetches the raw Blueprint-backed issue set used by the legacy Dependencies graph. */
export async function fetchBlueprintDependencySourceIssues(
  teams: ArtTeam[],
  selectedPiName: string,
): Promise<DependencySourceIssue[]> {
  const sourceData = await fetchBlueprintQuerySourceData(teams, selectedPiName);
  if (!sourceData) {
    return [];
  }

  return collectDependencySourceIssues(sourceData, teams);
}

/** Fetches the legacy-style bottom-up Blueprint hierarchy from Jira. */
export async function fetchBlueprintHierarchy(
  teams: ArtTeam[],
  selectedPiName: string,
): Promise<BlueprintProgramEpicNode[]> {
  const sourceData = await fetchBlueprintQuerySourceData(teams, selectedPiName);
  if (!sourceData) {
    return [];
  }

  return createBlueprintProgramEpicNodes(
    sourceData.featureIssueMap,
    sourceData.programEpicIssueMap,
    sourceData.allTeamIssues,
    sourceData.subtaskMap,
    sourceData.allFeatureChildrenMap,
    sourceData.trimmedPiName,
    sourceData.piFieldId,
    sourceData.artProjectKeys,
  );
}

function matchesSearchTerm(nodeSummary: string, nodeKey: string, searchTerm: string, nodeAssignee?: string | null, nodeStatus?: string | null): boolean {
  if (!searchTerm) {
    return true;
  }

  const normalizedSearchTerm = searchTerm.toLowerCase();
  return nodeKey.toLowerCase().includes(normalizedSearchTerm)
    || nodeSummary.toLowerCase().includes(normalizedSearchTerm)
    || (nodeAssignee ?? '').toLowerCase().includes(normalizedSearchTerm)
    || (nodeStatus ?? '').toLowerCase().includes(normalizedSearchTerm);
}

/** Returns only Program Epics and features that match the active search term. */
export function filterProgramEpicsBySearch(
  programEpics: BlueprintProgramEpicNode[],
  searchTerm: string,
): BlueprintProgramEpicNode[] {
  if (!searchTerm.trim()) {
    return programEpics;
  }

  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  return programEpics
    .map((programEpic) => {
      const filteredFeatures = programEpic.features.filter((featureNode) =>
        matchesSearchTerm(featureNode.summary, featureNode.key, normalizedSearchTerm, null, featureNode.status)
        || featureNode.children.some((storyNode) =>
          matchesSearchTerm(storyNode.summary, storyNode.key, normalizedSearchTerm, storyNode.assignee, storyNode.status))
        || featureNode.offTrain.some((storyNode) =>
          matchesSearchTerm(storyNode.summary, storyNode.key, normalizedSearchTerm, storyNode.assignee, storyNode.status)));

      const hasProgramEpicMatch = matchesSearchTerm(programEpic.summary, programEpic.key, normalizedSearchTerm, null, programEpic.status);
      return hasProgramEpicMatch || filteredFeatures.length > 0
        ? { ...programEpic, features: filteredFeatures }
        : null;
    })
    .filter((programEpic): programEpic is BlueprintProgramEpicNode => Boolean(programEpic));
}

/** Flattens all features across Program Epics for flat Blueprint views. */
export function flattenProgramEpicFeatures(programEpics: BlueprintProgramEpicNode[]): BlueprintFeatureNode[] {
  return programEpics.flatMap((programEpic) => programEpic.features);
}
