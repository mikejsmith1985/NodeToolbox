// confluenceSource.test.ts — Proves the four Confluence failures are told apart, and that an unreachable
// Confluence is NEVER presented as an empty page (FR-023b, SC-018, INV-J6).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetchConfluencePageByReference, mockResolveConfluencePageIdFromReference } = vi.hoisted(() => ({
  mockFetchConfluencePageByReference: vi.fn(),
  mockResolveConfluencePageIdFromReference: vi.fn(),
}));

// The real error class is kept: classification depends on being able to recognise it.
vi.mock('../../../services/confluenceApi.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/confluenceApi.ts')>();
  return {
    ConfluenceRequestError: actual.ConfluenceRequestError,
    fetchConfluencePageByReference: mockFetchConfluencePageByReference,
    resolveConfluencePageIdFromReference: mockResolveConfluencePageIdFromReference,
  };
});

import { ConfluenceRequestError } from '../../../services/confluenceApi.ts';
import { ConfluenceSourceError, readConfluenceSource } from './confluenceSource';

const PAGE_URL = 'https://wiki/wiki/spaces/ART/pages/12345/Claims';
const NOW_ISO = '2026-07-15T09:00:00.000Z';

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveConfluencePageIdFromReference.mockReturnValue('12345');
  mockFetchConfluencePageByReference.mockResolvedValue({
    id: '12345',
    title: 'Claims brief',
    version: { number: 3 },
    body: { storage: { value: '<p>Claimants cannot attach documents.</p>', representation: 'storage' } },
  });
});

describe('readConfluenceSource — the happy path', () => {
  it('reuses the existing fetch rather than a new read path', async () => {
    await readConfluenceSource(PAGE_URL, [], NOW_ISO);

    expect(mockFetchConfluencePageByReference).toHaveBeenCalledWith(PAGE_URL);
  });

  it('stores the page as readable TEXT, never as markup to be rendered', async () => {
    const source = await readConfluenceSource(PAGE_URL, [], NOW_ISO);

    expect(source.text).toBe('Claimants cannot attach documents.');
    expect(source.text).not.toContain('<p>');
  });

  it('keeps the page URL so the PO can open the real page later (FR-024)', async () => {
    const source = await readConfluenceSource(PAGE_URL, [], NOW_ISO);

    expect(source.pageUrl).toBe(PAGE_URL);
    expect(source.pageId).toBe('12345');
  });

  it('carries the page title and the time it was fetched', async () => {
    const source = await readConfluenceSource(PAGE_URL, [], NOW_ISO);

    expect(source.title).toBe('Claims brief');
    expect(source.fetchedAtIso).toBe(NOW_ISO);
  });

  it('copes with a page that has no storage body', async () => {
    mockFetchConfluencePageByReference.mockResolvedValue({ id: '12345', title: 'Empty', version: { number: 1 } });

    const source = await readConfluenceSource(PAGE_URL, [], NOW_ISO);

    expect(source.text).toBe('');
  });
});

describe('readConfluenceSource — the four failures are told apart (SC-018)', () => {
  /** Runs a failing read and hands back the classified error. */
  async function captureFailure(status: number, proxyErrorCode?: string): Promise<ConfluenceSourceError> {
    mockFetchConfluencePageByReference.mockRejectedValue(
      new ConfluenceRequestError('Confluence GET page 12345 failed: something', status, proxyErrorCode),
    );
    try {
      await readConfluenceSource(PAGE_URL, [], NOW_ISO);
    } catch (error) {
      return error as ConfluenceSourceError;
    }
    throw new Error('Expected readConfluenceSource to reject.');
  }

  it('calls a 404 a missing page', async () => {
    const failure = await captureFailure(404);

    expect(failure.kind).toBe('not-found');
    expect(failure.message).toMatch(/does not exist/i);
  });

  it('calls a 403 a permission problem, distinct from a missing page', async () => {
    const failure = await captureFailure(403);

    expect(failure.kind).toBe('no-permission');
    expect(failure.message).toMatch(/cannot see it/i);
  });

  it('calls a 401 a permission problem too', async () => {
    expect((await captureFailure(401)).kind).toBe('no-permission');
  });

  it('calls a proxy 502 a CONNECTION problem and names the VPN', async () => {
    const failure = await captureFailure(502, 'Proxy error');

    expect(failure.kind).toBe('unreachable');
    expect(failure.message).toMatch(/VPN|connection/i);
  });

  it('tells "not configured" apart from "unreachable", though BOTH are 502', async () => {
    // The status cannot separate these; only the proxy's own error code can. Getting this wrong would
    // send a PO to check their VPN when in fact Confluence was never set up.
    const failure = await captureFailure(502, 'Confluence not configured');

    expect(failure.kind).toBe('not-configured');
    expect(failure.message).toMatch(/not set up|administrator/i);
  });

  it('NEVER returns an empty page for a failure — the PO is told, not misled (INV-J6)', async () => {
    for (const status of [404, 403, 502]) {
      mockFetchConfluencePageByReference.mockRejectedValue(
        new ConfluenceRequestError('failed', status),
      );
      await expect(readConfluenceSource(PAGE_URL, [], NOW_ISO)).rejects.toBeInstanceOf(ConfluenceSourceError);
    }
  });

  it('gives each failure a distinct message', async () => {
    const messages = [
      (await captureFailure(404)).message,
      (await captureFailure(403)).message,
      (await captureFailure(502, 'Proxy error')).message,
      (await captureFailure(502, 'Confluence not configured')).message,
    ];

    expect(new Set(messages).size).toBe(4);
  });
});

describe('readConfluenceSource — a link that is not a page', () => {
  it('asks for a URL when nothing was given, without calling Confluence', async () => {
    await expect(readConfluenceSource('   ', [], NOW_ISO)).rejects.toThrow(ConfluenceSourceError);
    expect(mockFetchConfluencePageByReference).not.toHaveBeenCalled();
  });

  it('rejects a link that is not a page, before wasting a request', async () => {
    mockResolveConfluencePageIdFromReference.mockReturnValue(null);

    const failedRead = readConfluenceSource('https://wiki/wiki/spaces/ART', [], NOW_ISO);

    await expect(failedRead).rejects.toThrow(/full page URL|numeric page ID/i);
    expect(mockFetchConfluencePageByReference).not.toHaveBeenCalled();
  });

  it('classifies an unexpected error rather than letting it escape raw', async () => {
    mockFetchConfluencePageByReference.mockRejectedValue(new Error('something odd'));

    try {
      await readConfluenceSource(PAGE_URL, [], NOW_ISO);
      throw new Error('should have rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfluenceSourceError);
      expect((error as ConfluenceSourceError).kind).toBe('unknown');
    }
  });
});
