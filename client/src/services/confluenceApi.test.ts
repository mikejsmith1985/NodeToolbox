// confluenceApi.test.ts — Unit tests for the Confluence proxy client.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ConfluenceRequestError,
  createConfluenceDatabase,
  fetchConfluencePage,
  fetchConfluencePageByReference,
  loadSharedArtWorkspace,
  resolveConfluencePageIdFromReference,
  saveSharedArtWorkspace,
  SHARED_ART_DATABASE_PROPERTY_KEY,
  updateConfluencePage,
} from './confluenceApi.ts';

const MOCK_CONFLUENCE_PAGE = {
  id: '12345',
  type: 'page',
  title: 'PI Review',
  version: { number: 7 },
  body: {
    storage: {
      value: '<table><tbody><tr><th>Feature</th></tr></tbody></table>',
      representation: 'storage',
    },
  },
};

const MOCK_SHARED_ART_PAYLOAD = {
  schemaVersion: 1,
  artKey: 'S2E',
  artName: 'Systems Team',
  updatedAt: '2026-05-20T12:00:00.000Z',
  teams: [
    {
      id: 'team-1',
      name: 'Alpha Team',
      boardId: '42',
      projectKey: 'ALPHA',
    },
  ],
  settings: {
    piFieldId: 'customfield_10301',
    staleDays: 5,
  },
};

/** Registers a one-shot fetch mock that returns the given body and status. */
function mockFetchOnce(body: unknown, ok = true, status = 200): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('fetchConfluencePage', () => {
  it('loads a Confluence page through the proxy with the expected expand query', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(MOCK_CONFLUENCE_PAGE),
    } as Response);

    const result = await fetchConfluencePage('12345');

    expect(result.title).toBe('PI Review');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/confluence-proxy/wiki/rest/api/content/12345?expand=body.storage%2Cversion',
      undefined,
    );
  });

  it('throws a descriptive error when Confluence rejects the page load', async () => {
    mockFetchOnce({ message: 'Unauthorized' }, false, 401);
    await expect(fetchConfluencePage('12345')).rejects.toThrow('Confluence GET page 12345 failed: Unauthorized');
  });

  it('surfaces actionable guidance when the configured Confluence host cannot be resolved', async () => {
    mockFetchOnce({ message: 'getaddrinfo ENOTFOUND zilverton.atlassian.net' }, false, 502);
    await expect(fetchConfluencePage('12345')).rejects.toThrow(
      'Confluence GET page 12345 failed: Could not resolve the configured Confluence host. Check the Confluence base URL, VPN/DNS access, and Atlassian tenant name. Original error: getaddrinfo ENOTFOUND zilverton.atlassian.net',
    );
  });
});

describe('resolveConfluencePageIdFromReference', () => {
  it('accepts a bare numeric page ID', () => {
    expect(resolveConfluencePageIdFromReference('12345')).toBe('12345');
  });

  it('extracts the page ID from a Confluence pretty URL', () => {
    expect(
      resolveConfluencePageIdFromReference('https://example.atlassian.net/wiki/spaces/ART/pages/12345/PI-Review'),
    ).toBe('12345');
  });

  it('extracts the page ID from a viewpage URL', () => {
    expect(
      resolveConfluencePageIdFromReference('https://example.atlassian.net/wiki/pages/viewpage.action?pageId=67890'),
    ).toBe('67890');
  });

  it('returns null when the reference does not contain a supported page ID', () => {
    expect(resolveConfluencePageIdFromReference('https://example.atlassian.net/wiki/spaces/ART')).toBeNull();
  });
});

