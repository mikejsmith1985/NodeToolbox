// bookmarkPayload.test.ts — Proves the relay bookmark serves only the Wizard tab that opened it, runs requests on its own
// site with the user's session (and ServiceNow's fresh token), carries files intact, and is a self-contained bookmark.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SNOW_HOSTNAME_FRAGMENTS, SNOW_TOKEN_RESOLVER_SOURCE } from '../../services/snowRelayShared.ts';
import {
  buildBookmarkHref,
  buildBookmarkSource,
  detectBookmarkRole,
  runBookmark,
  runRelayAgent,
  showWizardBadge,
  type RelaySystem,
} from './bookmarkPayload.ts';

const CHANNEL_NAME = 'snowWizard';
const WIZARD_ORIGIN = 'https://wizard.example.com';
const OPENER_CHECK_INTERVAL_MS = 1000;

interface FakeOpener {
  postMessage: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  closed: boolean;
}

function readBadgeText(): string {
  return document.getElementById('snow-wizard-badge')?.textContent ?? '';
}

describe('detectBookmarkRole', () => {
  it('does nothing on a tab the Wizard did not open', () => {
    expect(detectBookmarkRole('acme.service-now.com', SNOW_HOSTNAME_FRAGMENTS, false)).toBe('unknown');
    expect(detectBookmarkRole('jira.example.com', SNOW_HOSTNAME_FRAGMENTS, false)).toBe('unknown');
  });

  it('serves ServiceNow on a ServiceNow host, ignoring case', () => {
    expect(detectBookmarkRole('ACME.Service-Now.com', SNOW_HOSTNAME_FRAGMENTS, true)).toBe('snowAgent');
  });

  it('serves Jira on any other host, so a Jira move needs no new bookmark (R-011)', () => {
    expect(detectBookmarkRole('jira-new.example.com', SNOW_HOSTNAME_FRAGMENTS, true)).toBe('jiraAgent');
  });
});

