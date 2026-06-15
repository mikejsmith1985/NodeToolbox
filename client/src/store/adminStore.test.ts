// Tests for the admin unlock store (initialisation + reactivity).

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('useAdminStore', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules(); // re-evaluate the module so init reads fresh sessionStorage
  });

  it('defaults isAdminUnlocked to false when no session flag is set', async () => {
    const { useAdminStore } = await import('./adminStore.ts');
    expect(useAdminStore.getState().isAdminUnlocked).toBe(false);
  });

  it('initialises isAdminUnlocked to true when the session flag is "1"', async () => {
    sessionStorage.setItem('tbxAdminUnlocked', '1');
    const { useAdminStore } = await import('./adminStore.ts');
    expect(useAdminStore.getState().isAdminUnlocked).toBe(true);
  });

  it('ignores any session value other than "1"', async () => {
    sessionStorage.setItem('tbxAdminUnlocked', 'true');
    const { useAdminStore } = await import('./adminStore.ts');
    expect(useAdminStore.getState().isAdminUnlocked).toBe(false);
  });

  it('reflects external setState updates', async () => {
    const { useAdminStore } = await import('./adminStore.ts');
    useAdminStore.setState({ isAdminUnlocked: true });
    expect(useAdminStore.getState().isAdminUnlocked).toBe(true);
  });
});
