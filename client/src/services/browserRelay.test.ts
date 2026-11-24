// browserRelay.test.ts — Unit tests for the ServiceNow relay bookmarklet helper.

import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConnectionStore } from '../store/connectionStore.ts';
import {
  openSharePointRelay,
  openSnowRelay,
  parseRelayReturnRoute,
  RELAY_RETURN_ROUTE_KEY,
  resetBrowserRelayForTests,
  SHAREPOINT_RELAY_BOOKMARKLET_CODE,
  SNOW_HOSTNAME_FRAGMENTS,
  SNOW_RELAY_BOOKMARKLET_CODE,
  SNOW_TOKEN_RESOLVER_SOURCE,
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

  it('sends a base64 body as raw bytes with the caller\'s Content-Type, so a file can cross the relay', () => {
    // A zip of test evidence is not JSON. Re-serializing it would attach a JSON string to the
    // change, and ServiceNow would file that under the zip's name.
    for (const bookmarkletCode of [SNOW_RELAY_BOOKMARKLET_CODE, UNIFIED_RELAY_BOOKMARKLET_CODE]) {
      expect(bookmarkletCode).toContain('relayRequest.bodyEncoding==="base64"');
      expect(bookmarkletCode).toContain('function decodeBase64Body(encodedText){var binaryText=atob(encodedText)');
      expect(bookmarkletCode).toContain('isBinaryBody?(relayRequest.contentType||"application/octet-stream"):"application/json"');
      expect(bookmarkletCode).toContain('isBinaryBody?decodeBase64Body(relayRequest.body):JSON.stringify(relayRequest.body)');
    }
  });

  it('lets a request ask for a longer wait, because an upload outlasts a table read', () => {
    expect(SNOW_RELAY_BOOKMARKLET_CODE).toContain('relayRequest.timeoutMs||25000');
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

  it('the one bookmarklet also relays Jira, recognised by the page itself rather than its address', () => {
    // After a Jira re-instance migration the server's stored token belongs to the old instance (401 on
    // every call). A relaying Jira tab carries the calls with the person's own session instead. The page
    // is recognised by what Jira renders, so a new Jira address never needs a new bookmark.
    expect(UNIFIED_RELAY_BOOKMARKLET_CODE).toContain('var sys="jira"');
    expect(UNIFIED_RELAY_BOOKMARKLET_CODE).toContain('meta[name=application-name][content=JIRA]');
  });

  it('the Jira relay sends the Jira anti-XSRF header and honours a Jira context path', () => {
    // Without X-Atlassian-Token a session-authenticated write is refused as a possible XSRF; a Jira served
    // under /jira would 404 every call if the context path were dropped.
    expect(UNIFIED_RELAY_BOOKMARKLET_CODE).toContain('"X-Atlassian-Token":"no-check"');
    expect(UNIFIED_RELAY_BOOKMARKLET_CODE).toContain('meta[name=ajs-context-path]');
  });

  it('the Jira relay serves same-site paths only, so the session is never sent elsewhere', () => {
    expect(UNIFIED_RELAY_BOOKMARKLET_CODE).toContain('relayRequest.path.charAt(1)==="/"');
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

// Feature 040: the standalone SNow Wizard reuses the token resolver and host fragments. Exporting them must not change a
// single byte of the bookmarklets users already have in their bars — these fingerprints were taken before the export.
describe('shared pieces exported for the SNow Wizard (feature 040)', () => {
  function fingerprint(sourceText: string): string {
    return createHash('sha256').update(sourceText).digest('hex');
  }

  it('leaves the ServiceNow bookmarklet byte-identical, and pins the unified one', () => {
    expect(fingerprint(SNOW_RELAY_BOOKMARKLET_CODE)).toBe('8787759255de13bd04547a7522805f7c8a540e472861767efa6e2ea8347a106c');
    // The unified bookmark changed ON PURPOSE when it learned to relay Jira (v0.328.2) — re-drag it once.
    expect(fingerprint(UNIFIED_RELAY_BOOKMARKLET_CODE)).toBe('dac4485deb29ff9520df312f4b99e35498d10c1e9be08037a2ae2ea31fa39b4e');
  });

  it('exports the exact token resolver the ServiceNow bookmarklet runs', () => {
    expect(SNOW_TOKEN_RESOLVER_SOURCE.startsWith('function resolveUserToken(){')).toBe(true);
    expect(SNOW_RELAY_BOOKMARKLET_CODE).toContain(SNOW_TOKEN_RESOLVER_SOURCE);
  });

  it('exports the ServiceNow host fragments', () => {
    expect(SNOW_HOSTNAME_FRAGMENTS).toEqual(['service-now', 'servicenow']);
  });
});

describe('the unified bookmarklet, run on a Jira page', () => {
  const addedMetaTags: HTMLMetaElement[] = [];

  function addMetaTag(name: string, content: string): void {
    const metaTag = document.createElement('meta');
    metaTag.setAttribute('name', name);
    metaTag.setAttribute('content', content);
    document.head.appendChild(metaTag);
    addedMetaTags.push(metaTag);
  }

  afterEach(() => {
    addedMetaTags.splice(0).forEach((metaTag) => metaTag.remove());
    vi.unstubAllGlobals();
  });

  it('registers as the Jira relay and runs a queued call under Jira’s context path with the session', async () => {
    addMetaTag('application-name', 'JIRA');
    addMetaTag('ajs-context-path', '/jira');
    let pollCount = 0;
    const postedResults: unknown[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/api/relay-bridge/register')) return new Response('{}', { status: 200 });
      if (url.includes('/api/relay-bridge/poll')) {
        pollCount += 1;
        if (pollCount > 1) return new Promise<Response>(() => undefined); // later polls just wait
        return new Response(JSON.stringify({ request: { id: 'r1', method: 'GET', path: '/rest/api/2/myself' } }));
      }
      if (url.includes('/api/relay-bridge/result')) {
        postedResults.push(JSON.parse(String(init?.body)));
        return new Response('{}');
      }
      return new Response('{"name":"me"}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('open', vi.fn());

    new Function(UNIFIED_RELAY_BOOKMARKLET_CODE.replace(/^javascript:/, ''))();
    await vi.waitFor(() => expect(postedResults).toHaveLength(1));

    expect(String(fetchMock.mock.calls[0][0])).toContain('register?sys=jira');
    const siteCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/jira/rest/api/2/myself'));
    expect(siteCall?.[1]).toMatchObject({ method: 'GET', credentials: 'include' });
    expect(postedResults[0]).toMatchObject({ id: 'r1', sys: 'jira', ok: true, status: 200, data: '{"name":"me"}' });
  });
});