describe('fetchConfluencePageByReference', () => {
  it('loads a page when given a Confluence page URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(MOCK_CONFLUENCE_PAGE),
    } as Response);

    const result = await fetchConfluencePageByReference(
      'https://example.atlassian.net/wiki/spaces/ART/pages/12345/PI-Review',
    );

    expect(result.id).toBe('12345');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/confluence-proxy/wiki/rest/api/content/12345?expand=body.storage%2Cversion',
      undefined,
    );
  });

  it('throws a descriptive error when the page reference cannot be resolved', async () => {
    await expect(fetchConfluencePageByReference('https://example.atlassian.net/wiki/spaces/ART')).rejects.toThrow(
      'Confluence page URL or ID is invalid',
    );
  });
});

describe('updateConfluencePage', () => {
  it('sends the next page version and updated storage body to Confluence', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ...MOCK_CONFLUENCE_PAGE, version: { number: 8 } }),
    } as Response);

    await updateConfluencePage({
      pageId: '12345',
      pageTitle: 'PI Review',
      storageValue: '<p>Updated</p>',
      nextVersionNumber: 8,
    });

    const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(requestBody.version.number).toBe(8);
    expect(requestBody.body.storage.value).toBe('<p>Updated</p>');
  });

  it('throws a descriptive error when the save fails', async () => {
    mockFetchOnce({ message: 'Conflict' }, false, 409);
    await expect(
      updateConfluencePage({
        pageId: '12345',
        pageTitle: 'PI Review',
        storageValue: '<p>Updated</p>',
        nextVersionNumber: 8,
      }),
    ).rejects.toThrow('Confluence PUT page 12345 failed: Conflict');
  });
});

describe('createConfluenceDatabase', () => {
  it('creates a Confluence database through the v2 proxy', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'db-123', type: 'database', title: 'Systems Team', spaceId: '77' }),
    } as Response);

    const result = await createConfluenceDatabase({
      spaceId: '77',
      title: 'Systems Team',
      parentId: '9001',
    });

    expect(result.id).toBe('db-123');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/confluence-proxy/wiki/api/v2/databases',
      expect.objectContaining({
        method: 'POST',
      }),
    );

    const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(requestBody).toEqual({
      spaceId: '77',
      title: 'Systems Team',
      parentId: '9001',
    });
  });
});

describe('loadSharedArtWorkspace', () => {
  it('loads the shared ART payload from the Confluence database property', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          results: [{ id: 'prop-1', key: SHARED_ART_DATABASE_PROPERTY_KEY, version: { number: 4 } }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'prop-1',
          key: SHARED_ART_DATABASE_PROPERTY_KEY,
          value: MOCK_SHARED_ART_PAYLOAD,
          version: { number: 4 },
        }),
      } as Response);

    const result = await loadSharedArtWorkspace('db-123');

    expect(result.artKey).toBe('S2E');
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      '/confluence-proxy/wiki/api/v2/databases/db-123/properties?key=nodetoolbox-shared-art',
      undefined,
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      '/confluence-proxy/wiki/api/v2/databases/db-123/properties/prop-1',
      undefined,
    );
  });
});

describe('saveSharedArtWorkspace', () => {
  it('creates the shared ART property when it does not exist yet', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ results: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'prop-1',
          key: SHARED_ART_DATABASE_PROPERTY_KEY,
          value: MOCK_SHARED_ART_PAYLOAD,
          version: { number: 1 },
        }),
      } as Response);

    await saveSharedArtWorkspace('db-123', MOCK_SHARED_ART_PAYLOAD);

    const requestBody = JSON.parse(fetchSpy.mock.calls[1][1]?.body as string);
    expect(requestBody.key).toBe(SHARED_ART_DATABASE_PROPERTY_KEY);
    expect(requestBody.value.artKey).toBe('S2E');
    // Saving always stamps the current schema version (v2) regardless of the source payload's version.
    expect(requestBody.value.schemaVersion).toBe(2);
  });

  it('updates the shared ART property when it already exists', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          results: [{ id: 'prop-1', key: SHARED_ART_DATABASE_PROPERTY_KEY, version: { number: 4 } }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'prop-1',
          key: SHARED_ART_DATABASE_PROPERTY_KEY,
          value: MOCK_SHARED_ART_PAYLOAD,
          version: { number: 4 },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          id: 'prop-1',
          key: SHARED_ART_DATABASE_PROPERTY_KEY,
          value: MOCK_SHARED_ART_PAYLOAD,
          version: { number: 5 },
        }),
      } as Response);

    await saveSharedArtWorkspace('db-123', MOCK_SHARED_ART_PAYLOAD);

    const requestBody = JSON.parse(fetchSpy.mock.calls[2][1]?.body as string);
    expect(fetchSpy.mock.calls[2][0]).toBe('/confluence-proxy/wiki/api/v2/databases/db-123/properties/prop-1');
    expect(requestBody.version.number).toBe(5);
    expect(requestBody.value.artName).toBe('Systems Team');
  });
});