describe('runRelayAgent', () => {
  const fetchMock = vi.fn();
  const stopAgents: Array<() => void> = [];
  let fakeOpener: FakeOpener;

  function startAgent(system: RelaySystem, resolveUserToken: (() => string) | null = null, showBadge = vi.fn()): void {
    stopAgents.push(runRelayAgent({ channelName: CHANNEL_NAME, system }, resolveUserToken, showBadge));
  }

  function sendRequest(requestData: Record<string, unknown>, source: unknown = fakeOpener, origin = WIZARD_ORIGIN): void {
    window.dispatchEvent(new MessageEvent('message', {
      data: { channel: CHANNEL_NAME, kind: 'request', requestId: 'r1', method: 'GET', path: '/api/now/table/x', ...requestData },
      origin,
      source: source as MessageEventSource,
    }));
  }

  function readReplies(): Array<[Record<string, unknown>, string]> {
    return fakeOpener.postMessage.mock.calls.filter(([message]) => (message as { kind: string }).kind === 'response') as Array<[Record<string, unknown>, string]>;
  }

  function readFetchHeaders(callIndex = 0): Record<string, string> {
    return (fetchMock.mock.calls[callIndex][1] as RequestInit).headers as Record<string, string>;
  }

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    fakeOpener = { postMessage: vi.fn(), focus: vi.fn(), closed: false };
    Object.defineProperty(window, 'opener', { configurable: true, value: fakeOpener });
  });

  afterEach(() => {
    stopAgents.splice(0).forEach((stopAgent) => stopAgent());
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'opener', { configurable: true, value: null });
    document.body.innerHTML = '';
  });

  it('says hello to the Wizard that opened it, naming its system, and hands focus back', () => {
    const showBadge = vi.fn();
    startAgent('snow', () => 'token', showBadge);
    expect(fakeOpener.postMessage).toHaveBeenCalledWith({ channel: CHANNEL_NAME, kind: 'hello', system: 'snow' }, '*');
    expect(fakeOpener.focus).toHaveBeenCalled();
    expect(showBadge.mock.calls[0][0]).toContain('connected to this ServiceNow tab');
  });

  describe('switching back to the Wizard', () => {
    function sendWelcome(appWindowName: string, source: unknown = fakeOpener): void {
      window.dispatchEvent(new MessageEvent('message', {
        data: { channel: CHANNEL_NAME, kind: 'welcome', appWindowName }, origin: WIZARD_ORIGIN, source: source as MessageEventSource,
      }));
    }

    it('brings the Wizard to the front by its window name, once', () => {
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeOpener as unknown as Window);
      startAgent('jira');
      sendWelcome('snowWizardApp-abc');
      sendWelcome('snowWizardApp-abc');
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith('', 'snowWizardApp-abc');
    });

    it('closes the empty tab a browser opens when the name reaches nothing', () => {
      const strayTab = { close: vi.fn() };
      vi.spyOn(window, 'open').mockReturnValue(strayTab as unknown as Window);
      startAgent('snow', () => 'token');
      sendWelcome('snowWizardApp-abc');
      expect(strayTab.close).toHaveBeenCalled();
    });

    it('ignores a welcome from any other window, or naming any other window', () => {
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
      startAgent('jira');
      sendWelcome('snowWizardApp-abc', { postMessage: vi.fn() });
      sendWelcome('someoneElse');
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  it('says a Jira hello for a Jira tab', () => {
    startAgent('jira');
    expect(fakeOpener.postMessage).toHaveBeenCalledWith({ channel: CHANNEL_NAME, kind: 'hello', system: 'jira' }, '*');
  });

  it('explains itself and serves nothing on a tab with no opener', () => {
    Object.defineProperty(window, 'opener', { configurable: true, value: null });
    const showBadge = vi.fn();
    startAgent('jira', null, showBadge);
    expect(showBadge.mock.calls[0][0]).toContain('not opened from the SNow Wizard');
    sendRequest({}, null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores requests from any window other than its opener, and other channels', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    startAgent('jira');
    const strangerWindow = { postMessage: vi.fn() };

    sendRequest({ requestId: 'stranger' }, strangerWindow, 'https://evil.example.com');
    window.dispatchEvent(new MessageEvent('message', {
      data: { channel: 'other', kind: 'request', requestId: 'r0', method: 'GET', path: '/x' },
      origin: WIZARD_ORIGIN,
      source: fakeOpener as unknown as MessageEventSource,
    }));
    sendRequest({ requestId: 'wizard', path: '/rest/api/2/myself' });

    await vi.waitFor(() => expect(readReplies()).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(strangerWindow.postMessage).not.toHaveBeenCalled();
    expect(readReplies()[0][0]).toEqual(expect.objectContaining({ requestId: 'wizard', status: 200 }));
  });

  it('runs a request on its own site with the user session and replies to the Wizard\'s exact origin', async () => {
    fetchMock.mockResolvedValue(new Response('{"displayName":"Smith, Jane"}', { status: 200 }));
    startAgent('jira');

    sendRequest({ method: 'get', path: '/rest/api/2/myself' });

    await vi.waitFor(() => expect(readReplies()).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith(`${location.origin}/rest/api/2/myself`, expect.objectContaining({ credentials: 'include', method: 'GET' }));
    expect(readReplies()[0]).toEqual([
      { channel: CHANNEL_NAME, kind: 'response', requestId: 'r1', status: 200, body: '{"displayName":"Smith, Jane"}' },
      WIZARD_ORIGIN,
    ]);
  });

  it('replies to "*" when the Wizard is a file page whose origin is "null"', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    startAgent('jira');
    sendRequest({}, fakeOpener, 'null');
    await vi.waitFor(() => expect(readReplies()).toHaveLength(1));
    expect(readReplies()[0][1]).toBe('*');
  });

  it('gives every ServiceNow request the ServiceNow headers and a token read fresh each time', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 200 }));
    const resolveUserToken = vi.fn().mockReturnValueOnce('token-1').mockReturnValueOnce('token-2');
    startAgent('snow', resolveUserToken);

    sendRequest({ requestId: 'first' });
    await vi.waitFor(() => expect(readReplies()).toHaveLength(1));
    sendRequest({ requestId: 'second' });
    await vi.waitFor(() => expect(readReplies()).toHaveLength(2));

    expect(resolveUserToken).toHaveBeenCalledTimes(2);
    expect(readFetchHeaders(0)).toEqual(expect.objectContaining({ 'X-Requested-With': 'XMLHttpRequest', 'X-UserToken': 'token-1' }));
    expect(readFetchHeaders(1)['X-UserToken']).toBe('token-2');
  });

  it('never adds ServiceNow headers to Jira requests', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    startAgent('jira');
    sendRequest({ path: '/rest/api/2/myself' });
    await vi.waitFor(() => expect(readReplies()).toHaveLength(1));
    expect(readFetchHeaders()).not.toHaveProperty('X-UserToken');
    expect(readFetchHeaders()).not.toHaveProperty('X-Requested-With');
    expect(readFetchHeaders()['Content-Type']).toBe('application/json');
  });

  it('refuses any path that would leave its own site, without fetching', async () => {
    startAgent('snow', () => 'token');

    sendRequest({ requestId: 'protocol-relative', path: '//evil.example.com/steal' });
    sendRequest({ requestId: 'absolute', path: 'https://evil.example.com/steal' });

    await vi.waitFor(() => expect(readReplies()).toHaveLength(2));
    expect(fetchMock).not.toHaveBeenCalled();
    for (const [replyMessage] of readReplies()) {
      expect(replyMessage).toEqual(expect.objectContaining({ status: 0, body: 'refused: only paths on this site are served' }));
    }
  });

  it('sends JSON bodies as text, and a base64 body as the original bytes with its own content type', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 201 }));
    startAgent('snow', () => 'token');
    const fileBytes = new Uint8Array([0, 255, 128, 80, 75, 3, 4]);

    sendRequest({ requestId: 'json', method: 'POST', body: { short_description: 'Fix' } });
    await vi.waitFor(() => expect(readReplies()).toHaveLength(1));
    sendRequest({
      requestId: 'file', method: 'POST', path: '/api/now/attachment/file',
      body: btoa(String.fromCharCode(...fileBytes)), bodyEncoding: 'base64', contentType: 'application/zip',
    });
    await vi.waitFor(() => expect(readReplies()).toHaveLength(2));

    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe('{"short_description":"Fix"}');
    expect((fetchMock.mock.calls[1][1] as RequestInit).body).toEqual(fileBytes);
    expect(readFetchHeaders(1)['Content-Type']).toBe('application/zip');
  });

  it('sends a file back as base64 so its bytes arrive unchanged', async () => {
    const fileBytes = new Uint8Array([0, 255, 128, 37, 80, 68, 70]);
    fetchMock.mockResolvedValue(new Response(fileBytes, { status: 200 }));
    startAgent('jira');

    sendRequest({ path: '/secure/attachment/10001/report.pdf', responseEncoding: 'base64' });

    await vi.waitFor(() => expect(readReplies()).toHaveLength(1));
    expect(readFetchHeaders().Accept).toBe('*/*');
    const replyMessage = readReplies()[0][0] as { status: number; body: string; bodyEncoding: string };
    expect(replyMessage.status).toBe(200);
    expect(replyMessage.bodyEncoding).toBe('base64');
    expect(Uint8Array.from(atob(replyMessage.body), (character) => character.charCodeAt(0))).toEqual(fileBytes);
  });

  it('answers status 0 with the reason when the site cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'));
    startAgent('jira');
    sendRequest({ path: '/rest/api/2/myself' });
    await vi.waitFor(() => expect(readReplies()).toHaveLength(1));
    expect(readReplies()[0][0]).toEqual(expect.objectContaining({ status: 0, body: 'Failed to fetch' }));
  });

  it('closes a Jira tab once the Wizard that opened it is closed, and stops serving', () => {
    vi.useFakeTimers();
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const showBadge = vi.fn();
    startAgent('jira', null, showBadge);

    vi.advanceTimersByTime(OPENER_CHECK_INTERVAL_MS);
    expect(closeSpy).not.toHaveBeenCalled();
    fakeOpener.closed = true;
    vi.advanceTimersByTime(OPENER_CHECK_INTERVAL_MS);

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(showBadge).toHaveBeenLastCalledWith('The SNow Wizard was closed — this Jira tab is no longer connected.', '#57606a');
    sendRequest({ path: '/rest/api/2/myself' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps a ServiceNow tab open when the Wizard closes, because people keep working in it', () => {
    vi.useFakeTimers();
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const showBadge = vi.fn();
    startAgent('snow', () => 'token', showBadge);

    fakeOpener.closed = true;
    vi.advanceTimersByTime(OPENER_CHECK_INTERVAL_MS);
    vi.advanceTimersByTime(OPENER_CHECK_INTERVAL_MS * 3);

    expect(closeSpy).not.toHaveBeenCalled();
    expect(showBadge).toHaveBeenLastCalledWith('The SNow Wizard was closed — this ServiceNow tab is no longer connected.', '#57606a');
    expect(showBadge.mock.calls.filter(([message]) => String(message).includes('was closed'))).toHaveLength(1);
  });

  it('stops serving when its stop function is called', () => {
    const stopAgent = runRelayAgent({ channelName: CHANNEL_NAME, system: 'jira' }, null, vi.fn());
    stopAgent();
    sendRequest({ path: '/rest/api/2/myself' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('runBookmark', () => {
  const bookmarkConfig = { channelName: CHANNEL_NAME, snowHostnameFragments: SNOW_HOSTNAME_FRAGMENTS };

  afterEach(() => {
    Object.defineProperty(window, 'opener', { configurable: true, value: null });
    document.body.innerHTML = '';
  });

  it('gives the ServiceNow agent the token resolver and the Jira agent none', () => {
    const relayAgent = vi.fn(() => () => undefined);
    const resolveUserToken = vi.fn(() => 'token');
    runBookmark(bookmarkConfig, () => 'snowAgent', relayAgent, vi.fn(), resolveUserToken);
    runBookmark(bookmarkConfig, () => 'jiraAgent', relayAgent, vi.fn(), resolveUserToken);
    expect(relayAgent).toHaveBeenNthCalledWith(1, { channelName: CHANNEL_NAME, system: 'snow' }, resolveUserToken, expect.any(Function));
    expect(relayAgent).toHaveBeenNthCalledWith(2, { channelName: CHANNEL_NAME, system: 'jira' }, null, expect.any(Function));
  });

  it('tells the user how to start from the Wizard when clicked on a tab it did not open', () => {
    const relayAgent = vi.fn(() => () => undefined);
    runBookmark(bookmarkConfig, detectBookmarkRole, relayAgent, showWizardBadge, () => '');
    expect(relayAgent).not.toHaveBeenCalled();
    expect(readBadgeText()).toContain('open the SNow Wizard file and press Connect');
  });
});

describe('showWizardBadge', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reuses one badge and removes it when clicked', () => {
    showWizardBadge('first', '#000');
    showWizardBadge('second', '#111');
    expect(document.querySelectorAll('#snow-wizard-badge')).toHaveLength(1);
    expect(readBadgeText()).toBe('second');
    (document.getElementById('snow-wizard-badge') as HTMLElement).click();
    expect(document.getElementById('snow-wizard-badge')).toBeNull();
  });
});

describe('buildBookmarkSource / buildBookmarkHref', () => {
  const bookmarkConfig = { channelName: CHANNEL_NAME };

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is one self-calling function with no module import, reusing the exact token resolver Toolbox ships', () => {
    const bookmarkSource = buildBookmarkSource(bookmarkConfig);
    expect(bookmarkSource.startsWith('(function(){')).toBe(true);
    expect(bookmarkSource.endsWith('})();')).toBe(true);
    expect(bookmarkSource).toContain(SNOW_TOKEN_RESOLVER_SOURCE);
    expect(bookmarkSource).not.toMatch(/\bimport\s*[{(*'"]|\bimport\s+\w+\s+from\b|__vi_import/);
  });

  it('runs on a foreign page without needing anything outside itself (no opener → guidance badge)', () => {
    new Function(buildBookmarkSource(bookmarkConfig))();
    expect(readBadgeText()).toContain('open the SNow Wizard file and press Connect');
  });

  it('calls window.fetch, never a bare fetch the Wizard build would swap for its own Jira one', () => {
    const relaySource = String(runRelayAgent);
    expect(relaySource).toContain('window.fetch(');
    expect(relaySource).not.toMatch(/(^|[^.\w])fetch\(/);
  });

  it('wraps the source as a percent-encoded javascript: URL that decodes back to the same source', () => {
    const bookmarkHref = buildBookmarkHref(bookmarkConfig);
    expect(bookmarkHref).toBe(`javascript:${encodeURIComponent(buildBookmarkSource(bookmarkConfig))}`);
    expect(bookmarkHref).not.toMatch(/\s/);
    expect(decodeURIComponent(bookmarkHref.slice('javascript:'.length))).toBe(buildBookmarkSource(bookmarkConfig));
  });
});
