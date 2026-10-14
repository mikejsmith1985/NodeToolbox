// jiraApiWrappers.test.ts — Unit tests for the Template Maker Jira wrappers.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createIssue, getIssueTypeFields, getMyself, getProject, getProjectIssueTypes } from '../../../services/jiraApi.ts';

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

  it('getProjectIssueTypes requests the modern per-project issuetypes endpoint', async () => {
    const fetchSpy = vi.fn(async (_url: string) => new Response(JSON.stringify({ values: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchSpy);

    await getProjectIssueTypes('ABC');

    const calledUrl = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toContain('/jira-proxy/rest/api/2/issue/createmeta/ABC/issuetypes');
    expect(calledUrl).not.toContain('projectKeys=');
  });

  it('getIssueTypeFields requests the modern per-issuetype fields endpoint', async () => {
    const fetchSpy = vi.fn(async (_url: string) => new Response(JSON.stringify({ values: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchSpy);

    await getIssueTypeFields('ABC', '10001');

    const calledUrl = fetchSpy.mock.calls[0][0];
    expect(calledUrl).toContain('/jira-proxy/rest/api/2/issue/createmeta/ABC/issuetypes/10001');
  });

  it('getIssueTypeFields follows every page, so a field past the first page is not missed (GH #439)', async () => {
    // Jira Data Center caps createmeta pages below the size asked for; a required field on page two
    // was invisible to the PRB generator's pre-create check and Jira refused the Defect.
    const pages = [
      { values: [{ fieldId: 'summary', required: true, name: 'Summary' }], startAt: 0, maxResults: 1, total: 2, isLast: false },
      { values: [{ fieldId: 'customfield_10253', required: true, name: 'Severity' }], startAt: 1, maxResults: 1, total: 2, isLast: true },
    ];
    const fetchSpy = vi.fn(async (_url: string) => new Response(JSON.stringify(pages.shift()), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const fieldsResponse = await getIssueTypeFields('ABC', '10001');

    expect(fieldsResponse.values.map((field) => field.fieldId)).toEqual(['summary', 'customfield_10253']);
    expect(fetchSpy.mock.calls[1][0]).toContain('startAt=1');
  });

  it('getIssueTypeFields stops after one page when Jira says nothing about more', async () => {
    const fetchSpy = vi.fn(async (_url: string) => new Response(JSON.stringify({ values: [{ fieldId: 'summary' }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchSpy);

    await getIssueTypeFields('ABC', '10001');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
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

  it('getProject fetches a project by key (for the prefill URL pid)', async () => {
    const fetchSpy = vi.fn(async (_url: string) => new Response(JSON.stringify({ id: '11900', key: 'ENCUC', name: 'Customer UC' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const project = await getProject('ENCUC');
    expect(project.id).toBe('11900');
    expect(fetchSpy.mock.calls[0][0]).toContain('/jira-proxy/rest/api/2/project/ENCUC');
  });
});