// ── Failure classification (feature 017) ──
//
// A Confluence read can fail four materially different ways, and a PO needs to be told which one:
// the page is missing, they cannot see it, Confluence is unreachable (VPN), or it is not configured.
// The message alone cannot separate these, so the thrown error carries the HTTP status and the
// proxy's own error code. See specs/017-po-feature-tools/contracts/jira-writes.md (INV-J6).

describe('ConfluenceRequestError — failure classification', () => {
  /** Runs a failing page load and hands back the thrown error for inspection. */
  async function captureFailure(body: unknown, status: number): Promise<ConfluenceRequestError> {
    mockFetchOnce(body, false, status);
    try {
      await fetchConfluencePage('12345');
    } catch (thrownError) {
      return thrownError as ConfluenceRequestError;
    }
    throw new Error('Expected fetchConfluencePage to reject.');
  }

  it('carries the HTTP status so a missing page is distinguishable', async () => {
    const failure = await captureFailure({ message: 'No content found with id 12345' }, 404);

    expect(failure).toBeInstanceOf(ConfluenceRequestError);
    expect(failure.status).toBe(404);
  });

  it('carries the HTTP status so a permission failure is distinguishable from a missing page', async () => {
    const failure = await captureFailure({ message: 'Not permitted' }, 403);

    expect(failure.status).toBe(403);
  });

  it('exposes the proxy error code so an unreachable Confluence is distinguishable', async () => {
    // The proxy reports transport failures as its own 502 — not something Confluence said.
    const failure = await captureFailure(
      { error: 'Proxy error', message: 'getaddrinfo ENOTFOUND zilverton.atlassian.net' },
      502,
    );

    expect(failure.status).toBe(502);
    expect(failure.proxyErrorCode).toBe('Proxy error');
  });

  it('exposes the proxy error code so an unconfigured Confluence is distinguishable from a network failure', async () => {
    // Both are 502; only the proxy's error code separates "not set up" from "cannot reach".
    const failure = await captureFailure(
      { error: 'Confluence not configured', message: 'Set TBX_CONFLUENCE_URL and credentials' },
      502,
    );

    expect(failure.status).toBe(502);
    expect(failure.proxyErrorCode).toBe('Confluence not configured');
  });

  it('leaves proxyErrorCode absent when the failure came from Confluence itself', async () => {
    const failure = await captureFailure({ message: 'Unauthorized' }, 401);

    expect(failure.proxyErrorCode).toBeUndefined();
  });

  it('remains a plain Error to existing callers that only read the message', async () => {
    // Every existing consumer renders error.message; that contract must not change.
    const failure = await captureFailure({ message: 'Unauthorized' }, 401);

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toBe('Confluence GET page 12345 failed: Unauthorized');
  });

  it('still rewrites a DNS failure into actionable guidance', async () => {
    const failure = await captureFailure(
      { message: 'getaddrinfo ENOTFOUND zilverton.atlassian.net' },
      502,
    );

    expect(failure.message).toContain('Could not resolve the configured Confluence host');
  });
});
