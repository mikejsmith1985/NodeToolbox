// useSprintStandupState.ts — Team Dashboard standup state for Sprint and Roster scopes plus person-walk planning.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { jiraGet, jiraPost } from '../../../services/jiraApi.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import {
  useStandupPlanningStore,
  type StandupPlanEntry,
  type StandupScopeMode,
} from './useStandupPlanningStore.ts';
import { buildStandupRosterAssigneeClause, useStandupRosterStore } from './useStandupRosterStore.ts';
import { hasBlockingLink as hasSharedBlockingLink } from './sprintDashboardIssueUtils.ts';

const STANDUP_UI_STORAGE_KEY = 'tbxSprintDashboardStandupUi';
const CURRENT_USER_PATH = '/rest/api/2/myself';
const PERSON_WALK_COPY_SUCCESS_MESSAGE = 'Copied';
const PERSON_WALK_COPY_FAILURE_MESSAGE = 'Copy failed';
const PERSON_WALK_POST_KEY_ERROR_MESSAGE = 'Enter an issue key before posting.';
const PERSON_WALK_POST_FAILURE_MESSAGE = 'Could not post standup comment.';
const PERSON_WALK_YESTERDAY_EMPTY_TEXT = '• (nothing updated yesterday)';
const PERSON_WALK_TODAY_EMPTY_TEXT = '• (no active issues assigned)';
const PERSON_WALK_EMPTY_BLOCKERS_TEXT = 'None';
const PERSON_WALK_SUCCESS_MESSAGE_DURATION_MS = 2_000;
const BOARDWALK_WARNING_AGE_DAYS = 2;
const BOARDWALK_STALE_AGE_DAYS = 5;
const DONE_STATUS_NAMES = ['done', 'closed', 'resolved'];
const DEFAULT_SCOPE_MODE: StandupScopeMode = 'sprint';
const ROSTER_SCOPE_EMPTY_MESSAGE = 'No roster members yet. Add people in the Roster tab to run roster standup.';
const ROSTER_SCOPE_PROJECT_MESSAGE = 'Set a project key before using roster standup.';
const ROSTER_SCOPE_FAILURE_MESSAGE = 'Could not load roster issues. Check Jira connection.';
const ROSTER_SCOPE_RECENT_LOOKBACK_DAYS = 2;
const ROSTER_SCOPE_MAX_RESULTS = 200;
const ROSTER_SCOPE_FIELDS =
  'summary,status,priority,issuetype,assignee,reporter,created,updated,description,comment,fixVersions,issuelinks,customfield_10016,customfield_10021';

export type StandupMode = 'boardwalk' | 'personwalk' | 'dsu-board';
export type StandupStatusCategory = 'new' | 'indeterminate' | 'done';
export type PersonWalkPostStatus = 'idle' | 'posting' | 'success' | 'error';
export type { StandupScopeMode } from './useStandupPlanningStore.ts';

export interface PersonWalkDraft {
  yesterday: string;
  today: string;
  blockers: string;
}

export interface SprintStandupState {
  standupMode: StandupMode;
  scopeMode: StandupScopeMode;
  shouldShowDoneColumn: boolean;
  scopeIssues: JiraIssue[];
  isLoadingScopeIssues: boolean;
  scopeLoadErrorMessage: string | null;
  plannedIssueKeysByPerson: Record<string, string[]>;
  previousPlannedIssueKeysByPerson: Record<string, string[]>;
  boardwalkStatusFilters: Record<StandupStatusCategory, Record<string, boolean>>;
  personWalkDraft: PersonWalkDraft;
  personWalkPostKey: string;
  personWalkPostStatus: PersonWalkPostStatus;
  personWalkPostErrorMessage: string | null;
  personWalkCopyStatusMessage: string | null;
  isLoadingPersonWalk: boolean;
  personWalkErrorMessage: string | null;
}

export interface SprintStandupActions {
  setStandupMode: (nextMode: StandupMode) => void;
  setScopeMode: (nextScopeMode: StandupScopeMode) => void;
  setShouldShowDoneColumn: (shouldShowDoneColumn: boolean) => void;
  togglePlannedIssue: (personName: string, issueKey: string) => void;
  toggleBoardwalkStatusFilter: (categoryKey: StandupStatusCategory, statusName: string) => void;
  refreshPersonWalk: () => Promise<void>;
  setPersonWalkDraftField: (fieldName: keyof PersonWalkDraft, value: string) => void;
  setPersonWalkPostKey: (postKey: string) => void;
  copyPersonWalk: () => Promise<void>;
  postPersonWalkComment: () => Promise<void>;
}

