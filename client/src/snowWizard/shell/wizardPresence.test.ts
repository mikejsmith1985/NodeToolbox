// wizardPresence.test.ts — Proves the Wizard window marks itself open for its whole life and flags its tab on request.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { flagWizardTab, holdWizardPresenceLock } from './wizardPresence.ts';

describe('holdWizardPresenceLock', () => {
  it('requests the named lock and never releases it while the window lives', async () => {
    let heldCallbackResult: Promise<unknown> | null = null;
    const request = vi.fn((_lockName: string, callback: () => Promise<unknown>) => {
      heldCallbackResult = callback();
      return heldCallbackResult;
    });
    holdWizardPresenceLock('snowWizard:open', { request } as unknown as LockManager);

    expect(request).toHaveBeenCalledWith('snowWizard:open', expect.any(Function));
    const settled = await Promise.race([heldCallbackResult, new Promise((resolve) => setTimeout(() => resolve('still held'), 5))]);
    expect(settled).toBe('still held');
  });

  it('does nothing where the browser has no Web Locks', () => {
    expect(() => holdWizardPresenceLock('snowWizard:open', undefined)).not.toThrow();
  });
});

describe('flagWizardTab', () => {
  afterEach(() => vi.useRealTimers());

  it('puts a pointer in the tab title, then restores it', () => {
    vi.useFakeTimers();
    const fakeDocument = { title: 'SNow Wizard' };
    flagWizardTab(fakeDocument, 1000);
    expect(fakeDocument.title).toBe('👉 SNow Wizard — over here');
    vi.advanceTimersByTime(1000);
    expect(fakeDocument.title).toBe('SNow Wizard');
  });
});
