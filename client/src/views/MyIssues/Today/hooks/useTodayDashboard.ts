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
import { fetchIssuesPaged } from '../../../../services/fetchIssuesPaged.ts';
import { loadHygieneEvaluationSetup, runHygieneScan } from '../../../Hygiene/hooks/hygieneScan.ts';
import { resolveStoryPointsFieldIds } from '../../../Hygiene/checks/storyPointsField.ts';
import { toCalendarDay } from '../../../../utils/calendarDate.ts';
import type { HygieneEvaluationContext } from '../../../Hygiene/checks/hygieneChecks.ts';
import { loadDashboardConfigFromStorage } from '../../../SprintDashboard/hooks/useDashboardConfig.ts';
import { useSprintData } from '../../../SprintDashboard/hooks/useSprintData.ts';
import { buildTeamHygieneScopeJql } from '../../../SprintDashboard/teamHygieneScope.ts';
import { readArtSettings, readRawForecastSettings } from '../../../../services/artSettingsStore.ts';
import { adaptHygieneIssues, collectFixVersionNames } from '../../../SprintDashboard/forecast/forecastAdapters.ts';
import { buildForecastConfig } from '../../../SprintDashboard/forecast/forecastSettings.ts';
import { computeForecast } from '../../../SprintDashboard/forecast/forecastCompose.ts';
import type { ForecastResult } from '../../../SprintDashboard/forecast/forecastTypes.ts';
import { useMentionsState } from '../../hooks/useMentionsState.ts';
import { MY_ISSUES_JQL_SUFFIX } from '../../hooks/useMyIssuesState.ts';
import { buildAssigneeJql } from '../../myIssuesRoleLens.ts';
import { useMyIssuesPersonaStore } from '../../hooks/useMyIssuesPersonaStore.ts';
import {
  buildTeamCountBreakdown,
  buildTeamFlagBreakdown,
  countAllTeamHygieneFlags,
  resolveTeamScanScope,
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
  /**
   * The team profile to activate before navigating.
   *
   * A `sprintTab` link without this opens whichever team happens to be active, which on a count
   * spread across teams means landing on the one holding two of twenty-six. The destination has to
   * be able to say which team it means, or it is not a destination at all.
   */
  teamProfileId?: string;
}

/**
 * One scope behind a mixed-scope count, with the link that opens exactly that scope.
 *
 * A count that unions "my issues" and "the team's issues" cannot be opened by a single link: the
 * two live on different surfaces with different queries. Naming the halves is the honest
 * alternative to a link that silently shows a fraction of the number printed on the card.
 */
export interface CategoryScopeShare {
  id: 'mine' | 'team';
  label: string;
  count: number;
  /**
   * Where this share opens — ABSENT when no single link can honestly show it.
   *
   * The team half of a several-team count is the case: a chip reading "Team 26" that lands on
   * whichever team happens to be active shows a fraction of its own number, which is the dead end
   * this card already had once. When the team half spans several teams the per-team chips carry
   * the navigation and this stays a plain label.
   */
  destination?: TodayDestination;
  /** The team to activate before navigating, when this share belongs to exactly one team. */
  teamProfileId?: string;
}

/** The resolved state of one Today category, ready to render as a card. */
export interface CategoryResult {
  id: CategoryId;
  status: CategoryStatus;
  count: number;
  errorMessage?: string;
  /**
   * True when the count is a FLOOR rather than a total — the fetch or scan behind it could not
   * read everything in scope. A short number presented as the number is the failure this names.
   */
  isPartial?: boolean;
  destination: TodayDestination;
  /** Per-team share of the count, present on team cards when more than one team was scanned. */
  teamBreakdown?: TeamCountBreakdownEntry[];
  /**
   * Per-scope share of a mixed my+team count, each with its own link.
   *
   * The shares can sum to MORE than `count`: an issue that is both mine and my team's is counted
   * once in the total and appears in both scopes. The card says so rather than hiding it.
   */
  scopeBreakdown?: CategoryScopeShare[];
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
  /**
   * The daily forecast across every saved Dashboard Team, or null before the first scan lands.
   *
   * Computed over issues the team scans ALREADY returned — no extra Jira request. It is the same
   * `computeForecast` the Roll-Up Board and the Forecast tab call, which is why the three cannot
   * report different figures for the same issue.
   */
  forecast: ForecastResult | null;
  /**
   * Team display names by profile id, so the forecast can attribute every row.
   *
   * Returned from the hook rather than read from the store by the view: these come from the very
   * profiles the scans ran against, so a row can never be labelled with a team that was not scanned.
   */
  teamNamesByProfileId: Record<string, string>;
}

