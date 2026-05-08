// useArtData.ts — State management hook for the ART (Agile Release Train) View.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { jiraGet } from '../../../services/jiraApi.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const SPRINT_STATE_ACTIVE = 'active';
const SPRINT_ISSUE_MAX_RESULTS = 100;
const SPRINT_ISSUE_FIELDS = 'summary,status,priority,assignee,reporter,issuetype,created,updated,description';
const BOARD_PREP_FIELDS = 'summary,status,priority,customfield_10016';
const BOARD_PREP_MAX_RESULTS = 100;
const STATUS_CATEGORY_DONE = 'done';
const STATUS_CATEGORY_IN_PROGRESS = 'indeterminate';
const ART_TEAMS_STORAGE_KEY = 'nodetoolbox-art-teams';

export type ArtPersona = 'sm' | 'po' | 'dev' | 'qa';
export type ArtTab =
  | 'overview'
  | 'impediments'
  | 'predictability'
  | 'releases'
  | 'blueprint'
  | 'dependencies'
  | 'boardprep'
  | 'sos'
  | 'monthly'
  | 'settings';

/** Represents a single Agile team in the ART view. */
export interface ArtTeam {
  id: string;
  name: string;
  boardId: string;
  /** Optional Jira project key (e.g. "ALPHA") used for Blueprint off-train detection. */
  projectKey?: string;
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
  persona: ArtPersona;
  teams: ArtTeam[];
  selectedPiName: string;
  isLoadingAllTeams: boolean;
  /** Team IDs whose SoS accordion sections are currently expanded. */
  sosExpandedTeams: string[];
  /** Issues fetched from team board backlogs for the Board Prep panel. */
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
  setPersona: (persona: ArtPersona) => void;
  setSelectedPiName: (name: string) => void;
  addTeam: (name: string, boardId: string, projectKey?: string) => void;
  removeTeam: (teamId: string) => void;
  saveTeams: () => void;
  loadTeam: (teamId: string) => Promise<void>;
  loadAllTeams: () => Promise<void>;
  /** Expand or collapse a team's SoS accordion section. */
  toggleSosTeam: (teamId: string) => void;
  /** Fetch backlog-ready issues for all teams' boards (issues not yet in a sprint). */
  loadBoardPrep: () => Promise<void>;
  setBoardPrepTeamFilter: (teamName: string) => void;
}

