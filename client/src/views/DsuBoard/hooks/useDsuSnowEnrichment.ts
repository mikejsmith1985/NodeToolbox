// useDsuSnowEnrichment.ts — Helper utilities for DSU Board ServiceNow link enrichment.

import { jiraGet } from '../../../services/jiraApi.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const MAX_REMOTE_LOOKUP_COUNT = 15;
const SNOW_LABEL_PATTERN = /\b(?:INC|PRB)\d+\b/gi;
const INCIDENT_PREFIX = 'INC';
const INCIDENT_PATH = 'incident.do';
const PROBLEM_PATH = 'problem.do';

interface JiraRemoteLink {
  url?: string;
  title?: string;
  globalId?: string;
  object?: {
    url?: string;
    title?: string;
    summary?: string;
  };
}

/** A normalized ServiceNow label and URL pair shown on DSU issue cards. */
export interface SnowLink {
  label: string;
  url: string | null;
}

/** Per-issue ServiceNow links keyed by Jira issue key. */
export type SnowLinksMap = Record<string, SnowLink[]>;

function createSnowBaseUrl(snowBaseUrl: string): string {
  return snowBaseUrl.replace(/\/+$/, '');
}

function extractUniqueSnowLabels(sourceText: string): string[] {
  const uniqueLabels = new Set<string>();
  for (const matchedLabel of sourceText.match(SNOW_LABEL_PATTERN) ?? []) {
    uniqueLabels.add(matchedLabel.toUpperCase());
  }
  return Array.from(uniqueLabels);
}

function buildSnowUrl(label: string, snowBaseUrl: string): string | null {
  const normalizedSnowBaseUrl = createSnowBaseUrl(snowBaseUrl);
  if (!normalizedSnowBaseUrl) {
    return null;
  }

  const tablePath = label.startsWith(INCIDENT_PREFIX) ? INCIDENT_PATH : PROBLEM_PATH;
  return `${normalizedSnowBaseUrl}/${tablePath}?number=${label}`;
}

function mergeSnowLinks(existingSnowLinks: SnowLink[], newSnowLinks: SnowLink[]): SnowLink[] {
  const snowLinksByLabel = new Map(existingSnowLinks.map((snowLink) => [snowLink.label, snowLink]));

  for (const snowLink of newSnowLinks) {
    const existingSnowLink = snowLinksByLabel.get(snowLink.label);
    if (existingSnowLink === undefined || (existingSnowLink.url === null && snowLink.url !== null)) {
      snowLinksByLabel.set(snowLink.label, snowLink);
    }
  }

  return Array.from(snowLinksByLabel.values());
}

function createRemoteLinkSearchText(remoteLink: JiraRemoteLink): string {
  return [
    remoteLink.title,
    remoteLink.url,
    remoteLink.globalId,
    remoteLink.object?.title,
    remoteLink.object?.summary,
    remoteLink.object?.url,
  ]
    .filter((fragment): fragment is string => typeof fragment === 'string' && fragment.length > 0)
    .join(' ');
}

function extractSnowLinksFromRemoteLink(remoteLink: JiraRemoteLink, snowBaseUrl: string): SnowLink[] {
  const remoteLinkUrl = remoteLink.object?.url ?? remoteLink.url ?? null;
  return extractUniqueSnowLabels(createRemoteLinkSearchText(remoteLink)).map((label) => ({
    label,
    url: remoteLinkUrl ?? buildSnowUrl(label, snowBaseUrl),
  }));
}

/** Extracts normalized ServiceNow INC/PRB values from a Jira summary. */
export function extractSnowLinksFromSummary(summary: string, snowBaseUrl: string): SnowLink[] {
  return extractUniqueSnowLabels(summary).map((label) => ({
    label,
    url: buildSnowUrl(label, snowBaseUrl),
  }));
}

/** Enriches summary-derived ServiceNow links with additional Jira remote-link matches. */
export async function enrichIssuesWithSnowLinks(
  issues: JiraIssue[],
  snowBaseUrl: string,
): Promise<SnowLinksMap> {
  const snowLinksByIssue: SnowLinksMap = {};
  const issuesWithSummaryMatches: JiraIssue[] = [];

  for (const issue of issues) {
    const summarySnowLinks = extractSnowLinksFromSummary(issue.fields.summary, snowBaseUrl);
    if (summarySnowLinks.length === 0) {
      continue;
    }

    snowLinksByIssue[issue.key] = summarySnowLinks;
    issuesWithSummaryMatches.push(issue);
  }

  await Promise.all(
    issuesWithSummaryMatches.slice(0, MAX_REMOTE_LOOKUP_COUNT).map(async (issue) => {
      try {
        const remoteLinks = await jiraGet<JiraRemoteLink[]>(`/rest/api/2/issue/${issue.key}/remotelink`);
        const remoteSnowLinks = remoteLinks.flatMap((remoteLink) =>
          extractSnowLinksFromRemoteLink(remoteLink, snowBaseUrl),
        );
        snowLinksByIssue[issue.key] = mergeSnowLinks(
          snowLinksByIssue[issue.key] ?? [],
          remoteSnowLinks,
        );
      } catch {
        // Remote-link enrichment is best-effort so the summary-derived badges still render.
      }
    }),
  );

  return snowLinksByIssue;
}
