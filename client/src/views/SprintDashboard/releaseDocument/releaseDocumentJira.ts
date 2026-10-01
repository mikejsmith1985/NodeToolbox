// releaseDocumentJira.ts — The live Jira reads behind a release document: versions, paged searches, issues by key.
//
// Kept apart from the gather logic so that logic stays pure: here are the network, the configured field ids
// and the team's feature projects; there is only data.

import { fetchIssuesPaged } from '../../../services/fetchIssuesPaged.ts';
import { jiraGet } from '../../../services/jiraApi.ts';
import { resolveWriteFieldId } from '../../../services/jiraFieldMapping.ts';
import type { JiraVersion } from '../../../types/jira.ts';
import { featureLinkCandidateFieldIds, loadConfiguredFeatureLinkFieldId } from '../../../utils/featureLink.ts';
import { loadTeamFeatureScope } from '../rollupBoard/boardScopeStore.ts';
import type { GatherIssue, ReleaseGatherDeps, ReleaseGatherInput } from './releaseGather.ts';
import { formatReleasePageTitle } from './releaseTitle.ts';

/** Fetches a Jira REST path and returns its JSON — `jiraGet` in the app, a fake in tests. */
export type JiraRequest = (path: string) => Promise<unknown>;

// The page size Jira search accepts without complaint, and the most issues one release may hold. A release
// beyond the ceiling is refused rather than silently shown short.
const SEARCH_PAGE_SIZE = 100;
const RELEASE_ISSUE_CEILING = 2000;
const KEYS_PER_REQUEST = 50;

/** The fields every release-document issue is read with: what the page shows, and every Epic link. */
export function buildReleaseIssueFields(featureLinkField: string): string {
  return ['summary', 'issuetype', 'status', 'assignee', 'fixVersions', 'project', 'parent',
    ...featureLinkCandidateFieldIds(featureLinkField)].join(',');
}

/** One search request path. */
function buildSearchPath(jql: string, fields: string, startAt: number, maxResults: number): string {
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fields)}`
    + `&startAt=${startAt}&maxResults=${maxResults}`;
}

/**
 * The two Jira reads gathering needs, wired to the network. `searchAll` reads every page and refuses a
 * release too large to show whole — a release document that drops items would be worse than none.
 */
export function createReleaseGatherDeps(featureLinkField: string, request: JiraRequest = jiraGet): ReleaseGatherDeps {
  const fields = buildReleaseIssueFields(featureLinkField);
  return {
    searchAll: async (jql) => {
      const outcome = await fetchIssuesPaged<GatherIssue>(
        async (startAt, pageSize) => await request(buildSearchPath(jql, fields, startAt, pageSize)) as { issues?: GatherIssue[]; total?: number },
        { pageSize: SEARCH_PAGE_SIZE, ceiling: RELEASE_ISSUE_CEILING },
      );
      if (outcome.isTruncated) {
        throw new Error(`This search matches ${outcome.totalMatchingCount} issues — more than the ${RELEASE_ISSUE_CEILING} a release document can hold.`);
      }
      return outcome.issues;
    },
    fetchByKeys: async (issueKeys) => {
      const issues: GatherIssue[] = [];
      for (let chunkStart = 0; chunkStart < issueKeys.length; chunkStart += KEYS_PER_REQUEST) {
        const keyChunk = issueKeys.slice(chunkStart, chunkStart + KEYS_PER_REQUEST);
        const page = await request(buildSearchPath(`key in (${keyChunk.join(',')})`, fields, 0, KEYS_PER_REQUEST)) as { issues?: GatherIssue[] };
        issues.push(...(page.issues ?? []));
      }
      return issues;
    },
  };
}

/** The configured ids and the team's feature projects, everything gathering needs besides the release. */
export function loadReleaseGatherSettings(teamProfileId: string): Omit<ReleaseGatherInput, 'teamProjectKey' | 'versionName'> {
  const epicLinkFieldId = resolveWriteFieldId('epicLinkFieldId', window.localStorage);
  return {
    featureLinkField: loadConfiguredFeatureLinkFieldId(),
    epicLinkFieldId: epicLinkFieldId || null,
    extraEpicProjectKeys: loadTeamFeatureScope(teamProfileId).featureProjectKeys,
  };
}

/** A release the document can be made for: an unreleased fixVersion of the team project. */
export interface ReleaseVersionOption {
  id: string;
  name: string;
  releaseDate: string | null;
  /** The page title (e.g. 2026Oct14), or null when the version has no date to title it by. */
  pageTitle: string | null;
}

/** "2026-10-14" sorts as text; undated versions go last. */
function compareReleaseDates(firstVersion: ReleaseVersionOption, secondVersion: ReleaseVersionOption): number {
  if (!firstVersion.releaseDate) return secondVersion.releaseDate ? 1 : 0;
  if (!secondVersion.releaseDate) return -1;
  return firstVersion.releaseDate.localeCompare(secondVersion.releaseDate);
}

/**
 * The team project's unreleased, unarchived fixVersions, soonest first. Released and archived versions are
 * never offered, so their pages are never touched again.
 */
export async function fetchUnreleasedVersions(projectKey: string, request: JiraRequest = jiraGet): Promise<ReleaseVersionOption[]> {
  const versions = await request(`/rest/api/2/project/${encodeURIComponent(projectKey)}/versions`) as JiraVersion[];
  return (Array.isArray(versions) ? versions : [])
    .filter((version) => !version.released && !version.archived)
    .map((version) => ({
      id: version.id,
      name: version.name,
      releaseDate: version.releaseDate ?? null,
      pageTitle: formatReleasePageTitle({ releaseDate: version.releaseDate ?? null, name: version.name }),
    }))
    .sort(compareReleaseDates);
}
