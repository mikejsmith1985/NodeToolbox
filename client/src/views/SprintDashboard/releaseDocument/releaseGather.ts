// releaseGather.ts — Gathers one release from Jira: the team's children and the Epics they deliver (GH #395).
//
// A team's work lives in its own project (ENCUC, ENFCT) but its Epics live elsewhere (DASP, DENP), so Epics
// are found FROM the children — by walking each child's parent link — and then from a same-name fixVersion
// search in those Epic projects, kept only when the Epic has a child in the team's project. Every Jira call is
// injected and every field id arrives as data, so this module is pure and field-blind.

import { extractFeatureKeyFromIssueFields, type FeatureLinkFields } from '../../../utils/featureLink.ts';
import { escapeJqlValue } from '../../../utils/jqlValue.ts';
import { computeMisalignments, isInRelease } from './releaseAlignment.ts';

/**
 * A disagreement between an Epic and its children about the release, compared by fixVersion name.
 * - `epic-has-no-version`: a child is in this release; its Epic carries no fixVersion.
 * - `epic-in-other-version`: a child is in this release; its Epic names other versions.
 * - `child-outside-release`: the Epic is in this release; one of its team children is not.
 */
export interface ReleaseMisalignment {
  kind: 'epic-has-no-version' | 'epic-in-other-version' | 'child-outside-release';
  /** The issue the flag is about (the child, or the Epic for the first two kinds). */
  issueKey: string;
  /** Plain words for the page and the tab, naming the versions involved. */
  message: string;
}

/** A Jira issue as the gather step needs it: its key and raw fields. */
export interface GatherIssue {
  key: string;
  fields: Record<string, unknown>;
}

/** One issue on the release document. `notes` is hand-entered, merged in from the page. */
export interface ReleaseItem {
  key: string;
  summary: string;
  issueTypeName: string;
  statusName: string;
  assigneeName: string;
  fixVersionNames: string[];
  epicKey: string | null;
  notes: string;
}

/** A team child of an Epic that is NOT in this release — the evidence for a misalignment flag. */
export interface OutsideItem {
  key: string;
  fixVersionNames: string[];
}

/** One Epic and its children in this release. `epicKey` null is the "No Epic" group. */
export interface EpicGroup {
  epicKey: string | null;
  /** The Epic itself, or null when it could not be read (or for the "No Epic" group). */
  epic: ReleaseItem | null;
  items: ReleaseItem[];
  outsideItems: OutsideItem[];
  misalignments: ReleaseMisalignment[];
}

/** The two Jira reads gathering needs; both return every match, already paged. */
export interface ReleaseGatherDeps {
  searchAll: (jql: string) => Promise<GatherIssue[]>;
  fetchByKeys: (issueKeys: readonly string[]) => Promise<GatherIssue[]>;
}

export interface ReleaseGatherInput {
  teamProjectKey: string;
  versionName: string;
  /** The configured feature link field id; Epic Link and `parent` are tried after it. */
  featureLinkField: string;
  /** The Epic Link field id, for finding an Epic's children; null when not configured. */
  epicLinkFieldId: string | null;
  /** The team's configured feature projects — more places its Epics may live. */
  extraEpicProjectKeys: readonly string[];
}

// Jira caps how long a `key in (…)` / `parent in (…)` list may be in one query; stay well under it.
const KEYS_PER_LOOKUP = 50;
// Shown in place of an empty assignee, so a blank cell never reads as "not loaded".
const UNASSIGNED_LABEL = 'Unassigned';

// ── Reading Jira fields ──

/** The `name` of a `{ name }` field, or '' when absent. */
function readNamedField(fieldValue: unknown): string {
  return typeof fieldValue === 'object' && fieldValue !== null && typeof (fieldValue as { name?: unknown }).name === 'string'
    ? (fieldValue as { name: string }).name
    : '';
}

/** Every fixVersion name on an issue. */
export function readFixVersionNames(issue: GatherIssue): string[] {
  const fixVersions = issue.fields.fixVersions;
  return Array.isArray(fixVersions) ? fixVersions.map((fixVersion) => readNamedField(fixVersion)).filter(Boolean) : [];
}

