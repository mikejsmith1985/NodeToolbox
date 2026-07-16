// useTodayDashboard.ts — Orchestrates the per-card data for the Scrum Master "Today" tab.
//
// Each daily duty (mentions, blockers, stale work, etc.) is fed by an independent data
// source so a single slow or failing source can never blank the whole dashboard. This hook
// fans those sources out, runs the existing pure selectors over them, and returns one
// CategoryResult per catalog entry plus the data the Sprint-Flow snapshot needs. It performs
// no Jira mutation — its only job is reading and counting.

import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';

import { jiraGet } from '../../../../services/jiraApi.ts';
import { useConnectionStore } from '../../../../store/connectionStore.ts';
import { useSettingsStore } from '../../../../store/settingsStore.ts';
import type { JiraIssue, JiraSprint } from '../../../../types/jira.ts';
import type { JiraIssue as HygieneJiraIssue } from '../../../Hygiene/checks/hygieneChecks.ts';
import { formatLastBusinessDayEndChicago } from '../../../../utils/lastBusinessDayChicago.ts';
import { loadDashboardConfigFromStorage } from '../../../SprintDashboard/hooks/useDashboardConfig.ts';
import { useSprintData } from '../../../SprintDashboard/hooks/useSprintData.ts';
import { useMentionsState } from '../../hooks/useMentionsState.ts';
import { MY_ISSUES_JQL } from '../../hooks/useMyIssuesState.ts';
import {
  bucketTeamHygiene,
  selectBlockers,
  selectDueOverdue,
  selectMyStale,
  selectUntriaged,
  type CategoryId,
} from '../todayCategories.ts';

// ── Public types ──

/** Lifecycle of a single category's data fetch, mirroring the per-card visual states. */
export type CategoryStatus = 'loading' | 'ready' | 'error' | 'not-configured';

/** Where a category card's deep link lands the user. */
export interface TodayDestination {
  kind: 'myIssuesTab' | 'sprintTab' | 'dsuBoard';
  tab?: string;
  /** Extra query params carried to the target, so the landing view opens in the SAME scope the card counted. */
  search?: Record<string, string>;
}

/** The resolved state of one Today category, ready to render as a card. */
export interface CategoryResult {
  id: CategoryId;
  status: CategoryStatus;
  count: number;
  errorMessage?: string;
  destination: TodayDestination;
}

/** Everything the Today dashboard component needs to render in one stable object. */
export interface TodayDashboardData {
  categories: Record<CategoryId, CategoryResult>;
  isConnectionReady: boolean;
  refresh: () => void;
  /** Team issue set (cast to the Hygiene shape) used by the informational snapshot. */
  sprintIssues: HygieneJiraIssue[];
  /** The active sprint, or null when no scrum sprint is selected. */
  sprintInfo: JiraSprint | null;
}

// ── Constants ──

const SEARCH_PATH = '/rest/api/2/search';
const MYSELF_MAX_RESULTS = 100;
const MY_ISSUES_FIELDS =
  'summary,status,assignee,issuetype,priority,created,updated,duedate,fixVersions,parent,customfield_10028,customfield_10016,customfield_10020,customfield_10200,customfield_10101,customfield_10102,customfield_10301';
// The untriaged card only needs enough fields to count the DSU "new" set, so a compact list
// keeps the request small while still mirroring the DSU board's new-section query.
const UNTRIAGED_FIELDS = 'summary,status,priority,assignee,issuetype,created,updated';

// Each card's deep-link target. Team-scope cards point at the Sprint Dashboard / DSU surfaces;
// personal cards stay inside My Issues. These mirror the destinations in data-model.md.
const DESTINATIONS: Record<CategoryId, TodayDestination> = {
  mentions: { kind: 'myIssuesTab', tab: 'mentions' },
  blockers: { kind: 'sprintTab', tab: 'blockers' },
  // The card counts MY stale issues across every project, so the drill-through must open Hygiene in
  // the same cross-project personal scope with the stale filter applied — landing on a single
  // persisted project key showed a different (often zero) answer than the card (GH #167).
  'my-stale': { kind: 'myIssuesTab', tab: 'hygiene', search: { hygieneScope: 'mine', hygieneFilter: 'stale' } },
  'team-stale': { kind: 'sprintTab', tab: 'hygiene' },
  // Unassigned and commitment-gap counts come from the TEAM's sprint issues, so they must land on
  // the team dashboard's Hygiene tab. The personal Hygiene tab filters to assignee = currentUser(),
  // where an unassigned issue can never appear — the old link was a guaranteed zero (GH #167).
  unassigned: { kind: 'sprintTab', tab: 'hygiene' },
  'commitment-gaps': { kind: 'sprintTab', tab: 'hygiene' },
  // Due/overdue is a my+team union; the personal cross-project scope shows at least the "my" half
  // honestly rather than whatever project key was last persisted.
  'due-overdue': { kind: 'myIssuesTab', tab: 'hygiene', search: { hygieneScope: 'mine' } },
  untriaged: { kind: 'dsuBoard' },
};

