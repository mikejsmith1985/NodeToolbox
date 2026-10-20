// bookmarkPayload.test.ts — Proves the one Wizard bookmark picks its role from the page it is clicked on and serves Jira safely.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SNOW_HOSTNAME_FRAGMENTS, SNOW_TOKEN_RESOLVER_SOURCE } from '../../services/browserRelay.ts';
import {
  BOOT_PLACEHOLDER,
  buildBookmarkHref,
  buildBookmarkSource,
  detectBookmarkRole,
  runJiraAgent,
} from './bookmarkPayload.ts';

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