/** The project an issue belongs to: its project field, or its key's prefix. */
function readProjectKey(issue: GatherIssue): string {
  const projectField = issue.fields.project as { key?: unknown } | undefined;
  return typeof projectField?.key === 'string' ? projectField.key : issue.key.split('-')[0];
}

/** The Epic (or Feature) an issue belongs to, through the feature link, Epic Link or `parent`. */
function readEpicKey(issue: GatherIssue, featureLinkField: string): string | null {
  return extractFeatureKeyFromIssueFields(issue.fields as FeatureLinkFields, featureLinkField);
}

/** An issue as a release-document row. */
function toReleaseItem(issue: GatherIssue, featureLinkField: string): ReleaseItem {
  const assignee = issue.fields.assignee as { displayName?: unknown } | null | undefined;
  return {
    key: issue.key,
    summary: typeof issue.fields.summary === 'string' ? issue.fields.summary : '',
    issueTypeName: readNamedField(issue.fields.issuetype),
    statusName: readNamedField(issue.fields.status),
    assigneeName: typeof assignee?.displayName === 'string' ? assignee.displayName : UNASSIGNED_LABEL,
    fixVersionNames: readFixVersionNames(issue),
    epicKey: readEpicKey(issue, featureLinkField),
    notes: '',
  };
}

// ── Jira queries ──

/** Splits keys into lookup-sized batches. */
function chunkKeys(issueKeys: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let chunkStart = 0; chunkStart < issueKeys.length; chunkStart += KEYS_PER_LOOKUP) {
    chunks.push(issueKeys.slice(chunkStart, chunkStart + KEYS_PER_LOOKUP));
  }
  return chunks;
}

/** `cf[90002]` from `customfield_90002`, for JQL; null for an id that is not a custom field. */
function toJqlCustomFieldReference(fieldId: string | null): string | null {
  const customFieldMatch = /^customfield_(\d+)$/.exec(fieldId ?? '');
  return customFieldMatch ? `cf[${customFieldMatch[1]}]` : null;
}

/**
 * Same-name Epics in each Epic project. fixVersions belong to one project, so a project without this version
 * makes Jira refuse the search — that project is skipped with a warning rather than failing the release.
 */
async function searchSameNameEpics(
  input: ReleaseGatherInput,
  epicProjectKeys: readonly string[],
  deps: ReleaseGatherDeps,
): Promise<{ epics: GatherIssue[]; warnings: string[] }> {
  const epics: GatherIssue[] = [];
  const warnings: string[] = [];
  for (const projectKey of epicProjectKeys) {
    try {
      epics.push(...await deps.searchAll(
        `project = "${escapeJqlValue(projectKey)}" AND fixVersion = "${escapeJqlValue(input.versionName)}"`,
      ));
    } catch (searchError) {
      const reason = searchError instanceof Error ? searchError.message : String(searchError);
      warnings.push(`Could not search ${projectKey} for "${input.versionName}": ${reason}`);
    }
  }
  return { epics, warnings };
}

/** Every team-project child of the given Epics, through `parent` and the Epic Link field. */
async function searchTeamChildrenOfEpics(
  input: ReleaseGatherInput,
  epicKeys: readonly string[],
  deps: ReleaseGatherDeps,
): Promise<GatherIssue[]> {
  const epicLinkReference = toJqlCustomFieldReference(input.epicLinkFieldId);
  const children: GatherIssue[] = [];
  for (const keyChunk of chunkKeys(epicKeys)) {
    const keyList = keyChunk.join(', ');
    const linkClauses = [`parent in (${keyList})`, ...(epicLinkReference ? [`${epicLinkReference} in (${keyList})`] : [])];
    children.push(...await deps.searchAll(
      `project = "${escapeJqlValue(input.teamProjectKey)}" AND (${linkClauses.join(' OR ')})`,
    ));
  }
  return children;
}

// ── Assembly ──

