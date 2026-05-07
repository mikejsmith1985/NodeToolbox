// useSprintPlanningState.ts — State and Jira interactions for the Sprint Planning view.
//
// Sprint Planning lets a user pull the open backlog for a chosen Jira project, review
// each story inline, edit its story points in a small numeric input, and batch-save
// every pending change with a single "Save Changes" action. The hook owns:
//
//   • backlog fetch via the existing `/jira-proxy` route (no new server endpoint)
//   • story-points field auto-detection (`customfield_10028` vs `customfield_10016`)
//   • search-string filter, pending change map, save progress + per-issue errors
//
// The legacy ToolBox version lived in `12-sprint-planning.js`; this hook ports the
// observable behaviour but keeps state in React + TypeScript so the view stays
// declarative and unit-testable.

import { useCallback, useMemo, useState } from 'react';

import { jiraGet, jiraPut } from '../../../services/jiraApi.ts';

// ── Named constants — avoid magic numbers / strings throughout the hook. ────────

/** Default JQL when the user hasn't typed anything else — gives the user a sane starting point. */
export const DEFAULT_BACKLOG_JQL = 'statusCategory != Done AND sprint is EMPTY ORDER BY priority DESC, created DESC';

/** Maximum issues to fetch in a single backlog request — Jira's hard ceiling per call is 100. */
const BACKLOG_MAX_RESULTS = 100;

/** Fields requested from Jira — kept narrow to keep network payload small. */
const BACKLOG_FIELDS = [
  'summary',
  'status',
  'priority',
  'issuetype',
  'assignee',
  'customfield_10016',
  'customfield_10028',
].join(',');

/** Story-points custom field IDs we know about. The "preferred" field wins on ties. */
const STORY_POINTS_FIELD_PREFERRED = 'customfield_10028';
const STORY_POINTS_FIELD_FALLBACK = 'customfield_10016';

/** Hard limits on the editable points input — story points beyond 100 are almost always typos. */
const MIN_STORY_POINTS = 0;
const MAX_STORY_POINTS = 100;

/** Lower-cased priority names that we recognize when colouring rows. */
type PriorityKey = 'highest' | 'blocker' | 'high' | 'critical' | 'medium' | 'low' | 'lowest';

// ── Public types exposed by the hook ──────────────────────────────────────────

export interface SprintPlanningIssue {
  key: string;
  summary: string;
  issueType: string;
  priority: string;
  assignee: string;
  storyPoints: number;
}

export interface SprintPlanningState {
  projectKey: string;
  searchText: string;
  backlog: SprintPlanningIssue[];
  pendingChanges: Record<string, number>;
  isLoading: boolean;
  isSaving: boolean;
  loadError: string | null;
  saveStatusMessage: string | null;
  failedSaveKeys: string[];
}

export interface SprintPlanningActions {
  setProjectKey: (projectKey: string) => void;
  setSearchText: (searchText: string) => void;
  loadBacklog: () => Promise<void>;
  setStoryPoints: (issueKey: string, rawValue: string) => void;
  saveChanges: () => Promise<void>;
  resetPendingChanges: () => void;
}

// ── Jira response shape (narrow — only what we actually consume). ──────────────

interface JiraSearchResponse {
  issues: Array<{
    key: string;
    fields: {
      summary?: string;
      assignee?: { displayName?: string } | null;
      priority?: { name?: string } | null;
      issuetype?: { name?: string } | null;
      [customField: string]: unknown;
    };
  }>;
}

// ── Pure helpers (also re-exported so the view can render badges/colour tags). ──

/**
 * Resolves the story-points custom-field ID for the loaded backlog. If at least one
 * issue has a value on the preferred field but a blank fallback, we trust the
 * preferred field; otherwise we fall back to the legacy `customfield_10016`.
 */
export function detectStoryPointsField(_backlog: SprintPlanningIssue[], rawIssues: JiraSearchResponse['issues']): string {
  const preferredHasUniqueValue = rawIssues.some((rawIssue) => {
    const preferredValue = rawIssue.fields[STORY_POINTS_FIELD_PREFERRED];
    const fallbackValue = rawIssue.fields[STORY_POINTS_FIELD_FALLBACK];
    return typeof preferredValue === 'number' && typeof fallbackValue !== 'number';
  });
  return preferredHasUniqueValue ? STORY_POINTS_FIELD_PREFERRED : STORY_POINTS_FIELD_FALLBACK;
}

