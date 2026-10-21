// bookmarkPayload.test.ts — Proves the one Wizard bookmark picks its role from the page it is clicked on and serves Jira safely.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SNOW_HOSTNAME_FRAGMENTS, SNOW_TOKEN_RESOLVER_SOURCE } from '../../services/snowRelayShared.ts';
import {
  BOOT_PLACEHOLDER,
  buildBookmarkHref,
  buildBookmarkSource,
  detectBookmarkRole,
  readIsPresenceLockHeld,
  runJiraAgent,
  runSnowLauncher,
  showInstallPanel,
} from './bookmarkPayload.ts';
import { assembleWizardHtml } from '../install/installRuntime.ts';

const JIRA_HOSTNAME = 'jira.example.com';
const CHANNEL_NAME = 'snowWizardProbe';

describe('detectBookmarkRole', () => {
  it('treats any ServiceNow host as the launcher', () => {
    expect(detectBookmarkRole('acme.service-now.com', SNOW_HOSTNAME_FRAGMENTS, JIRA_HOSTNAME)).toBe('snowLauncher');
  });

  it('treats the configured Jira host as the agent, ignoring case', () => {
    expect(detectBookmarkRole('JIRA.example.com', SNOW_HOSTNAME_FRAGMENTS, JIRA_HOSTNAME)).toBe('jiraAgent');
  });

  it('refuses any other page', () => {
    expect(detectBookmarkRole('intranet.example.com', SNOW_HOSTNAME_FRAGMENTS, JIRA_HOSTNAME)).toBe('unknown');
  });

  it('never treats an empty configured Jira host as matching every page', () => {
    expect(detectBookmarkRole('intranet.example.com', SNOW_HOSTNAME_FRAGMENTS, '')).toBe('unknown');
  });

  it('with no frozen Jira host, acts as the agent on any non-ServiceNow tab the Wizard opened (R-011)', () => {
    expect(detectBookmarkRole('jira-new.example.com', SNOW_HOSTNAME_FRAGMENTS, '', true)).toBe('jiraAgent');
    expect(detectBookmarkRole('acme.service-now.com', SNOW_HOSTNAME_FRAGMENTS, '', true)).toBe('snowLauncher');
  });
});

describe('buildBookmarkSource / buildBookmarkHref', () => {
  const bookmarkConfig = {
    snowWindowHtml: `<html><script>window.__SNOW_WIZARD_BOOT__=${BOOT_PLACEHOLDER};</script></html>`,
    jiraHostname: JIRA_HOSTNAME,
    channelName: CHANNEL_NAME,
  };

  it('reuses the exact ServiceNow token resolver Toolbox ships, so the two can never drift', () => {
    expect(buildBookmarkSource(bookmarkConfig)).toContain(SNOW_TOKEN_RESOLVER_SOURCE);
  });

  it('produces source that parses as JavaScript', () => {
    expect(() => new Function(buildBookmarkSource(bookmarkConfig))).not.toThrow();
  });

  it('runs on a foreign page without needing anything outside itself (unknown page → guidance badge)', () => {
    new Function(buildBookmarkSource(bookmarkConfig))();
    expect(document.getElementById('snow-wizard-badge')?.textContent).toContain('click this on your ServiceNow tab');
    document.body.innerHTML = '';
  });

  it('wraps the source as a javascript: URL that decodes back to the same source', () => {
    const bookmarkHref = buildBookmarkHref(bookmarkConfig);
    expect(bookmarkHref.startsWith('javascript:')).toBe(true);
    expect(decodeURIComponent(bookmarkHref.slice('javascript:'.length))).toBe(buildBookmarkSource(bookmarkConfig));
  });
});

