// blastRadius.ts — Pure helpers that translate Jira issue links into Impact Analysis blast-radius data.

const UNKNOWN_KEY = 'UNKNOWN';
const UNKNOWN_STATUS = 'Unknown';
const UNTITLED_SUMMARY = 'Untitled Jira issue';
const BLOCKER_TEXT = 'block';

export type LinkDirection = 'inward' | 'outward';
export type StatusCategoryKey = 'new' | 'indeterminate' | 'done' | 'unknown';

export interface RelatedIssue {
  key: string;
  summary: string;
  statusName: string;
  statusCategoryKey: StatusCategoryKey;
}

export interface BlastLink {
  direction: LinkDirection;
  linkType: string;
  related: RelatedIssue;
  isBlocker: boolean;
}

export type BlastChild = RelatedIssue;

export interface BlastStats {
  totalRelated: number;
  blockerCount: number;
  openCount: number;
  doneCount: number;
}

interface JiraStatusCategory {
  key?: string;
}

interface JiraStatus {
  name?: string;
  statusCategory?: JiraStatusCategory;
}

interface JiraIssueFields {
  summary?: string;
  status?: JiraStatus;
}

interface JiraLinkedIssue {
  key?: string;
  fields?: JiraIssueFields;
}

interface JiraIssueLinkType {
  name?: string;
  inward?: string;
  outward?: string;
}

export interface JiraIssueLink {
  type?: JiraIssueLinkType;
  inwardIssue?: JiraLinkedIssue;
  outwardIssue?: JiraLinkedIssue;
}

export interface ParsedIssueLinks {
  inward: BlastLink[];
  outward: BlastLink[];
}

/** Normalizes Jira link labels so grouping and blocker counts are stable across Jira configurations. */
export function normalizeLinkType(linkType: string | undefined): string {
  return linkType?.trim().toLowerCase().replace(/\s+/g, ' ') || 'relates to';
}

/** Converts Jira's raw issue-link payload into the inward and outward rows shown by Impact Analysis. */
export function parseIssueLinks(issueLinks: JiraIssueLink[] | undefined): ParsedIssueLinks {
  const parsedLinks: ParsedIssueLinks = { inward: [], outward: [] };

  for (const issueLink of issueLinks ?? []) {
    const outwardLink = createBlastLink('outward', issueLink.outwardIssue, issueLink.type?.outward ?? issueLink.type?.name);
    const inwardLink = createBlastLink('inward', issueLink.inwardIssue, issueLink.type?.inward ?? issueLink.type?.name);

    if (outwardLink !== null) parsedLinks.outward.push(outwardLink);
    if (inwardLink !== null) parsedLinks.inward.push(inwardLink);
  }

  return parsedLinks;
}

/** Computes footer counts from every rendered related issue so the summary matches what users see. */
export function computeBlastStats(inward: BlastLink[], outward: BlastLink[], children: BlastChild[]): BlastStats {
  const allLinks = [...inward, ...outward];
  const allRelatedIssues = [...allLinks.map((link) => link.related), ...children];
  const doneCount = allRelatedIssues.filter((relatedIssue) => relatedIssue.statusCategoryKey === 'done').length;

  return {
    totalRelated: allRelatedIssues.length,
    blockerCount: allLinks.filter((link) => link.isBlocker).length,
    openCount: allRelatedIssues.length - doneCount,
    doneCount,
  };
}

/** Maps the small Jira issue shape used by links and children into a safe display model. */
export function mapJiraIssueToRelatedIssue(issue: JiraLinkedIssue | undefined): RelatedIssue {
  return {
    key: issue?.key?.trim() || UNKNOWN_KEY,
    summary: issue?.fields?.summary?.trim() || UNTITLED_SUMMARY,
    statusName: issue?.fields?.status?.name?.trim() || UNKNOWN_STATUS,
    statusCategoryKey: normalizeStatusCategoryKey(issue?.fields?.status?.statusCategory?.key),
  };
}

function createBlastLink(direction: LinkDirection, issue: JiraLinkedIssue | undefined, rawLinkType: string | undefined): BlastLink | null {
  if (!issue) return null;

  const linkType = normalizeLinkType(rawLinkType);
  return {
    direction,
    linkType,
    related: mapJiraIssueToRelatedIssue(issue),
    isBlocker: linkType.includes(BLOCKER_TEXT),
  };
}

function normalizeStatusCategoryKey(categoryKey: string | undefined): StatusCategoryKey {
  if (categoryKey === 'new' || categoryKey === 'indeterminate' || categoryKey === 'done') return categoryKey;
  return 'unknown';
}
