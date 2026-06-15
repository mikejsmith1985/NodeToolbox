// Tests for the Rovo capability unlock store (shared, sessionStorage-backed).

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('rovoStore', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules(); // re-evaluate the module so init reads fresh sessionStorage
  });

  it('defaults isRovoUnlocked to false when no session flag is set', async () => {
    const { useRovoStore } = await import('./rovoStore.ts');
    expect(useRovoStore.getState().isRovoUnlocked).toBe(false);
  });

  it('initialises isRovoUnlocked to true when the session flag is "1"', async () => {
    sessionStorage.setItem('tbxRovoUnlocked', '1');
    const { useRovoStore } = await import('./rovoStore.ts');
    expect(useRovoStore.getState().isRovoUnlocked).toBe(true);
  });

  it('ignores any session value other than "1"', async () => {
    sessionStorage.setItem('tbxRovoUnlocked', 'true');
    const { useRovoStore } = await import('./rovoStore.ts');
    expect(useRovoStore.getState().isRovoUnlocked).toBe(false);
  });

  it('setRovoUnlocked(true) updates state and persists to sessionStorage', async () => {
    const { useRovoStore, setRovoUnlocked } = await import('./rovoStore.ts');
    setRovoUnlocked(true);
    expect(useRovoStore.getState().isRovoUnlocked).toBe(true);
    expect(sessionStorage.getItem('tbxRovoUnlocked')).toBe('1');
  });

  it('setRovoUnlocked(false) clears state and the session flag', async () => {
    sessionStorage.setItem('tbxRovoUnlocked', '1');
    const { useRovoStore, setRovoUnlocked } = await import('./rovoStore.ts');
    setRovoUnlocked(false);
    expect(useRovoStore.getState().isRovoUnlocked).toBe(false);
    expect(sessionStorage.getItem('tbxRovoUnlocked')).toBeNull();
  });
});
