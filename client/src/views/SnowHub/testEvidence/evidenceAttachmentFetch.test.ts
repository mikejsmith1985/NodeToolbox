// evidenceAttachmentFetch.test.ts — Reading which files a release's issues carry, then their bytes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import {
  buildAttachmentProxyPath,
  downloadAttachmentBytes,
  loadReleaseAttachments,
} from './evidenceAttachmentFetch.ts';

function issueResult(key: string, attachments: unknown[] = []) {
  return { key, fields: { summary: `Summary ${key}`, attachment: attachments } };
}

function jiraAttachment(overrides: Record<string, unknown> = {}) {
  return {
    id: '1001',
    filename: 'regression-run.pdf',
    size: 2048,
    mimeType: 'application/pdf',
    created: '2026-09-01T10:00:00.000+0000',
    author: { displayName: 'Ramirez, Dana' },
    content: 'https://jira.example.com/secure/attachment/1001/regression-run.pdf',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockJiraGet.mockResolvedValue({ issues: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadReleaseAttachments', () => {
  it('asks for the whole release in ONE search, requesting only summary and attachments', async () => {
    mockJiraGet.mockResolvedValue({ issues: [issueResult('ENCUC-1'), issueResult('ENCUC-2')] });

    await loadReleaseAttachments(['ENCUC-1', 'ENCUC-2']);

    expect(mockJiraGet).toHaveBeenCalledTimes(1);
    const requestedPath = decodeURIComponent(String(mockJiraGet.mock.calls[0][0]));
    expect(requestedPath).toContain('key in ("ENCUC-1","ENCUC-2")');
    expect(requestedPath).toContain('fields=summary,attachment');
    expect(requestedPath).toContain('maxResults=2');
  });

  it('costs no request for an empty key list', async () => {
    const outcome = await loadReleaseAttachments([]);

    expect(mockJiraGet).not.toHaveBeenCalled();
    expect(outcome).toEqual({ issues: [], missingKeys: [] });
  });

  it('reduces each attachment to what the bundle planner needs', async () => {
    mockJiraGet.mockResolvedValue({ issues: [issueResult('ENCUC-1', [jiraAttachment()])] });

    const outcome = await loadReleaseAttachments(['ENCUC-1']);

    expect(outcome.issues).toEqual([{
      key: 'ENCUC-1',
      summary: 'Summary ENCUC-1',
      attachments: [{
        attachmentId: '1001',
        filename: 'regression-run.pdf',
        sizeBytes: 2048,
        mimeType: 'application/pdf',
        created: '2026-09-01T10:00:00.000+0000',
        authorName: 'Ramirez, Dana',
        contentUrl: 'https://jira.example.com/secure/attachment/1001/regression-run.pdf',
      }],
    }]);
  });

  it('keeps an issue with no attachments, so the reviewer sees it brought nothing', async () => {
    mockJiraGet.mockResolvedValue({ issues: [issueResult('ENCUC-1')] });

    const outcome = await loadReleaseAttachments(['ENCUC-1']);

    expect(outcome.issues[0].attachments).toEqual([]);
  });

  it('names the keys Jira did not return', async () => {
    mockJiraGet.mockResolvedValue({ issues: [issueResult('ENCUC-1')] });

    const outcome = await loadReleaseAttachments(['ENCUC-1', 'ENCUC-404']);

    expect(outcome.missingKeys).toEqual(['ENCUC-404']);
  });

  it('tolerates an attachment missing its optional fields', async () => {
    mockJiraGet.mockResolvedValue({
      issues: [issueResult('ENCUC-1', [{ id: 9, filename: 'x.png', size: '10', content: 'https://j/secure/attachment/9/x.png' }])],
    });

    const outcome = await loadReleaseAttachments(['ENCUC-1']);

    expect(outcome.issues[0].attachments[0]).toMatchObject({ attachmentId: '9', sizeBytes: 10, filename: 'x.png' });
    expect(outcome.issues[0].attachments[0].authorName).toBeUndefined();
  });
});

describe('buildAttachmentProxyPath', () => {
  it('routes the Jira content URL through the local Jira proxy by its path alone', () => {
    // The host is dropped on purpose: the proxy owns the base URL, and a Data Center instance
    // sometimes advertises attachments on a hostname the proxy is not configured for.
    expect(buildAttachmentProxyPath('https://jira.example.com/secure/attachment/1001/regression%20run.pdf'))
      .toBe('/jira-proxy/secure/attachment/1001/regression%20run.pdf');
  });

  it('keeps a query string, which some instances use for the content token', () => {
    expect(buildAttachmentProxyPath('https://jira.example.com/secure/attachment/1/a.png?token=abc'))
      .toBe('/jira-proxy/secure/attachment/1/a.png?token=abc');
  });

  it('accepts a path-only content value', () => {
    expect(buildAttachmentProxyPath('/secure/attachment/1/a.png')).toBe('/jira-proxy/secure/attachment/1/a.png');
  });
});

describe('downloadAttachmentBytes', () => {
  it('fetches through the proxy and returns the exact bytes', async () => {
    const fileBytes = new Uint8Array([1, 2, 3, 4]);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => fileBytes.buffer,
    });
    vi.stubGlobal('fetch', mockFetch);

    const downloaded = await downloadAttachmentBytes('https://jira.example.com/secure/attachment/1/a.png');

    expect(mockFetch).toHaveBeenCalledWith('/jira-proxy/secure/attachment/1/a.png');
    expect(Array.from(downloaded)).toEqual([1, 2, 3, 4]);
  });

  it('refuses a failed download rather than zipping an error page as evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }));

    await expect(downloadAttachmentBytes('https://jira.example.com/secure/attachment/1/a.png'))
      .rejects.toThrow('404');
  });
});