interface JiraUserResponse {
  accountId: string;
}

interface JiraSearchIssuesResponse {
  issues: JiraIssue[];
}

interface StoredStandupUiState {
  mode?: StandupMode;
  scopeMode?: StandupScopeMode;
  shouldShowDoneColumn?: boolean;
}

function isStandupMode(value: unknown): value is StandupMode {
  return value === 'boardwalk' || value === 'personwalk' || value === 'dsu-board';
}

function isStandupScopeMode(value: unknown): value is StandupScopeMode {
  return value === 'sprint' || value === 'roster';
}

function createDefaultPersonWalkDraft(): PersonWalkDraft {
  return {
    yesterday: PERSON_WALK_YESTERDAY_EMPTY_TEXT,
    today: PERSON_WALK_TODAY_EMPTY_TEXT,
    blockers: '',
  };
}

function readStoredStandupUiState(): StoredStandupUiState {
  try {
    const storedValue = window.localStorage.getItem(STANDUP_UI_STORAGE_KEY);
    if (!storedValue) {
      return {};
    }

    const parsedValue: unknown = JSON.parse(storedValue);
    if (typeof parsedValue !== 'object' || parsedValue === null) {
      return {};
    }

    const candidateState = parsedValue as StoredStandupUiState;
    return {
      mode: isStandupMode(candidateState.mode) ? candidateState.mode : undefined,
      scopeMode: isStandupScopeMode(candidateState.scopeMode) ? candidateState.scopeMode : undefined,
      shouldShowDoneColumn:
        typeof candidateState.shouldShowDoneColumn === 'boolean' ? candidateState.shouldShowDoneColumn : undefined,
    };
  } catch {
    return {};
  }
}

function persistStandupUiState(storedState: StoredStandupUiState): void {
  try {
    window.localStorage.setItem(STANDUP_UI_STORAGE_KEY, JSON.stringify(storedState));
  } catch {
    // Standup mode persistence should not break the dashboard when browser storage is unavailable.
  }
}

function readCurrentIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function getYesterdayIsoDate(): string {
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  return yesterdayDate.toISOString().slice(0, 10);
}

function normalizeProjectKey(projectKey: string): string {
  return projectKey.trim().toUpperCase();
}

function readAssigneeName(issue: JiraIssue): string {
  return issue.fields.assignee?.displayName ?? 'Unassigned';
}

function formatBulletLines(lines: string[], fallbackText: string): string {
  return lines.length > 0 ? lines.join('\n') : fallbackText;
}

function readStatusCategory(issue: JiraIssue): StandupStatusCategory {
  const categoryKey = issue.fields.status.statusCategory.key;
  if (categoryKey === 'done' || categoryKey === 'indeterminate' || categoryKey === 'new') {
    return categoryKey;
  }

  return 'new';
}

function isDoneByStatusName(issue: JiraIssue): boolean {
  return DONE_STATUS_NAMES.includes(issue.fields.status.name.toLowerCase());
}

function buildBoardwalkStatusFilters(issues: JiraIssue[]): Record<StandupStatusCategory, Record<string, boolean>> {
  const nextFilters: Record<StandupStatusCategory, Record<string, boolean>> = {
    new: {},
    indeterminate: {},
    done: {},
  };
  for (const issue of issues) {
    const categoryKey = readStatusCategory(issue);
    nextFilters[categoryKey][issue.fields.status.name] = true;
  }
  return nextFilters;
}

function buildPersonWalkDraft(issues: JiraIssue[], currentUserAccountId: string): PersonWalkDraft {
  const yesterdayIsoDate = getYesterdayIsoDate();
  const assignedIssues = issues.filter((issue) => issue.fields.assignee?.accountId === currentUserAccountId);
  const yesterdayLines = assignedIssues
    .filter((issue) => issue.fields.updated.slice(0, 10) === yesterdayIsoDate)
    .map((issue) => `• ${issue.key} - ${issue.fields.summary}`);
  const todayLines = assignedIssues
    .filter((issue) => !isDoneByStatusName(issue))
    .map((issue) => `• ${issue.key} - ${issue.fields.summary}`);

  return {
    yesterday: formatBulletLines(yesterdayLines, PERSON_WALK_YESTERDAY_EMPTY_TEXT),
    today: formatBulletLines(todayLines, PERSON_WALK_TODAY_EMPTY_TEXT),
    blockers: '',
  };
}

