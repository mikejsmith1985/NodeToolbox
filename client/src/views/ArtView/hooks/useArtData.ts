// useArtData.ts — State management hook for the ART (Agile Release Train) View.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jiraGet } from '../../../services/jiraApi.ts';
import { fetchPiNameSuggestions } from '../../../services/piNameSuggestions.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import {
  findPiNameForDate,
  isIssueDone,
  isIssueInProgress,
  resolveIssueStoryPoints,
} from './artHelpers.ts';

const SPRINT_STATE_ACTIVE = 'active';
const SPRINT_ISSUE_MAX_RESULTS = 100;
const BOARD_ISSUE_MAX_RESULTS = 200;
const PI_ISSUE_MAX_RESULTS = 500;
// All fields required by Overview, Impediments, SoS, Predictability, and Releases parity paths.
// Keeping a single constant here means any new tab automatically gets the full dataset.
const SPRINT_ISSUE_FIELDS = [
  'summary', 'status', 'priority', 'assignee', 'reporter', 'issuetype',
  'created', 'updated', 'description',
  // Dependency / blocker parity
  'issuelinks',
  // Release parity
  'fixVersions',
  // Story-point fields (primary + alternate instance field)
  'customfield_10016', 'customfield_10028',
  // Impediment / flagged field
  'customfield_10021',
  // Program Increment scoping field
  'customfield_10301',
  // Label-based impediment detection and planning grouping
  'labels',
  // Epic fallback for planning hierarchy
  'parent',
].join(',');

// Board Prep backlog queries include both story-point fields so resolveIssueStoryPoints
// can handle instances that only populate the alternate field.
const BOARD_PREP_FIELDS = 'summary,status,priority,customfield_10016,customfield_10028';
const BOARD_PREP_MAX_RESULTS = 100;
const ART_TEAMS_STORAGE_KEY = 'nodetoolbox-art-teams';
const ART_SETTINGS_STORAGE_KEY = 'tbxARTSettings';
const DEFAULT_PI_FIELD_ID = 'customfield_10301';
const EMPTY_PI_NAME = '';

type ArtBoardType = 'scrum' | 'kanban' | 'simple' | 'unknown';

interface ArtAdvancedSettings {
  piFieldId?: string;
  piName?: string;
  piReviewPageId?: string;
  piReviewPageUrl?: string;
}

interface JiraBoardMetadata {
  id: number;
  name?: string;
  type?: string;
}

interface JiraSprintMetadata {
  id: number;
  name: string;
  state: string;
}

interface JiraBoardProjectResponse {
  values?: Array<{ key?: string }>;
}

interface JiraPiSearchResponse {
  issues?: Array<{ fields?: Record<string, unknown> }>;
}

function createArtTeamId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function readArtAdvancedSettings(): ArtAdvancedSettings {
  try {
    return JSON.parse(localStorage.getItem(ART_SETTINGS_STORAGE_KEY) || '{}') as ArtAdvancedSettings;
  } catch {
    return {};
  }
}

