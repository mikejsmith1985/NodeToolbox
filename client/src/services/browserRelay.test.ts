// browserRelay.test.ts — Unit tests for the ServiceNow relay bookmarklet helper.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectionStore } from '../store/connectionStore.ts';
import {
  openSnowRelay,
  parseRelayReturnRoute,
  RELAY_RETURN_ROUTE_KEY,
  resetBrowserRelayForTests,
  SNOW_RELAY_BOOKMARKLET_CODE,
} from './browserRelay.ts';

describe('browserRelay', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.localStorage.clear();
    useConnectionStore.setState(useConnectionStore.getInitialState());
    resetBrowserRelayForTests();
  });

  afterEach(() => {
    resetBrowserRelayForTests();
    vi.restoreAllMocks();
  });

  it('keeps the bookmarklet on the Chrome-safe local HTTP bridge flow', () => {
    expect(SNOW_RELAY_BOOKMARKLET_CODE).toContain('http://127.0.0.1:5555');
    expect(SNOW_RELAY_BOOKMARKLET_CODE).toContain('/api/relay-bridge/register');
    expect(SNOW_RELAY_BOOKMARKLET_CODE).toContain('/api/relay-bridge/poll');
    expect(SNOW_RELAY_BOOKMARKLET_CODE).toContain('X-UserToken');
    expect(SNOW_RELAY_BOOKMARKLET_CODE).not.toContain('glide_user_activity');
    expect(SNOW_RELAY_BOOKMARKLET_CODE).toContain('resolveUserToken');
  });

  it('reports token readiness after ServiceNow exposes g_ck post-registration', () => {
    expect(SNOW_RELAY_BOOKMARKLET_CODE).toContain('/api/relay-bridge/session-token');
    expect(SNOW_RELAY_BOOKMARKLET_CODE).toContain('reportSessionTokenReady');
  });

  it('refreshes g_ck on every relayed request instead of using only the startup value', () => {
    const executeRequestSnippet = SNOW_RELAY_BOOKMARKLET_CODE.match(
      /async function executeRelayRequest\(relayRequest\).*?resolveUserToken\(\)/,
    );

    expect(executeRequestSnippet).not.toBeNull();
  });

  it('uses an amber bookmarklet badge when g_ck is not ready yet', () => {
    expect(SNOW_RELAY_BOOKMARKLET_CODE).toContain('#b08800');
    expect(SNOW_RELAY_BOOKMARKLET_CODE).toContain('no g_ck');
  });

  it('focuses the NodeToolbox window without navigating it (no page reload)', () => {
    // The bookmarklet must use window.open("","toolbox") — empty URL = focus only.
    // Passing the relay server URL as the first argument causes Chrome to navigate
    // the NodeToolbox window to the root URL, wiping all in-progress form state.
    expect(SNOW_RELAY_BOOKMARKLET_CODE).toContain('window.open("","toolbox")');
    expect(SNOW_RELAY_BOOKMARKLET_CODE).not.toMatch(/window\.open\(relayServer,"toolbox"\)/);
  });

  it('generates bookmarklet JavaScript that parses before users drag it', () => {
    const bookmarkletBody = SNOW_RELAY_BOOKMARKLET_CODE.replace(/^javascript:/, '');

    expect(() => new Function(bookmarkletBody)).not.toThrow();
  });

  it('makes local bridge failures visible instead of silently doing nothing', () => {
    expect(SNOW_RELAY_BOOKMARKLET_CODE).toContain('cannot reach local bridge');
    expect(SNOW_RELAY_BOOKMARKLET_CODE).toContain('Could not reach NodeToolbox');
  });

  it('opens ServiceNow in the original __crg_snow relay tab', () => {
    const relayWindow = { closed: false } as Window;
    vi.spyOn(window, 'open').mockReturnValue(relayWindow);

    expect(openSnowRelay('https://snow.example.com')).toBe(true);

    expect(window.open).toHaveBeenCalledWith('https://snow.example.com', '__crg_snow', '');
    expect(useConnectionStore.getState().relayBridgeStatus?.isConnected).toBe(false);
  });

  it('returns false when popup blocking prevents opening ServiceNow', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    expect(openSnowRelay('https://snow.example.com')).toBe(false);
  });

  it('stores a timestamped current pathname so the app can restore it after the relay reload', () => {
    vi.spyOn(window, 'open').mockReturnValue({ closed: false } as Window);

    // jsdom sets window.location.pathname to '/' by default
    openSnowRelay('https://snow.example.com');

    expect(parseRelayReturnRoute(localStorage.getItem(RELAY_RETURN_ROUTE_KEY))).toBe('/');
  });

  it('does not store a return route when the URL is empty', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    openSnowRelay('');

    // openSnowRelay returns early for empty URLs — no route should be stored
    expect(localStorage.getItem(RELAY_RETURN_ROUTE_KEY)).toBeNull();
  });

  it('ignores old plain-text relay return routes so stale values cannot hijack startup navigation', () => {
    expect(parseRelayReturnRoute('/snow-hub')).toBeNull();
  });

  it('ignores expired relay return routes', () => {
    const nowMs = Date.now();
    const expiredRoute = JSON.stringify({ path: '/snow-hub', createdAt: nowMs - 10 * 60 * 1000 });

    expect(parseRelayReturnRoute(expiredRoute, nowMs)).toBeNull();
  });
});