// ── Constants ──

const SEARCH_PATH = '/rest/api/2/search';
/** Issues requested per page of the personal search. */
const MYSELF_PAGE_SIZE = 100;
/**
 * The most personal issues one refresh will hold.
 *
 * This was a flat `maxResults=100` with no paging and no signal, so anyone with a queue longer than
 * a hundred saw counts that were simply short. The ceiling stays — an unbounded pull into the
 * browser is its own failure — but a run that hits it now marks its cards partial.
 */
const MYSELF_ISSUE_CEILING = 1_000;
// The personal fetch's field list is NOT hard-coded here any more. It used to name
// customfield_10101/10102 directly, which meant the "my" half of the Due / overdue card read a
// Target End field the instance might not use, while the team half resolved the field by name —
// two halves of one number, looking at different data. Both now come from the shared setup.
// The untriaged card only needs enough fields to count the DSU "new" set, so a compact list
// keeps the request small while still mirroring the DSU board's new-section query.
const UNTRIAGED_FIELDS = 'summary,status,priority,assignee,issuetype,created,updated';

/**
 * The check filter the Due / overdue drill-throughs carry, built from the SAME ids the count is
 * built from — so the link and the number cannot come to disagree about which checks they mean.
 */
const DUE_OVERDUE_FILTER = DUE_OVERDUE_CHECK_IDS.join(',');

/** The team-scoped Hygiene view, filtered to the same checks the count is built from. */
const TEAM_HYGIENE_DESTINATION: TodayDestination = {
  kind: 'sprintTab', tab: 'hygiene', search: { hygieneFilter: DUE_OVERDUE_FILTER },
};

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
  // No check filter: this card counts EVERY flag, so its drill-through must show every flag. A
  // filter here would open a narrower page than the number that led the user to it.
  'team-hygiene': { kind: 'sprintTab', tab: 'hygiene' },
  // Unassigned and commitment-gap counts come from the TEAM's sprint issues, so they must land on
  // the team dashboard's Hygiene tab. The personal Hygiene tab filters to assignee = currentUser(),
  // where an unassigned issue can never appear — the old link was a guaranteed zero (GH #167).
  // Each team card carries its own check filter; without it, three different cards landed on one
  // identical unfiltered view whose number matched none of them (GH #177). Commitment gaps count
  // two checks, so its filter carries both ids.
  unassigned: { kind: 'sprintTab', tab: 'hygiene', search: { hygieneFilter: 'no-assignee' } },
  'commitment-gaps': { kind: 'sprintTab', tab: 'hygiene', search: { hygieneFilter: 'missing-sp,no-ac' } },
  // Due/overdue is a my+team union; the personal cross-project scope shows the "my" half rather
  // than whatever project key was last persisted, and the team half is reachable from the card's
  // own scope chips. The check filter is NOT optional here: Hygiene falls back to the filter it
  // persisted in localStorage when a deep link supplies none, so this card — the only hygiene-bound
  // card that omitted one — opened on whatever check the user last looked at, with the overdue
  // issues it had just counted filtered straight back out.
  'due-overdue': {
    kind: 'myIssuesTab',
    tab: 'hygiene',
    search: { hygieneScope: 'mine', hygieneFilter: DUE_OVERDUE_FILTER },
  },
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
  /** True when Jira held more issues than this fetch was willing to read. */
  isPartial?: boolean;
  /**
   * The hygiene configuration these issues were fetched under, carried WITH them.
   *
   * It travels beside the issues rather than in its own state so the two can never be a run apart:
   * evaluating this fetch's issues against a later fetch's field ids is precisely the kind of
   * near-miss that produces a count nobody can reproduce. Null only for the untriaged fetch, which
   * runs no hygiene rules.
   */
  hygieneContext: HygieneEvaluationContext | null;
}

/** Stands for "no fetch has completed yet" — chosen so it can never equal a real request key. */
const REQUEST_NONE = '';

const EMPTY_SOURCE_RESULT: SourceResult = { requestKey: REQUEST_NONE, issues: [], errorMessage: null, hygieneContext: null };

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
function buildMyIssuesSearchPath(
  assigneeClause: string,
  requestedFields: readonly string[],
  startAt: number,
  pageSize: number,
): string {
  const jql = `${assigneeClause}${MY_ISSUES_JQL_SUFFIX}`;
  const fieldList = encodeURIComponent(requestedFields.join(','));
  return `${SEARCH_PATH}?jql=${encodeURIComponent(jql)}&fields=${fieldList}`
    + `&startAt=${startAt}&maxResults=${pageSize}`;
}