interface JiraSearchResponse {
  issues?: JiraIssue[];
}

/**
 * The outcome of one Jira fetch, stamped with the request that produced it.
 *
 * The stamp is what lets the card's "loading" state be worked out during render instead of being
 * switched on by hand when a fetch starts: if the data on hand came from an older request than the
 * one the current inputs call for, a new fetch is by definition still in flight. One value moving
 * as a unit also removes the window where the issues had been replaced but the error had not.
 */
interface SourceResult {
  /** The requestKey of the fetch that produced this data; never matches REQUEST_NONE. */
  requestKey: string;
  issues: JiraIssue[];
  errorMessage: string | null;
}

/** Stands for "no fetch has completed yet" — chosen so it can never equal a real request key. */
const REQUEST_NONE = '';

const EMPTY_SOURCE_RESULT: SourceResult = { requestKey: REQUEST_NONE, issues: [], errorMessage: null };

// ── Pure helpers (module-level so the hook body stays small) ──

/**
 * Works out a source's status by comparing the data on hand against the request the current inputs
 * call for. A null requestKey means the inputs cannot support a fetch yet (no connection), which the
 * cards show as loading rather than as a false "ready" with a zero count.
 */
function deriveFetchStatus(requestKey: string | null, result: SourceResult): CategoryStatus {
  if (requestKey === null) return 'loading';
  if (result.requestKey !== requestKey) return 'loading';
  if (result.errorMessage) return 'error';
  return 'ready';
}

/** Treats the typed Jira issue as the Hygiene shape the selectors expect (same field names). */
function toHygieneIssues(issues: JiraIssue[]): HygieneJiraIssue[] {
  return issues as unknown as HygieneJiraIssue[];
}

/** Derives a category status from a source's loading / error flags. */
function deriveSourceStatus(isLoading: boolean, errorMessage: string | null): CategoryStatus {
  if (isLoading) return 'loading';
  if (errorMessage) return 'error';
  return 'ready';
}

/** Combines two source statuses for a mixed (my + team) category — worst state wins. */
function combineStatuses(primary: CategoryStatus, secondary: CategoryStatus): CategoryStatus {
  if (primary === 'loading' || secondary === 'loading') return 'loading';
  if (primary === 'error' || secondary === 'error') return 'error';
  return 'ready';
}

/** Reads a human-readable message from an unknown thrown value. */
function extractErrorMessage(unknownError: unknown): string {
  return unknownError instanceof Error ? unknownError.message : 'Failed to load';
}

/** Builds the my-issues search path with every field the reused Hygiene rules read. */
function buildMyIssuesSearchPath(): string {
  return `${SEARCH_PATH}?jql=${encodeURIComponent(MY_ISSUES_JQL)}&fields=${MY_ISSUES_FIELDS}&maxResults=${MYSELF_MAX_RESULTS}`;
}

/** Builds the DSU "new" search path for the untriaged card (reuses useDsuBoardState's cutoff + JQL). */
function buildUntriagedSearchPath(projectKey: string): string {
  const jql = `project = "${projectKey}" AND created >= "${formatLastBusinessDayEndChicago()}" ORDER BY created DESC`;
  return `${SEARCH_PATH}?jql=${encodeURIComponent(jql)}&fields=${UNTRIAGED_FIELDS}&maxResults=${MYSELF_MAX_RESULTS}`;
}

/** Builds a mixed-scope (my + team) category result, combining both source statuses. */
function buildMixedCategory(
  id: CategoryId,
  count: number,
  myStatus: CategoryStatus,
  teamStatus: CategoryStatus,
  myError: string | null,
  teamError: string | null,
): CategoryResult {
  const status = combineStatuses(myStatus, teamStatus);
  return {
    id,
    status,
    count,
    errorMessage: status === 'error' ? (myError ?? teamError ?? undefined) : undefined,
    destination: DESTINATIONS[id],
  };
}

