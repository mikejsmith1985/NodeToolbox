// toolVisibilityStore.test.ts — Unit tests for the shared per-tool home visibility store.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  reloadToolVisibilityFromStorage,
  resolveToolIsVisible,
  setToolVisibility,
  TOOL_VISIBILITY_STORAGE_KEY,
  useToolVisibilityStore,
} from './toolVisibilityStore.ts';

beforeEach(() => {
  window.localStorage.clear();
  useToolVisibilityStore.setState({ visibilityByCardId: {} });
});

describe('toolVisibilityStore', () => {
  it('treats every tool as visible until explicitly hidden', () => {
    expect(resolveToolIsVisible({}, 'text-tools')).toBe(true);
    expect(resolveToolIsVisible({ 'text-tools': true }, 'text-tools')).toBe(true);
    expect(resolveToolIsVisible({ 'text-tools': false }, 'text-tools')).toBe(false);
  });

  it('pins admin-hub visible regardless of the stored map, and refuses to hide it', () => {
    expect(resolveToolIsVisible({ 'admin-hub': false }, 'admin-hub')).toBe(true);

    setToolVisibility('admin-hub', false);

    expect(useToolVisibilityStore.getState().visibilityByCardId['admin-hub']).toBeUndefined();
    expect(window.localStorage.getItem(TOOL_VISIBILITY_STORAGE_KEY)).toBeNull();
  });

  it('persists changes to the existing tbxToolVisibility key and updates subscribers synchronously', () => {
    setToolVisibility('snow-hub', false);

    expect(useToolVisibilityStore.getState().visibilityByCardId['snow-hub']).toBe(false);
    const persistedMap = JSON.parse(window.localStorage.getItem(TOOL_VISIBILITY_STORAGE_KEY) ?? '{}');
    expect(persistedMap['snow-hub']).toBe(false);

    setToolVisibility('snow-hub', true);
    expect(useToolVisibilityStore.getState().visibilityByCardId['snow-hub']).toBe(true);
  });

  it('loads a map persisted by the previous Admin Hub implementation (same key, same shape)', () => {
    window.localStorage.setItem(TOOL_VISIBILITY_STORAGE_KEY, JSON.stringify({ 'text-tools': false }));

    reloadToolVisibilityFromStorage();

    expect(resolveToolIsVisible(useToolVisibilityStore.getState().visibilityByCardId, 'text-tools')).toBe(false);
  });

  it('degrades corrupt storage to everything-visible without throwing', () => {
    window.localStorage.setItem(TOOL_VISIBILITY_STORAGE_KEY, '{not json');

    expect(() => reloadToolVisibilityFromStorage()).not.toThrow();
    expect(useToolVisibilityStore.getState().visibilityByCardId).toEqual({});
  });
});
