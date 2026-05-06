// settingsStore.ts — Zustand store for browser settings persisted with legacy NodeToolbox localStorage keys.

import { create } from 'zustand';

import type { Theme } from '../types/config.ts';

const DARK_THEME: Theme = 'dark';
const LIGHT_THEME: Theme = 'light';
const DEFAULT_HOME_PERSONA = 'all';
const DEFAULT_SNOW_HUB_TAB = 'crg';
const DEFAULT_TEXT_TOOLS_TAB = 'case';
const EMPTY_STRING = '';
const EMPTY_STRING_LIST: string[] = [];

const THEME_STORAGE_KEY = 'tbx-theme';
const HOME_PERSONA_STORAGE_KEY = 'tbxHomePersona';
const CARD_ORDER_STORAGE_KEY = 'tbxCardOrder';
const CHANGE_REQUEST_GENERATOR_JIRA_URL_STORAGE_KEY = 'tbxCRGenJiraUrl';
const CHANGE_REQUEST_GENERATOR_SNOW_URL_STORAGE_KEY = 'tbxCRGenSnowUrl';
const CONFLUENCE_URL_STORAGE_KEY = 'tbxConfUrl';
const SNOW_HUB_TAB_STORAGE_KEY = 'tbxSnowHubTab';
const TEXT_TOOLS_TAB_STORAGE_KEY = 'tbxTextToolsTab';
const DSU_PROJECT_KEY_STORAGE_KEY = 'tbxDSUProjKey';
const MY_ISSUES_JQL_STORAGE_KEY = 'tbxMIJql';
const MY_ISSUES_BOARD_ID_STORAGE_KEY = 'tbxMIBoardId';
const MY_ISSUES_JQL_HISTORY_STORAGE_KEY = 'tbxMIJqlHistory';
const RECENT_VIEWS_STORAGE_KEY = 'tbxRecentViews';

interface SettingsState {
  theme: Theme;
  homePersona: string;
  cardOrder: string[];
  changeRequestGeneratorJiraUrl: string;
  changeRequestGeneratorSnowUrl: string;
  confluenceUrl: string;
  snowHubTab: string;
  textToolsTab: string;
  dsuProjectKey: string;
  myIssuesJql: string;
  myIssuesBoardId: string;
  myIssuesJqlHistory: string[];
  recentViews: string[];
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setHomePersona: (homePersona: string) => void;
  setCardOrder: (cardOrder: string[]) => void;
  setChangeRequestGeneratorJiraUrl: (url: string) => void;
  setChangeRequestGeneratorSnowUrl: (url: string) => void;
  setConfluenceUrl: (url: string) => void;
  setSnowHubTab: (tab: string) => void;
  setTextToolsTab: (tab: string) => void;
  setDsuProjectKey: (projectKey: string) => void;
  setMyIssuesJql: (jql: string) => void;
  setMyIssuesBoardId: (boardId: string) => void;
  setMyIssuesJqlHistory: (jqlHistory: string[]) => void;
  setRecentViews: (recentViews: string[]) => void;
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

function readStoredTheme(): Theme {
  const storedTheme = readStoredString(THEME_STORAGE_KEY, DARK_THEME);
  return storedTheme === LIGHT_THEME ? LIGHT_THEME : DARK_THEME;
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

/** Zustand store for React SPA settings backed by legacy localStorage keys. */
export const useSettingsStore = create<SettingsState>((setState) => ({
  theme: readStoredTheme(),
  homePersona: readStoredString(HOME_PERSONA_STORAGE_KEY, DEFAULT_HOME_PERSONA),
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
  dsuProjectKey: readStoredString(DSU_PROJECT_KEY_STORAGE_KEY, EMPTY_STRING),
  myIssuesJql: readStoredString(MY_ISSUES_JQL_STORAGE_KEY, EMPTY_STRING),
  myIssuesBoardId: readStoredString(MY_ISSUES_BOARD_ID_STORAGE_KEY, EMPTY_STRING),
  myIssuesJqlHistory: readStoredStringArray(MY_ISSUES_JQL_HISTORY_STORAGE_KEY),
  recentViews: readStoredStringArray(RECENT_VIEWS_STORAGE_KEY),
  setTheme: (theme) => {
    writeStoredString(THEME_STORAGE_KEY, theme);
    setState({ theme });
  },
  toggleTheme: () =>
    setState((currentState) => {
      const nextTheme = currentState.theme === DARK_THEME ? LIGHT_THEME : DARK_THEME;
      writeStoredString(THEME_STORAGE_KEY, nextTheme);
      return { theme: nextTheme };
    }),
  setHomePersona: (homePersona) => {
    writeStoredString(HOME_PERSONA_STORAGE_KEY, homePersona);
    setState({ homePersona });
  },
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
  setDsuProjectKey: (projectKey) => {
    writeStoredString(DSU_PROJECT_KEY_STORAGE_KEY, projectKey);
    setState({ dsuProjectKey: projectKey });
  },
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
}));