describe('runJiraAgent', () => {
  const openerPostMessage = vi.fn();
  const fetchMock = vi.fn();
  const stopAgents: Array<() => void> = [];
  function startAgent(): void {
    stopAgents.push(runJiraAgent({ channelName: CHANNEL_NAME, isReadOnly: true }));
  }

  beforeEach(() => {
    openerPostMessage.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(window, 'opener', { configurable: true, value: { postMessage: openerPostMessage } });
  });

  afterEach(() => {
    stopAgents.splice(0).forEach((stopAgent) => stopAgent());
    vi.unstubAllGlobals();
    Object.defineProperty(window, 'opener', { configurable: true, value: null });
    document.body.innerHTML = '';
  });

  function sendAgentRequest(requestData: Record<string, unknown>): void {
    window.dispatchEvent(new MessageEvent('message', {
      data: { channel: CHANNEL_NAME, kind: 'request', requestId: 'r1', ...requestData },
      origin: 'null',
      source: window.opener as MessageEventSource,
    }));
  }

  it('says hello to the window that opened it', () => {
    startAgent();
    expect(openerPostMessage).toHaveBeenCalledWith({ channel: CHANNEL_NAME, kind: 'hello', system: 'jira' }, '*');
  });

  it('closes its own tab (or says it can be closed) once the Wizard window that opened it is closed', () => {
    vi.useFakeTimers();
    const opener = { postMessage: openerPostMessage, closed: false, focus: vi.fn() };
    Object.defineProperty(window, 'opener', { configurable: true, value: opener });
    const closeSpy = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const showBadge = vi.fn();
    stopAgents.push(runJiraAgent({ channelName: CHANNEL_NAME, isReadOnly: true }, { showBadge, readIsLockHeld: readIsPresenceLockHeld }));

    vi.advanceTimersByTime(1000);
    expect(closeSpy).not.toHaveBeenCalled();
    opener.closed = true;
    vi.advanceTimersByTime(1000);

    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(showBadge).toHaveBeenLastCalledWith('The SNow Wizard window was closed — you can close this Jira tab.', '#57606a');
    closeSpy.mockRestore();
    vi.useRealTimers();
  });

  it('runs a read request on its own origin with the user session and answers with status and body', async () => {
    fetchMock.mockResolvedValue(new Response('{"displayName":"Smith, Jane"}', { status: 200 }));
    startAgent();

    sendAgentRequest({ method: 'GET', path: '/rest/api/2/myself' });

    await vi.waitFor(() => expect(openerPostMessage).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledWith(`${location.origin}/rest/api/2/myself`, expect.objectContaining({ credentials: 'include', method: 'GET' }));
    expect(openerPostMessage).toHaveBeenLastCalledWith(
      { channel: CHANNEL_NAME, kind: 'response', requestId: 'r1', status: 200, body: '{"displayName":"Smith, Jane"}' },
      '*',
    );
  });

  it('refuses any path outside /rest/ and any write while read-only, without calling Jira', async () => {
    startAgent();

    sendAgentRequest({ method: 'GET', path: '/secure/Dashboard.jspa' });
    sendAgentRequest({ method: 'POST', path: '/rest/api/2/issue' });

    await vi.waitFor(() => expect(openerPostMessage).toHaveBeenCalledTimes(3));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(openerPostMessage).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'response', status: 0 }), '*');
  });

  it('sends an attachment file back as base64 so its bytes arrive unchanged', async () => {
    const fileBytes = new Uint8Array([0, 255, 128, 37, 80, 68, 70]);
    fetchMock.mockResolvedValue(new Response(fileBytes, { status: 200 }));
    startAgent();

    sendAgentRequest({ method: 'GET', path: '/secure/attachment/10001/report.pdf', responseEncoding: 'base64' });

    await vi.waitFor(() => expect(openerPostMessage).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledWith(`${location.origin}/secure/attachment/10001/report.pdf`, expect.objectContaining({ credentials: 'include', method: 'GET' }));
    const reply = openerPostMessage.mock.calls[1][0] as { status: number; body: string; bodyEncoding: string };
    expect(reply.status).toBe(200);
    expect(reply.bodyEncoding).toBe('base64');
    expect(Uint8Array.from(atob(reply.body), (character) => character.charCodeAt(0))).toEqual(fileBytes);
  });

  it('serves attachment files only as reads', async () => {
    stopAgents.push(runJiraAgent({ channelName: CHANNEL_NAME, isReadOnly: false }));

    sendAgentRequest({ method: 'DELETE', path: '/secure/attachment/10001/report.pdf' });

    await vi.waitFor(() => expect(openerPostMessage).toHaveBeenCalledTimes(2));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(openerPostMessage).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'response', status: 0 }), '*');
  });

  it('sends the user back to the Wizard window after connecting', () => {
    const openerFocus = vi.fn();
    Object.defineProperty(window, 'opener', { configurable: true, value: { postMessage: openerPostMessage, focus: openerFocus } });
    startAgent();
    expect(openerFocus).toHaveBeenCalled();
  });

  it('serves only ServiceNow windows when restricted, replying to that exact origin', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 201 }));
    stopAgents.push(runJiraAgent({ channelName: CHANNEL_NAME, isReadOnly: false, allowedRequesterHostFragments: ['service-now'] }));
    const requesterWindow = { postMessage: vi.fn() };

    window.dispatchEvent(new MessageEvent('message', {
      data: { channel: CHANNEL_NAME, kind: 'request', requestId: 'evil', method: 'GET', path: '/rest/api/2/myself' },
      origin: 'https://evil.example.com',
      source: requesterWindow as unknown as MessageEventSource,
    }));
    window.dispatchEvent(new MessageEvent('message', {
      data: { channel: CHANNEL_NAME, kind: 'request', requestId: 'r2', method: 'POST', path: '/rest/api/2/issue', body: '{"fields":{}}' },
      origin: 'https://acme.service-now.com',
      source: requesterWindow as unknown as MessageEventSource,
    }));

    await vi.waitFor(() => expect(requesterWindow.postMessage).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: 'POST', body: '{"fields":{}}' }));
    expect(requesterWindow.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'r2', status: 201 }),
      'https://acme.service-now.com',
    );
  });

  it('ignores messages from other channels', () => {
    startAgent();
    window.dispatchEvent(new MessageEvent('message', { data: { channel: 'other', kind: 'request' } }));
    expect(openerPostMessage).toHaveBeenCalledTimes(1);
  });

  it('reports a severed link plainly when no window opened this tab', () => {
    Object.defineProperty(window, 'opener', { configurable: true, value: null });
    startAgent();
    expect(document.body.textContent).toContain('cut the link');
  });
});

