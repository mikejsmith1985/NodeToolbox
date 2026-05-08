// useDashboardConfig.test.ts — Unit tests for the dashboard settings hook.

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_DASHBOARD_CONFIG,
  loadDashboardConfigFromStorage,
  saveDashboardConfigToStorage,
  useDashboardConfig,
} from './useDashboardConfig.ts';

const TEST_STORAGE_KEY = 'tbxSprintDashboardConfig';

describe('loadDashboardConfigFromStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns defaults when localStorage is empty', () => {
    const config = loadDashboardConfigFromStorage();
    expect(config).toEqual(DEFAULT_DASHBOARD_CONFIG);
  });

  it('merges stored values with defaults so missing fields are always present', () => {
    // Simulate a stored blob that only has staleDaysThreshold (legacy format)
    localStorage.setItem(TEST_STORAGE_KEY, JSON.stringify({ staleDaysThreshold: 10 }));
    const config = loadDashboardConfigFromStorage();

    expect(config.staleDaysThreshold).toBe(10);
    // Fields not in the stored blob fall back to defaults.
    expect(config.storyPointScale).toBe(DEFAULT_DASHBOARD_CONFIG.storyPointScale);
    expect(config.sprintWindow).toBe(DEFAULT_DASHBOARD_CONFIG.sprintWindow);
  });

  it('returns defaults when the stored value is malformed JSON', () => {
    localStorage.setItem(TEST_STORAGE_KEY, '{ broken json >>>');
    const config = loadDashboardConfigFromStorage();
    expect(config).toEqual(DEFAULT_DASHBOARD_CONFIG);
  });
});

describe('saveDashboardConfigToStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists the config blob so a subsequent load returns the same values', () => {
    const customConfig = { ...DEFAULT_DASHBOARD_CONFIG, staleDaysThreshold: 7, sprintWindow: 5 };
    saveDashboardConfigToStorage(customConfig);
    const reloaded = loadDashboardConfigFromStorage();
    expect(reloaded.staleDaysThreshold).toBe(7);
    expect(reloaded.sprintWindow).toBe(5);
  });
});

describe('useDashboardConfig', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('initialises with default config when localStorage is empty', () => {
    const { result } = renderHook(() => useDashboardConfig());
    expect(result.current.config).toEqual(DEFAULT_DASHBOARD_CONFIG);
  });

  it('reads saved config from localStorage on mount', () => {
    localStorage.setItem(TEST_STORAGE_KEY, JSON.stringify({ staleDaysThreshold: 14 }));
    const { result } = renderHook(() => useDashboardConfig());
    expect(result.current.config.staleDaysThreshold).toBe(14);
  });

  it('updateConfig applies a partial update and persists to localStorage', () => {
    const { result } = renderHook(() => useDashboardConfig());

    act(() => {
      result.current.actions.updateConfig({ staleDaysThreshold: 3 });
    });

    expect(result.current.config.staleDaysThreshold).toBe(3);
    // Other fields must remain at their defaults.
    expect(result.current.config.storyPointScale).toBe(DEFAULT_DASHBOARD_CONFIG.storyPointScale);
    // Verify persistence.
    expect(loadDashboardConfigFromStorage().staleDaysThreshold).toBe(3);
  });

  it('updateConfig can update multiple fields at once', () => {
    const { result } = renderHook(() => useDashboardConfig());

    act(() => {
      result.current.actions.updateConfig({ sprintWindow: 6, kanbanPeriodDays: 30 });
    });

    expect(result.current.config.sprintWindow).toBe(6);
    expect(result.current.config.kanbanPeriodDays).toBe(30);
  });

  it('resetConfig restores all defaults and persists them', () => {
    const { result } = renderHook(() => useDashboardConfig());

    act(() => {
      result.current.actions.updateConfig({ staleDaysThreshold: 99, sprintWindow: 10 });
    });
    act(() => {
      result.current.actions.resetConfig();
    });

    expect(result.current.config).toEqual(DEFAULT_DASHBOARD_CONFIG);
    expect(loadDashboardConfigFromStorage()).toEqual(DEFAULT_DASHBOARD_CONFIG);
  });

  it('returns stable action references across re-renders', () => {
    const { result, rerender } = renderHook(() => useDashboardConfig());
    const firstUpdateConfig = result.current.actions.updateConfig;
    const firstResetConfig = result.current.actions.resetConfig;

    rerender();

    expect(result.current.actions.updateConfig).toBe(firstUpdateConfig);
    expect(result.current.actions.resetConfig).toBe(firstResetConfig);
  });
});