/** Maps a Jira priority name to a brand colour token so the view can render badges consistently. */
export function priorityToColorHex(priorityName: string): string {
  const normalizedKey = priorityName.toLowerCase() as PriorityKey;
  switch (normalizedKey) {
    case 'highest':
    case 'blocker':
      return '#e11d48';
    case 'high':
    case 'critical':
      return '#f97316';
    case 'medium':
      return '#f59e0b';
    case 'low':
      return '#22c55e';
    case 'lowest':
      return '#6b7280';
    default:
      return '#6b7280';
  }
}

/** Maps a Jira issue type name to a small emoji used as a row prefix. */
export function issueTypeToEmoji(issueTypeName: string): string {
  const normalizedTypeName = issueTypeName.toLowerCase();
  if (normalizedTypeName === 'story') return '📗';
  if (normalizedTypeName === 'bug') return '🐛';
  if (normalizedTypeName === 'task') return '✅';
  if (normalizedTypeName === 'epic') return '⚡';
  if (normalizedTypeName === 'subtask' || normalizedTypeName === 'sub-task') return '🔹';
  return '📄';
}

/** Clamps user-entered story points to [MIN_STORY_POINTS, MAX_STORY_POINTS] and rounds invalid input to 0. */
export function clampStoryPointsInput(rawValue: string): number {
  const numericValue = Number(rawValue);
  if (!Number.isFinite(numericValue) || numericValue < MIN_STORY_POINTS) {
    return MIN_STORY_POINTS;
  }
  if (numericValue > MAX_STORY_POINTS) {
    return MAX_STORY_POINTS;
  }
  return Math.round(numericValue);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function readNumericField(fieldsObject: Record<string, unknown>, fieldId: string): number {
  const fieldValue = fieldsObject[fieldId];
  return typeof fieldValue === 'number' ? fieldValue : 0;
}

function buildBacklogJql(projectKey: string): string {
  if (!projectKey.trim()) {
    return DEFAULT_BACKLOG_JQL;
  }
  return `project = ${projectKey.trim()} AND statusCategory != Done AND sprint is EMPTY ORDER BY priority DESC, created DESC`;
}

function buildSearchPath(projectKey: string): string {
  const jqlClause = encodeURIComponent(buildBacklogJql(projectKey));
  return `/rest/api/2/search?jql=${jqlClause}&maxResults=${BACKLOG_MAX_RESULTS}&fields=${BACKLOG_FIELDS}`;
}

function mapJiraIssueToBacklogRow(rawIssue: JiraSearchResponse['issues'][number]): SprintPlanningIssue {
  const fieldsObject = rawIssue.fields ?? {};
  const preferredPoints = readNumericField(fieldsObject as Record<string, unknown>, STORY_POINTS_FIELD_PREFERRED);
  const fallbackPoints = readNumericField(fieldsObject as Record<string, unknown>, STORY_POINTS_FIELD_FALLBACK);
  const storyPoints = preferredPoints || fallbackPoints;

  return {
    key: rawIssue.key,
    summary: fieldsObject.summary ?? '',
    issueType: fieldsObject.issuetype?.name ?? '',
    priority: fieldsObject.priority?.name ?? '',
    assignee: fieldsObject.assignee?.displayName ?? '',
    storyPoints,
  };
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/** Owns Sprint Planning state and Jira interactions. Pure UI lives in `SprintPlanningView.tsx`. */
export function useSprintPlanningState(): SprintPlanningState & SprintPlanningActions {
  const [projectKey, setProjectKeyInternal] = useState<string>('');
  const [searchText, setSearchText] = useState<string>('');
  const [backlog, setBacklog] = useState<SprintPlanningIssue[]>([]);
  const [rawBacklogIssues, setRawBacklogIssues] = useState<JiraSearchResponse['issues']>([]);
  const [pendingChanges, setPendingChanges] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatusMessage, setSaveStatusMessage] = useState<string | null>(null);
  const [failedSaveKeys, setFailedSaveKeys] = useState<string[]>([]);

  const loadBacklog = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const response = await jiraGet<JiraSearchResponse>(buildSearchPath(projectKey));
      const incomingIssues = response.issues ?? [];
      setRawBacklogIssues(incomingIssues);
      setBacklog(incomingIssues.map(mapJiraIssueToBacklogRow));
      // Loading a fresh backlog discards any outstanding edits — they're tied to old data.
      setPendingChanges({});
      setFailedSaveKeys([]);
      setSaveStatusMessage(null);
    } catch (caughtError: unknown) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : 'Failed to load backlog';
      setLoadError(errorMessage);
      setBacklog([]);
      setRawBacklogIssues([]);
    } finally {
      setIsLoading(false);
    }
  }, [projectKey]);

  const setStoryPoints = useCallback((issueKey: string, rawValue: string) => {
    const sanitizedValue = clampStoryPointsInput(rawValue);
    setPendingChanges((previousChanges) => {
      const updatedChanges = { ...previousChanges, [issueKey]: sanitizedValue };
      return updatedChanges;
    });
  }, []);

  const saveChanges = useCallback(async () => {
    const changedKeys = Object.keys(pendingChanges);
    if (changedKeys.length === 0) {
      return;
    }
    setIsSaving(true);
    setSaveStatusMessage(`Saving ${changedKeys.length} change${changedKeys.length === 1 ? '' : 's'}…`);

    const storyPointsFieldId = detectStoryPointsField(backlog, rawBacklogIssues);
    const failedKeys: string[] = [];

    // Run requests concurrently; using Promise.all keeps a small backlog snappy without
    // overwhelming Jira (max ~100 issues = 100 PUTs in a worst case).
    await Promise.all(
      changedKeys.map(async (issueKey) => {
        try {
          await jiraPut(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, {
            fields: { [storyPointsFieldId]: pendingChanges[issueKey] },
          });
        } catch {
          failedKeys.push(issueKey);
        }
      }),
    );

    const savedCount = changedKeys.length - failedKeys.length;
    if (failedKeys.length > 0) {
      setSaveStatusMessage(`⚠ Saved ${savedCount}, failed: ${failedKeys.join(', ')}`);
    } else {
      setSaveStatusMessage('✅ All changes saved');
    }
    setFailedSaveKeys(failedKeys);

    // Apply successful changes locally so the table reflects the new state without re-fetch.
    setBacklog((previousBacklog) =>
      previousBacklog.map((row) =>
        failedKeys.includes(row.key) || pendingChanges[row.key] === undefined
          ? row
          : { ...row, storyPoints: pendingChanges[row.key] },
      ),
    );
    setPendingChanges((previousChanges) => {
      const remainingChanges: Record<string, number> = {};
      for (const issueKey of failedKeys) {
        if (previousChanges[issueKey] !== undefined) {
          remainingChanges[issueKey] = previousChanges[issueKey];
        }
      }
      return remainingChanges;
    });
    setIsSaving(false);
  }, [pendingChanges, backlog, rawBacklogIssues]);

  const resetPendingChanges = useCallback(() => {
    setPendingChanges({});
    setFailedSaveKeys([]);
    setSaveStatusMessage(null);
  }, []);

  const setProjectKey = useCallback((newProjectKey: string) => {
    setProjectKeyInternal(newProjectKey);
  }, []);

  // Derive nothing here — keep the API stable for the view; memoization purely avoids
  // triggering React re-renders when the same return identity would suffice.
  return useMemo(
    () => ({
      projectKey,
      searchText,
      backlog,
      pendingChanges,
      isLoading,
      isSaving,
      loadError,
      saveStatusMessage,
      failedSaveKeys,
      setProjectKey,
      setSearchText,
      loadBacklog,
      setStoryPoints,
      saveChanges,
      resetPendingChanges,
    }),
    [
      projectKey,
      searchText,
      backlog,
      pendingChanges,
      isLoading,
      isSaving,
      loadError,
      saveStatusMessage,
      failedSaveKeys,
      setProjectKey,
      setSearchText,
      loadBacklog,
      setStoryPoints,
      saveChanges,
      resetPendingChanges,
    ],
  );
}