/** Builds a team-scope category result, surfacing the not-configured state when no board is set. */
function buildTeamCategory(
  id: CategoryId,
  count: number,
  isTeamConfigured: boolean,
  sprintStatus: CategoryStatus,
  sprintError: string | null,
): CategoryResult {
  if (!isTeamConfigured) {
    return { id, status: 'not-configured', count: 0, destination: DESTINATIONS[id] };
  }
  return {
    id,
    status: sprintStatus,
    count,
    errorMessage: sprintStatus === 'error' ? (sprintError ?? undefined) : undefined,
    destination: DESTINATIONS[id],
  };
}

// ── Hook ──

/**
 * Composes the Today dashboard's per-card data from the existing mentions, sprint, my-issues,
 * and DSU sources, then derives each category count through the shared Today selectors.
 */
export function useTodayDashboard(): TodayDashboardData {
  const isConnectionReady = useConnectionStore((connectionState) => connectionState.isJiraReady);
  const activeTeamProfileId = useSettingsStore((settings) => settings.sprintDashboardActiveTeamProfileId);
  const dsuProjectKey = useSettingsStore((settings) => settings.dsuProjectKey);

  // The stale threshold and story-points field both come from the team's saved dashboard config,
  // so the Today counts agree with the Hygiene and Blockers tabs rather than re-deriving them.
  const dashboardConfig = useMemo(
    () => loadDashboardConfigFromStorage(activeTeamProfileId),
    [activeTeamProfileId],
  );
  const staleDaysThreshold = dashboardConfig.staleDaysThreshold;

  const mentions = useMentionsState();
  const { state: sprintState, actions: sprintActions } = useSprintData(
    activeTeamProfileId,
    dashboardConfig.customStoryPointsFieldId,
  );

  const [myIssuesResult, setMyIssuesResult] = useState<SourceResult>(EMPTY_SOURCE_RESULT);
  const [untriagedResult, setUntriagedResult] = useState<SourceResult>(EMPTY_SOURCE_RESULT);
  // Bumping this token re-runs the my-issues and untriaged fetches on manual refresh.
  const [reloadToken, setReloadToken] = useState<number>(0);

  const isTeamConfigured = sprintState.boardId !== null || Boolean(sprintState.projectKey.trim());
  const trimmedDsuProjectKey = dsuProjectKey.trim();
  const isUntriagedConfigured = Boolean(trimmedDsuProjectKey);

  // Each key names the exact fetch the current inputs call for, and null means "cannot fetch yet".
  // Everything the query depends on is in the key, so a changed project key or a refresh both mark
  // the data on hand as stale automatically — that is what drives the loading state below.
  const myIssuesRequestKey = isConnectionReady ? `my|${reloadToken}` : null;
  const untriagedRequestKey =
    isConnectionReady && isUntriagedConfigured ? `untriaged|${trimmedDsuProjectKey}|${reloadToken}` : null;

  const myIssuesStatus = deriveFetchStatus(myIssuesRequestKey, myIssuesResult);
  const untriagedStatus = deriveFetchStatus(untriagedRequestKey, untriagedResult);
  const myIssuesError = myIssuesResult.errorMessage;
  const untriagedError = untriagedResult.errorMessage;

  // ── My-issues fetch (independent source) ──
  useEffect(() => {
    if (myIssuesRequestKey === null) {
      return;
    }

    let isMounted = true;
    jiraGet<JiraSearchResponse>(buildMyIssuesSearchPath())
      .then((response) => {
        if (!isMounted) return;
        setMyIssuesResult({ requestKey: myIssuesRequestKey, issues: response.issues ?? [], errorMessage: null });
      })
      .catch((unknownError: unknown) => {
        if (!isMounted) return;
        setMyIssuesResult({ requestKey: myIssuesRequestKey, issues: [], errorMessage: extractErrorMessage(unknownError) });
      });

    return () => {
      isMounted = false;
    };
  }, [myIssuesRequestKey]);

  // ── Untriaged fetch (independent source; own DSU "new" query) ──
  useEffect(() => {
    if (untriagedRequestKey === null) {
      return;
    }

    let isMounted = true;
    jiraGet<JiraSearchResponse>(buildUntriagedSearchPath(trimmedDsuProjectKey))
      .then((response) => {
        if (!isMounted) return;
        setUntriagedResult({ requestKey: untriagedRequestKey, issues: response.issues ?? [], errorMessage: null });
      })
      .catch((unknownError: unknown) => {
        if (!isMounted) return;
        setUntriagedResult({ requestKey: untriagedRequestKey, issues: [], errorMessage: extractErrorMessage(unknownError) });
      });

    return () => {
      isMounted = false;
    };
  }, [untriagedRequestKey, trimmedDsuProjectKey]);

  // ── Sprint load (independent source) ──
  // loadSprint gets a new identity on most renders, so calling it through an effect event keeps it
  // out of the dependency list below: the effect re-fires only when the team or connection actually
  // changes, while the call itself always reaches the current loadSprint.
  const loadSprintForCurrentTeam = useEffectEvent(() => {
    void sprintActions.loadSprint();
  });
  useEffect(() => {
    if (!isConnectionReady || !isTeamConfigured) {
      return;
    }
    loadSprintForCurrentTeam();
  }, [isConnectionReady, isTeamConfigured, reloadToken]);

  const refresh = useCallback(() => {
    setReloadToken((currentToken) => currentToken + 1);
    mentions.reload();
  }, [mentions]);

  const teamHygiene = useMemo(() => toHygieneIssues(sprintState.sprintIssues), [sprintState.sprintIssues]);
  const myHygiene = useMemo(() => toHygieneIssues(myIssuesResult.issues), [myIssuesResult.issues]);
  const untriagedHygiene = useMemo(() => toHygieneIssues(untriagedResult.issues), [untriagedResult.issues]);

  const categories = useMemo<Record<CategoryId, CategoryResult>>(() => {
    const mentionsStatus = deriveSourceStatus(mentions.isLoading, mentions.loadError);
    const sprintStatus = deriveSourceStatus(sprintState.isLoadingSprint, sprintState.loadError);
    // When the team is not configured, team issues contribute nothing to mixed-scope counts.
    const teamIssuesForMixed = isTeamConfigured ? teamHygiene : [];
    const teamStatusForMixed: CategoryStatus = isTeamConfigured ? sprintStatus : 'ready';
    const teamErrorForMixed = isTeamConfigured ? sprintState.loadError : null;
    const teamBuckets = bucketTeamHygiene(teamHygiene, { staleDaysThreshold });

    return {
      mentions: {
        id: 'mentions',
        status: mentionsStatus,
        count: mentions.visibleMentions.length,
        errorMessage: mentionsStatus === 'error' ? (mentions.loadError ?? undefined) : undefined,
        destination: DESTINATIONS.mentions,
      },
      blockers: buildMixedCategory(
        'blockers',
        selectBlockers(myHygiene, teamIssuesForMixed).length,
        myIssuesStatus,
        teamStatusForMixed,
        myIssuesError,
        teamErrorForMixed,
      ),
      'my-stale': {
        id: 'my-stale',
        status: myIssuesStatus,
        count: selectMyStale(myHygiene, staleDaysThreshold).length,
        errorMessage: myIssuesStatus === 'error' ? (myIssuesError ?? undefined) : undefined,
        destination: DESTINATIONS['my-stale'],
      },
      'team-stale': buildTeamCategory('team-stale', teamBuckets.stale.length, isTeamConfigured, sprintStatus, sprintState.loadError),
      unassigned: buildTeamCategory('unassigned', teamBuckets.unassigned.length, isTeamConfigured, sprintStatus, sprintState.loadError),
      'commitment-gaps': buildTeamCategory(
        'commitment-gaps',
        teamBuckets.commitmentGaps.length,
        isTeamConfigured,
        sprintStatus,
        sprintState.loadError,
      ),
      'due-overdue': buildMixedCategory(
        'due-overdue',
        selectDueOverdue(myHygiene, teamIssuesForMixed, { staleDaysThreshold }).length,
        myIssuesStatus,
        teamStatusForMixed,
        myIssuesError,
        teamErrorForMixed,
      ),
      untriaged: isUntriagedConfigured
        ? {
            id: 'untriaged',
            status: untriagedStatus,
            count: selectUntriaged(untriagedHygiene).length,
            errorMessage: untriagedStatus === 'error' ? (untriagedError ?? undefined) : undefined,
            destination: DESTINATIONS.untriaged,
          }
        : { id: 'untriaged', status: 'not-configured', count: 0, destination: DESTINATIONS.untriaged },
    };
  }, [
    mentions.isLoading,
    mentions.loadError,
    mentions.visibleMentions.length,
    sprintState.isLoadingSprint,
    sprintState.loadError,
    isTeamConfigured,
    teamHygiene,
    myHygiene,
    myIssuesStatus,
    myIssuesError,
    untriagedHygiene,
    untriagedStatus,
    untriagedError,
    isUntriagedConfigured,
    staleDaysThreshold,
  ]);

  return {
    categories,
    isConnectionReady,
    refresh,
    sprintIssues: teamHygiene,
    sprintInfo: sprintState.sprintInfo,
  };
}
