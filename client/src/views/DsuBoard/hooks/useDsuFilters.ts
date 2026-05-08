// useDsuFilters.ts — Pure helper utilities for DSU Board multi-criteria filtering.

import type { JiraIssue } from '../../../types/jira.ts';

const PRIORITY_SEVERITY_ORDER = ['Highest', 'Critical', 'High', 'Medium', 'Low', 'Lowest'] as const;

type DsuIssueFields = JiraIssue['fields'] & {
  customfield_10301?: { value?: string; name?: string } | string | null;
};

/** Active multi-criteria filters applied across every DSU board section. */
export interface DsuMultiCriteriaFilters {
  issueTypes: string[];
  priorities: string[];
  statuses: string[];
  fixVersion: string;
  piValue: string;
}

/** All unique filter values available from the current DSU board issues. */
export interface DsuFilterOptions {
  issueTypes: string[];
  priorities: string[];
  statuses: string[];
  fixVersions: string[];
  piValues: string[];
  assignees: string[];
}

/** Default empty state for every DSU multi-criteria filter control. */
export const DEFAULT_MULTI_CRITERIA_FILTERS: DsuMultiCriteriaFilters = {
  issueTypes: [],
  priorities: [],
  statuses: [],
  fixVersion: '',
  piValue: '',
};

function createAlphabeticalValues(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((leftValue, rightValue) => leftValue.localeCompare(rightValue));
}

function getPrioritySeverityRank(priorityName: string): number {
  const severityRank = PRIORITY_SEVERITY_ORDER.indexOf(priorityName as (typeof PRIORITY_SEVERITY_ORDER)[number]);
  return severityRank === -1 ? PRIORITY_SEVERITY_ORDER.length : severityRank;
}

function getIssuePiValue(issueFields: DsuIssueFields): string {
  if (typeof issueFields.customfield_10301 === 'string') {
    return issueFields.customfield_10301;
  }

  return issueFields.customfield_10301?.value ?? issueFields.customfield_10301?.name ?? '';
}

function matchesSelectedValues(selectedValues: string[], issueValue: string | null): boolean {
  if (selectedValues.length === 0) {
    return true;
  }

  return issueValue !== null && selectedValues.includes(issueValue);
}

function matchesFixVersionFilter(issueFields: DsuIssueFields, fixVersion: string): boolean {
  if (!fixVersion) {
    return true;
  }

  return (issueFields.fixVersions ?? []).some((issueFixVersion) => issueFixVersion.name === fixVersion);
}

function matchesPiFilter(issueFields: DsuIssueFields, piValue: string): boolean {
  if (!piValue) {
    return true;
  }

  return getIssuePiValue(issueFields) === piValue;
}

function matchesAssigneeFilters(issueFields: DsuIssueFields, activeAssigneeFilters: string[]): boolean {
  if (activeAssigneeFilters.length === 0) {
    return true;
  }

  return issueFields.assignee !== null && activeAssigneeFilters.includes(issueFields.assignee.displayName);
}

/** Returns true when any DSU multi-criteria filter is currently active. */
export function hasActiveMultiCriteriaFilters(filters: DsuMultiCriteriaFilters): boolean {
  return (
    filters.issueTypes.length > 0 ||
    filters.priorities.length > 0 ||
    filters.statuses.length > 0 ||
    filters.fixVersion.trim().length > 0 ||
    filters.piValue.trim().length > 0
  );
}

/** Builds unique filter options from the DSU issues currently loaded in the board. */
export function buildFilterOptions(issues: JiraIssue[]): DsuFilterOptions {
  const issueTypeValues: string[] = [];
  const priorityValues: string[] = [];
  const statusValues: string[] = [];
  const fixVersionValues: string[] = [];
  const piValues: string[] = [];
  const assigneeValues: string[] = [];

  for (const issue of issues) {
    const issueFields = issue.fields as DsuIssueFields;
    issueTypeValues.push(issueFields.issuetype.name);
    statusValues.push(issueFields.status.name);

    if (issueFields.priority !== null) {
      priorityValues.push(issueFields.priority.name);
    }

    if (issueFields.assignee !== null) {
      assigneeValues.push(issueFields.assignee.displayName);
    }

    for (const issueFixVersion of issueFields.fixVersions ?? []) {
      fixVersionValues.push(issueFixVersion.name);
    }

    const piValue = getIssuePiValue(issueFields);
    if (piValue) {
      piValues.push(piValue);
    }
  }

  return {
    issueTypes: createAlphabeticalValues(issueTypeValues),
    priorities: Array.from(new Set(priorityValues)).sort((leftPriority, rightPriority) => {
      const rankDifference = getPrioritySeverityRank(leftPriority) - getPrioritySeverityRank(rightPriority);
      return rankDifference !== 0 ? rankDifference : leftPriority.localeCompare(rightPriority);
    }),
    statuses: createAlphabeticalValues(statusValues),
    fixVersions: createAlphabeticalValues(fixVersionValues),
    piValues: createAlphabeticalValues(piValues),
    assignees: createAlphabeticalValues(assigneeValues),
  };
}

/** Applies all DSU multi-criteria filters using AND across groups and OR within each group. */
export function applyMultiCriteriaFilters(
  issues: JiraIssue[],
  multiFilters: DsuMultiCriteriaFilters,
  activeAssigneeFilters: string[],
): JiraIssue[] {
  if (!hasActiveMultiCriteriaFilters(multiFilters) && activeAssigneeFilters.length === 0) {
    return issues;
  }

  return issues.filter((issue) => {
    const issueFields = issue.fields as DsuIssueFields;
    return (
      matchesSelectedValues(multiFilters.issueTypes, issueFields.issuetype.name) &&
      matchesSelectedValues(multiFilters.priorities, issueFields.priority?.name ?? null) &&
      matchesSelectedValues(multiFilters.statuses, issueFields.status.name) &&
      matchesFixVersionFilter(issueFields, multiFilters.fixVersion) &&
      matchesPiFilter(issueFields, multiFilters.piValue) &&
      matchesAssigneeFilters(issueFields, activeAssigneeFilters)
    );
  });
}
