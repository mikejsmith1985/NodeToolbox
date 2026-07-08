// useCapacityDetailsStore.test.ts — Verifies the persisted, canvas-scoped operator-constraints store.

import { beforeEach, describe, expect, it } from 'vitest';

import { useCapacityDetailsStore } from './useCapacityDetailsStore.ts';

describe('useCapacityDetailsStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useCapacityDetailsStore.setState({ additionalDetails: '', storageKey: null });
  });

  it('persists and reloads constraints for a given team + project + PI scope', () => {
    const store = useCapacityDetailsStore.getState();
    store.setScope('team-a', 'DENP', 'PI 26.3');
    store.setAdditionalDetails('DoD = internal test complete; DENP-1353 exclusive first.');

    // A fresh scope switch away and back reloads the same text from storage.
    useCapacityDetailsStore.getState().setScope('team-a', 'OTHER', 'PI 26.3');
    expect(useCapacityDetailsStore.getState().additionalDetails).toBe('');
    useCapacityDetailsStore.getState().setScope('team-a', 'DENP', 'PI 26.3');
    expect(useCapacityDetailsStore.getState().additionalDetails).toBe('DoD = internal test complete; DENP-1353 exclusive first.');
  });

  it('keys each team/PI scope separately (no cross-scope bleed) and clears to empty', () => {
    const store = useCapacityDetailsStore.getState();
    store.setScope('team-a', 'DENP', 'PI 26.3');
    store.setAdditionalDetails('constraint A');
    useCapacityDetailsStore.getState().setScope('team-b', 'DENP', 'PI 26.3');
    expect(useCapacityDetailsStore.getState().additionalDetails).toBe('');

    useCapacityDetailsStore.getState().setScope('team-a', 'DENP', 'PI 26.3');
    useCapacityDetailsStore.getState().setAdditionalDetails('');
    useCapacityDetailsStore.getState().setScope('team-a', 'DENP', 'PI 26.3');
    expect(useCapacityDetailsStore.getState().additionalDetails).toBe('');
  });
});
