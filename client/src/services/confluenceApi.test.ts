// confluenceApi.test.ts — Unit tests for the Confluence proxy client.

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
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
