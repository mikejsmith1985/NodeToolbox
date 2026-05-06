// useLocalStorage.ts — React hook that keeps component state synchronized with browser localStorage.

import { useCallback, useState } from 'react';

/**
 * Like useState, but persisted in localStorage under the given key.
 * Returns the stored value plus a setter that updates both React state and storage.
 */
export function useLocalStorage<StoredValue>(
  storageKey: string,
  defaultValue: StoredValue,
): [StoredValue, (value: StoredValue) => void] {
  const [storedValue, setStoredValue] = useState<StoredValue>(() => {
    try {
      const rawItem = window.localStorage.getItem(storageKey);
      return rawItem !== null ? (JSON.parse(rawItem) as StoredValue) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setValue = useCallback(
    (value: StoredValue) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
        // Storage access can fail in private mode, so the in-memory value remains the fallback source of truth.
      }
      setStoredValue(value);
    },
    [storageKey],
  );

  return [storedValue, setValue];
}