/** Returns a team record safe to persist without volatile loading or issue data. */
function buildStoredTeamRecord(team: ArtTeam): ArtTeam {
  return {
    id: team.id,
    name: team.name,
    boardId: team.boardId,
    projectKey: team.projectKey,
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
      .map((team) => ({
        id: String(team.id ?? ''),
        name: String(team.name ?? ''),
        boardId: String(team.boardId ?? ''),
        projectKey: typeof team.projectKey === 'string' && team.projectKey.trim() !== ''
          ? team.projectKey
          : undefined,
        sprintIssues: [],
        isLoading: false,
        loadError: null,
      }))
      .filter((team) => team.id !== '' && team.name !== '' && team.boardId !== '');
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

/** Determines whether a Jira issue counts as done based on status category or name. */
function isIssueDone(issue: JiraIssue): boolean {
  const categoryKey = issue.fields.status.statusCategory?.key;
  if (categoryKey) return categoryKey === STATUS_CATEGORY_DONE;
  return issue.fields.status.name.toLowerCase() === 'done';
}

/** Determines whether a Jira issue is actively in progress. */
function isIssueInProgress(issue: JiraIssue): boolean {
  const categoryKey = issue.fields.status.statusCategory?.key;
  if (categoryKey) return categoryKey === STATUS_CATEGORY_IN_PROGRESS;
  const statusName = issue.fields.status.name.toLowerCase();
  return statusName === 'in progress' || statusName === 'in review';
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
  const [activeTab, setActiveTabState] = useState<ArtTab>('overview');
  const [persona, setPersonaState] = useState<ArtPersona>('sm');
  const [teams, setTeams] = useState<ArtTeam[]>(loadStoredTeams);
  // teamsRef keeps an always-current reference so loadTeam can read boardId without stale closures
  const teamsRef = useRef<ArtTeam[]>([]);
  teamsRef.current = teams;
  const [selectedPiName, setSelectedPiNameState] = useState('');
  const [isLoadingAllTeams, setIsLoadingAllTeams] = useState(false);
  const [sosExpandedTeams, setSosExpandedTeams] = useState<string[]>([]);
  const [boardPrepIssues, setBoardPrepIssues] = useState<ArtBoardPrepIssue[]>([]);
  const [isLoadingBoardPrep, setIsLoadingBoardPrep] = useState(false);
  const [boardPrepError, setBoardPrepError] = useState<string | null>(null);
  const [boardPrepTeamFilter, setBoardPrepTeamFilterState] = useState('all');

  useEffect(() => {
    persistTeams(teams);
  }, [teams]);

  // Derive PI progress stats from live team data without a separate state variable
  const piProgressStats = useMemo(() => computePiProgressStats(teams), [teams]);

  const setActiveTab = useCallback((tab: ArtTab) => {
    setActiveTabState(tab);
  }, []);

  const setPersona = useCallback((newPersona: ArtPersona) => {
    setPersonaState(newPersona);
  }, []);

  const setSelectedPiName = useCallback((name: string) => {
    setSelectedPiNameState(name);
  }, []);

  const addTeam = useCallback((name: string, boardId: string, projectKey?: string) => {
    // Use timestamp + random suffix for a unique ID without crypto.randomUUID
    const newTeamId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const newTeam: ArtTeam = {
      id: newTeamId,
      name,
      boardId,
      projectKey: projectKey?.trim() || undefined,
      sprintIssues: [],
      isLoading: false,
      loadError: null,
    };
    setTeams((previous) => [...previous, newTeam]);
  }, []);

  const removeTeam = useCallback((teamId: string) => {
    setTeams((previous) => previous.filter((team) => team.id !== teamId));
  }, []);

  const saveTeams = useCallback(() => {
    persistTeams(teamsRef.current);
  }, []);

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
      const sprintResponse = await jiraGet<{ values: { id: number; name: string; state: string }[] }>(
        `/rest/agile/1.0/board/${boardId}/sprint?state=${SPRINT_STATE_ACTIVE}`,
      );
      const activeSprint = sprintResponse.values[0];

      if (!activeSprint) {
        setTeams((current) =>
          current.map((team) =>
            team.id === teamId
              ? { ...team, isLoading: false, loadError: 'No active sprint found', sprintIssues: [] }
              : team,
          ),
        );
        return;
      }

      const issueResponse = await jiraGet<{ issues: JiraIssue[] }>(
        `/rest/agile/1.0/sprint/${activeSprint.id}/issue?maxResults=${SPRINT_ISSUE_MAX_RESULTS}&fields=${SPRINT_ISSUE_FIELDS}`,
      );

      setTeams((current) =>
        current.map((team) =>
          team.id === teamId
            ? { ...team, isLoading: false, loadError: null, sprintIssues: issueResponse.issues }
            : team,
        ),
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load team';
      setTeams((current) =>
        current.map((team) =>
          team.id === teamId
            ? { ...team, isLoading: false, loadError: errorMessage, sprintIssues: [] }
            : team,
        ),
      );
    }
  }, []);

  const loadAllTeams = useCallback(async () => {
    setIsLoadingAllTeams(true);
    try {
      await Promise.all(teams.map((team) => loadTeam(team.id)));
    } finally {
      setIsLoadingAllTeams(false);
    }
  }, [teams, loadTeam]);

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
          const response = await jiraGet<{ issues: JiraIssue[] }>(
            `/rest/agile/1.0/board/${team.boardId}/backlog?maxResults=${BOARD_PREP_MAX_RESULTS}&fields=${BOARD_PREP_FIELDS}`,
          );
          return response.issues.map<ArtBoardPrepIssue>((issue) => ({
            teamName: team.name,
            key: issue.key,
            summary: issue.fields.summary,
            estimate: issue.fields.customfield_10016 ?? null,
            priority: issue.fields.priority?.name ?? null,
          }));
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

  return {
    state: {
      activeTab,
      persona,
      teams,
      selectedPiName,
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
      setPersona,
      setSelectedPiName,
      addTeam,
      removeTeam,
      saveTeams,
      loadTeam,
      loadAllTeams,
      toggleSosTeam,
      loadBoardPrep,
      setBoardPrepTeamFilter,
    },
  };
}
