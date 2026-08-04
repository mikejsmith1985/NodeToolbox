// githubEmailSharePointPull.test.ts — The macro-less GitHub email pull: list the SharePoint library
// folder through the relay, ask the server which files are new, download only those, and post them
// to the intake's sharepoint/run endpoint in size-capped batches. Relay + server I/O fully mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RelayRequest } from '../types/relay.ts';

// Relay mock: postRelayRequest records the request; waitForRelayResult answers from a path-keyed table.
const { mockPostRelayRequest, mockWaitForRelayResult, mockFetchRelayStatus, relayRequestsById } = vi.hoisted(() => ({
  mockPostRelayRequest: vi.fn(),
  mockWaitForRelayResult: vi.fn(),
  mockFetchRelayStatus: vi.fn(),
  relayRequestsById: new Map<string, RelayRequest>(),
}));
vi.mock('./relayBridgeApi.ts', () => ({
  postRelayRequest: mockPostRelayRequest,
  waitForRelayResult: mockWaitForRelayResult,
  fetchRelayStatus: mockFetchRelayStatus,
}));

import {
  batchEmailSources,
  pullSharePointEmails,
  type SharePointEmailSource,
} from './githubEmailSharePointPull.ts';

const FOLDER_URL = '/sites/Team/Shared Documents/GitHubEmails';

/** Wires the relay mocks so each posted request is answered by pathAnswers (first match wins). */
function wireRelay(pathAnswers: Array<{ pathIncludes: string; data: unknown }>): void {
  relayRequestsById.clear();
  mockPostRelayRequest.mockImplementation((request: RelayRequest) => {
    relayRequestsById.set(request.id, request);
    return Promise.resolve();
  });
  mockWaitForRelayResult.mockImplementation((requestId: string) => {
    const request = relayRequestsById.get(requestId);
    const answer = pathAnswers.find((candidate) => request !== undefined && request.path.includes(candidate.pathIncludes));
    if (!answer) {
      return Promise.resolve({ id: requestId, ok: false, status: 404, data: null, error: 'no stubbed answer' });
    }
    const data = typeof answer.data === 'string' ? answer.data : JSON.stringify(answer.data);
    return Promise.resolve({ id: requestId, ok: true, status: 200, data, error: null });
  });
}

/** Stubs global fetch to answer the two intake endpoints; returns the recorded run-call bodies. */
function wireServer(newFileNames: string[]): { runBodies: Array<{ sources: SharePointEmailSource[] }> } {
  const runBodies: Array<{ sources: SharePointEmailSource[] }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/sharepoint/filter-new')) {
      return new Response(JSON.stringify({ ok: true, newFileNames }), { status: 200 });
    }
    if (url.includes('/sharepoint/run')) {
      const body = JSON.parse(String(init?.body)) as { sources: SharePointEmailSource[] };
      runBodies.push(body);
      return new Response(JSON.stringify({
        ok: true,
        result: { postedCount: body.sources.length, skippedCount: 0, errorCount: 0 },
      }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }));
  return { runBodies };
}

beforeEach(() => {
  mockPostRelayRequest.mockReset();
  mockWaitForRelayResult.mockReset();
  mockFetchRelayStatus.mockReset();
  mockFetchRelayStatus.mockResolvedValue({ system: 'sharepoint', isConnected: true, lastPingAt: null, version: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pullSharePointEmails', () => {
  it('lists the folder, downloads only server-confirmed-new email files, and posts them for ingest', async () => {
    wireRelay([
      {
        pathIncludes: '/Files',
        data: { value: [
          { Name: 'old.eml', TimeCreated: '2026-08-01T00:00:00Z' },
          { Name: 'fresh.eml', TimeCreated: '2026-08-02T00:00:00Z' },
          { Name: 'image.png', TimeCreated: '2026-08-03T00:00:00Z' }, // not an email file — never listed
        ] },
      },
      { pathIncludes: '/$value', data: 'RAW EMAIL SOURCE' },
    ]);
    const { runBodies } = wireServer(['fresh.eml']);

    const summary = await pullSharePointEmails(FOLDER_URL);

    // Only the server-confirmed-new email file is downloaded and ingested.
    expect(summary.listedCount).toBe(2);
    expect(summary.newCount).toBe(1);
    expect(summary.postedCount).toBe(1);
    expect(runBodies).toHaveLength(1);
    expect(runBodies[0].sources).toEqual([{ fileName: 'fresh.eml', content: 'RAW EMAIL SOURCE' }]);

    // The download went through the relay against the file's server-relative path.
    const downloadRequest = [...relayRequestsById.values()].find((request) => request.path.includes('/$value'));
    expect(downloadRequest?.path).toContain(encodeURIComponent(`${FOLDER_URL}/fresh.eml`).replace(/'/g, '%27'));
  });

  it('fails fast with a clear message when the SharePoint relay is not connected', async () => {
    mockFetchRelayStatus.mockResolvedValue({ system: 'sharepoint', isConnected: false, lastPingAt: null, version: null });
    wireServer([]);
    await expect(pullSharePointEmails(FOLDER_URL)).rejects.toThrow(/relay/i);
    expect(mockPostRelayRequest).not.toHaveBeenCalled();
  });

  it('reports an all-caught-up pull without downloading anything', async () => {
    wireRelay([{ pathIncludes: '/Files', data: { value: [{ Name: 'old.eml', TimeCreated: '2026-08-01T00:00:00Z' }] } }]);
    wireServer([]);

    const summary = await pullSharePointEmails(FOLDER_URL);

    expect(summary).toMatchObject({ listedCount: 1, newCount: 0, postedCount: 0, errorCount: 0 });
    // No file download requests were issued — only the single folder listing.
    expect([...relayRequestsById.values()].filter((request) => request.path.includes('/$value'))).toHaveLength(0);
  });
});

describe('batchEmailSources', () => {
  it('splits by the per-batch file cap', () => {
    const sources = Array.from({ length: 45 }, (_unused, index) => ({ fileName: `f${index}.eml`, content: 'x' }));
    const batches = batchEmailSources(sources);
    expect(batches.map((batch) => batch.length)).toEqual([20, 20, 5]);
  });

  it('splits early when accumulated content would exceed the body-size budget', () => {
    const bigContent = 'a'.repeat(400_000);
    const sources = [
      { fileName: 'a.eml', content: bigContent },
      { fileName: 'b.eml', content: bigContent },
      { fileName: 'c.eml', content: 'small' },
    ];
    const batches = batchEmailSources(sources);
    // 400k + 400k would blow the 600k budget → b starts a new batch; c fits beside b.
    expect(batches.map((batch) => batch.map((source) => source.fileName))).toEqual([['a.eml'], ['b.eml', 'c.eml']]);
  });
});
