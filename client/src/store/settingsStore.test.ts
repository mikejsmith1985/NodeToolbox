// settingsStore.test.ts — Unit tests for the localStorage-backed settings Zustand store.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const THEME_STORAGE_KEY = 'tbx-theme';
const TOOL_TEXT_SIZE_STORAGE_KEY = 'tbxToolTextSize';
const CARD_ORDER_STORAGE_KEY = 'tbxCardOrder';
const RECENT_VIEWS_STORAGE_KEY = 'tbxRecentViews';
const PERSONAL_TOOLBOX_MODULE_IDS_STORAGE_KEY = 'tbxPersonalToolboxModuleIds';
const SPRINT_DASHBOARD_PROJECT_KEY_STORAGE_KEY = 'tbxSprintDashboardProjectKey';
const SPRINT_DASHBOARD_BOARD_ID_STORAGE_KEY = 'tbxSprintDashboardBoardId';
const SPRINT_DASHBOARD_ACTIVE_TAB_STORAGE_KEY = 'tbxSprintDashboardActiveTab';
const SPRINT_DASHBOARD_SCOPE_MODE_STORAGE_KEY = 'tbxSprintDashboardScopeMode';
const SPRINT_DASHBOARD_SELECTED_SPRINT_ID_STORAGE_KEY = 'tbxSprintDashboardSelectedSprintId';
const SPRINT_DASHBOARD_SELECTED_FIX_VERSION_STORAGE_KEY = 'tbxSprintDashboardSelectedFixVersion';
const SPRINT_DASHBOARD_SELECTED_PI_VALUE_STORAGE_KEY = 'tbxSprintDashboardSelectedPiValue';
const SPRINT_DASHBOARD_ACTIVE_TEAM_STORAGE_KEY = 'tbxSprintDashboardActiveTeam';

