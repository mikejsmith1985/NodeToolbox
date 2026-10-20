// jiraProxyFetch.test.ts — Proves Toolbox's Jira calls (which go to /jira-proxy) reach Jira through the Wizard's Jira
// tab, while every other request is an ordinary fetch.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { wizardFetch } from './jiraProxyFetch.ts';
import { installWizardTransports, resetWizardTransports } from './wizardTransports.ts';

afterEach(() => {
  resetWizardTransports();
  vi.unstubAllGlobals();
});

describe('wizardFetch', () => {
  it('routes /jira-proxy calls to the Jira transport and returns a normal Response', async () => {
    const execute = vi.fn(async () => ({ status: 200, body: '{"key":"ABC-1"}' }));
    installWizardTransports({ jira: { execute } });

    const jiraResponse = await wizardFetch('/jira-proxy/rest/api/2/issue', { method: 'POST', body: '{"fields":{}}' });

    expect(execute).toHaveBeenCalledWith({ method: 'POST', path: '/rest/api/2/issue', body: '{"fields":{}}' });
    expect(jiraResponse.status).toBe(200);
    await expect(jiraResponse.json()).resolves.toEqual({ key: 'ABC-1' });
  });

  it('defaults to GET and maps a 204 to an empty body', async () => {
    const execute = vi.fn(async () => ({ status: 204, body: '' }));
    installWizardTransports({ jira: { execute } });

    const jiraResponse = await wizardFetch('/jira-proxy/rest/api/2/issue/ABC-1');

    expect(execute).toHaveBeenCalledWith({ method: 'GET', path: '/rest/api/2/issue/ABC-1', body: undefined });
    expect(jiraResponse.status).toBe(204);
    await expect(jiraResponse.text()).resolves.toBe('');
  });

  it('throws like a network failure when Jira could not be reached', async () => {
    installWizardTransports({ jira: { execute: vi.fn(async () => ({ status: 0, body: 'timeout' })) } });
    await expect(wizardFetch('/jira-proxy/rest/api/2/myself')).rejects.toThrow('Jira did not answer: timeout');
  });

  it('throws a plain instruction when Jira is not connected yet', async () => {
    await expect(wizardFetch('/jira-proxy/rest/api/2/myself')).rejects.toThrow('Jira is not connected');
  });

  it('passes every other request to the browser untouched', async () => {
    const browserFetch = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', browserFetch);
    await wizardFetch('https://acme.service-now.com/x', { method: 'GET' });
    expect(browserFetch).toHaveBeenCalledWith('https://acme.service-now.com/x', { method: 'GET' });
  });

  it('fetches a Jira attachment as base64 through the Jira tab and returns the exact bytes', async () => {
    const fileBytes = new Uint8Array([0, 255, 128, 37, 80, 68, 70]);
    const execute = vi.fn(async () => ({ status: 200, body: btoa(String.fromCharCode(...fileBytes)), bodyEncoding: 'base64' as const }));
    installWizardTransports({ jira: { execute } });

    const fileResponse = await wizardFetch('/jira-proxy/secure/attachment/10001/report.pdf');

    expect(execute).toHaveBeenCalledWith({ method: 'GET', path: '/secure/attachment/10001/report.pdf', body: undefined, responseEncoding: 'base64' });
    expect(fileResponse.ok).toBe(true);
    expect(new Uint8Array(await fileResponse.arrayBuffer())).toEqual(fileBytes);
  });

  it('passes an attachment error status through without decoding it', async () => {
    installWizardTransports({ jira: { execute: vi.fn(async () => ({ status: 404, body: 'gone' })) } });
    const fileResponse = await wizardFetch('/jira-proxy/secure/attachment/1/a.pdf');
    expect(fileResponse.status).toBe(404);
  });

  it('says plainly to re-install the bookmark when the Jira tab runs an older one that cannot send files', async () => {
    installWizardTransports({ jira: { execute: vi.fn(async () => ({ status: 0, body: 'refused: only /rest/ paths are served' })) } });
    await expect(wizardFetch('/jira-proxy/secure/attachment/1/a.pdf')).rejects.toThrow(/bookmark is out of date/);
  });

  it('refuses a file the older bookmark sent as text, rather than keeping damaged bytes', async () => {
    installWizardTransports({ jira: { execute: vi.fn(async () => ({ status: 200, body: '%PDF-garbled' })) } });
    await expect(wizardFetch('/jira-proxy/secure/attachment/1/a.pdf')).rejects.toThrow(/bookmark is out of date/);
  });
});