describe('runSnowLauncher', () => {
  const channelPosts: unknown[] = [];
  let answerPingWithPong = false;
  let openedHtml = '';

  class FakeBroadcastChannel {
    onmessage: ((messageEvent: MessageEvent) => void) | null = null;
    postMessage(message: { kind: string }) {
      channelPosts.push(message);
      if (message.kind === 'ping' && answerPingWithPong) queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: { kind: 'pong' } })));
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    channelPosts.length = 0;
    answerPingWithPong = false;
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    vi.stubGlobal('Blob', class { constructor(parts: string[]) { openedHtml = parts.join(''); } });
    URL.createObjectURL = vi.fn(() => 'blob:https://acme.service-now.com/abc');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const launcherConfig = {
    snowWindowHtml: `<script>window.__SNOW_WIZARD_BOOT__=${BOOT_PLACEHOLDER};</script>`,
    jiraHostname: '',
    channelName: 'snowWizard',
    bootPlaceholder: BOOT_PLACEHOLDER,
    pingWaitMs: 10,
  };

  it('opens the Wizard window with boot data in which "<" can never close the script', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    runSnowLauncher(launcherConfig, () => 'tok<en', { showBadge: vi.fn(), readIsLockHeld: readIsPresenceLockHeld });
    await vi.advanceTimersByTimeAsync(11);

    expect(openSpy).toHaveBeenCalledWith('blob:https://acme.service-now.com/abc', 'snowWizardApp');
    expect(openedHtml).toContain(`tok${String.fromCharCode(92)}u003cen`);
    expect(openedHtml).not.toContain('tok<en');
  });

  it('does not open a second Wizard when one answers, and refreshes its token instead', async () => {
    answerPingWithPong = true;
    const openSpy = vi.spyOn(window, 'open');
    const showBadge = vi.fn();
    runSnowLauncher(launcherConfig, () => 'fresh-token', { showBadge, readIsLockHeld: readIsPresenceLockHeld });
    await vi.advanceTimersByTimeAsync(11);

    expect(openSpy).not.toHaveBeenCalled();
    expect(channelPosts).toContainEqual({ kind: 'token', token: 'fresh-token' });
    expect(showBadge.mock.calls[0][0]).toContain('already open');
  });

  it('never opens a second Wizard while its presence lock is held, even if that tab is asleep and cannot answer', async () => {
    vi.stubGlobal('navigator', { locks: { query: vi.fn(async () => ({ held: [{ name: 'snowWizard:open' }], pending: [] })) } });
    const openSpy = vi.spyOn(window, 'open');
    const showBadge = vi.fn();
    runSnowLauncher({ ...launcherConfig, presenceLockName: 'snowWizard:open' }, () => 'fresh-token', { showBadge, readIsLockHeld: readIsPresenceLockHeld });
    await vi.advanceTimersByTimeAsync(11);

    expect(openSpy).not.toHaveBeenCalled();
    expect(channelPosts).toContainEqual({ kind: 'token', token: 'fresh-token' });
    expect(channelPosts).toContainEqual({ kind: 'attention' });
    expect(showBadge.mock.calls[0][0]).toContain('already open');
  });

  describe('the loader (Wizard kept in ServiceNow storage)', () => {
    const INSTALLED = { version: 'v2', appSource: 'startWizard()', styleSource: 'p{}' };
    const STORE_CONFIG = {
      databaseName: 'snowWizard', storeName: 'installedApp', recordKey: 'current', payloadElementId: 'snow-wizard-install',
      payloadKind: 'snowWizardInstall', appPlaceholder: '__APP__', stylePlaceholder: '__STYLE__', bootPlaceholder: BOOT_PLACEHOLDER,
    };
    const loaderConfig = {
      jiraHostname: '', channelName: 'snowWizard', bootPlaceholder: BOOT_PLACEHOLDER, pingWaitMs: 10,
      windowTemplate: `<style>__STYLE__</style><script>window.__SNOW_WIZARD_BOOT__=${BOOT_PLACEHOLDER};</script><script>__APP__</script>`,
      installStore: STORE_CONFIG,
    };

    function createInstallTools(installedWizard: typeof INSTALLED | null) {
      return {
        openStore: vi.fn(),
        readInstalled: vi.fn(async () => installedWizard),
        writeInstalled: vi.fn(async () => undefined),
        parseFile: vi.fn((fileText: string) => (fileText === 'release-file' ? INSTALLED : null)),
        assemble: assembleWizardHtml,
        showInstallPanel: vi.fn(),
      };
    }

    it('opens the installed Wizard straight away, filled with fresh boot data', async () => {
      const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
      const install = createInstallTools(INSTALLED);
      runSnowLauncher(loaderConfig, () => 'token-1', { showBadge: vi.fn(), readIsLockHeld: readIsPresenceLockHeld, install });
      await vi.advanceTimersByTimeAsync(11);

      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openedHtml).toContain('<script>startWizard()</script>');
      expect(openedHtml).toContain('"userToken":"token-1"');
      expect(install.showInstallPanel).not.toHaveBeenCalled();
    });

    it('asks for the release file once when nothing is installed, keeps it, then opens it', async () => {
      const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
      const install = createInstallTools(null);
      runSnowLauncher(loaderConfig, () => 'token-1', { showBadge: vi.fn(), readIsLockHeld: readIsPresenceLockHeld, install });
      await vi.advanceTimersByTimeAsync(11);
      expect(openSpy).not.toHaveBeenCalled();

      const [installFromText, openInstalled] = install.showInstallPanel.mock.calls[0];
      expect(await installFromText('some other file')).toEqual({ installedWizard: null, isKept: false });
      expect(await installFromText('release-file')).toEqual({ installedWizard: INSTALLED, isKept: true });
      expect(install.writeInstalled).toHaveBeenCalledWith(STORE_CONFIG, install.openStore, INSTALLED);
      openInstalled(INSTALLED);
      expect(openedHtml).toContain('<script>startWizard()</script>');
    });
  });

  it('opens the Wizard when no one holds the presence lock and no one answers', async () => {
    vi.stubGlobal('navigator', { locks: { query: vi.fn(async () => ({ held: [], pending: [] })) } });
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    runSnowLauncher({ ...launcherConfig, presenceLockName: 'snowWizard:open' }, () => 'token', { showBadge: vi.fn(), readIsLockHeld: readIsPresenceLockHeld });
    await vi.advanceTimersByTimeAsync(11);

    expect(openSpy).toHaveBeenCalledTimes(1);
  });
});

