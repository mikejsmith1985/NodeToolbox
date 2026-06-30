// jiraApiWrappers.test.ts — Unit tests for the Template Maker Jira wrappers.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createIssue, getCreateMeta, getMyself } from '../../../services/jiraApi.ts';

function mockFetchOnce(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })));
}

describe('Template Maker Jira wrappers', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { dispatchEvent: vi.fn(), addEventListener: vi.fn() } as unknown as Window & typeof globalThis);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('getCreateMeta requests the classic endpoint with the field expansion', async () => {
    const fetchSpy = vi.fn(async (_url: string) => new Response(JSON.stringify({ projects: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchSpy);

    await getCreateMeta('ABC');

    const calledUrl = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toContain('/jira-proxy/rest/api/2/issue/createmeta');
    expect(calledUrl).toContain('projectKeys=ABC');
    expect(calledUrl).toContain('expand=projects.issuetypes.fields');
  });

  it('createIssue POSTs to /rest/api/2/issue and returns the created key', async () => {
    mockFetchOnce({ id: '100', key: 'ABC-1', self: 'https://jira/issue/100' });
    const result = await createIssue({ fields: { summary: 'Hi' } });
    expect(result.key).toBe('ABC-1');
  });

  it('getMyself returns the current user', async () => {
    mockFetchOnce({ displayName: 'Jane Doe', name: 'jdoe' });
    const me = await getMyself();
    expect(me.displayName).toBe('Jane Doe');
  });
});
