// useLocalStorage.test.ts — Unit tests for the generic localStorage-backed React hook.

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useLocalStorage } from './useLocalStorage.ts';

const STORAGE_KEY = 'phase-one-setting';
const DEFAULT_VALUE = 'default-value';
const STORED_VALUE = 'stored-value';
const UPDATED_VALUE = 'updated-value';
const MALFORMED_JSON_VALUE = 'not-json';

describe('useLocalStorage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reads the initial value from localStorage', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(STORED_VALUE));

    const { result } = renderHook(() => useLocalStorage<string>(STORAGE_KEY, DEFAULT_VALUE));

    expect(result.current[0]).toBe(STORED_VALUE);
  });

  it('writes updates to localStorage and React state', () => {
    const { result } = renderHook(() => useLocalStorage<string>(STORAGE_KEY, DEFAULT_VALUE));

    act(() => {
      result.current[1](UPDATED_VALUE);
    });

    expect(result.current[0]).toBe(UPDATED_VALUE);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(UPDATED_VALUE));
  });

  it('falls back to the default value when the key is missing', () => {
    const { result } = renderHook(() => useLocalStorage<string>(STORAGE_KEY, DEFAULT_VALUE));

    expect(result.current[0]).toBe(DEFAULT_VALUE);
  });

  it('falls back to the default value when JSON is malformed', () => {
    window.localStorage.setItem(STORAGE_KEY, MALFORMED_JSON_VALUE);

    const { result } = renderHook(() => useLocalStorage<string>(STORAGE_KEY, DEFAULT_VALUE));

    expect(result.current[0]).toBe(DEFAULT_VALUE);
  });
});