/** Groups sorted by Epic key, numerically within a project; the "No Epic" group always last. */
function sortGroups(groups: EpicGroup[]): EpicGroup[] {
  return [...groups].sort((firstGroup, secondGroup) => {
    if (firstGroup.epicKey === null) return 1;
    if (secondGroup.epicKey === null) return -1;
    return firstGroup.epicKey.localeCompare(secondGroup.epicKey, undefined, { numeric: true });
  });
}

/** An empty group for an Epic, holding the Epic's own row when it could be read. */
function createGroup(epicKey: string | null, epicIssue: GatherIssue | undefined, featureLinkField: string): EpicGroup {
  return {
    epicKey,
    epic: epicIssue ? toReleaseItem(epicIssue, featureLinkField) : null,
    items: [],
    outsideItems: [],
    misalignments: [],
  };
}

/**
 * Gathers a release: the team project's issues with this fixVersion, each under the Epic it belongs to, plus
 * Epics carrying the same version name that have a team child — with the team children each Epic has OUTSIDE
 * this release recorded, so misalignments can be flagged. Warnings report projects that could not be searched.
 */
export async function gatherRelease(
  input: ReleaseGatherInput,
  deps: ReleaseGatherDeps,
): Promise<{ groups: EpicGroup[]; warnings: string[] }> {
  const releaseChildren = await deps.searchAll(
    `project = "${escapeJqlValue(input.teamProjectKey)}" AND fixVersion = "${escapeJqlValue(input.versionName)}" ORDER BY key ASC`,
  );
  const childItems = releaseChildren.map((issue) => toReleaseItem(issue, input.featureLinkField));
  const parentKeys = [...new Set(childItems.map((item) => item.epicKey).filter((epicKey): epicKey is string => epicKey !== null))];
  const parentIssues = parentKeys.length > 0 ? await deps.fetchByKeys(parentKeys) : [];
  const epicIssueByKey = new Map(parentIssues.map((issue) => [issue.key, issue]));

  const epicProjectKeys = [...new Set([...parentIssues.map((issue) => readProjectKey(issue)), ...input.extraEpicProjectKeys])]
    .filter((projectKey) => projectKey !== input.teamProjectKey);
  const { epics: sameNameEpics, warnings } = await searchSameNameEpics(input, epicProjectKeys, deps);
  sameNameEpics.forEach((epicIssue) => {
    if (!epicIssueByKey.has(epicIssue.key)) epicIssueByKey.set(epicIssue.key, epicIssue);
  });

  // The children of every Epic that carries this release — what decides whether a same-name Epic is this
  // team's, and which team children sit outside the release.
  const releaseEpicKeys = [...epicIssueByKey.values()]
    .filter((epicIssue) => isInRelease(readFixVersionNames(epicIssue), input.versionName))
    .map((epicIssue) => epicIssue.key);
  const epicChildren = releaseEpicKeys.length > 0 ? await searchTeamChildrenOfEpics(input, releaseEpicKeys, deps) : [];

  const groupsByKey = new Map<string | null, EpicGroup>();
  const ensureGroup = (epicKey: string | null): EpicGroup => {
    const existingGroup = groupsByKey.get(epicKey);
    if (existingGroup) return existingGroup;
    const newGroup = createGroup(epicKey, epicKey ? epicIssueByKey.get(epicKey) : undefined, input.featureLinkField);
    groupsByKey.set(epicKey, newGroup);
    return newGroup;
  };

  childItems.forEach((item) => ensureGroup(item.epicKey).items.push(item));
  epicChildren.forEach((childIssue) => {
    const epicKey = readEpicKey(childIssue, input.featureLinkField);
    const fixVersionNames = readFixVersionNames(childIssue);
    if (epicKey === null || !releaseEpicKeys.includes(epicKey) || isInRelease(fixVersionNames, input.versionName)) {
      return;
    }
    ensureGroup(epicKey).outsideItems.push({ key: childIssue.key, fixVersionNames });
  });

  const groupsWithFlags = [...groupsByKey.values()].map((group) => ({
    ...group,
    misalignments: computeMisalignments(group, input.versionName),
  }));
  return { groups: sortGroups(groupsWithFlags), warnings };
}
