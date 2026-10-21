// main.entry.test.tsx — Proves the Wizard window starts the app with its boot data and explains itself without it.

import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  document.body.innerHTML = '';
  Reflect.deleteProperty(window, '__SNOW_WIZARD_BOOT__');
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('Wizard window entry', () => {
  it('explains how to open the Wizard when it has no boot data', async () => {
    await import('./main.entry.tsx');
    expect(document.body.textContent).toContain('clicking its bookmark on your ServiceNow tab');
  });

  it('starts the Wizard when the bookmark supplied boot data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"result":[{"name":"Smith, Jane"}]}', { status: 200 })));
    Object.assign(window, { __SNOW_WIZARD_BOOT__: { instanceOrigin: 'https://acme.service-now.com', userToken: 't', channelName: 'snowWizard' } });
    await import('./main.entry.tsx');
    await waitFor(() => expect(document.body.textContent).toContain('SNow Wizard'));
    expect(document.body.textContent).toContain('Connect to ServiceNow and Jira');
  });
});
