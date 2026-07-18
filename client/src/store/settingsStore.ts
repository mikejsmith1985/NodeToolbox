// settingsStore.ts — Zustand store for browser settings persisted with legacy NodeToolbox localStorage keys.

import { create } from 'zustand';

import type { Theme } from '../types/config.ts';
import type { StatusMapping } from '../types/issueLinking.ts';

const DARK_THEME: Theme = 'dark';
const LIGHT_THEME: Theme = 'light';
const DEFAULT_TOOL_TEXT_SIZE = 'default';
const LARGE_TOOL_TEXT_SIZE = 'large';
const EXTRA_LARGE_TOOL_TEXT_SIZE = 'extra-large';
const DEFAULT_SNOW_HUB_TAB = 'crg';
const DEFAULT_TEXT_TOOLS_TAB = 'case';
const DEFAULT_SPRINT_DASHBOARD_ACTIVE_TAB = 'overview';
const EMPTY_STRING = '';
const EMPTY_STRING_LIST: string[] = [];
const MAX_RECENT_VIEW_COUNT = 5;
const TOOL_TEXT_SIZE_OPTIONS: readonly string[] = [
  DEFAULT_TOOL_TEXT_SIZE,
  LARGE_TOOL_TEXT_SIZE,
  EXTRA_LARGE_TOOL_TEXT_SIZE,
];

export const THEME_STORAGE_KEY = 'tbx-theme';
export const TOOL_TEXT_SIZE_STORAGE_KEY = 'tbxToolTextSize';
const CARD_ORDER_STORAGE_KEY = 'tbxCardOrder';
const CHANGE_REQUEST_GENERATOR_JIRA_URL_STORAGE_KEY = 'tbxCRGenJiraUrl';
const CHANGE_REQUEST_GENERATOR_SNOW_URL_STORAGE_KEY = 'tbxCRGenSnowUrl';
const CONFLUENCE_URL_STORAGE_KEY = 'tbxConfUrl';
const SNOW_HUB_TAB_STORAGE_KEY = 'tbxSnowHubTab';
const TEXT_TOOLS_TAB_STORAGE_KEY = 'tbxTextToolsTab';
// Last Agile Hub space (team | product | train) — the hub reopens where the user was (spec 020 FR-013).
const AGILE_HUB_LAST_SPACE_STORAGE_KEY = 'tbxAgileHubLastSpace';
const DEFAULT_AGILE_HUB_SPACE = 'team';
const DSU_PROJECT_KEY_STORAGE_KEY = 'tbxDSUProjKey';
const SPRINT_DASHBOARD_PROJECT_KEY_STORAGE_KEY = 'tbxSprintDashboardProjectKey';
const SPRINT_DASHBOARD_BOARD_ID_STORAGE_KEY = 'tbxSprintDashboardBoardId';
const SPRINT_DASHBOARD_ACTIVE_TAB_STORAGE_KEY = 'tbxSprintDashboardActiveTab';
const SPRINT_DASHBOARD_SCOPE_MODE_STORAGE_KEY = 'tbxSprintDashboardScopeMode';
const SPRINT_DASHBOARD_SELECTED_SPRINT_ID_STORAGE_KEY = 'tbxSprintDashboardSelectedSprintId';
const SPRINT_DASHBOARD_SELECTED_FIX_VERSION_STORAGE_KEY = 'tbxSprintDashboardSelectedFixVersion';
const SPRINT_DASHBOARD_SELECTED_PI_VALUE_STORAGE_KEY = 'tbxSprintDashboardSelectedPiValue';
const SPRINT_DASHBOARD_ACTIVE_TEAM_STORAGE_KEY = 'tbxSprintDashboardActiveTeam';
const SPRINT_DASHBOARD_TEAM_PROFILES_STORAGE_KEY = 'tbxSprintDashboardTeams';
const SPRINT_DASHBOARD_ACTIVE_TEAM_PROFILE_ID_STORAGE_KEY = 'tbxSprintDashboardActiveTeamProfileId';
const MY_ISSUES_JQL_STORAGE_KEY = 'tbxMIJql';
const MY_ISSUES_BOARD_ID_STORAGE_KEY = 'tbxMIBoardId';
const MY_ISSUES_JQL_HISTORY_STORAGE_KEY = 'tbxMIJqlHistory';
const RECENT_VIEWS_STORAGE_KEY = 'tbxRecentViews';
const STATUS_MAPPINGS_STORAGE_KEY = 'tbxStatusMappings';
const PERSONAL_TOOLBOX_MODULE_IDS_STORAGE_KEY = 'tbxPersonalToolboxModuleIds';

export type ToolTextSize =
  | typeof DEFAULT_TOOL_TEXT_SIZE
  | typeof LARGE_TOOL_TEXT_SIZE
  | typeof EXTRA_LARGE_TOOL_TEXT_SIZE;

