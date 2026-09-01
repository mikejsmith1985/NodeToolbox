// browserRelay.test.ts — Unit tests for the ServiceNow relay bookmarklet helper.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectionStore } from '../store/connectionStore.ts';
import {
  openSharePointRelay,
  openSnowRelay,
  parseRelayReturnRoute,
  RELAY_RETURN_ROUTE_KEY,
  resetBrowserRelayForTests,
  SHAREPOINT_RELAY_BOOKMARKLET_CODE,
  SNOW_RELAY_BOOKMARKLET_CODE,
  UNIFIED_RELAY_BOOKMARKLET_CODE,
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

  describe('SharePoint relay', () => {
    it('bookmarklet targets the sharepoint system with the JSON Accept header and host guard', () => {
      expect(SHAREPOINT_RELAY_BOOKMARKLET_CODE).toContain('var sys="sharepoint"');
      expect(SHAREPOINT_RELAY_BOOKMARKLET_CODE).toContain('application/json;odata=nometadata');
      expect(SHAREPOINT_RELAY_BOOKMARKLET_CODE).toContain('sharepoint.com');
      expect(SHAREPOINT_RELAY_BOOKMARKLET_CODE).toContain('127.0.0.1:5555');
      expect(SHAREPOINT_RELAY_BOOKMARKLET_CODE).toContain('credentials:"include"');
    });

    it('bookmarklet returns the user to Toolbox via window.open("","toolbox") (no blank tab)', () => {
      expect(SHAREPOINT_RELAY_BOOKMARKLET_CODE).toContain('window.open("","toolbox")');
    });

    it('openSharePointRelay opens the site in a named window and returns true', () => {
      vi.spyOn(window, 'open').mockReturnValue({} as Window);
      expect(openSharePointRelay('https://contoso.sharepoint.com/sites/CUCIntake')).toBe(true);
    });

    it('openSharePointRelay returns false for an empty URL', () => {
      vi.spyOn(window, 'open').mockReturnValue(null);
      expect(openSharePointRelay('')).toBe(false);
    });
  });
});

// ── The bookmarklets must be valid JavaScript ──
//
// A bookmarklet is a `javascript:` URL. If it does not parse, the browser does nothing at all: no
// badge, no alert, no console error, nothing to report. That is exactly how a broken regex literal
// went unnoticed — `\/` inside a quoted string collapses to `/`, so `/^(\/sites\/[^\/]+)/` shipped as
// `/^(/sites/[^/]+)/`, the literal ended early, and `sites` was read as regex flags.
//
// These tests are cheap and they are the only thing standing between a typo and a dead bookmarklet.

/** Compiles the bookmarklet body, throwing on any syntax error exactly as a browser would. */
function assertBookmarkletParses(bookmarkletCode: string): void {
  const javascriptBody = bookmarkletCode.replace(/^javascript:/, '');
  // eslint-disable-next-line no-new-func
  new Function(javascriptBody);
}

