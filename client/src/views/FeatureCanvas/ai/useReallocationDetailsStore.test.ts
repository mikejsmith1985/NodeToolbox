// useReallocationDetailsStore.test.ts — Verifies canvas-scoped persistence of the re-allocation constraints.

import { beforeEach, describe, expect, it } from 'vitest';

import { deriveScopeKey } from '../overlay/overlayStorage.ts';
import { useReallocationDetailsStore } from './useReallocationDetailsStore.ts';

const REALLOCATION_DETAILS_BASE_KEY = 'tbxReallocationDetails';

function readStore() {
  return useReallocationDetailsStore.getState();
}

describe('useReallocationDetailsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset the singleton back to an unscoped, empty state between tests.
    useReallocationDetailsStore.setState({ additionalDetails: '', storageKey: null });
  });

  it('persists the details for the active scope and reloads them on return', () => {
    readStore().setScope('team-a', 'DENP', 'pi-1');
    readStore().setAdditionalDetails('ESI only has two devs.');

    const expectedKey = `${REALLOCATION_DETAILS_BASE_KEY}:team-a:${deriveScopeKey('DENP', 'pi-1')}`;
    expect(localStorage.getItem(expectedKey)).toBe('ESI only has two devs.');

    // Switch away, then back — the value round-trips from storage.
    readStore().setScope('team-a', 'DENP', 'pi-2');
    expect(readStore().additionalDetails).toBe('');
    readStore().setScope('team-a', 'DENP', 'pi-1');
    expect(readStore().additionalDetails).toBe('ESI only has two devs.');
  });

  it('clears to empty by removing the persisted entry', () => {
    readStore().setScope('team-a', 'DENP', 'pi-1');
    readStore().setAdditionalDetails('temporary note');
    readStore().setAdditionalDetails('');

    const expectedKey = `${REALLOCATION_DETAILS_BASE_KEY}:team-a:${deriveScopeKey('DENP', 'pi-1')}`;
    expect(localStorage.getItem(expectedKey)).toBeNull();
    expect(readStore().additionalDetails).toBe('');
  });

  it('keys a different PI separately, so constraints never bleed across PIs', () => {
    readStore().setScope('team-a', 'DENP', 'pi-1');
    readStore().setAdditionalDetails('PI-1 constraint');

    readStore().setScope('team-a', 'DENP', 'pi-2');
    expect(readStore().additionalDetails).toBe('');
    readStore().setAdditionalDetails('PI-2 constraint');

    // Both entries coexist under distinct keys.
    expect(localStorage.getItem(`${REALLOCATION_DETAILS_BASE_KEY}:team-a:${deriveScopeKey('DENP', 'pi-1')}`)).toBe('PI-1 constraint');
    expect(localStorage.getItem(`${REALLOCATION_DETAILS_BASE_KEY}:team-a:${deriveScopeKey('DENP', 'pi-2')}`)).toBe('PI-2 constraint');
  });

  it('keys a different team separately, so constraints never bleed across teams', () => {
    readStore().setScope('team-a', 'DENP', 'pi-1');
    readStore().setAdditionalDetails('Team A constraint');

    readStore().setScope('team-b', 'DENP', 'pi-1');
    expect(readStore().additionalDetails).toBe('');
    readStore().setAdditionalDetails('Team B constraint');

    readStore().setScope('team-a', 'DENP', 'pi-1');
    expect(readStore().additionalDetails).toBe('Team A constraint');
  });
});
