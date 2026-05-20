// demoModeStorage.test.ts — Verifies session-only demo mode storage isolation.

import { beforeEach, describe, expect, it } from 'vitest';

import {
  createDemoModeUrl,
  disableDemoModeForCurrentTab,
  initializeDemoModeStorageIsolation,
  isDemoModeEnabled,
} from './demoModeStorage.ts';

const DEMO_MODE_SESSION_FLAG_KEY = 'ntbx-demo-mode-enabled';

describe('demoModeStorage', () => {
  beforeEach(() => {
    disableDemoModeForCurrentTab();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('redirects app localStorage reads and writes to sessionStorage while demo mode is active', () => {
    window.localStorage.setItem('tbx-theme', 'light');
    window.sessionStorage.setItem(DEMO_MODE_SESSION_FLAG_KEY, '1');

    expect(isDemoModeEnabled()).toBe(true);
    expect(window.localStorage.getItem('tbx-theme')).toBeNull();

    window.localStorage.setItem('tbx-theme', 'dark');
    expect(window.localStorage.getItem('tbx-theme')).toBe('dark');

    disableDemoModeForCurrentTab();
    expect(window.localStorage.getItem('tbx-theme')).toBe('light');
  });

  it('keeps demo-mode enumeration scoped to session-only keys', () => {
    window.localStorage.setItem('tbx-real-setting', 'real value');
    window.sessionStorage.setItem(DEMO_MODE_SESSION_FLAG_KEY, '1');
    window.localStorage.setItem('tbx-demo-setting', 'demo value');

    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.key(0)).toBe('tbx-demo-setting');
  });

  it('activates from the demo query parameter without deleting real settings', () => {
    window.localStorage.setItem('tbx-theme', 'light');
    window.history.replaceState({}, '', '/admin-hub?demo=1');

    initializeDemoModeStorageIsolation();

    expect(isDemoModeEnabled()).toBe(true);
    expect(window.location.search).toBe('');
    expect(window.localStorage.getItem('tbx-theme')).toBeNull();

    disableDemoModeForCurrentTab();
    expect(window.localStorage.getItem('tbx-theme')).toBe('light');
  });

  it('creates a demo-mode URL for opening an isolated first-install tab', () => {
    expect(createDemoModeUrl('https://toolbox.example.com/admin-hub?tab=settings')).toBe(
      'https://toolbox.example.com/admin-hub?tab=settings&demo=1',
    );
  });

  it('marks same-origin API requests as demo mode without changing external requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    window.sessionStorage.setItem(DEMO_MODE_SESSION_FLAG_KEY, '1');

    initializeDemoModeStorageIsolation();
    await fetch('/api/proxy-status');
    await fetch('https://api.github.com/user');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/proxy-status',
      expect.objectContaining({
        headers: expect.any(Headers),
      }),
    );
    const demoHeaders = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(demoHeaders.get('X-NodeToolbox-Demo-Mode')).toBe('1');
    expect(fetchMock.mock.calls[1][1]).toBeUndefined();
  });
});