describe('the bookmarklets parse as JavaScript', () => {
  it('the SharePoint relay bookmarklet parses', () => {
    expect(() => assertBookmarkletParses(SHAREPOINT_RELAY_BOOKMARKLET_CODE)).not.toThrow();
  });

  it('the ServiceNow relay bookmarklet parses', () => {
    expect(() => assertBookmarkletParses(SNOW_RELAY_BOOKMARKLET_CODE)).not.toThrow();
  });

  it('the one bookmarklet for both systems parses', () => {
    expect(() => assertBookmarkletParses(UNIFIED_RELAY_BOOKMARKLET_CODE)).not.toThrow();
  });

  it('the one bookmarklet carries BOTH relays and picks by the tab it is clicked in', () => {
    // Two bookmarks was an accident of the two being written months apart, not a requirement.
    expect(UNIFIED_RELAY_BOOKMARKLET_CODE).toContain('var sys="snow"');
    expect(UNIFIED_RELAY_BOOKMARKLET_CODE).toContain('var sys="sharepoint"');
    expect(UNIFIED_RELAY_BOOKMARKLET_CODE).toContain('service-now');
    expect(UNIFIED_RELAY_BOOKMARKLET_CODE).toContain('sharepoint.com');
  });

  it('runs each relay in its own function, so the two cannot collide', () => {
    // Both bodies declare showRelayStatus, sys, isRunning and a poll loop. Sharing one scope would
    // be a redeclaration, and the whole bookmarklet would do nothing at all.
    expect(UNIFIED_RELAY_BOOKMARKLET_CODE).toContain('{(function(){');
  });

  it('every bookmarklet names the tab and guards it against an accidental close', () => {
    // A tab cannot pin itself, so it does the two things it can: be findable, and ask before closing.
    for (const bookmarkletCode of [
      SNOW_RELAY_BOOKMARKLET_CODE, SHAREPOINT_RELAY_BOOKMARKLET_CODE, UNIFIED_RELAY_BOOKMARKLET_CODE,
    ]) {
      expect(bookmarkletCode).toContain('"RELAY - "+document.title');
      expect(bookmarkletCode).toContain('beforeunload');
    }
  });

  it('the ServiceNow relay reports where it is running, so a wrong-instance tab is nameable', () => {
    // Without this the relay registers, polls, and reads "connected" while every call it relays
    // lands on whichever instance the tab happened to be on (GH #377).
    expect(SNOW_RELAY_BOOKMARKLET_CODE).toContain('&origin="+encodeURIComponent(location.origin)');
  });

  it('registers with exactly two arguments, so the POST options are not silently dropped', () => {
    // The shape this pins: fetch(url, init). An extra comma before a URL fragment turns the init
    // into a THIRD argument, which fetch ignores — the registration then goes out as a GET and the
    // relay cannot register at all, while the bookmarklet still parses perfectly.
    for (const bookmarkletCode of [SNOW_RELAY_BOOKMARKLET_CODE, UNIFIED_RELAY_BOOKMARKLET_CODE]) {
      expect(bookmarkletCode).toContain(
        '(initialToken?"1":"0")+"&origin="+encodeURIComponent(location.origin),{method:"POST"',
      );
    }
  });

  it('carries no comma-then-plus, which is never intentional and always a spliced argument', () => {
    for (const bookmarkletCode of [
      SNOW_RELAY_BOOKMARKLET_CODE, SHAREPOINT_RELAY_BOOKMARKLET_CODE, UNIFIED_RELAY_BOOKMARKLET_CODE,
    ]) {
      expect(bookmarkletCode).not.toContain(',+"');
    }
  });

  it('neither carries a regex literal, which cannot survive being written inside a string', () => {
    // The rule this enforces: build patterns from string operations, or from `new RegExp("…")` where a
    // pattern is genuinely needed. A bare /…/ literal in a quoted bookmarklet line is a latent break.
    for (const bookmarkletCode of [SHAREPOINT_RELAY_BOOKMARKLET_CODE, SNOW_RELAY_BOOKMARKLET_CODE]) {
      expect(bookmarkletCode).not.toMatch(/=\/\^/);
    }
  });

  it('finds the site root of both managed paths, and nothing else', () => {
    // The behaviour the broken regex was meant to provide — now covering /teams/ too, which it missed.
    const siteRootOfPath = new Function('requestPath',
      'var pathParts=String(requestPath||"").split("/");'
      + 'var managedPath=(pathParts[1]||"").toLowerCase();'
      + 'return (managedPath==="sites"||managedPath==="teams")&&pathParts[2]?"/"+pathParts[1]+"/"+pathParts[2]:"";',
    ) as (requestPath: string) => string;

    expect(siteRootOfPath('/sites/Transformers/Shared Documents/Mail')).toBe('/sites/Transformers');
    expect(siteRootOfPath('/teams/Alpha/Docs')).toBe('/teams/Alpha');
    expect(siteRootOfPath('/Shared Documents/Mail')).toBe('');
    expect(siteRootOfPath('')).toBe('');
  });
});
