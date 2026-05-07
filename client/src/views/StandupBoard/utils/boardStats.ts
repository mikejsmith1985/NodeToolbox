// boardStats.ts — Pure Standup Board helpers for Jira issue age, blockers, and flow health metrics.

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const WARNING_AGE_DAYS = 2;
const OLD_AGE_DAYS = 5;
const ONE_DECIMAL_PLACE = 10;

export type StatusCategoryKey = 'new' | 'indeterminate' | 'done';
export type AgeClassification = 'ok' | 'warn' | 'old';

export interface StandupIssue {
  key: string;
  summary: string;
  status: string;
  statusCategoryKey: StatusCategoryKey;
  assignee: string | null;
  ageDays: number;
  isBlocked: boolean;
}

export interface FlowStats {
  wip: number;
  stale: number;
  blocked: number;
  avgAgeDays: number;
}

interface JiraIssueLinkType {
  name?: string;
}

interface JiraIssueLink {
  type?: JiraIssueLinkType;
  inwardIssue?: unknown;
  outwardIssue?: unknown;
}

interface JiraIssueWithLinks {
  fields?: {
    issuelinks?: JiraIssueLink[];
  };
}

/** Calculates whole issue age days so standup cards surface the oldest work first. */
export function ageInDays(createdIso: string | undefined, now: Date = new Date()): number {
  if (!createdIso) return 0;

  const createdTimestamp = new Date(createdIso).getTime();
  const currentTimestamp = now.getTime();
  if (!Number.isFinite(createdTimestamp) || !Number.isFinite(currentTimestamp)) return 0;

  return Math.max(0, Math.floor((currentTimestamp - createdTimestamp) / MILLISECONDS_PER_DAY));
}

/** Detects inward blocker links because those issues need explicit standup attention. */
export function isBlocked(issue: JiraIssueWithLinks): boolean {
  const issueLinks = issue.fields?.issuelinks ?? [];
  return issueLinks.some((issueLink) => {
    const linkTypeName = issueLink.type?.name?.toLowerCase() ?? '';
    return Boolean(issueLink.inwardIssue) && linkTypeName.includes('block');
  });
}

/** Classifies age into the legacy green/yellow/red attention bands. */
export function classifyAge(ageDays: number): AgeClassification {
  if (ageDays <= WARNING_AGE_DAYS) return 'ok';
  if (ageDays <= OLD_AGE_DAYS) return 'warn';
  return 'old';
}

/** Computes flow health numbers used by the Standup Board summary bar. */
export function computeFlowStats(issues: StandupIssue[]): FlowStats {
  const nonDoneIssues = issues.filter((issue) => issue.statusCategoryKey !== 'done');
  const totalAgeDays = nonDoneIssues.reduce((runningTotal, issue) => runningTotal + issue.ageDays, 0);
  const averageAgeDays = nonDoneIssues.length === 0 ? 0 : totalAgeDays / nonDoneIssues.length;

  return {
    wip: issues.filter((issue) => issue.statusCategoryKey === 'indeterminate').length,
    stale: issues.filter((issue) => issue.statusCategoryKey === 'indeterminate' && issue.ageDays > OLD_AGE_DAYS).length,
    blocked: issues.filter((issue) => issue.isBlocked).length,
    avgAgeDays: Math.round(averageAgeDays * ONE_DECIMAL_PLACE) / ONE_DECIMAL_PLACE,
  };
}