async function loadSettingsStoreModule() {
  vi.resetModules();
  return import('./settingsStore.ts');
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('useSettingsStore', () => {
  it('reads initial state from localStorage', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    window.localStorage.setItem(TOOL_TEXT_SIZE_STORAGE_KEY, 'large');
    window.localStorage.setItem(CARD_ORDER_STORAGE_KEY, JSON.stringify(['settings', 'home']));

    const { useSettingsStore } = await loadSettingsStoreModule();
    const settingsState = useSettingsStore.getState();

    expect(settingsState.theme).toBe('light');
    expect(settingsState.toolTextSize).toBe('large');
    expect(settingsState.cardOrder).toEqual(['settings', 'home']);
  });

  it('writes setter updates back to localStorage and state', async () => {
    const { useSettingsStore } = await loadSettingsStoreModule();

    useSettingsStore.getState().setCardOrder(['snow-hub', 'reports-hub']);

    expect(useSettingsStore.getState().cardOrder).toEqual(['snow-hub', 'reports-hub']);
    expect(window.localStorage.getItem(CARD_ORDER_STORAGE_KEY)).toBe(
      JSON.stringify(['snow-hub', 'reports-hub']),
    );
  });

  it('toggles theme and persists the updated value', async () => {
    const { useSettingsStore } = await loadSettingsStoreModule();

    useSettingsStore.getState().toggleTheme();

    expect(useSettingsStore.getState().theme).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  });

  it('persists tool text size changes back to localStorage and state', async () => {
    const { useSettingsStore } = await loadSettingsStoreModule();

    useSettingsStore.getState().setToolTextSize('extra-large');

    expect(useSettingsStore.getState().toolTextSize).toBe('extra-large');
    expect(window.localStorage.getItem(TOOL_TEXT_SIZE_STORAGE_KEY)).toBe('extra-large');
  });

  it('resolves the stored theme safely before React mounts', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');

    const { resolveStoredTheme } = await loadSettingsStoreModule();

    expect(resolveStoredTheme()).toBe('light');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'unexpected');
    expect(resolveStoredTheme()).toBe('dark');
  });

  it('adds a recent view, keeps it unique, and limits the list to five items', async () => {
    const { useSettingsStore } = await loadSettingsStoreModule();

    useSettingsStore.setState({
      recentViews: ['reports-hub', 'snow-hub', 'text-tools', 'admin-hub', 'code-walkthrough'],
    });

    useSettingsStore.getState().addRecentView('snow-hub');
    useSettingsStore.getState().addRecentView('dev-workspace');

    expect(useSettingsStore.getState().recentViews).toEqual([
      'dev-workspace',
      'snow-hub',
      'reports-hub',
      'text-tools',
      'admin-hub',
    ]);
    expect(window.localStorage.getItem(RECENT_VIEWS_STORAGE_KEY)).toBe(
      JSON.stringify(['dev-workspace', 'snow-hub', 'reports-hub', 'text-tools', 'admin-hub']),
    );
  });

  it('stores selected personal toolbox modules and persists them', async () => {
    const { useSettingsStore } = await loadSettingsStoreModule();

    useSettingsStore
      .getState()
      .setPersonalToolboxModuleIds(['my-issues', 'dev-workspace', 'reports-hub']);

    expect(useSettingsStore.getState().personalToolboxModuleIds).toEqual([
      'my-issues',
      'dev-workspace',
      'reports-hub',
    ]);
    expect(window.localStorage.getItem(PERSONAL_TOOLBOX_MODULE_IDS_STORAGE_KEY)).toBe(
      JSON.stringify(['my-issues', 'dev-workspace', 'reports-hub']),
    );
  });

  it('restores Sprint Dashboard selections from localStorage', async () => {
    window.localStorage.setItem(SPRINT_DASHBOARD_PROJECT_KEY_STORAGE_KEY, 'TBX');
    window.localStorage.setItem(SPRINT_DASHBOARD_BOARD_ID_STORAGE_KEY, '42');
    window.localStorage.setItem(SPRINT_DASHBOARD_ACTIVE_TAB_STORAGE_KEY, 'standup');
    window.localStorage.setItem(SPRINT_DASHBOARD_SCOPE_MODE_STORAGE_KEY, 'fixVersion');
    window.localStorage.setItem(SPRINT_DASHBOARD_SELECTED_SPRINT_ID_STORAGE_KEY, '12');
    window.localStorage.setItem(SPRINT_DASHBOARD_SELECTED_FIX_VERSION_STORAGE_KEY, 'Release 24.1');
    window.localStorage.setItem(SPRINT_DASHBOARD_SELECTED_PI_VALUE_STORAGE_KEY, 'PI-24.1');
    window.localStorage.setItem(SPRINT_DASHBOARD_ACTIVE_TEAM_STORAGE_KEY, 'Transformers');

    const { useSettingsStore } = await loadSettingsStoreModule();
    const settingsState = useSettingsStore.getState();

    expect(settingsState.sprintDashboardProjectKey).toBe('TBX');
    expect(settingsState.sprintDashboardBoardId).toBe('42');
    expect(settingsState.sprintDashboardActiveTab).toBe('standup');
    expect(settingsState.sprintDashboardScopeMode).toBe('fixVersion');
    expect(settingsState.sprintDashboardSelectedSprintId).toBe('12');
    expect(settingsState.sprintDashboardSelectedFixVersion).toBe('Release 24.1');
    expect(settingsState.sprintDashboardSelectedPiValue).toBe('PI-24.1');
    expect(settingsState.sprintDashboardActiveTeam).toBe('Transformers');
  });

  it('persists Sprint Dashboard setters back to localStorage', async () => {
    const { useSettingsStore } = await loadSettingsStoreModule();

    useSettingsStore.getState().setSprintDashboardProjectKey('ENFCT');
    useSettingsStore.getState().setSprintDashboardBoardId('77');
    useSettingsStore.getState().setSprintDashboardActiveTab('capacity');
    useSettingsStore.getState().setSprintDashboardScopeMode('pi');
    useSettingsStore.getState().setSprintDashboardSelectedSprintId('19');
    useSettingsStore.getState().setSprintDashboardSelectedFixVersion('Release 25.1');
    useSettingsStore.getState().setSprintDashboardSelectedPiValue('PI-25.1');
    useSettingsStore.getState().setSprintDashboardActiveTeam('Clean Up Crew');

    expect(window.localStorage.getItem(SPRINT_DASHBOARD_PROJECT_KEY_STORAGE_KEY)).toBe('ENFCT');
    expect(window.localStorage.getItem(SPRINT_DASHBOARD_BOARD_ID_STORAGE_KEY)).toBe('77');
    expect(window.localStorage.getItem(SPRINT_DASHBOARD_ACTIVE_TAB_STORAGE_KEY)).toBe('capacity');
    expect(window.localStorage.getItem(SPRINT_DASHBOARD_SCOPE_MODE_STORAGE_KEY)).toBe('pi');
    expect(window.localStorage.getItem(SPRINT_DASHBOARD_SELECTED_SPRINT_ID_STORAGE_KEY)).toBe('19');
    expect(window.localStorage.getItem(SPRINT_DASHBOARD_SELECTED_FIX_VERSION_STORAGE_KEY)).toBe('Release 25.1');
    expect(window.localStorage.getItem(SPRINT_DASHBOARD_SELECTED_PI_VALUE_STORAGE_KEY)).toBe('PI-25.1');
    expect(window.localStorage.getItem(SPRINT_DASHBOARD_ACTIVE_TEAM_STORAGE_KEY)).toBe('Clean Up Crew');
  });
});