function writeArtAdvancedSettings(settings: ArtAdvancedSettings): void {
  try {
    localStorage.setItem(ART_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // The current session remains usable even when local persistence is unavailable.
  }
}

function getStoredSelectedPiName(): string {
  return readArtAdvancedSettings().piName?.trim() ?? EMPTY_PI_NAME;
}

function persistSelectedPiName(piName: string): void {
  const currentSettings = readArtAdvancedSettings();
  writeArtAdvancedSettings({ ...currentSettings, piName });
}

function normalizeBoardType(boardTypeValue?: string): ArtBoardType {
  const normalizedBoardType = boardTypeValue?.trim().toLowerCase();
  if (normalizedBoardType === 'scrum' || normalizedBoardType === 'kanban' || normalizedBoardType === 'simple') {
    return normalizedBoardType;
  }

  return 'unknown';
}

function extractPiNameFromFieldValue(fieldValue: unknown): string | null {
  if (typeof fieldValue === 'string') {
    const trimmedPiName = fieldValue.trim();
    return trimmedPiName === '' ? null : trimmedPiName;
  }

  if (typeof fieldValue === 'object' && fieldValue !== null) {
    const fieldRecord = fieldValue as { value?: unknown; name?: unknown };
    if (typeof fieldRecord.value === 'string' && fieldRecord.value.trim() !== '') {
      return fieldRecord.value.trim();
    }

    if (typeof fieldRecord.name === 'string' && fieldRecord.name.trim() !== '') {
      return fieldRecord.name.trim();
    }
  }

  return null;
}

function createUniqueProjectKeys(teams: ArtTeam[]): string[] {
  return Array.from(
    new Set(
      teams
        .map((team) => team.projectKey?.trim())
        .filter((projectKey): projectKey is string => Boolean(projectKey)),
    ),
  );
}

function sortPiNames(piNames: string[]): string[] {
  return Array.from(new Set(piNames))
    .sort((leftPiName, rightPiName) => {
      const leftMatch = leftPiName.match(/(\d+)\.(\d+)/);
      const rightMatch = rightPiName.match(/(\d+)\.(\d+)/);

      if (leftMatch && rightMatch) {
        const yearDifference = Number(leftMatch[1]) - Number(rightMatch[1]);
        if (yearDifference !== 0) {
          return yearDifference;
        }

        return Number(leftMatch[2]) - Number(rightMatch[2]);
      }

      return leftPiName.localeCompare(rightPiName);
    })
    .reverse();
}

async function fetchPiNamesFromIssues(piFieldId: string, projectKeys: string[]): Promise<string[]> {
  const piFieldNumber = piFieldId.replace('customfield_', '');
  const projectFilterClause = projectKeys.length > 0
    ? ` AND project in (${projectKeys.map((projectKey) => `"${projectKey}"`).join(', ')})`
    : '';
  const piSearchJql = `cf[${piFieldNumber}] is not EMPTY${projectFilterClause} ORDER BY created DESC`;
  const response = await jiraGet<JiraPiSearchResponse>(
    `/rest/api/2/search?jql=${encodeURIComponent(piSearchJql)}&maxResults=1000&fields=${encodeURIComponent(piFieldId)}`,
  );

  return (response.issues ?? [])
    .map((issue) => extractPiNameFromFieldValue(issue.fields?.[piFieldId]))
    .filter((piName): piName is string => Boolean(piName));
}

export async function loadAvailablePiNamesFromJira(teams: ArtTeam[]): Promise<string[]> {
  if (teams.length === 0) {
    return [];
  }

  const projectKeys = createUniqueProjectKeys(teams);
  const piFieldId = readArtAdvancedSettings().piFieldId?.trim() || DEFAULT_PI_FIELD_ID;
  const autocompletePiNames = await fetchPiNameSuggestions(piFieldId);

  if (autocompletePiNames.length > 0) {
    return sortPiNames(autocompletePiNames);
  }

  if (projectKeys.length === 0) {
    return [];
  }

  const fallbackPiNames = await fetchPiNamesFromIssues(piFieldId, projectKeys);
  return sortPiNames(fallbackPiNames);
}

async function resolveTeamProjectKey(team: ArtTeam): Promise<string | undefined> {
  if (team.projectKey?.trim()) {
    return team.projectKey.trim();
  }

  try {
    const response = await jiraGet<JiraBoardProjectResponse>(`/rest/agile/1.0/board/${team.boardId}/project`);
    return response.values?.[0]?.key?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the active sprint name for a Scrum board when PI mode needs sprint context for reporting.
 * This keeps the Predictability sprint column populated even when issues are loaded by PI JQL instead of sprint endpoint.
 */
async function loadActiveSprintNameForBoard(boardId: string, boardType: ArtBoardType): Promise<string | undefined> {
  if (boardType !== 'scrum') {
    return undefined;
  }

  try {
    const sprintResponse = await jiraGet<{ values: JiraSprintMetadata[] }>(
      `/rest/agile/1.0/board/${boardId}/sprint?state=${SPRINT_STATE_ACTIVE}`,
    );
    return sprintResponse.values[0]?.name;
  } catch {
    return undefined;
  }
}

function buildBoardPrepIssuePath(boardId: string, boardType: ArtBoardType): string {
  const encodedBoardPrepFields = encodeURIComponent(BOARD_PREP_FIELDS);

  if (boardType === 'kanban' || boardType === 'simple') {
    return `/rest/agile/1.0/board/${boardId}/issue?maxResults=${BOARD_PREP_MAX_RESULTS}&fields=${encodedBoardPrepFields}`;
  }

  return `/rest/agile/1.0/board/${boardId}/backlog?maxResults=${BOARD_PREP_MAX_RESULTS}&fields=${encodedBoardPrepFields}`;
}

async function resolveBoardPrepBoardType(team: ArtTeam): Promise<ArtBoardType> {
  if (team.boardType && team.boardType !== 'unknown') {
    return team.boardType;
  }

  const boardMetadata = await jiraGet<JiraBoardMetadata>(`/rest/agile/1.0/board/${team.boardId}`);
  return normalizeBoardType(boardMetadata.type);
}

function createBoardPrepIssues(teamName: string, issues: JiraIssue[]): ArtBoardPrepIssue[] {
  return issues.map<ArtBoardPrepIssue>((issue) => ({
    teamName,
    key: issue.key,
    summary: issue.fields.summary,
    // Use the shared helper so both known story-point fields are checked automatically.
    estimate: resolveIssueStoryPoints(issue),
    priority: issue.fields.priority?.name ?? null,
  }));
}

export type ArtTab =
  | 'overview'
  | 'impediments'
  | 'predictability'
  | 'releases'
  | 'pireview'
  | 'blueprint'
  | 'dependencies'
  | 'boardprep'
  | 'sos'
  | 'monthly'
  | 'readiness'
  | 'settings';

/** The valid tab keys, used to validate an inbound `?artTab=` deep-link seed. */
const ART_TAB_KEYS: readonly ArtTab[] = [
  'overview', 'impediments', 'predictability', 'releases', 'pireview', 'blueprint',
  'dependencies', 'boardprep', 'sos', 'monthly', 'readiness', 'settings',
];

/**
 * One-time initial tab from the `?artTab=` query param, so a deep link (e.g. the Today cards or a
 * shared readiness link) opens straight on the right tab. Read once at mount; unknown values fall
 * back to Overview and there is no persistence side effect.
 */
function readInitialArtTab(): ArtTab {
  if (typeof window === 'undefined') return 'overview';
  const requestedTab = new URLSearchParams(window.location.search).get('artTab');
  return requestedTab && (ART_TAB_KEYS as readonly string[]).includes(requestedTab)
    ? (requestedTab as ArtTab)
    : 'overview';
}

/**
 * One Program Increment ↔ Confluence page association used by the PI Review tab.
 * A team can hold several of these so multiple PIs (e.g. the current PI and the next
 * one being planned) can be reviewed side-by-side instead of one at a time.
 */
export interface PiReviewPageAssociation {
  /** Program Increment name (e.g. "PI 26.4"), chosen from the team's available PI list. */
  piName: string;
  /** Full Confluence page URL or bare numeric page ID hosting this PI's review table. */
  pageUrl: string;
}

/** Represents a single Agile team in the ART view. */
export interface ArtTeam {
  id: string;
  name: string;
  boardId: string;
  boardName?: string;
  boardType?: ArtBoardType;
  /** Optional Jira project key (e.g. "ALPHA") used for Blueprint off-train detection. */
  projectKey?: string;
  /**
   * Confluence PI Review pages for this team — one entry per Program Increment.
   * Lets a team run several PIs concurrently on the PI Review tab.
   */
  piReviewPages?: PiReviewPageAssociation[];
  /** Active sprint name for Scrum boards — absent for Kanban boards or when Jira does not report an active sprint. */
  activeSprintName?: string;
  /**
   * Optional Jira issue key for this team's SoS tracking issue.
   * Used by the SoS panel to surface the team's standup Jira item and by future SoS sync features.
   */
  sosIssueKey?: string;
  /** Jira label used to query Features for this team (e.g. "Transformers"). Drives Feature Change reports. */
  jiraLabel?: string;
  sprintIssues: JiraIssue[];
  isLoading: boolean;
  loadError: string | null;
}

/** A single issue surfaced in the Board Prep panel for pre-sprint review. */
export interface ArtBoardPrepIssue {
  teamName: string;
  key: string;
  summary: string;
  estimate: number | null;
  priority: string | null;
}

/** Aggregated PI-level progress statistics derived from all teams' sprint issues. */
export interface PiProgressStats {
  totalIssues: number;
  doneCount: number;
  inProgressCount: number;
  toDoCount: number;
  /** Percentage of issues in done state, rounded to the nearest integer. */
  completionPercent: number;
}

export interface ArtDataState {
  activeTab: ArtTab;
  teams: ArtTeam[];
  selectedPiName: string;
  availablePiNames: string[];
  isLoadingPiOptions: boolean;
  isLoadingAllTeams: boolean;
  /** Team IDs whose SoS accordion sections are currently expanded. */
  sosExpandedTeams: string[];
  /** Issues fetched from each team's Board Prep source for PI-planning review. */
  boardPrepIssues: ArtBoardPrepIssue[];
  isLoadingBoardPrep: boolean;
  boardPrepError: string | null;
  /** 'all' or a specific team name to filter the Board Prep table. */
  boardPrepTeamFilter: string;
  /** Derived PI-level completion stats computed from all loaded sprint issues. */
  piProgressStats: PiProgressStats;
}

export interface ArtDataActions {
  setActiveTab: (tab: ArtTab) => void;
  setSelectedPiName: (name: string) => void;
  addTeam: (name: string, boardId: string, projectKey?: string, boardName?: string, sosIssueKey?: string) => void;
  replaceTeams: (teams: Array<Partial<ArtTeam>>) => void;
  removeTeam: (teamId: string) => void;
  saveTeams: () => void;
  loadPiOptions: () => Promise<void>;
  loadTeam: (teamId: string) => Promise<void>;
  loadAllTeams: () => Promise<void>;
  /** Expand or collapse a team's SoS accordion section. */
  toggleSosTeam: (teamId: string) => void;
  /** Fetch backlog-ready issues for all teams' boards (issues not yet in a sprint). */
  loadBoardPrep: () => Promise<void>;
  setBoardPrepTeamFilter: (teamName: string) => void;
  /** Update the SoS Jira issue key for a specific team, persisted with the team roster. */
  updateTeamSosKey: (teamId: string, sosIssueKey: string) => void;
  /** Update the Jira label for a specific team, persisted with the team roster. Used by Feature Change reports. */
  updateTeamJiraLabel: (teamId: string, jiraLabel: string) => void;
}

/** Normalizes a single stored PI Review page entry, dropping fully-empty rows. */
function normalizeSinglePiReviewPage(association: unknown): PiReviewPageAssociation | null {
  if (typeof association !== 'object' || association === null) {
    return null;
  }
  const candidate = association as { piName?: unknown; pageUrl?: unknown };
  const pageUrl = typeof candidate.pageUrl === 'string' ? candidate.pageUrl.trim() : '';
  const piName = typeof candidate.piName === 'string' ? candidate.piName.trim() : '';
  // Keep a row if it carries either a chosen PI or a page URL so an in-progress entry is not lost.
  if (pageUrl === '' && piName === '') {
    return null;
  }
  return { piName, pageUrl };
}

/**
 * Normalizes a team's PI Review pages, migrating the legacy single `piReviewPageUrl`
 * field into the multi-PI list so rosters saved before the upgrade keep working.
 */
function normalizePiReviewPages(
  team: Partial<ArtTeam> & { piReviewPageUrl?: unknown },
): PiReviewPageAssociation[] {
  if (Array.isArray(team.piReviewPages)) {
    return team.piReviewPages
      .map((association) => normalizeSinglePiReviewPage(association))
      .filter((association): association is PiReviewPageAssociation => association !== null);
  }

  // Legacy migration: a single stored page becomes a one-entry list with an unnamed PI.
  const legacyPageUrl = typeof team.piReviewPageUrl === 'string' ? team.piReviewPageUrl.trim() : '';
  if (legacyPageUrl !== '') {
    return [{ piName: '', pageUrl: legacyPageUrl }];
  }

  return [];
}

/** Returns a team record safe to persist without volatile loading or issue data. */
function buildStoredTeamRecord(team: ArtTeam): ArtTeam {
  return {
    id: team.id,
    name: team.name,
    boardId: team.boardId,
    boardName: team.boardName,
    boardType: team.boardType,
    projectKey: team.projectKey,
    piReviewPages: normalizePiReviewPages(team),
    sosIssueKey: team.sosIssueKey,
    jiraLabel: team.jiraLabel,
    sprintIssues: [],
    isLoading: false,
    loadError: null,
  };
}

/** Normalizes a persisted/shared team record into the runtime ART team shape. */
function normalizeStoredTeamRecord(team: Partial<ArtTeam>): ArtTeam | null {
  const teamName = typeof team.name === 'string' ? team.name.trim() : '';
  const teamBoardId = typeof team.boardId === 'string' ? team.boardId.trim() : '';
  if (teamName === '' || teamBoardId === '') {
    return null;
  }

  return {
    id: typeof team.id === 'string' && team.id.trim() !== '' ? team.id : createArtTeamId(),
    name: teamName,
    boardId: teamBoardId,
    boardName: typeof team.boardName === 'string' && team.boardName.trim() !== ''
      ? team.boardName.trim()
      : undefined,
    boardType: typeof team.boardType === 'string'
      ? normalizeBoardType(team.boardType)
      : undefined,
    projectKey: typeof team.projectKey === 'string' && team.projectKey.trim() !== ''
      ? team.projectKey.trim()
      : undefined,
    piReviewPages: normalizePiReviewPages(team),
    sosIssueKey: typeof team.sosIssueKey === 'string' && team.sosIssueKey.trim() !== ''
      ? team.sosIssueKey.trim()
      : undefined,
    jiraLabel: typeof team.jiraLabel === 'string' && team.jiraLabel.trim() !== ''
      ? team.jiraLabel.trim()
      : undefined,
    sprintIssues: [],
    isLoading: false,
    loadError: null,
  };
}

/** Loads stored team configuration from localStorage, ignoring malformed payloads. */
function loadStoredTeams(): ArtTeam[] {
  try {
    const storedTeams = localStorage.getItem(ART_TEAMS_STORAGE_KEY);
    if (!storedTeams) {
      return [];
    }

    const parsedTeams = JSON.parse(storedTeams) as unknown;
    if (!Array.isArray(parsedTeams)) {
      return [];
    }

    return parsedTeams
      .filter((team): team is Partial<ArtTeam> => typeof team === 'object' && team !== null)
      .map((team) => normalizeStoredTeamRecord(team))
      .filter((team): team is ArtTeam => team !== null);
  } catch {
    return [];
  }
}

/** Persists only the stable team roster fields needed to rebuild the ART settings screen. */
function persistTeams(teams: ArtTeam[]): void {
  try {
    localStorage.setItem(
      ART_TEAMS_STORAGE_KEY,
      JSON.stringify(teams.map((team) => buildStoredTeamRecord(team))),
    );
  } catch {
    // Storage failures are non-fatal because the current in-memory roster remains usable.
  }
}

/** Computes PI-level aggregate stats from all loaded sprint issues across every team. */
function computePiProgressStats(teams: ArtTeam[]): PiProgressStats {
  const allIssues = teams.flatMap((team) => team.sprintIssues);
  const totalIssues = allIssues.length;
  if (totalIssues === 0) {
    return { totalIssues: 0, doneCount: 0, inProgressCount: 0, toDoCount: 0, completionPercent: 0 };
  }
  const doneCount = allIssues.filter(isIssueDone).length;
  const inProgressCount = allIssues.filter((issue) => !isIssueDone(issue) && isIssueInProgress(issue)).length;
  const toDoCount = totalIssues - doneCount - inProgressCount;
  const completionPercent = Math.round((doneCount / totalIssues) * 100);
  return { totalIssues, doneCount, inProgressCount, toDoCount, completionPercent };
}

/** Hook providing all state and actions for the ART multi-team PI planning view. */
export function useArtData(): { state: ArtDataState; actions: ArtDataActions } {
  const [activeTab, setActiveTabState] = useState<ArtTab>(readInitialArtTab);
  const [teams, setTeams] = useState<ArtTeam[]>(loadStoredTeams);
  // teamsRef keeps an always-current reference so loadTeam can read boardId without stale closures
  const teamsRef = useRef<ArtTeam[]>([]);
  const initialStoredTeamCountRef = useRef(teams.length);
  const [selectedPiName, setSelectedPiNameState] = useState(getStoredSelectedPiName);
  const selectedPiNameRef = useRef(selectedPiName);
  const [availablePiNames, setAvailablePiNames] = useState<string[]>([]);
  const [isLoadingPiOptions, setIsLoadingPiOptions] = useState(false);
  const [isLoadingAllTeams, setIsLoadingAllTeams] = useState(false);
  const [sosExpandedTeams, setSosExpandedTeams] = useState<string[]>([]);
  const [boardPrepIssues, setBoardPrepIssues] = useState<ArtBoardPrepIssue[]>([]);
  const [isLoadingBoardPrep, setIsLoadingBoardPrep] = useState(false);
  const [boardPrepError, setBoardPrepError] = useState<string | null>(null);
  const [boardPrepTeamFilter, setBoardPrepTeamFilterState] = useState('all');

  useEffect(() => {
    persistTeams(teams);
  }, [teams]);

  useEffect(() => {
    teamsRef.current = teams;
  }, [teams]);

  useEffect(() => {
    selectedPiNameRef.current = selectedPiName;
  }, [selectedPiName]);

  // Derive PI progress stats from live team data without a separate state variable
  const piProgressStats = useMemo(() => computePiProgressStats(teams), [teams]);

  const setActiveTab = useCallback((tab: ArtTab) => {
    setActiveTabState(tab);
  }, []);

  const setSelectedPiName = useCallback((name: string) => {
    setSelectedPiNameState(name);
    selectedPiNameRef.current = name;
    persistSelectedPiName(name);
  }, []);

  const addTeam = useCallback((name: string, boardId: string, projectKey?: string, boardName?: string, sosIssueKey?: string) => {
    const newTeam: ArtTeam = {
      id: createArtTeamId(),
      name,
      boardId,
      boardName: boardName?.trim() || undefined,
      projectKey: projectKey?.trim() || undefined,
      sosIssueKey: sosIssueKey?.trim() || undefined,
      piReviewPages: [],
      sprintIssues: [],
      isLoading: false,
      loadError: null,
    };
    setTeams((previous) => [...previous, newTeam]);
  }, []);

  /** Replaces the full ART roster with a sanitized imported/shared set of teams. */
  const replaceTeams = useCallback((incomingTeams: Array<Partial<ArtTeam>>) => {
    setTeams(
      incomingTeams
        .map((team) => normalizeStoredTeamRecord(team))
        .filter((team): team is ArtTeam => team !== null),
    );
  }, []);

  const removeTeam = useCallback((teamId: string) => {
    setTeams((previous) => previous.filter((team) => team.id !== teamId));
  }, []);

  const saveTeams = useCallback(() => {
    persistTeams(teamsRef.current);
  }, []);

  const loadPiOptions = useCallback(async (shouldAutoSelectCurrentPi = false) => {
    setIsLoadingPiOptions(true);
    try {
      const loadedPiNames = await loadAvailablePiNamesFromJira(teamsRef.current);
      setAvailablePiNames(loadedPiNames);
      if (shouldAutoSelectCurrentPi) {
        const activePiName = findPiNameForDate(loadedPiNames);
        if (activePiName !== null) {
          setSelectedPiNameState(activePiName);
          selectedPiNameRef.current = activePiName;
          persistSelectedPiName(activePiName);
        }
      }
    } catch {
      setAvailablePiNames([]);
    } finally {
      setIsLoadingPiOptions(false);
    }
  }, []);

  useEffect(() => {
    if (initialStoredTeamCountRef.current === 0) {
      return;
    }

    void loadPiOptions(true);
  }, [loadPiOptions]);

  const loadTeam = useCallback(async (teamId: string) => {
    // Read boardId directly from the ref to avoid stale closures in concurrent mode
    const targetTeam = teamsRef.current.find((team) => team.id === teamId);
    if (!targetTeam) return;
    const { boardId } = targetTeam;

    setTeams((previous) =>
      previous.map((team) =>
        team.id === teamId ? { ...team, isLoading: true, loadError: null } : team,
      ),
    );

    try {
      const boardMetadata = await jiraGet<JiraBoardMetadata>(`/rest/agile/1.0/board/${boardId}`);
      const normalizedBoardType = normalizeBoardType(boardMetadata.type);
      const resolvedBoardName = boardMetadata.name?.trim() || targetTeam.boardName;
      const piFieldId = readArtAdvancedSettings().piFieldId?.trim() || DEFAULT_PI_FIELD_ID;
      const hasSelectedPiName = selectedPiNameRef.current.trim() !== '';
      const resolvedProjectKey = hasSelectedPiName
        ? await resolveTeamProjectKey(targetTeam)
        : targetTeam.projectKey?.trim();

      if (hasSelectedPiName && !resolvedProjectKey) {
        setTeams((current) =>
          current.map((team) =>
            team.id === teamId
              ? {
                  ...team,
                  boardName: resolvedBoardName,
                  boardType: normalizedBoardType,
                  activeSprintName: undefined,
                  isLoading: false,
                  loadError: 'PI filter unavailable: no project key for this board',
                  sprintIssues: [],
                }
              : team,
          ),
        );
        return;
      }

      if (hasSelectedPiName && resolvedProjectKey) {
        const piFieldNumber = piFieldId.replace('customfield_', '');
        const piSearchJql = `project="${resolvedProjectKey}" AND cf[${piFieldNumber}]="${selectedPiNameRef.current.trim()}" ORDER BY updated DESC`;
        const issueResponse = await jiraGet<{ issues: JiraIssue[] }>(
          `/rest/api/2/search?jql=${encodeURIComponent(piSearchJql)}&fields=${encodeURIComponent(SPRINT_ISSUE_FIELDS)}&maxResults=${PI_ISSUE_MAX_RESULTS}`,
        );
        const activeSprintName = await loadActiveSprintNameForBoard(boardId, normalizedBoardType);

        setTeams((current) =>
          current.map((team) =>
            team.id === teamId
              ? {
                  ...team,
                  boardName: resolvedBoardName,
                  boardType: normalizedBoardType,
                  projectKey: resolvedProjectKey,
                  activeSprintName,
                  isLoading: false,
                  loadError: null,
                  sprintIssues: issueResponse.issues,
                }
              : team,
          ),
        );
        return;
      }

      if (normalizedBoardType === 'kanban' || normalizedBoardType === 'simple') {
        const issueResponse = await jiraGet<{ issues: JiraIssue[] }>(
          `/rest/agile/1.0/board/${boardId}/issue?maxResults=${BOARD_ISSUE_MAX_RESULTS}&fields=${encodeURIComponent(SPRINT_ISSUE_FIELDS)}`,
        );

        setTeams((current) =>
          current.map((team) =>
            team.id === teamId
              ? {
                  ...team,
                  boardName: resolvedBoardName,
                  boardType: normalizedBoardType,
                  projectKey: resolvedProjectKey ?? team.projectKey,
                  // Kanban boards have no sprints, so any previously stored sprint name is no longer valid.
                  activeSprintName: undefined,
                  isLoading: false,
                  loadError: null,
                  sprintIssues: issueResponse.issues,
                }
              : team,
          ),
        );
        return;
      }

      try {
        const sprintResponse = await jiraGet<{ values: JiraSprintMetadata[] }>(
          `/rest/agile/1.0/board/${boardId}/sprint?state=${SPRINT_STATE_ACTIVE}`,
        );
        const activeSprint = sprintResponse.values[0];

        if (!activeSprint) {
          setTeams((current) =>
            current.map((team) =>
              team.id === teamId
                ? {
                    ...team,
                    boardName: resolvedBoardName,
                    boardType: normalizedBoardType,
                    projectKey: resolvedProjectKey ?? team.projectKey,
                    activeSprintName: undefined,
                    isLoading: false,
                    loadError: 'No active sprint found',
                    sprintIssues: [],
                  }
                : team,
            ),
          );
          return;
        }

        const issueResponse = await jiraGet<{ issues: JiraIssue[] }>(
          `/rest/agile/1.0/sprint/${activeSprint.id}/issue?maxResults=${SPRINT_ISSUE_MAX_RESULTS}&fields=${encodeURIComponent(SPRINT_ISSUE_FIELDS)}`,
        );

        setTeams((current) =>
          current.map((team) =>
            team.id === teamId
              ? {
                  ...team,
                  boardName: resolvedBoardName,
                  boardType: normalizedBoardType,
                  projectKey: resolvedProjectKey ?? team.projectKey,
                  // Store the sprint name so the Overview card can display it without a re-fetch.
                  activeSprintName: activeSprint.name,
                  isLoading: false,
                  loadError: null,
                  sprintIssues: issueResponse.issues,
                }
              : team,
          ),
        );
      } catch (sprintError) {
        const sprintErrorMessage = sprintError instanceof Error ? sprintError.message : String(sprintError);
        const normalizedSprintErrorMessage = sprintErrorMessage.toLowerCase();
        const canUseBoardIssueFallback = normalizedSprintErrorMessage.includes("doesn't support sprints")
          || normalizedSprintErrorMessage.includes('does not support sprints');

        if (!canUseBoardIssueFallback) {
          throw sprintError;
        }

        const issueResponse = await jiraGet<{ issues: JiraIssue[] }>(
          `/rest/agile/1.0/board/${boardId}/issue?maxResults=${BOARD_ISSUE_MAX_RESULTS}&fields=${encodeURIComponent(SPRINT_ISSUE_FIELDS)}`,
        );

        setTeams((current) =>
          current.map((team) =>
            team.id === teamId
              ? {
                  ...team,
                  boardName: resolvedBoardName,
                  boardType: normalizedBoardType,
                  projectKey: resolvedProjectKey ?? team.projectKey,
                  activeSprintName: undefined,
                  isLoading: false,
                  loadError: null,
                  sprintIssues: issueResponse.issues,
                }
              : team,
          ),
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load team';
      setTeams((current) =>
        current.map((team) =>
          team.id === teamId
            ? { ...team, activeSprintName: undefined, isLoading: false, loadError: errorMessage, sprintIssues: [] }
            : team,
        ),
      );
    }
  }, []);

  const loadAllTeams = useCallback(async () => {
    const currentTeams = teamsRef.current;
    setIsLoadingAllTeams(true);
    try {
      await Promise.all(currentTeams.map((team) => loadTeam(team.id)));
    } finally {
      setIsLoadingAllTeams(false);
    }
  }, [loadTeam]);

  const toggleSosTeam = useCallback((teamId: string) => {
    setSosExpandedTeams((previous) =>
      previous.includes(teamId)
        ? previous.filter((id) => id !== teamId)
        : [...previous, teamId],
    );
  }, []);

  const loadBoardPrep = useCallback(async () => {
    const currentTeams = teamsRef.current;
    setIsLoadingBoardPrep(true);
    setBoardPrepError(null);
    try {
      const teamIssueArrays = await Promise.all(
        currentTeams.map(async (team) => {
          const boardPrepBoardType = await resolveBoardPrepBoardType(team);
          const response = await jiraGet<{ issues: JiraIssue[] }>(
            buildBoardPrepIssuePath(team.boardId, boardPrepBoardType),
          );
          return createBoardPrepIssues(team.name, response.issues);
        }),
      );
      setBoardPrepIssues(teamIssueArrays.flat());
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load board prep';
      setBoardPrepError(errorMessage);
    } finally {
      setIsLoadingBoardPrep(false);
    }
  }, []);

  const setBoardPrepTeamFilter = useCallback((teamName: string) => {
    setBoardPrepTeamFilterState(teamName);
  }, []);

  /**
   * Updates the SoS Jira issue key for a team in-place.
   * The change is immediately reflected in state and persisted via the existing teams useEffect.
   */
  const updateTeamSosKey = useCallback((teamId: string, sosIssueKey: string) => {
    setTeams((previous) =>
      previous.map((team) =>
        team.id === teamId
          ? { ...team, sosIssueKey: sosIssueKey.trim() || undefined }
          : team,
      ),
    );
  }, []);

  /** Updates the Jira label for a team in-place. Persisted to localStorage via the next Save Teams click. */
  const updateTeamJiraLabel = useCallback((teamId: string, jiraLabel: string) => {
    setTeams((previous) =>
      previous.map((team) =>
        team.id === teamId
          ? { ...team, jiraLabel: jiraLabel.trim() || undefined }
          : team,
      ),
    );
  }, []);

  return {
    state: {
      activeTab,
      teams,
      selectedPiName,
      availablePiNames,
      isLoadingPiOptions,
      isLoadingAllTeams,
      sosExpandedTeams,
      boardPrepIssues,
      isLoadingBoardPrep,
      boardPrepError,
      boardPrepTeamFilter,
      piProgressStats,
    },
    actions: {
      setActiveTab,
      setSelectedPiName,
      addTeam,
      replaceTeams,
      removeTeam,
      saveTeams,
      loadPiOptions,
      loadTeam,
      loadAllTeams,
      toggleSosTeam,
      loadBoardPrep,
      setBoardPrepTeamFilter,
      updateTeamSosKey,
      updateTeamJiraLabel,
    },
  };
}
