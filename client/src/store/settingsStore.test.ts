// settingsStore.test.ts — Unit tests for the localStorage-backed settings Zustand store.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const THEME_STORAGE_KEY = 'tbx-theme';
const HOME_PERSONA_STORAGE_KEY = 'tbxHomePersona';
const CARD_ORDER_STORAGE_KEY = 'tbxCardOrder';
const RECENT_VIEWS_STORAGE_KEY = 'tbxRecentViews';

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
    window.localStorage.setItem(HOME_PERSONA_STORAGE_KEY, 'jira');
    window.localStorage.setItem(CARD_ORDER_STORAGE_KEY, JSON.stringify(['settings', 'home']));

    const { useSettingsStore } = await loadSettingsStoreModule();
    const settingsState = useSettingsStore.getState();

    expect(settingsState.theme).toBe('light');
    expect(settingsState.homePersona).toBe('jira');
    expect(settingsState.cardOrder).toEqual(['settings', 'home']);
  });

  it('writes setter updates back to localStorage and state', async () => {
    const { useSettingsStore } = await loadSettingsStoreModule();

    useSettingsStore.getState().setHomePersona('snow');
    useSettingsStore.getState().setCardOrder(['snow-hub', 'reports-hub']);

    expect(useSettingsStore.getState().homePersona).toBe('snow');
    expect(useSettingsStore.getState().cardOrder).toEqual(['snow-hub', 'reports-hub']);
    expect(window.localStorage.getItem(HOME_PERSONA_STORAGE_KEY)).toBe('snow');
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
});
