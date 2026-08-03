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
import { runHygieneScan } from '../../../Hygiene/hooks/hygieneScan.ts';
import { loadDashboardConfigFromStorage } from '../../../SprintDashboard/hooks/useDashboardConfig.ts';
import { useSprintData } from '../../../SprintDashboard/hooks/useSprintData.ts';
import { buildTeamHygieneScopeJql } from '../../../SprintDashboard/teamHygieneScope.ts';
import { useMentionsState } from '../../hooks/useMentionsState.ts';
import { MY_ISSUES_JQL_SUFFIX } from '../../hooks/useMyIssuesState.ts';
import { buildAssigneeJql } from '../../myIssuesRoleLens.ts';
import { useMyIssuesPersonaStore } from '../../hooks/useMyIssuesPersonaStore.ts';
import {
  buildTeamCountBreakdown,
  COMMITMENT_GAP_CHECK_IDS,
  countUniqueFindingKeysAcrossTeams,
  DUE_OVERDUE_CHECK_IDS,
  selectBlockers,
  selectDueOverdue,
  selectFindingKeysAcrossTeams,
  selectMyStale,
  selectUntriaged,
  TEAM_STALE_CHECK_IDS,
  TEAM_UNASSIGNED_CHECK_IDS,
  type CategoryId,
  type TeamCountBreakdownEntry,
  type TeamScanEntry,
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
  /** Per-team share of the count, present on team cards when more than one team was scanned. */
  teamBreakdown?: TeamCountBreakdownEntry[];
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
  'team-stale': { kind: 'sprintTab', tab: 'hygiene', search: { hygieneFilter: 'stale' } },
  // Unassigned and commitment-gap counts come from the TEAM's sprint issues, so they must land on
  // the team dashboard's Hygiene tab. The personal Hygiene tab filters to assignee = currentUser(),
  // where an unassigned issue can never appear — the old link was a guaranteed zero (GH #167).
  // Each team card carries its own check filter; without it, three different cards landed on one
  // identical unfiltered view whose number matched none of them (GH #177). Commitment gaps count
  // two checks, so its filter carries both ids.
  unassigned: { kind: 'sprintTab', tab: 'hygiene', search: { hygieneFilter: 'no-assignee' } },
  'commitment-gaps': { kind: 'sprintTab', tab: 'hygiene', search: { hygieneFilter: 'missing-sp,no-ac' } },
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

/**
 * The outcome of the team hygiene scans, stamped like SourceResult. Every saved Dashboard Team
 * profile is scanned (GH #282 — an SM's other teams were silently invisible), and each scan uses
 * the SHARED pipeline (hygieneScan.ts) — the exact scan the team Hygiene tab renders — so the
 * team cards and that tab can never disagree on scope, fields, or configuration (GH #177).
 */
interface TeamScanResult {
  requestKey: string;
  teamScans: TeamScanEntry[];
}

const EMPTY_TEAM_SCAN_RESULT: TeamScanResult = { requestKey: REQUEST_NONE, teamScans: [] };

/** One team the hygiene scan will audit: its identity plus the scope clause its profile persists. */
interface TeamScanTarget {
  teamProfileId: string;
  teamName: string;
  projectKey: string;
  scopeJql: string;
}

// ── Pure helpers (module-level so the hook body stays small) ──

/**
 * Works out a source's status by comparing the data on hand against the request the current inputs
 * call for. A null requestKey means the inputs cannot support a fetch yet (no connection), which the
 * cards show as loading rather than as a false "ready" with a zero count.
 */
function deriveFetchStatus(
  requestKey: string | null,
  result: { requestKey: string; errorMessage: string | null },
): CategoryStatus {
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

/** Builds the my-issues search path with every field the reused Hygiene rules read. The assignee clause is
 *  passed in so the Today checklist follows the tool-wide persona (view as the viewer or a simulated user). */
function buildMyIssuesSearchPath(assigneeClause: string): string {
  const jql = `${assigneeClause}${MY_ISSUES_JQL_SUFFIX}`;
  return `${SEARCH_PATH}?jql=${encodeURIComponent(jql)}&fields=${MY_ISSUES_FIELDS}&maxResults=${MYSELF_MAX_RESULTS}`;
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
  teamBreakdown?: TeamCountBreakdownEntry[],
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
    teamBreakdown,
  };
}

/**
 * Works out the combined team-scan status. Partial failures stay 'ready' — the surviving teams'
 * counts are real and the failed team is marked on its own breakdown chip; only when EVERY team
 * scan failed is there nothing honest to show (GH #167 — no false zeros, no all-or-nothing).
 */
function deriveTeamScanStatus(requestKey: string | null, result: TeamScanResult): CategoryStatus {
  if (requestKey === null) return 'loading';
  if (result.requestKey !== requestKey) return 'loading';
  const hasEveryTeamFailed =
    result.teamScans.length > 0 && result.teamScans.every((teamScan) => teamScan.errorMessage !== null);
  return hasEveryTeamFailed ? 'error' : 'ready';
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
  const teamProfiles = useSettingsStore((settings) => settings.sprintDashboardTeamProfiles);

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
  const [teamScanResult, setTeamScanResult] = useState<TeamScanResult>(EMPTY_TEAM_SCAN_RESULT);
  // Bumping this token re-runs the my-issues, untriaged, and team-scan fetches on manual refresh.
  const [reloadToken, setReloadToken] = useState<number>(0);

  const isTeamConfigured = sprintState.boardId !== null || Boolean(sprintState.projectKey.trim());
  const trimmedDsuProjectKey = dsuProjectKey.trim();
  const isUntriagedConfigured = Boolean(trimmedDsuProjectKey);

  // The team hygiene cards count the SAME scan the team Hygiene tab runs. EVERY saved Dashboard
  // Team profile is a scan target — an SM with several teams previously saw only the active one
  // (GH #282 follow-up). Each target's scope clause comes from its profile's persisted selection,
  // built by the same function the Hygiene tab uses, so the JQL per team is identical to its tab.
  const teamScanTargets = useMemo<TeamScanTarget[]>(() => {
    const profileTargets = teamProfiles
      .filter((teamProfile) => teamProfile.projectKey.trim() !== '')
      .map((teamProfile) => ({
        teamProfileId: teamProfile.id,
        teamName: teamProfile.name,
        projectKey: teamProfile.projectKey.trim(),
        scopeJql: buildTeamHygieneScopeJql({
          scopeMode: teamProfile.scopeMode,
          selectedPiValue: teamProfile.selectedPiValue,
          selectedFixVersionName: teamProfile.selectedFixVersion,
          selectedSprintId: teamProfile.selectedSprintId ? Number(teamProfile.selectedSprintId) : null,
        }),
      }));
    if (profileTargets.length > 0) {
      return profileTargets;
    }
    // Legacy profile-less setup: fall back to the live dashboard selection (the old behavior).
    const legacyProjectKey = sprintState.projectKey.trim();
    if (!legacyProjectKey) {
      return [];
    }
    return [{
      teamProfileId: activeTeamProfileId,
      teamName: 'Team',
      projectKey: legacyProjectKey,
      scopeJql: buildTeamHygieneScopeJql({
        scopeMode: sprintState.scopeMode,
        selectedPiValue: sprintState.selectedPiValue,
        selectedFixVersionName: sprintState.selectedFixVersionName,
        selectedSprintId: sprintState.selectedSprintId,
      }),
    }];
  }, [
    teamProfiles,
    activeTeamProfileId,
    sprintState.projectKey,
    sprintState.scopeMode,
    sprintState.selectedPiValue,
    sprintState.selectedFixVersionName,
    sprintState.selectedSprintId,
  ]);
  const isTeamHygieneConfigured = teamScanTargets.length > 0;

  // The tool-wide persona subject drives the "my" half of the Today checklist, so simulating another user
  // shows THEIR daily hygiene. The team-scope cards below are unaffected (they audit the whole team).
  const personaSubject = useMyIssuesPersonaStore((store) => store.subject);
  const personaMemberIdentifiers = useMyIssuesPersonaStore((store) => store.memberIdentifiers);
  const myIssuesAssigneeClause = buildAssigneeJql(personaSubject, personaMemberIdentifiers);

  // Each key names the exact fetch the current inputs call for, and null means "cannot fetch yet".
  // Everything the query depends on — including the persona clause — is in the key, so a changed subject
  // or a refresh both mark the data on hand as stale automatically (that drives the loading state below).
  const myIssuesRequestKey = isConnectionReady ? `my|${myIssuesAssigneeClause}|${reloadToken}` : null;
  const untriagedRequestKey =
    isConnectionReady && isUntriagedConfigured ? `untriaged|${trimmedDsuProjectKey}|${reloadToken}` : null;
  // Every target's identity + scope is in the key, so adding a team profile or a changed
  // PI/sprint selection automatically re-runs the scans against the new inputs.
  const teamScanRequestKey =
    isConnectionReady && isTeamHygieneConfigured
      ? `team-scan|${teamScanTargets.map((target) => `${target.teamProfileId}:${target.projectKey}:${target.scopeJql}`).join(';')}|${reloadToken}`
      : null;

  const myIssuesStatus = deriveFetchStatus(myIssuesRequestKey, myIssuesResult);
  const untriagedStatus = deriveFetchStatus(untriagedRequestKey, untriagedResult);
  const teamScanStatus = deriveTeamScanStatus(teamScanRequestKey, teamScanResult);
  // Only an all-teams failure surfaces as the card error; partial failures are per-chip.
  const teamScanErrorMessage =
    teamScanStatus === 'error' ? (teamScanResult.teamScans[0]?.errorMessage ?? 'Failed to load') : null;
  const myIssuesError = myIssuesResult.errorMessage;
  const untriagedError = untriagedResult.errorMessage;

  // ── My-issues fetch (independent source) ──
  useEffect(() => {
    if (myIssuesRequestKey === null) {
      return;
    }

    let isMounted = true;
    jiraGet<JiraSearchResponse>(buildMyIssuesSearchPath(myIssuesAssigneeClause))
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
  }, [myIssuesRequestKey, myIssuesAssigneeClause]);

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

  // ── Team hygiene scans (independent source; THE same scan each team's Hygiene tab runs) ──
  // One scan per saved team profile, in parallel. A failed team resolves to an errored entry
  // rather than rejecting the batch, so one broken team never hides the others' findings.
  useEffect(() => {
    if (teamScanRequestKey === null) {
      return;
    }

    let isMounted = true;
    void Promise.all(
      teamScanTargets.map((target) =>
        runHygieneScan({
          projectKey: target.projectKey,
          extraJql: target.scopeJql,
          // Team mode audits every in-scope issue regardless of assignee, exactly like the tab.
          assigneeClause: null,
          activeTeamProfileId: target.teamProfileId,
        })
          .then((scanOutcome): TeamScanEntry => ({
            teamProfileId: target.teamProfileId,
            teamName: target.teamName,
            findings: scanOutcome.findings,
            errorMessage: null,
          }))
          .catch((unknownError: unknown): TeamScanEntry => ({
            teamProfileId: target.teamProfileId,
            teamName: target.teamName,
            findings: [],
            errorMessage: extractErrorMessage(unknownError),
          })),
      ),
    ).then((teamScans) => {
      if (!isMounted) return;
      setTeamScanResult({ requestKey: teamScanRequestKey, teamScans });
    });

    return () => {
      isMounted = false;
    };
  }, [teamScanRequestKey, teamScanTargets]);

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
    // The team cards count the shared scans' findings — never a second evaluation over a second
    // issue pool. The sprint fetch includes Done issues and misses configured fields; counting
    // hygiene from it produced 58 phantom commitment gaps beside a tab showing 1 (GH #177).
    // Counts are the deduped union across every scanned team (GH #282); the per-team share is
    // attached as a breakdown only when there is genuinely more than one team to break down.
    const teamScans = teamScanResult.teamScans;
    const breakdownFor = (checkIds: readonly string[]): TeamCountBreakdownEntry[] | undefined =>
      teamScans.length > 1 ? buildTeamCountBreakdown(teamScans, checkIds) : undefined;
    // Due/overdue is a my+team union deduped by key; the team half reads the scan findings so it
    // honours the same scope and enabled checks as each team's Hygiene tab.
    const myDueOverdueKeys = selectDueOverdue(myHygiene, [], { staleDaysThreshold }).map((issue) => issue.key);
    const teamDueOverdueKeys = isTeamHygieneConfigured
      ? selectFindingKeysAcrossTeams(teamScans, DUE_OVERDUE_CHECK_IDS)
      : [];
    const dueOverdueCount = new Set([...myDueOverdueKeys, ...teamDueOverdueKeys]).size;
    const dueOverdueTeamStatus: CategoryStatus = isTeamHygieneConfigured ? teamScanStatus : 'ready';
    const dueOverdueTeamError = isTeamHygieneConfigured ? teamScanErrorMessage : null;

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
      'team-stale': buildTeamCategory(
        'team-stale',
        countUniqueFindingKeysAcrossTeams(teamScans, TEAM_STALE_CHECK_IDS),
        isTeamHygieneConfigured,
        teamScanStatus,
        teamScanErrorMessage,
        breakdownFor(TEAM_STALE_CHECK_IDS),
      ),
      unassigned: buildTeamCategory(
        'unassigned',
        countUniqueFindingKeysAcrossTeams(teamScans, TEAM_UNASSIGNED_CHECK_IDS),
        isTeamHygieneConfigured,
        teamScanStatus,
        teamScanErrorMessage,
        breakdownFor(TEAM_UNASSIGNED_CHECK_IDS),
      ),
      'commitment-gaps': buildTeamCategory(
        'commitment-gaps',
        countUniqueFindingKeysAcrossTeams(teamScans, COMMITMENT_GAP_CHECK_IDS),
        isTeamHygieneConfigured,
        teamScanStatus,
        teamScanErrorMessage,
        breakdownFor(COMMITMENT_GAP_CHECK_IDS),
      ),
      'due-overdue': buildMixedCategory(
        'due-overdue',
        dueOverdueCount,
        myIssuesStatus,
        dueOverdueTeamStatus,
        myIssuesError,
        dueOverdueTeamError,
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
    isTeamHygieneConfigured,
    teamScanResult,
    teamScanStatus,
    teamScanErrorMessage,
  ]);

  return {
    categories,
    isConnectionReady,
    refresh,
    sprintIssues: teamHygiene,
    sprintInfo: sprintState.sprintInfo,
  };
}