describe('showInstallPanel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function chooseFile(fileText: string): void {
    const fileInput = document.querySelector('#snow-wizard-install-panel input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, 'files', { configurable: true, value: [{ text: async () => fileText }] });
    fileInput.dispatchEvent(new Event('change'));
  }

  it('says ✗ for the wrong file, then ✓ and offers "Open the SNow Wizard" for the right one', async () => {
    const installedWizard = { version: 'v2', appSource: 'x', styleSource: '' };
    const installFromText = vi.fn(async (fileText: string) => (fileText === 'right' ? { installedWizard, isKept: true } : { installedWizard: null, isKept: false }));
    const openInstalled = vi.fn();
    showInstallPanel(installFromText, openInstalled);
    const panel = document.getElementById('snow-wizard-install-panel') as HTMLElement;
    expect(panel.textContent).toContain('Install the SNow Wizard');

    chooseFile('wrong');
    await vi.waitFor(() => expect(panel.textContent).toContain('✗ That is not the SNow Wizard file'));
    chooseFile('right');
    await vi.waitFor(() => expect(panel.textContent).toContain('✓ SNow Wizard v2 is installed.'));

    (Array.from(panel.querySelectorAll('button')).find((buttonElement) => buttonElement.textContent === 'Open the SNow Wizard') as HTMLButtonElement).click();
    expect(openInstalled).toHaveBeenCalledWith(installedWizard);
    expect(document.getElementById('snow-wizard-install-panel')).toBeNull();
  });
});

describe('readIsPresenceLockHeld', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is false with no lock name, so the probe never consults locks', async () => {
    expect(await readIsPresenceLockHeld(undefined)).toBe(false);
  });

  it('is false where the browser has no Web Locks, and when the query fails', async () => {
    vi.stubGlobal('navigator', {});
    expect(await readIsPresenceLockHeld('snowWizard:open')).toBe(false);
    vi.stubGlobal('navigator', { locks: { query: vi.fn(async () => { throw new Error('denied'); }) } });
    expect(await readIsPresenceLockHeld('snowWizard:open')).toBe(false);
  });

  it('is true only for the exact lock name', async () => {
    vi.stubGlobal('navigator', { locks: { query: vi.fn(async () => ({ held: [{ name: 'other' }], pending: [] })) } });
    expect(await readIsPresenceLockHeld('snowWizard:open')).toBe(false);
  });
});
