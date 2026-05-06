// useArtData.ts — State management hook for the ART (Agile Release Train) View.

import { useCallback, useRef, useState } from 'react';
import { jiraGet } from '../../../services/jiraApi.ts';
import type { JiraIssue } from '../../../types/jira.ts';

const SPRINT_STATE_ACTIVE = 'active';
const SPRINT_ISSUE_MAX_RESULTS = 100;
const SPRINT_ISSUE_FIELDS = 'summary,status,priority,assignee,reporter,issuetype,created,updated,description';

export type ArtPersona = 'sm' | 'po' | 'dev' | 'qa';
export type ArtTab = 'overview' | 'impediments' | 'predictability' | 'releases' | 'sos' | 'monthly' | 'settings';

/** Represents a single Agile team in the ART view. */
export interface ArtTeam {
  id: string;
  name: string;
  boardId: string;
  sprintIssues: JiraIssue[];
  isLoading: boolean;
  loadError: string | null;
}

export interface ArtDataState {
  activeTab: ArtTab;
  persona: ArtPersona;
  teams: ArtTeam[];
  selectedPiName: string;
  isLoadingAllTeams: boolean;
}

export interface ArtDataActions {
  setActiveTab: (tab: ArtTab) => void;
  setPersona: (persona: ArtPersona) => void;
  setSelectedPiName: (name: string) => void;
  addTeam: (name: string, boardId: string) => void;
  removeTeam: (teamId: string) => void;
  loadTeam: (teamId: string) => Promise<void>;
  loadAllTeams: () => Promise<void>;
}

/** Hook providing all state and actions for the ART multi-team PI planning view. */
export function useArtData(): { state: ArtDataState; actions: ArtDataActions } {
  const [activeTab, setActiveTabState] = useState<ArtTab>('overview');
  const [persona, setPersonaState] = useState<ArtPersona>('sm');
  const [teams, setTeams] = useState<ArtTeam[]>([]);
  // teamsRef keeps an always-current reference so loadTeam can read boardId without stale closures
  const teamsRef = useRef<ArtTeam[]>([]);
  teamsRef.current = teams;
  const [selectedPiName, setSelectedPiNameState] = useState('');
  const [isLoadingAllTeams, setIsLoadingAllTeams] = useState(false);

  const setActiveTab = useCallback((tab: ArtTab) => {
    setActiveTabState(tab);
  }, []);

  const setPersona = useCallback((newPersona: ArtPersona) => {
    setPersonaState(newPersona);
  }, []);

  const setSelectedPiName = useCallback((name: string) => {
    setSelectedPiNameState(name);
  }, []);

  const addTeam = useCallback((name: string, boardId: string) => {
    // Use timestamp + random suffix for a unique ID without crypto.randomUUID
    const newTeamId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const newTeam: ArtTeam = {
      id: newTeamId,
      name,
      boardId,
      sprintIssues: [],
      isLoading: false,
      loadError: null,
    };
    setTeams((previous) => [...previous, newTeam]);
  }, []);

  const removeTeam = useCallback((teamId: string) => {
    setTeams((previous) => previous.filter((team) => team.id !== teamId));
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

  return {
    state: {
      activeTab,
      persona,
      teams,
      selectedPiName,
      isLoadingAllTeams,
    },
    actions: {
      setActiveTab,
      setPersona,
      setSelectedPiName,
      addTeam,
      removeTeam,
      loadTeam,
      loadAllTeams,
    },
  };
}
