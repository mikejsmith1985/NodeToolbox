// quickLookupStore.test.ts — Unit tests for the app-wide Quick Issue Lookup open/close store.
//
// The store lets any surface (e.g. a linked-issue button in IssueDetailPanel) open the F2 popup
// seeded with a key. These tests pin the exact state transitions of open(), open(key), and close().

import { beforeEach, describe, expect, it } from 'vitest';

import { useQuickLookupStore } from './quickLookupStore.ts';

describe('useQuickLookupStore', () => {
  // Reset to the closed baseline before each test so nonce/seed assertions are deterministic.
  beforeEach(() => {
    useQuickLookupStore.setState({ isOpen: false, seedKey: null, openNonce: 0 });
  });

  it('starts closed with no seed and a zero nonce', () => {
    const state = useQuickLookupStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.seedKey).toBeNull();
    expect(state.openNonce).toBe(0);
  });

  it('open() with no key opens with a null seed and bumps the nonce', () => {
    useQuickLookupStore.getState().open();

    const state = useQuickLookupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.seedKey).toBeNull();
    expect(state.openNonce).toBe(1);
  });

  it("open('ABC-1') opens seeded with the key and bumps the nonce", () => {
    useQuickLookupStore.getState().open('ABC-1');

    const state = useQuickLookupStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.seedKey).toBe('ABC-1');
    expect(state.openNonce).toBe(1);
  });

  it('bumps the nonce again on a second open so the popup remounts', () => {
    useQuickLookupStore.getState().open('ABC-1');
    useQuickLookupStore.getState().open('DEF-2');

    const state = useQuickLookupStore.getState();
    expect(state.openNonce).toBe(2);
    expect(state.seedKey).toBe('DEF-2');
  });

  it('close() clears open state and the seed but leaves the nonce intact', () => {
    useQuickLookupStore.getState().open('ABC-1');
    useQuickLookupStore.getState().close();

    const state = useQuickLookupStore.getState();
    expect(state.isOpen).toBe(false);
    expect(state.seedKey).toBeNull();
    expect(state.openNonce).toBe(1);
  });
});