function buildPlanIssueKeysByPerson(
  planEntries: StandupPlanEntry[],
  targetDate: string,
  scopeMode: StandupScopeMode,
  projectKey: string,
): Record<string, string[]> {
  const plannedIssueKeysByPerson: Record<string, string[]> = {};
  for (const planEntry of planEntries) {
    if (
      planEntry.date === targetDate &&
      planEntry.scopeMode === scopeMode &&
      normalizeProjectKey(planEntry.projectKey) === projectKey
    ) {
      plannedIssueKeysByPerson[planEntry.personName] = [...planEntry.plannedIssueKeys];
    }
  }
  return plannedIssueKeysByPerson;
}

function buildVisibleIssueKeysByPerson(scopeIssues: JiraIssue[]): Record<string, Set<string>> {
  const visibleIssueKeysByPerson: Record<string, Set<string>> = {};
  for (const issue of scopeIssues) {
    const assigneeName = readAssigneeName(issue);
    if (!visibleIssueKeysByPerson[assigneeName]) {
      visibleIssueKeysByPerson[assigneeName] = new Set<string>();
    }
    visibleIssueKeysByPerson[assigneeName].add(issue.key);
  }
  return visibleIssueKeysByPerson;
}

function buildEffectivePlannedIssueKeysByPerson(
  currentPlanIssueKeysByPerson: Record<string, string[]>,
  previousPlanIssueKeysByPerson: Record<string, string[]>,
  visibleIssueKeysByPerson: Record<string, Set<string>>,
): Record<string, string[]> {
  const effectivePlannedIssueKeysByPerson: Record<string, string[]> = {};
  const personNames = new Set([
    ...Object.keys(currentPlanIssueKeysByPerson),
    ...Object.keys(previousPlanIssueKeysByPerson),
    ...Object.keys(visibleIssueKeysByPerson),
  ]);

  for (const personName of personNames) {
    const sourceIssueKeys = currentPlanIssueKeysByPerson[personName] ?? previousPlanIssueKeysByPerson[personName] ?? [];
    const visibleIssueKeys = visibleIssueKeysByPerson[personName];
    effectivePlannedIssueKeysByPerson[personName] = visibleIssueKeys
      ? sourceIssueKeys.filter((issueKey) => visibleIssueKeys.has(issueKey))
      : [];
  }

  return effectivePlannedIssueKeysByPerson;
}

function buildRosterScopeSearchPath(projectKey: string, rosterAssigneeClause: string | null): string | null {
  if (!projectKey) {
    return null;
  }
  if (rosterAssigneeClause === null) {
    return null;
  }

  const jql = `project = "${projectKey}" AND ${rosterAssigneeClause} AND (statusCategory in ("To Do","In Progress") OR updated >= "-${ROSTER_SCOPE_RECENT_LOOKBACK_DAYS}d") ORDER BY assignee ASC, updated DESC`;
  return `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${ROSTER_SCOPE_FIELDS}&maxResults=${ROSTER_SCOPE_MAX_RESULTS}`;
}

/** Formats the live DSU person-walk text block used for preview, clipboard, and Jira comments. */
export function formatPersonWalkText(draft: PersonWalkDraft): string {
  const blockerSection = draft.blockers.trim() ? draft.blockers : PERSON_WALK_EMPTY_BLOCKERS_TEXT;
  return `*Yesterday*\n${draft.yesterday}\n\n*Today*\n${draft.today}\n\n*Blockers*\n${blockerSection}`;
}

/** Returns true when a Jira issue has an inward blocking link, matching the legacy board-walk blocker rule. */
export const hasBlockingLink = hasSharedBlockingLink;

/** Calculates whole-day age for board-walk sorting and stale highlighting. */
export function calculateIssueAgeDays(issue: JiraIssue): number {
  const updatedTimestamp = new Date(issue.fields.updated).getTime();
  if (!Number.isFinite(updatedTimestamp)) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - updatedTimestamp) / (24 * 60 * 60 * 1000)));
}

/** Classifies the card age band exactly like the legacy board walk. */
export function classifyIssueAge(ageDays: number): 'ok' | 'warn' | 'old' {
  if (ageDays > BOARDWALK_STALE_AGE_DAYS) {
    return 'old';
  }
  if (ageDays > BOARDWALK_WARNING_AGE_DAYS) {
    return 'warn';
  }
  return 'ok';
}

