// Tests for the AI Assist capability unlock store (shared, sessionStorage-backed).

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('aiAssistStore', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.resetModules(); // re-evaluate the module so init reads fresh sessionStorage
  });

  it('defaults isAiAssistUnlocked to false when no session flag is set', async () => {
    const { useAiAssistStore } = await import('./aiAssistStore.ts');
    expect(useAiAssistStore.getState().isAiAssistUnlocked).toBe(false);
  });

  it('initialises isAiAssistUnlocked to true when the session flag is "1"', async () => {
    sessionStorage.setItem('tbxAiAssistUnlocked', '1');
    const { useAiAssistStore } = await import('./aiAssistStore.ts');
    expect(useAiAssistStore.getState().isAiAssistUnlocked).toBe(true);
  });

  it('ignores any session value other than "1"', async () => {
    sessionStorage.setItem('tbxAiAssistUnlocked', 'true');
    const { useAiAssistStore } = await import('./aiAssistStore.ts');
    expect(useAiAssistStore.getState().isAiAssistUnlocked).toBe(false);
  });

  it('setAiAssistUnlocked(true) updates state and persists to sessionStorage', async () => {
    const { useAiAssistStore, setAiAssistUnlocked } = await import('./aiAssistStore.ts');
    setAiAssistUnlocked(true);
    expect(useAiAssistStore.getState().isAiAssistUnlocked).toBe(true);
    expect(sessionStorage.getItem('tbxAiAssistUnlocked')).toBe('1');
  });

  it('setAiAssistUnlocked(false) clears state and the session flag', async () => {
    sessionStorage.setItem('tbxAiAssistUnlocked', '1');
    const { useAiAssistStore, setAiAssistUnlocked } = await import('./aiAssistStore.ts');
    setAiAssistUnlocked(false);
    expect(useAiAssistStore.getState().isAiAssistUnlocked).toBe(false);
    expect(sessionStorage.getItem('tbxAiAssistUnlocked')).toBeNull();
  });
});