/** One Program Increment ↔ Confluence page association for a team's PI Review workspace. */
export interface SprintDashboardPiReviewPage {
  piName: string;
  pageUrl: string;
}

export interface SprintDashboardTeamProfile {
  id: string;
  name: string;
  projectKey: string;
  boardId: string;
  boardName: string;
  boardType: string;
  scopeMode: string;
  selectedSprintId: string;
  selectedFixVersion: string;
  selectedPiValue: string;
  /**
   * Confluence PI Review pages for this team — one per Program Increment. This is the single
   * source of truth for a team's PI Review pages; the ART view reads them from here for display.
   * Optional so profiles saved before this feature (and hand-built literals) stay valid.
   */
  piReviewPages?: SprintDashboardPiReviewPage[];
}

const EMPTY_TEAM_PROFILE_LIST: SprintDashboardTeamProfile[] = [];

interface SprintDashboardLegacySelections {
  projectKey: string;
  boardId: string;
  scopeMode: string;
  selectedSprintId: string;
  selectedFixVersion: string;
  selectedPiValue: string;
}

interface SettingsState {
  theme: Theme;
  toolTextSize: ToolTextSize;
  cardOrder: string[];
  changeRequestGeneratorJiraUrl: string;
  changeRequestGeneratorSnowUrl: string;
  confluenceUrl: string;
  snowHubTab: string;
  textToolsTab: string;
  /** Last-used Agile Hub space; the hub falls back here when no ?space= param is present. */
  agileHubLastSpace: string;
  dsuProjectKey: string;
  sprintDashboardProjectKey: string;
  sprintDashboardBoardId: string;
  sprintDashboardActiveTab: string;
  sprintDashboardScopeMode: string;
  sprintDashboardSelectedSprintId: string;
  sprintDashboardSelectedFixVersion: string;
  sprintDashboardSelectedPiValue: string;
  sprintDashboardActiveTeam: string;
  sprintDashboardTeamProfiles: SprintDashboardTeamProfile[];
  sprintDashboardActiveTeamProfileId: string;
  /**
   * Increments whenever the live draft must be re-hydrated from a saved profile without the active
   * team id changing — specifically on a Revert. The dashboard hook watches this to reload cleanly.
   */
  sprintDashboardHydrationNonce: number;
  myIssuesJql: string;
  myIssuesBoardId: string;
  myIssuesJqlHistory: string[];
  recentViews: string[];
  /**
   * User-configured Jira status → SNow state equivalence mappings for the
   * My Issues health-check feature. Persisted so they survive app updates.
   * The system-defined "To Do → New" mapping is always applied in addition.
   */
  statusMappings: StatusMapping[];
  personalToolboxModuleIds: string[];
  setTheme: (theme: Theme) => void;
  setToolTextSize: (toolTextSize: ToolTextSize) => void;
  toggleTheme: () => void;
  setCardOrder: (cardOrder: string[]) => void;
  setChangeRequestGeneratorJiraUrl: (url: string) => void;
  setChangeRequestGeneratorSnowUrl: (url: string) => void;
  setConfluenceUrl: (url: string) => void;
  setSnowHubTab: (tab: string) => void;
  setTextToolsTab: (tab: string) => void;
  setAgileHubLastSpace: (space: string) => void;
  setDsuProjectKey: (projectKey: string) => void;
  setSprintDashboardProjectKey: (projectKey: string) => void;
  setSprintDashboardBoardId: (boardId: string) => void;
  setSprintDashboardActiveTab: (activeTab: string) => void;
  setSprintDashboardScopeMode: (scopeMode: string) => void;
  setSprintDashboardSelectedSprintId: (sprintId: string) => void;
  setSprintDashboardSelectedFixVersion: (fixVersionName: string) => void;
  setSprintDashboardSelectedPiValue: (piValue: string) => void;
  setSprintDashboardActiveTeam: (teamName: string) => void;
  setSprintDashboardTeamProfiles: (teamProfiles: SprintDashboardTeamProfile[]) => void;
  setSprintDashboardActiveTeamProfileId: (teamProfileId: string) => void;
  updateActiveSprintDashboardTeamProfile: (
    profileUpdates: Partial<Omit<SprintDashboardTeamProfile, 'id'>>,
  ) => void;
  /** Discards unsaved draft edits by re-hydrating the draft from the active saved profile. */
  revertActiveSprintDashboardTeamProfile: () => void;
  setMyIssuesJql: (jql: string) => void;
  setMyIssuesBoardId: (boardId: string) => void;
  setMyIssuesJqlHistory: (jqlHistory: string[]) => void;
  setRecentViews: (recentViews: string[]) => void;
  addRecentView: (viewId: string) => void;
  /** Replaces the full list of user-configured status mappings (system mapping preserved separately). */
  setStatusMappings: (mappings: StatusMapping[]) => void;
  setPersonalToolboxModuleIds: (moduleIds: string[]) => void;
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readStoredString(storageKey: string, fallbackValue: string): string {
  if (!canUseLocalStorage()) {
    return fallbackValue;
  }

  try {
    const storedValue = window.localStorage.getItem(storageKey);
    return storedValue ?? fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((arrayItem) => typeof arrayItem === 'string');
}

/** Normalizes a stored PI Review page list, dropping fully-empty rows. Blank-URL rows are kept so
 *  an in-progress entry (PI chosen, URL not yet pasted) is not silently lost on reload. */
function normalizeSprintDashboardPiReviewPages(pagesCandidate: unknown): SprintDashboardPiReviewPage[] {
  if (!Array.isArray(pagesCandidate)) {
    return [];
  }

  return pagesCandidate
    .map((pageCandidate) => {
      if (typeof pageCandidate !== 'object' || pageCandidate === null) {
        return null;
      }
      const pageRecord = pageCandidate as { piName?: unknown; pageUrl?: unknown };
      const pageUrl = typeof pageRecord.pageUrl === 'string' ? pageRecord.pageUrl.trim() : '';
      const piName = typeof pageRecord.piName === 'string' ? pageRecord.piName.trim() : '';
      if (pageUrl === '' && piName === '') {
        return null;
      }
      return { piName, pageUrl };
    })
    .filter((page): page is SprintDashboardPiReviewPage => page !== null);
}

function normalizeSprintDashboardTeamProfile(
  profileCandidate: Partial<SprintDashboardTeamProfile>,
): SprintDashboardTeamProfile | null {
  const profileId = typeof profileCandidate.id === 'string' ? profileCandidate.id.trim() : '';
  if (!profileId) {
    return null;
  }

  return {
    id: profileId,
    name: typeof profileCandidate.name === 'string' ? profileCandidate.name.trim() : '',
    projectKey:
      typeof profileCandidate.projectKey === 'string' ? profileCandidate.projectKey.trim() : '',
    boardId: typeof profileCandidate.boardId === 'string' ? profileCandidate.boardId.trim() : '',
    boardName: typeof profileCandidate.boardName === 'string' ? profileCandidate.boardName.trim() : '',
    boardType: typeof profileCandidate.boardType === 'string' ? profileCandidate.boardType.trim() : '',
    scopeMode:
      typeof profileCandidate.scopeMode === 'string'
        ? profileCandidate.scopeMode.trim()
        : 'sprint',
    selectedSprintId:
      typeof profileCandidate.selectedSprintId === 'string'
        ? profileCandidate.selectedSprintId.trim()
        : '',
    selectedFixVersion:
      typeof profileCandidate.selectedFixVersion === 'string'
        ? profileCandidate.selectedFixVersion.trim()
        : '',
    selectedPiValue:
      typeof profileCandidate.selectedPiValue === 'string'
        ? profileCandidate.selectedPiValue.trim()
        : '',
    piReviewPages: normalizeSprintDashboardPiReviewPages(profileCandidate.piReviewPages),
  };
}

function readSprintDashboardLegacySelections(): SprintDashboardLegacySelections {
  return {
    projectKey: readStoredString(SPRINT_DASHBOARD_PROJECT_KEY_STORAGE_KEY, EMPTY_STRING),
    boardId: readStoredString(SPRINT_DASHBOARD_BOARD_ID_STORAGE_KEY, EMPTY_STRING),
    scopeMode: readStoredString(SPRINT_DASHBOARD_SCOPE_MODE_STORAGE_KEY, 'sprint'),
    selectedSprintId: readStoredString(SPRINT_DASHBOARD_SELECTED_SPRINT_ID_STORAGE_KEY, EMPTY_STRING),
    selectedFixVersion: readStoredString(
      SPRINT_DASHBOARD_SELECTED_FIX_VERSION_STORAGE_KEY,
      EMPTY_STRING,
    ),
    selectedPiValue: readStoredString(SPRINT_DASHBOARD_SELECTED_PI_VALUE_STORAGE_KEY, EMPTY_STRING),
  };
}

function createMigratedSprintDashboardTeamProfile(
  legacySelections: SprintDashboardLegacySelections,
): SprintDashboardTeamProfile | null {
  const hasSavedTeamSelection =
    legacySelections.projectKey.trim() !== '' || legacySelections.boardId.trim() !== '';
  if (!hasSavedTeamSelection) {
    return null;
  }

  const fallbackTeamName =
    legacySelections.projectKey.trim() !== ''
      ? legacySelections.projectKey.trim().toUpperCase()
      : `Board ${legacySelections.boardId.trim()}`;
  return {
    id: `dashboard-team:${legacySelections.projectKey.trim().toUpperCase() || 'board'}:${legacySelections.boardId.trim() || 'saved'}`,
    name: fallbackTeamName,
    projectKey: legacySelections.projectKey.trim(),
    boardId: legacySelections.boardId.trim(),
    boardName: EMPTY_STRING,
    boardType: EMPTY_STRING,
    scopeMode: legacySelections.scopeMode.trim() || 'sprint',
    selectedSprintId: legacySelections.selectedSprintId.trim(),
    selectedFixVersion: legacySelections.selectedFixVersion.trim(),
    selectedPiValue: legacySelections.selectedPiValue.trim(),
  };
}

function readStoredSprintDashboardTeamProfiles(): SprintDashboardTeamProfile[] {
  if (!canUseLocalStorage()) {
    return EMPTY_TEAM_PROFILE_LIST;
  }

  try {
    const rawStoredValue = window.localStorage.getItem(
      SPRINT_DASHBOARD_TEAM_PROFILES_STORAGE_KEY,
    );
    if (rawStoredValue !== null) {
      const parsedValue: unknown = JSON.parse(rawStoredValue);
      if (Array.isArray(parsedValue)) {
        return parsedValue
          .map((profileCandidate) =>
            typeof profileCandidate === 'object' && profileCandidate !== null
              ? normalizeSprintDashboardTeamProfile(profileCandidate as Partial<SprintDashboardTeamProfile>)
              : null,
          )
          .filter((teamProfile): teamProfile is SprintDashboardTeamProfile => teamProfile !== null);
      }
    }
  } catch {
    return EMPTY_TEAM_PROFILE_LIST;
  }

  const migratedTeamProfile = createMigratedSprintDashboardTeamProfile(
    readSprintDashboardLegacySelections(),
  );
  return migratedTeamProfile === null ? EMPTY_TEAM_PROFILE_LIST : [migratedTeamProfile];
}

function writeStoredSprintDashboardTeamProfiles(
  teamProfiles: SprintDashboardTeamProfile[],
): void {
  writeStoredString(
    SPRINT_DASHBOARD_TEAM_PROFILES_STORAGE_KEY,
    JSON.stringify(teamProfiles),
  );
}

function readResolvedSprintDashboardTeamProfiles(): SprintDashboardTeamProfile[] {
  const storedTeamProfiles = readStoredSprintDashboardTeamProfiles();
  return storedTeamProfiles.length > 0 ? storedTeamProfiles : EMPTY_TEAM_PROFILE_LIST;
}

function readResolvedSprintDashboardActiveTeamProfileId(
  teamProfiles: SprintDashboardTeamProfile[],
): string {
  const storedProfileId = readStoredString(
    SPRINT_DASHBOARD_ACTIVE_TEAM_PROFILE_ID_STORAGE_KEY,
    EMPTY_STRING,
  ).trim();
  if (storedProfileId !== '' && teamProfiles.some((teamProfile) => teamProfile.id === storedProfileId)) {
    return storedProfileId;
  }

  return teamProfiles[0]?.id ?? EMPTY_STRING;
}

function writeSprintDashboardLegacySelections(
  teamProfile: SprintDashboardTeamProfile | null,
): void {
  writeStoredString(
    SPRINT_DASHBOARD_PROJECT_KEY_STORAGE_KEY,
    teamProfile?.projectKey ?? EMPTY_STRING,
  );
  writeStoredString(
    SPRINT_DASHBOARD_BOARD_ID_STORAGE_KEY,
    teamProfile?.boardId ?? EMPTY_STRING,
  );
  writeStoredString(
    SPRINT_DASHBOARD_SCOPE_MODE_STORAGE_KEY,
    teamProfile?.scopeMode || 'sprint',
  );
  writeStoredString(
    SPRINT_DASHBOARD_SELECTED_SPRINT_ID_STORAGE_KEY,
    teamProfile?.selectedSprintId ?? EMPTY_STRING,
  );
  writeStoredString(
    SPRINT_DASHBOARD_SELECTED_FIX_VERSION_STORAGE_KEY,
    teamProfile?.selectedFixVersion ?? EMPTY_STRING,
  );
  writeStoredString(
    SPRINT_DASHBOARD_SELECTED_PI_VALUE_STORAGE_KEY,
    teamProfile?.selectedPiValue ?? EMPTY_STRING,
  );
}

function readActiveSprintDashboardTeamProfile(
  currentState: Pick<
    SettingsState,
    | 'sprintDashboardActiveTeamProfileId'
    | 'sprintDashboardTeamProfiles'
  >,
): SprintDashboardTeamProfile | null {
  return (
    currentState.sprintDashboardTeamProfiles.find(
      (teamProfile) => teamProfile.id === currentState.sprintDashboardActiveTeamProfileId,
    ) ?? null
  );
}

function createSprintDashboardTeamStatePatch(
  teamProfiles: SprintDashboardTeamProfile[],
  activeTeamProfileId: string,
) {
  const activeTeamProfile =
    teamProfiles.find((teamProfile) => teamProfile.id === activeTeamProfileId) ?? null;
  writeStoredSprintDashboardTeamProfiles(teamProfiles);
  writeStoredString(
    SPRINT_DASHBOARD_ACTIVE_TEAM_PROFILE_ID_STORAGE_KEY,
    activeTeamProfile?.id ?? EMPTY_STRING,
  );
  writeSprintDashboardLegacySelections(activeTeamProfile);
  return {
    sprintDashboardTeamProfiles: teamProfiles,
    sprintDashboardActiveTeamProfileId: activeTeamProfile?.id ?? EMPTY_STRING,
    sprintDashboardProjectKey: activeTeamProfile?.projectKey ?? EMPTY_STRING,
    sprintDashboardBoardId: activeTeamProfile?.boardId ?? EMPTY_STRING,
    sprintDashboardScopeMode: activeTeamProfile?.scopeMode || 'sprint',
    sprintDashboardSelectedSprintId: activeTeamProfile?.selectedSprintId ?? EMPTY_STRING,
    sprintDashboardSelectedFixVersion: activeTeamProfile?.selectedFixVersion ?? EMPTY_STRING,
    sprintDashboardSelectedPiValue: activeTeamProfile?.selectedPiValue ?? EMPTY_STRING,
  };
}

function readStoredStringArray(storageKey: string): string[] {
  if (!canUseLocalStorage()) {
    return EMPTY_STRING_LIST;
  }

  try {
    const rawStoredValue = window.localStorage.getItem(storageKey);
    if (rawStoredValue === null) {
      return EMPTY_STRING_LIST;
    }

    const parsedValue: unknown = JSON.parse(rawStoredValue);
    return isStringArray(parsedValue) ? parsedValue : EMPTY_STRING_LIST;
  } catch {
    return EMPTY_STRING_LIST;
  }
}

/** Resolves the persisted theme preference and falls back to dark when storage is unavailable or invalid. */
export function resolveStoredTheme(): Theme {
  const storedTheme = readStoredString(THEME_STORAGE_KEY, DARK_THEME);
  return storedTheme === LIGHT_THEME ? LIGHT_THEME : DARK_THEME;
}

/** Resolves the persisted tool text size and falls back to the standard size when storage is unavailable or invalid. */
export function resolveStoredToolTextSize(): ToolTextSize {
  const storedToolTextSize = readStoredString(TOOL_TEXT_SIZE_STORAGE_KEY, DEFAULT_TOOL_TEXT_SIZE);
  return TOOL_TEXT_SIZE_OPTIONS.includes(storedToolTextSize)
    ? storedToolTextSize as ToolTextSize
    : DEFAULT_TOOL_TEXT_SIZE;
}

function buildRecentViews(viewId: string, currentRecentViews: string[]): string[] {
  const deduplicatedRecentViews = currentRecentViews.filter(
    (recentViewId) => recentViewId !== viewId,
  );
  return [viewId, ...deduplicatedRecentViews].slice(0, MAX_RECENT_VIEW_COUNT);
}

/**
 * Reads and validates the stored status mappings array from localStorage.
 * Returns an empty array on parse failure so the store starts in a safe state.
 */
function readStoredStatusMappings(): StatusMapping[] {
  if (!canUseLocalStorage()) {
    return [];
  }

  try {
    const rawStoredValue = window.localStorage.getItem(STATUS_MAPPINGS_STORAGE_KEY);
    if (rawStoredValue === null) {
      return [];
    }

    const parsedValue: unknown = JSON.parse(rawStoredValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }

    // Validate each entry has the required shape before trusting stored data.
    return parsedValue.filter(
      (entry): entry is StatusMapping =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as StatusMapping).jiraStatus === 'string' &&
        typeof (entry as StatusMapping).snowStatus === 'string',
    );
  } catch {
    return [];
  }
}

function writeStoredString(storageKey: string, value: string): void {
  if (!canUseLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // Storage access can be blocked in some browser modes, so the in-memory state remains authoritative.
  }
}

function writeStoredStringArray(storageKey: string, value: string[]): void {
  if (!canUseLocalStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Storage access can be blocked in some browser modes, so the in-memory state remains authoritative.
  }
}

const INITIAL_SPRINT_DASHBOARD_TEAM_PROFILES = readResolvedSprintDashboardTeamProfiles();
const INITIAL_SPRINT_DASHBOARD_ACTIVE_TEAM_PROFILE_ID =
  readResolvedSprintDashboardActiveTeamProfileId(INITIAL_SPRINT_DASHBOARD_TEAM_PROFILES);
const INITIAL_ACTIVE_SPRINT_DASHBOARD_TEAM_PROFILE =
  INITIAL_SPRINT_DASHBOARD_TEAM_PROFILES.find(
    (teamProfile) => teamProfile.id === INITIAL_SPRINT_DASHBOARD_ACTIVE_TEAM_PROFILE_ID,
  ) ?? null;

/** Zustand store for React SPA settings backed by legacy localStorage keys. */
export const useSettingsStore = create<SettingsState>((setState) => ({
  theme: resolveStoredTheme(),
  toolTextSize: resolveStoredToolTextSize(),
  cardOrder: readStoredStringArray(CARD_ORDER_STORAGE_KEY),
  changeRequestGeneratorJiraUrl: readStoredString(
    CHANGE_REQUEST_GENERATOR_JIRA_URL_STORAGE_KEY,
    EMPTY_STRING,
  ),
  changeRequestGeneratorSnowUrl: readStoredString(
    CHANGE_REQUEST_GENERATOR_SNOW_URL_STORAGE_KEY,
    EMPTY_STRING,
  ),
  confluenceUrl: readStoredString(CONFLUENCE_URL_STORAGE_KEY, EMPTY_STRING),
  snowHubTab: readStoredString(SNOW_HUB_TAB_STORAGE_KEY, DEFAULT_SNOW_HUB_TAB),
  textToolsTab: readStoredString(TEXT_TOOLS_TAB_STORAGE_KEY, DEFAULT_TEXT_TOOLS_TAB),
  agileHubLastSpace: readStoredString(AGILE_HUB_LAST_SPACE_STORAGE_KEY, DEFAULT_AGILE_HUB_SPACE),
  dsuProjectKey: readStoredString(DSU_PROJECT_KEY_STORAGE_KEY, EMPTY_STRING),
  sprintDashboardProjectKey:
    INITIAL_ACTIVE_SPRINT_DASHBOARD_TEAM_PROFILE?.projectKey ??
    readStoredString(SPRINT_DASHBOARD_PROJECT_KEY_STORAGE_KEY, EMPTY_STRING),
  sprintDashboardBoardId:
    INITIAL_ACTIVE_SPRINT_DASHBOARD_TEAM_PROFILE?.boardId ??
    readStoredString(SPRINT_DASHBOARD_BOARD_ID_STORAGE_KEY, EMPTY_STRING),
  sprintDashboardActiveTab: readStoredString(
    SPRINT_DASHBOARD_ACTIVE_TAB_STORAGE_KEY,
    DEFAULT_SPRINT_DASHBOARD_ACTIVE_TAB,
  ),
  sprintDashboardScopeMode:
    INITIAL_ACTIVE_SPRINT_DASHBOARD_TEAM_PROFILE?.scopeMode ??
    readStoredString(SPRINT_DASHBOARD_SCOPE_MODE_STORAGE_KEY, 'sprint'),
  sprintDashboardSelectedSprintId:
    INITIAL_ACTIVE_SPRINT_DASHBOARD_TEAM_PROFILE?.selectedSprintId ??
    readStoredString(SPRINT_DASHBOARD_SELECTED_SPRINT_ID_STORAGE_KEY, EMPTY_STRING),
  sprintDashboardSelectedFixVersion:
    INITIAL_ACTIVE_SPRINT_DASHBOARD_TEAM_PROFILE?.selectedFixVersion ??
    readStoredString(SPRINT_DASHBOARD_SELECTED_FIX_VERSION_STORAGE_KEY, EMPTY_STRING),
  sprintDashboardSelectedPiValue:
    INITIAL_ACTIVE_SPRINT_DASHBOARD_TEAM_PROFILE?.selectedPiValue ??
    readStoredString(SPRINT_DASHBOARD_SELECTED_PI_VALUE_STORAGE_KEY, EMPTY_STRING),
  sprintDashboardActiveTeam: readStoredString(SPRINT_DASHBOARD_ACTIVE_TEAM_STORAGE_KEY, EMPTY_STRING),
  sprintDashboardTeamProfiles: INITIAL_SPRINT_DASHBOARD_TEAM_PROFILES,
  sprintDashboardActiveTeamProfileId: INITIAL_SPRINT_DASHBOARD_ACTIVE_TEAM_PROFILE_ID,
  sprintDashboardHydrationNonce: 0,
  myIssuesJql: readStoredString(MY_ISSUES_JQL_STORAGE_KEY, EMPTY_STRING),
  myIssuesBoardId: readStoredString(MY_ISSUES_BOARD_ID_STORAGE_KEY, EMPTY_STRING),
  myIssuesJqlHistory: readStoredStringArray(MY_ISSUES_JQL_HISTORY_STORAGE_KEY),
  recentViews: readStoredStringArray(RECENT_VIEWS_STORAGE_KEY),
  setTheme: (theme) => {
    writeStoredString(THEME_STORAGE_KEY, theme);
    setState({ theme });
  },
  setToolTextSize: (toolTextSize) => {
    writeStoredString(TOOL_TEXT_SIZE_STORAGE_KEY, toolTextSize);
    setState({ toolTextSize });
  },
  toggleTheme: () =>
    setState((currentState) => {
      const nextTheme = currentState.theme === DARK_THEME ? LIGHT_THEME : DARK_THEME;
      writeStoredString(THEME_STORAGE_KEY, nextTheme);
      return { theme: nextTheme };
    }),
  setCardOrder: (cardOrder) => {
    writeStoredStringArray(CARD_ORDER_STORAGE_KEY, cardOrder);
    setState({ cardOrder });
  },
  setChangeRequestGeneratorJiraUrl: (url) => {
    writeStoredString(CHANGE_REQUEST_GENERATOR_JIRA_URL_STORAGE_KEY, url);
    setState({ changeRequestGeneratorJiraUrl: url });
  },
  setChangeRequestGeneratorSnowUrl: (url) => {
    writeStoredString(CHANGE_REQUEST_GENERATOR_SNOW_URL_STORAGE_KEY, url);
    setState({ changeRequestGeneratorSnowUrl: url });
  },
  setConfluenceUrl: (url) => {
    writeStoredString(CONFLUENCE_URL_STORAGE_KEY, url);
    setState({ confluenceUrl: url });
  },
  setSnowHubTab: (tab) => {
    writeStoredString(SNOW_HUB_TAB_STORAGE_KEY, tab);
    setState({ snowHubTab: tab });
  },
  setTextToolsTab: (tab) => {
    writeStoredString(TEXT_TOOLS_TAB_STORAGE_KEY, tab);
    setState({ textToolsTab: tab });
  },
  setAgileHubLastSpace: (space) => {
    writeStoredString(AGILE_HUB_LAST_SPACE_STORAGE_KEY, space);
    setState({ agileHubLastSpace: space });
  },
  setDsuProjectKey: (projectKey) => {
    writeStoredString(DSU_PROJECT_KEY_STORAGE_KEY, projectKey);
    setState({ dsuProjectKey: projectKey });
  },
  // ── Team Dashboard live-selection setters (draft-only) ──
  //
  // These write ONLY the working "draft" (the global selection keys). They deliberately do NOT
  // touch the saved team profile. Mirroring transient selections into the active profile is what
  // let one team's board silently overwrite another's; a profile now changes only on an explicit
  // save (updateActiveSprintDashboardTeamProfile) or a revert.
  setSprintDashboardProjectKey: (projectKey) => {
    writeStoredString(SPRINT_DASHBOARD_PROJECT_KEY_STORAGE_KEY, projectKey);
    setState({ sprintDashboardProjectKey: projectKey });
  },
  setSprintDashboardBoardId: (boardId) => {
    writeStoredString(SPRINT_DASHBOARD_BOARD_ID_STORAGE_KEY, boardId);
    setState({ sprintDashboardBoardId: boardId });
  },
  setSprintDashboardActiveTab: (activeTab) => {
    writeStoredString(SPRINT_DASHBOARD_ACTIVE_TAB_STORAGE_KEY, activeTab);
    setState({ sprintDashboardActiveTab: activeTab });
  },
  setSprintDashboardScopeMode: (scopeMode) => {
    writeStoredString(SPRINT_DASHBOARD_SCOPE_MODE_STORAGE_KEY, scopeMode);
    setState({ sprintDashboardScopeMode: scopeMode });
  },
  setSprintDashboardSelectedSprintId: (sprintId) => {
    writeStoredString(SPRINT_DASHBOARD_SELECTED_SPRINT_ID_STORAGE_KEY, sprintId);
    setState({ sprintDashboardSelectedSprintId: sprintId });
  },
  setSprintDashboardSelectedFixVersion: (fixVersionName) => {
    writeStoredString(SPRINT_DASHBOARD_SELECTED_FIX_VERSION_STORAGE_KEY, fixVersionName);
    setState({ sprintDashboardSelectedFixVersion: fixVersionName });
  },
  setSprintDashboardSelectedPiValue: (piValue) => {
    writeStoredString(SPRINT_DASHBOARD_SELECTED_PI_VALUE_STORAGE_KEY, piValue);
    setState({ sprintDashboardSelectedPiValue: piValue });
  },
  setSprintDashboardActiveTeam: (teamName) => {
    writeStoredString(SPRINT_DASHBOARD_ACTIVE_TEAM_STORAGE_KEY, teamName);
    setState({ sprintDashboardActiveTeam: teamName });
  },
  setSprintDashboardTeamProfiles: (teamProfiles) =>
    setState((currentState) => {
      const normalizedTeamProfiles = teamProfiles
        .map((teamProfile) => normalizeSprintDashboardTeamProfile(teamProfile))
        .filter((teamProfile): teamProfile is SprintDashboardTeamProfile => teamProfile !== null);
      const activeTeamProfileId = normalizedTeamProfiles.some(
        (teamProfile) => teamProfile.id === currentState.sprintDashboardActiveTeamProfileId,
      )
        ? currentState.sprintDashboardActiveTeamProfileId
        : normalizedTeamProfiles[0]?.id ?? EMPTY_STRING;
      return createSprintDashboardTeamStatePatch(normalizedTeamProfiles, activeTeamProfileId);
    }),
  setSprintDashboardActiveTeamProfileId: (teamProfileId) =>
    setState((currentState) =>
      createSprintDashboardTeamStatePatch(
        currentState.sprintDashboardTeamProfiles,
        teamProfileId.trim(),
      ),
    ),
  updateActiveSprintDashboardTeamProfile: (profileUpdates) =>
    setState((currentState) => {
      const activeTeamProfile = readActiveSprintDashboardTeamProfile(currentState);
      if (activeTeamProfile === null) {
        return {};
      }

      const normalizedTeamProfiles = currentState.sprintDashboardTeamProfiles.map((teamProfile) =>
        teamProfile.id === activeTeamProfile.id
          ? {
              ...teamProfile,
              ...profileUpdates,
              name: profileUpdates.name?.trim() ?? teamProfile.name,
              projectKey: profileUpdates.projectKey?.trim() ?? teamProfile.projectKey,
              boardId: profileUpdates.boardId?.trim() ?? teamProfile.boardId,
              boardName: profileUpdates.boardName?.trim() ?? teamProfile.boardName,
              boardType: profileUpdates.boardType?.trim() ?? teamProfile.boardType,
              scopeMode: profileUpdates.scopeMode?.trim() ?? teamProfile.scopeMode,
              selectedSprintId:
                profileUpdates.selectedSprintId?.trim() ?? teamProfile.selectedSprintId,
              selectedFixVersion:
                profileUpdates.selectedFixVersion?.trim() ?? teamProfile.selectedFixVersion,
              selectedPiValue:
                profileUpdates.selectedPiValue?.trim() ?? teamProfile.selectedPiValue,
              piReviewPages: profileUpdates.piReviewPages ?? teamProfile.piReviewPages,
            }
          : teamProfile,
      );
      return createSprintDashboardTeamStatePatch(
        normalizedTeamProfiles,
        currentState.sprintDashboardActiveTeamProfileId,
      );
    }),
  revertActiveSprintDashboardTeamProfile: () =>
    setState((currentState) => {
      // Rewrite the draft (global keys) back to the saved profile's values, discarding unsaved
      // edits, and bump the hydration nonce so the dashboard reloads from the restored draft.
      const draftPatch = createSprintDashboardTeamStatePatch(
        currentState.sprintDashboardTeamProfiles,
        currentState.sprintDashboardActiveTeamProfileId,
      );
      return {
        ...draftPatch,
        sprintDashboardHydrationNonce: currentState.sprintDashboardHydrationNonce + 1,
      };
    }),
  setMyIssuesJql: (jql) => {
    writeStoredString(MY_ISSUES_JQL_STORAGE_KEY, jql);
    setState({ myIssuesJql: jql });
  },
  setMyIssuesBoardId: (boardId) => {
    writeStoredString(MY_ISSUES_BOARD_ID_STORAGE_KEY, boardId);
    setState({ myIssuesBoardId: boardId });
  },
  setMyIssuesJqlHistory: (jqlHistory) => {
    writeStoredStringArray(MY_ISSUES_JQL_HISTORY_STORAGE_KEY, jqlHistory);
    setState({ myIssuesJqlHistory: jqlHistory });
  },
  setRecentViews: (recentViews) => {
    writeStoredStringArray(RECENT_VIEWS_STORAGE_KEY, recentViews);
    setState({ recentViews });
  },
  addRecentView: (viewId) =>
    setState((currentState) => {
      const recentViews = buildRecentViews(viewId, currentState.recentViews);
      writeStoredStringArray(RECENT_VIEWS_STORAGE_KEY, recentViews);
      return { recentViews };
    }),
  statusMappings: readStoredStatusMappings(),
  personalToolboxModuleIds: readStoredStringArray(PERSONAL_TOOLBOX_MODULE_IDS_STORAGE_KEY),
  setStatusMappings: (mappings) => {
    // Only persist user-defined mappings; system-defined ones are always re-applied at runtime.
    const userDefinedMappings = mappings.filter((mapping) => !mapping.isSystemDefined);
    try {
      window.localStorage.setItem(STATUS_MAPPINGS_STORAGE_KEY, JSON.stringify(userDefinedMappings));
    } catch {
      // Storage access can be blocked in some browser modes, so the in-memory state remains authoritative.
    }
    setState({ statusMappings: mappings });
  },
  setPersonalToolboxModuleIds: (moduleIds) => {
    writeStoredStringArray(PERSONAL_TOOLBOX_MODULE_IDS_STORAGE_KEY, moduleIds);
    setState({ personalToolboxModuleIds: moduleIds });
  },
}));