/** Owns persisted standup mode plus Sprint/Roster scope, click-to-plan state, and the person-walk workflow. */
export function useSprintStandupState(
  sprintIssues: JiraIssue[],
  projectKey: string,
): { state: SprintStandupState; actions: SprintStandupActions } {
  const storedUiState = readStoredStandupUiState();
  const rosterMembers = useStandupRosterStore((state) => state.rosterMembers);
  const rosterAssigneeClause = useMemo(() => buildStandupRosterAssigneeClause(rosterMembers), [rosterMembers]);
  const planEntries = useStandupPlanningStore((state) => state.planEntries);
  const setPlannedIssueKeys = useStandupPlanningStore((state) => state.setPlannedIssueKeys);
  const normalizedProjectKey = useMemo(() => normalizeProjectKey(projectKey), [projectKey]);
  const currentIsoDate = useMemo(() => readCurrentIsoDate(), []);
  const yesterdayIsoDate = useMemo(() => getYesterdayIsoDate(), []);

  const [standupMode, setStandupModeState] = useState<StandupMode>(storedUiState.mode ?? 'boardwalk');
  const [scopeMode, setScopeModeState] = useState<StandupScopeMode>(storedUiState.scopeMode ?? DEFAULT_SCOPE_MODE);
  const [shouldShowDoneColumn, setShouldShowDoneColumnState] = useState<boolean>(
    storedUiState.shouldShowDoneColumn ?? false,
  );
  const [boardwalkStatusFilterOverrides, setBoardwalkStatusFilterOverrides] = useState<Record<StandupStatusCategory, Record<string, boolean>>>({
    new: {},
    indeterminate: {},
    done: {},
  });
  const [currentUserAccountId, setCurrentUserAccountId] = useState<string | null>(null);
  const [personWalkDraft, setPersonWalkDraft] = useState<PersonWalkDraft>(createDefaultPersonWalkDraft);
  const [isLoadingPersonWalk, setIsLoadingPersonWalk] = useState(false);
  const [personWalkErrorMessage, setPersonWalkErrorMessage] = useState<string | null>(null);
  const [personWalkPostKey, setPersonWalkPostKeyState] = useState('');
  const [personWalkPostStatus, setPersonWalkPostStatus] = useState<PersonWalkPostStatus>('idle');
  const [personWalkPostErrorMessage, setPersonWalkPostErrorMessage] = useState<string | null>(null);
  const [personWalkCopyStatusMessage, setPersonWalkCopyStatusMessage] = useState<string | null>(null);
  const [rosterScopeIssues, setRosterScopeIssues] = useState<JiraIssue[]>([]);
  const [isLoadingScopeIssues, setIsLoadingScopeIssues] = useState(false);
  const [scopeLoadErrorMessage, setScopeLoadErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    persistStandupUiState({ mode: standupMode, scopeMode, shouldShowDoneColumn });
  }, [scopeMode, shouldShowDoneColumn, standupMode]);

  const scopeIssues = useMemo(
    () => (scopeMode === 'roster' ? rosterScopeIssues : sprintIssues),
    [rosterScopeIssues, scopeMode, sprintIssues],
  );

  const currentPlanIssueKeysByPerson = useMemo(
    () => buildPlanIssueKeysByPerson(planEntries, currentIsoDate, scopeMode, normalizedProjectKey),
    [currentIsoDate, normalizedProjectKey, planEntries, scopeMode],
  );
  const previousPlanIssueKeysByPerson = useMemo(
    () => buildPlanIssueKeysByPerson(planEntries, yesterdayIsoDate, scopeMode, normalizedProjectKey),
    [normalizedProjectKey, planEntries, scopeMode, yesterdayIsoDate],
  );
  const visibleIssueKeysByPerson = useMemo(() => buildVisibleIssueKeysByPerson(scopeIssues), [scopeIssues]);
  const plannedIssueKeysByPerson = useMemo(
    () =>
      buildEffectivePlannedIssueKeysByPerson(
        currentPlanIssueKeysByPerson,
        previousPlanIssueKeysByPerson,
        visibleIssueKeysByPerson,
      ),
    [currentPlanIssueKeysByPerson, previousPlanIssueKeysByPerson, visibleIssueKeysByPerson],
  );

  const boardwalkStatusFilters = useMemo(() => {
    const nextFilters = buildBoardwalkStatusFilters(scopeIssues);
    for (const categoryKey of Object.keys(nextFilters) as StandupStatusCategory[]) {
      for (const statusName of Object.keys(nextFilters[categoryKey])) {
        nextFilters[categoryKey][statusName] =
          boardwalkStatusFilterOverrides[categoryKey]?.[statusName] ?? true;
      }
    }
    return nextFilters;
  }, [boardwalkStatusFilterOverrides, scopeIssues]);

  const loadRosterScopeIssues = useCallback(async () => {
    if (scopeMode !== 'roster') {
      return;
    }
    if (!normalizedProjectKey) {
      setRosterScopeIssues([]);
      setScopeLoadErrorMessage(ROSTER_SCOPE_PROJECT_MESSAGE);
      return;
    }

    const searchPath = buildRosterScopeSearchPath(normalizedProjectKey, rosterAssigneeClause);
    if (searchPath === null) {
      setRosterScopeIssues([]);
      setScopeLoadErrorMessage(ROSTER_SCOPE_EMPTY_MESSAGE);
      return;
    }

    setIsLoadingScopeIssues(true);
    setScopeLoadErrorMessage(null);
    try {
      const response = await jiraGet<JiraSearchIssuesResponse>(searchPath);
      setRosterScopeIssues(response.issues ?? []);
    } catch (caughtError) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : ROSTER_SCOPE_FAILURE_MESSAGE;
      setRosterScopeIssues([]);
      setScopeLoadErrorMessage(errorMessage);
    } finally {
      setIsLoadingScopeIssues(false);
    }
  }, [normalizedProjectKey, rosterAssigneeClause, scopeMode]);

  useEffect(() => {
    if (scopeMode !== 'roster') {
      return;
    }

    const rosterLoadTimer = window.setTimeout(() => {
      void loadRosterScopeIssues();
    }, 0);

    return () => {
      window.clearTimeout(rosterLoadTimer);
    };
  }, [loadRosterScopeIssues, scopeMode]);

  const refreshPersonWalk = useCallback(async () => {
    setIsLoadingPersonWalk(true);
    setPersonWalkErrorMessage(null);

    try {
      const resolvedUserAccountId =
        currentUserAccountId ?? (await jiraGet<JiraUserResponse>(CURRENT_USER_PATH)).accountId;
      setCurrentUserAccountId(resolvedUserAccountId);
      setPersonWalkDraft(buildPersonWalkDraft(scopeIssues, resolvedUserAccountId));
    } catch (caughtError) {
      const errorMessage =
        caughtError instanceof Error ? caughtError.message : 'Could not fetch user info. Check Jira connection.';
      setPersonWalkErrorMessage(errorMessage);
    } finally {
      setIsLoadingPersonWalk(false);
    }
  }, [currentUserAccountId, scopeIssues]);

  useEffect(() => {
    if (scopeIssues.length === 0 || currentUserAccountId !== null || isLoadingPersonWalk) {
      return;
    }

    const refreshTimer = window.setTimeout(() => {
      void refreshPersonWalk();
    }, 0);

    return () => {
      window.clearTimeout(refreshTimer);
    };
  }, [currentUserAccountId, isLoadingPersonWalk, refreshPersonWalk, scopeIssues.length]);

  const setStandupMode = useCallback((nextMode: StandupMode) => {
    setStandupModeState(nextMode);
  }, []);

  const setScopeMode = useCallback((nextScopeMode: StandupScopeMode) => {
    setScopeModeState(nextScopeMode);
    setCurrentUserAccountId(null);
    setPersonWalkDraft(createDefaultPersonWalkDraft());
    setPersonWalkErrorMessage(null);
    setPersonWalkCopyStatusMessage(null);
    if (nextScopeMode !== 'roster') {
      setIsLoadingScopeIssues(false);
      setScopeLoadErrorMessage(null);
    }
  }, []);

  const setShouldShowDoneColumn = useCallback((nextValue: boolean) => {
    setShouldShowDoneColumnState(nextValue);
  }, []);

  const togglePlannedIssue = useCallback(
    (personName: string, issueKey: string) => {
      const currentPersonPlan = plannedIssueKeysByPerson[personName] ?? [];
      const nextPersonPlan = currentPersonPlan.includes(issueKey)
        ? currentPersonPlan.filter((plannedIssueKey) => plannedIssueKey !== issueKey)
        : [...currentPersonPlan, issueKey];
      setPlannedIssueKeys(currentIsoDate, scopeMode, normalizedProjectKey, personName, nextPersonPlan);
    },
    [currentIsoDate, normalizedProjectKey, plannedIssueKeysByPerson, scopeMode, setPlannedIssueKeys],
  );

  const toggleBoardwalkStatusFilter = useCallback((categoryKey: StandupStatusCategory, statusName: string) => {
    setBoardwalkStatusFilterOverrides((currentFilters) => ({
      ...currentFilters,
      [categoryKey]: {
        ...currentFilters[categoryKey],
        [statusName]: !(currentFilters[categoryKey]?.[statusName] ?? true),
      },
    }));
  }, []);

  const setPersonWalkDraftField = useCallback((fieldName: keyof PersonWalkDraft, value: string) => {
    setPersonWalkDraft((currentDraft) => ({ ...currentDraft, [fieldName]: value }));
  }, []);

  const setPersonWalkPostKey = useCallback((postKey: string) => {
    setPersonWalkPostKeyState(postKey);
  }, []);

  const copyPersonWalk = useCallback(async () => {
    const clipboardApi = navigator.clipboard;
    if (!clipboardApi) {
      setPersonWalkCopyStatusMessage(PERSON_WALK_COPY_FAILURE_MESSAGE);
      return;
    }

    try {
      await clipboardApi.writeText(formatPersonWalkText(personWalkDraft));
      setPersonWalkCopyStatusMessage(PERSON_WALK_COPY_SUCCESS_MESSAGE);
      window.setTimeout(() => setPersonWalkCopyStatusMessage(null), PERSON_WALK_SUCCESS_MESSAGE_DURATION_MS);
    } catch {
      setPersonWalkCopyStatusMessage(PERSON_WALK_COPY_FAILURE_MESSAGE);
    }
  }, [personWalkDraft]);

  const postPersonWalkComment = useCallback(async () => {
    const trimmedIssueKey = personWalkPostKey.trim().toUpperCase();
    if (!trimmedIssueKey) {
      setPersonWalkPostStatus('error');
      setPersonWalkPostErrorMessage(PERSON_WALK_POST_KEY_ERROR_MESSAGE);
      return;
    }

    setPersonWalkPostStatus('posting');
    setPersonWalkPostErrorMessage(null);

    try {
      await jiraPost(`/rest/api/2/issue/${encodeURIComponent(trimmedIssueKey)}/comment`, {
        body: formatPersonWalkText(personWalkDraft),
      });
      setPersonWalkPostStatus('success');
    } catch (caughtError) {
      const errorMessage = caughtError instanceof Error ? caughtError.message : PERSON_WALK_POST_FAILURE_MESSAGE;
      setPersonWalkPostStatus('error');
      setPersonWalkPostErrorMessage(errorMessage);
    }
  }, [personWalkDraft, personWalkPostKey]);

  const state = useMemo(
    () => ({
      standupMode,
      scopeMode,
      shouldShowDoneColumn,
      scopeIssues,
      isLoadingScopeIssues,
      scopeLoadErrorMessage,
      plannedIssueKeysByPerson,
      previousPlannedIssueKeysByPerson: previousPlanIssueKeysByPerson,
      boardwalkStatusFilters,
      personWalkDraft,
      personWalkPostKey,
      personWalkPostStatus,
      personWalkPostErrorMessage,
      personWalkCopyStatusMessage,
      isLoadingPersonWalk,
      personWalkErrorMessage,
    }),
    [
      boardwalkStatusFilters,
      isLoadingPersonWalk,
      isLoadingScopeIssues,
      personWalkCopyStatusMessage,
      personWalkDraft,
      personWalkErrorMessage,
      personWalkPostErrorMessage,
      personWalkPostKey,
      personWalkPostStatus,
      plannedIssueKeysByPerson,
      previousPlanIssueKeysByPerson,
      scopeIssues,
      scopeLoadErrorMessage,
      scopeMode,
      shouldShowDoneColumn,
      standupMode,
    ],
  );

  return {
    state,
    actions: {
      setStandupMode,
      setScopeMode,
      setShouldShowDoneColumn,
      togglePlannedIssue,
      toggleBoardwalkStatusFilter,
      refreshPersonWalk,
      setPersonWalkDraftField,
      setPersonWalkPostKey,
      copyPersonWalk,
      postPersonWalkComment,
    },
  };
}
