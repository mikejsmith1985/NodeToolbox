// snowWindowProbe.entry.test.ts — Proves the ServiceNow-window script mounts with its boot data and explains itself without it.

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
  Reflect.deleteProperty(window, '__SNOW_WIZARD_BOOT__');
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('snowWindowProbe entry', () => {
  it('explains that the window must be opened from the bookmark when no boot data is present', async () => {
    await import('./snowWindowProbe.entry.ts');
    expect(document.body.textContent).toContain('Open this window by clicking the probe bookmark on your ServiceNow tab');
  });

  it('mounts the probe when boot data is present', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"result":[]}', { status: 200 })));
    Object.assign(window, { __SNOW_WIZARD_BOOT__: { instanceOrigin: 'https://acme.service-now.com', userToken: 't', channelName: 'c', jiraUrl: '' } });
    await import('./snowWindowProbe.entry.ts');
    expect(document.body.textContent).toContain('ServiceNow window checks');
  });
});
