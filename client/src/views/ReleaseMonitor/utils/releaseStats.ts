// releaseStats.ts — Pure release health helpers for the standalone Jira Release Monitor.

const EMPTY_TOTAL = 0;
const PERCENT_MULTIPLIER = 100;
const BLOCKER_PRIORITY_NAMES = new Set(['highest', 'critical']);

export interface JiraVersion {
  id: string;
  name: string;
  released: boolean;
  archived: boolean;
  releaseDate: string | null;
}

export type ReleaseStatus = 'on-track' | 'overdue' | 'released' | 'unknown';
export type ReleaseStatusCategoryKey = 'new' | 'indeterminate' | 'done' | 'unknown';

export interface ReleaseStats {
  total: number;
  done: number;
  completionPct: number;
  blockers: number;
  overdue: number;
}

export interface ReleaseIssue {
  key: string;
  summary: string;
  statusName: string;
  statusCategoryKey: ReleaseStatusCategoryKey;
  assigneeName: string | null;
  priorityName: string;
  duedate: string | null;
  isBlocker: boolean;
  isOverdue: boolean;
}

interface BlockerCandidate {
  priorityName?: string | null;
  labels?: string[] | null;
}

interface OverdueCandidate {
  duedate?: string | null;
  statusCategoryKey: ReleaseStatusCategoryKey;
}

/** Classifies a Jira fixVersion so release teams can quickly see schedule risk. */
export function classifyVersion(version: JiraVersion | null, today: string = readTodayIsoDate()): ReleaseStatus {
  if (!version) return 'unknown';
  if (version.released) return 'released';
  if (version.releaseDate && version.releaseDate < today) return 'overdue';
  return 'on-track';
}

/** Detects blocker issues from priority or labels because either signal blocks release readiness. */
export function isBlocker(issue: BlockerCandidate): boolean {
  const normalizedPriorityName = issue.priorityName?.trim().toLowerCase() ?? '';
  const hasBlockerPriority = BLOCKER_PRIORITY_NAMES.has(normalizedPriorityName);
  const hasBlockerLabel = (issue.labels ?? []).some((labelName) => labelName.trim().toLowerCase() === 'blocker');
  return hasBlockerPriority || hasBlockerLabel;
}

/** Flags unresolved issues whose Jira due date has passed so the release owner sees late work. */
export function isOverdue(issue: OverdueCandidate, today: string = readTodayIsoDate()): boolean {
  if (!issue.duedate || issue.statusCategoryKey === 'done') return false;
  return issue.duedate < today;
}

/** Computes the summary tiles shown above the release board. */
export function computeStats(issues: ReleaseIssue[]): ReleaseStats {
  const total = issues.length;
  const done = issues.filter((issue) => issue.statusCategoryKey === 'done').length;

  return {
    total,
    done,
    completionPct: calculateCompletionPct(done, total),
    blockers: issues.filter((issue) => issue.isBlocker).length,
    overdue: issues.filter((issue) => issue.isOverdue).length,
  };
}

function calculateCompletionPct(doneCount: number, totalCount: number): number {
  if (totalCount === EMPTY_TOTAL) return EMPTY_TOTAL;
  return Math.round((doneCount / totalCount) * PERCENT_MULTIPLIER);
}

function readTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 'YYYY-MM-DD'.length);
}