/** Builds the DSU "new" search path for the untriaged card (reuses useDsuBoardState's cutoff + JQL). */
function buildUntriagedSearchPath(projectKey: string): string {
  const jql = `project = "${projectKey}" AND created >= "${formatLastBusinessDayEndChicago()}" ORDER BY created DESC`;
  return `${SEARCH_PATH}?jql=${encodeURIComponent(jql)}&fields=${UNTRIAGED_FIELDS}&maxResults=${MYSELF_PAGE_SIZE}`;
}

/**
 * Picks the destination of the biggest share behind a mixed count.
 *
 * A card whose Open button always went to the same half was, on a count dominated by the other
 * half, a link to the wrong place — it showed one of twenty-six and looked like the number was
 * invented. Per-team shares are preferred over the summary "Team" share because a team destination
 * can name the team it opens, which the summary cannot when several teams contribute.
 */
function pickLargestShareDestination(
  scopeShares: readonly CategoryScopeShare[],
  teamShares: readonly TeamCountBreakdownEntry[] | undefined,
): TodayDestination | null {
  const personalShare = scopeShares.find((share) => share.id === 'mine');
  const teamShare = scopeShares.find((share) => share.id === 'team');
  const personalCount = personalShare?.count ?? 0;
  const teamCount = teamShare?.count ?? 0;

  if (personalCount >= teamCount) {
    return personalShare?.destination ?? null;
  }

  // The team half wins, so Open must name the team holding most of it — not leave the choice to
  // whichever profile happens to be active.
  const largestTeamShare = [...(teamShares ?? [])].sort((left, right) => right.count - left.count)[0];
  if (largestTeamShare) {
    return { ...TEAM_HYGIENE_DESTINATION, teamProfileId: largestTeamShare.teamProfileId };
  }
  return teamShare?.destination ?? null;
}

/** Builds a mixed-scope (my + team) category result, combining both source statuses. */
function buildMixedCategory(
  id: CategoryId,
  count: number,
  myStatus: CategoryStatus,
  teamStatus: CategoryStatus,
  myError: string | null,
  teamError: string | null,
  isPartial = false,
): CategoryResult {
  const status = combineStatuses(myStatus, teamStatus);
  return {
    id,
    status,
    count,
    errorMessage: status === 'error' ? (myError ?? teamError ?? undefined) : undefined,
    isPartial,
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
        // The ACTIVE team follows the live dashboard selection, so the card and the Hygiene tab
        // beside it audit the same issues; the others keep their saved scope, which is the only
        // scope they have. Reading every team from its persisted selection is why this card could
        // report 1 overdue where the team's own Hygiene page showed 2.
        scopeJql: buildTeamHygieneScopeJql(resolveTeamScanScope(
          {
            teamProfileId: teamProfile.id,
            scopeMode: teamProfile.scopeMode,
            selectedPiValue: teamProfile.selectedPiValue,
            selectedFixVersion: teamProfile.selectedFixVersion,
            selectedSprintId: teamProfile.selectedSprintId,
          },
          activeTeamProfileId,
          {
            scopeMode: sprintState.scopeMode,
            selectedPiValue: sprintState.selectedPiValue,
            selectedFixVersionName: sprintState.selectedFixVersionName,
            selectedSprintId: sprintState.selectedSprintId,
          },
        )),
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
    // The setup is loaded per fetch rather than cached: it decides both which fields to REQUEST and
    // which rules to apply, and a stale one would silently ask Jira for the wrong Target End field.
    loadHygieneEvaluationSetup(activeTeamProfileId)
      .then(async (setup) => {
        const searchOutcome = await fetchIssuesPaged<JiraIssue>(
          (startAt, pageSize) => jiraGet<JiraSearchResponse>(
            buildMyIssuesSearchPath(myIssuesAssigneeClause, setup.requestedFields, startAt, pageSize),
          ),
          { pageSize: MYSELF_PAGE_SIZE, ceiling: MYSELF_ISSUE_CEILING },
        );
        if (!isMounted) return;
        setMyIssuesResult({
          requestKey: myIssuesRequestKey,
          issues: searchOutcome.issues,
          errorMessage: null,
          isPartial: searchOutcome.isTruncated,
          hygieneContext: setup.evaluationContext,
        });
      })
      .catch((unknownError: unknown) => {
        if (!isMounted) return;
        setMyIssuesResult({
          requestKey: myIssuesRequestKey,
          issues: [],
          errorMessage: extractErrorMessage(unknownError),
          hygieneContext: null,
        });
      });

    return () => {
      isMounted = false;
    };
  }, [myIssuesRequestKey, myIssuesAssigneeClause, activeTeamProfileId]);

  // ── Untriaged fetch (independent source; own DSU "new" query) ──
  useEffect(() => {
    if (untriagedRequestKey === null) {
      return;
    }

    let isMounted = true;
    jiraGet<JiraSearchResponse>(buildUntriagedSearchPath(trimmedDsuProjectKey))
      .then((response) => {
        if (!isMounted) return;
        setUntriagedResult({ requestKey: untriagedRequestKey, issues: response.issues ?? [], errorMessage: null, hygieneContext: null });
      })
      .catch((unknownError: unknown) => {
        if (!isMounted) return;
        setUntriagedResult({ requestKey: untriagedRequestKey, issues: [], errorMessage: extractErrorMessage(unknownError), hygieneContext: null });
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
            isTruncated: scanOutcome.isTruncated,
            scopeJql: target.scopeJql,
          }))
          .catch((unknownError: unknown): TeamScanEntry => ({
            teamProfileId: target.teamProfileId,
            teamName: target.teamName,
            findings: [],
            errorMessage: extractErrorMessage(unknownError),
            scopeJql: target.scopeJql,
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
    // Personal cards are floors when the personal fetch could not read to the end; team cards are
    // floors when ANY team's scan hit its ceiling. Either way the card says so rather than passing
    // a short number off as the number.
    const isMyCountPartial = myIssuesResult.isPartial === true;
    const isAnyTeamScanPartial = teamScans.some((teamScan) => teamScan.isTruncated === true);
    const breakdownFor = (checkIds: readonly string[]): TeamCountBreakdownEntry[] | undefined =>
      teamScans.length > 1 ? buildTeamCountBreakdown(teamScans, checkIds) : undefined;
    // The team destination every per-team chip opens, with the same filter the count is built from.
    // Due/overdue is a my+team union deduped by key; the team half reads the scan findings so it
    // honours the same scope and enabled checks as each team's Hygiene tab.
    // Same context as the team half: same instance field ids, same enabled checks, same thresholds.
    // Before this the personal half passed only the stale threshold, so it read a hard-coded Target
    // End field and went on counting a rule the admin had switched off.
    const myHygieneContext: HygieneEvaluationContext =
      myIssuesResult.hygieneContext ?? { staleDaysThreshold };
    const myDueOverdueKeys = selectDueOverdue(myHygiene, [], myHygieneContext).map((issue) => issue.key);
    const teamDueOverdueKeys = isTeamHygieneConfigured
      ? selectFindingKeysAcrossTeams(teamScans, DUE_OVERDUE_CHECK_IDS)
      : [];
    const dueOverdueCount = new Set([...myDueOverdueKeys, ...teamDueOverdueKeys]).size;
    // Both halves named. "Mine" always has a link; the team half only gets one when there is a
    // single team it could mean — otherwise the per-team chips below carry it, because a team scan
    // is only ever as wide as that team's own saved scope, and two teams can audit very different
    // populations of the same project.
    const isSingleTeamScan = teamScanTargets.length === 1;
    const dueOverdueScopeBreakdown: CategoryScopeShare[] = [
      {
        id: 'mine',
        label: 'Mine',
        count: myDueOverdueKeys.length,
        destination: DESTINATIONS['due-overdue'],
      },
      {
        id: 'team',
        label: 'Team',
        count: teamDueOverdueKeys.length,
        destination: isSingleTeamScan
          ? { ...TEAM_HYGIENE_DESTINATION, teamProfileId: teamScanTargets[0].teamProfileId }
          : undefined,
        teamProfileId: isSingleTeamScan ? teamScanTargets[0].teamProfileId : undefined,
      },
    ];
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
        isMyCountPartial,
      ),
      'my-stale': {
        id: 'my-stale',
        status: myIssuesStatus,
        count: selectMyStale(myHygiene, staleDaysThreshold).length,
        errorMessage: myIssuesStatus === 'error' ? (myIssuesError ?? undefined) : undefined,
        isPartial: isMyCountPartial,
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
      'due-overdue': {
        ...buildMixedCategory(
          'due-overdue',
          dueOverdueCount,
          myIssuesStatus,
          dueOverdueTeamStatus,
          myIssuesError,
          dueOverdueTeamError,
          isMyCountPartial || isAnyTeamScanPartial,
        ),
        // Open leads to whichever share holds the most of the number on the card. It used to be
        // fixed to the personal view, which on a 26 made of 1 mine and 25 the team's opened the
        // one — and the twenty-five were reachable only by noticing a chip.
        destination: pickLargestShareDestination(dueOverdueScopeBreakdown, breakdownFor(DUE_OVERDUE_CHECK_IDS))
          ?? DESTINATIONS['due-overdue'],
        scopeBreakdown: dueOverdueScopeBreakdown,
        // The attribution this card was missing while every other team-fed card had it: which team
        // the count belongs to, and a way into that team's own Hygiene view.
        teamBreakdown: breakdownFor(DUE_OVERDUE_CHECK_IDS),
      },
      // Everything the other cards do not watch. Without it, five green ticks sat over a board
      // holding 41 hygiene flags — 27 missing Target Start alone — and Today read as "finished".
      'team-hygiene': buildTeamCategory(
        'team-hygiene',
        teamScans.reduce((flagTotal, teamScan) => flagTotal + countAllTeamHygieneFlags(teamScan.findings), 0),
        isTeamHygieneConfigured,
        teamScanStatus,
        teamScanErrorMessage,
        teamScans.length > 1 ? buildTeamFlagBreakdown(teamScans) : undefined,
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
    // The context the personal issues were fetched under travels with them, so both belong here.
    myIssuesResult.hygieneContext,
    myIssuesResult.isPartial,
    // Read when deciding whether the team half can name a single team to open.
    teamScanTargets,
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

  const teamNamesByProfileId = useMemo(
    () => Object.fromEntries(teamScanTargets.map((target) => [target.teamProfileId, target.teamName])),
    [teamScanTargets],
  );

  // ── The daily forecast ──
  //
  // Built from issues the scans above ALREADY returned, so it costs no extra Jira request. Today
  // has no board and therefore no column order, which means every item is charged at full size —
  // stated in the completeness record rather than left for a reader to infer, and conservative
  // rather than wrong.
  const forecast = useMemo<ForecastResult | null>(() => {
    const fieldConfig = myIssuesResult.hygieneContext?.fieldConfig;
    if (!fieldConfig) {
      return null;
    }

    const scannedIssues = [
      ...myIssuesResult.issues,
      ...teamScanResult.teamScans.flatMap((teamScan) => teamScan.findings.map((finding) => finding.issue)),
    ];
    // Deduped by key: a Scrum Master's own issues also appear in their team's scan, and counting one
    // issue twice would double its effort in every total it touches.
    const uniqueIssuesByKey = new Map(scannedIssues.map((issue) => [issue.key, issue]));

    const items = adaptHygieneIssues([...uniqueIssuesByKey.values()], {
      storyPointsFieldIds: resolveStoryPointsFieldIds(myIssuesResult.hygieneContext?.customStoryPointsFieldId ?? ''),
      subStatusFieldIds: fieldConfig.subStatusFieldIds ?? [],
      targetStartFieldIds: fieldConfig.targetStartFieldIds ?? [],
    });

    const artSettings = readArtSettings();
    const { config, rejectedSettings } = buildForecastConfig(readRawForecastSettings(), toCalendarDay(new Date()));
    const computed = computeForecast(
      {
        items,
        orderedColumnIds: [],
        // Only the versions this work is actually committed to: fetching the project's whole
        // version list would be a request Today does not currently make.
        fixVersions: collectFixVersionNames(items).map((versionName) => ({ name: versionName })),
        people: [],
        piEndDate: artSettings.piEndDate,
        // The active team's PI carries its window in the name, so the PI clock works here too
        // without anybody having filled in the ART setting.
        piName: sprintState.selectedPiValue,
        hasSubStatusField: (fieldConfig.subStatusFieldIds ?? []).length > 0,
        teamProfileId: activeTeamProfileId,
      },
      config,
    );
    // Carried through rather than dropped: a rate somebody set to zero has to be visible, or the
    // numbers cannot be reconciled with the settings screen.
    return { ...computed, rejectedSettings };
  }, [
    myIssuesResult.hygieneContext,
    myIssuesResult.issues,
    teamScanResult.teamScans,
    activeTeamProfileId,
    sprintState.selectedPiValue,
  ]);

  return {
    categories,
    isConnectionReady,
    refresh,
    sprintIssues: teamHygiene,
    sprintInfo: sprintState.sprintInfo,
    forecast,
    teamNamesByProfileId,
  };
}
