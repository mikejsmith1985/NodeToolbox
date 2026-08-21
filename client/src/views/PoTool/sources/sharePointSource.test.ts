// sharePointSource.test.ts — Taking documents out of a SharePoint library and into the workspace.
//
// The walk and the parsing are the server's; this is the half that asks for them and turns the
// answer into the same shape every other kind of material uses.
//
// Two things have to hold. A document that could not be read is REPORTED, because somebody who
// selected six and got five deserves to know which one is missing. And ids must stay unique across
// one run — two documents added together that collide on an id would knock each other out of the
// workspace, which looks exactly like the second one never being fetched.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  browseSharePointLibrary,
  fetchSharePointDocuments,
  SharePointSourceError,
  type LibraryDocumentSummary,
} from './sharePointSource.ts';

const NOW_ISO = '2026-08-21T12:00:00.000Z';

function document(name: string, url = `/sites/D/Docs/${name}`): LibraryDocumentSummary {
  return { name, folderPath: '/sites/D/Docs', serverRelativeUrl: url, modifiedAtIso: '2026-08-01T00:00:00Z' };
}

/** Stubs one fetch response. */
function stubFetch(status: number, body: unknown) {
  globalThis.fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('browseSharePointLibrary', () => {
  it('returns what the walk found', async () => {
    stubFetch(200, { ok: true, documents: [document('Standard.md')], unreadable: [], skippedTooDeep: [], visitedFolderCount: 2 });

    const result = await browseSharePointLibrary('/sites/D/Docs');

    expect(result.documents.map((each) => each.name)).toEqual(['Standard.md']);
    expect(result.visitedFolderCount).toBe(2);
  });

  it('carries through what could not be read and what was not looked at', async () => {
    // A result that showed only the readable documents would read as "this is everything in the
    // library", which is the one thing it must never imply.
    stubFetch(200, {
      ok: true,
      documents: [],
      unreadable: [{ name: 'Report.pdf', reason: 'pdf cannot be read here' }],
      skippedTooDeep: ['/sites/D/Docs/a/b/c/d/e/f/g'],
      visitedFolderCount: 7,
    });

    const result = await browseSharePointLibrary('/sites/D/Docs');

    expect(result.unreadable).toHaveLength(1);
    expect(result.skippedTooDeep).toHaveLength(1);
  });

  it('refuses an empty folder path without calling the server', async () => {
    stubFetch(200, {});
    await expect(browseSharePointLibrary('   ')).rejects.toThrow(SharePointSourceError);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('passes the server message through, because the fixes are all different', async () => {
    // A relay that is not running, a library not shared with the user and a locked document are
    // three problems with three fixes. "Could not load" sends somebody to the wrong one.
    stubFetch(502, { ok: false, message: 'Relay bridge is not active for sharepoint.' });

    await expect(browseSharePointLibrary('/sites/D/Docs')).rejects.toThrow(/Relay bridge is not active/);
  });

  it('still says something useful when the failure carries no message', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json'); },
    })) as unknown as typeof fetch;

    await expect(browseSharePointLibrary('/sites/D/Docs')).rejects.toThrow(/SharePoint relay/i);
  });
});

describe('fetchSharePointDocuments', () => {
  it('turns each fetched document into a workspace source, keeping its provenance', async () => {
    stubFetch(200, {
      ok: true,
      documents: [{ serverRelativeUrl: '/sites/D/Docs/Standard.md', text: 'Contrast 4.5:1', error: null }],
    });

    const result = await fetchSharePointDocuments([document('Standard.md')], [], NOW_ISO);

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].fileName).toBe('Standard.md');
    expect(result.sources[0].folderPath).toBe('/sites/D/Docs');
    expect(result.sources[0].text).toBe('Contrast 4.5:1');
  });

  it('reports a document that failed, rather than quietly returning fewer', async () => {
    stubFetch(200, {
      ok: true,
      documents: [
        { serverRelativeUrl: '/sites/D/Docs/A.md', text: 'first', error: null },
        { serverRelativeUrl: '/sites/D/Docs/B.md', text: '', error: '423 Locked' },
      ],
    });

    const result = await fetchSharePointDocuments([document('A.md'), document('B.md')], [], NOW_ISO);

    expect(result.sources).toHaveLength(1);
    expect(result.failures).toEqual([{ name: 'B.md', reason: '423 Locked' }]);
  });

  it('treats an empty document as a failure, not as a source with nothing in it', async () => {
    // An empty source would ride in every prompt announcing a heading and no content, which reads
    // to an assistant as "this document says nothing" rather than "this was not readable".
    stubFetch(200, { ok: true, documents: [{ serverRelativeUrl: '/sites/D/Docs/A.md', text: '   ', error: null }] });

    const result = await fetchSharePointDocuments([document('A.md')], [], NOW_ISO);

    expect(result.sources).toHaveLength(0);
    expect(result.failures[0].reason).toMatch(/empty/i);
  });

  it('gives two documents fetched together different ids', async () => {
    // Minted against the growing list, not the original one. Colliding ids would knock one document
    // out of the workspace, which looks exactly like it never having been fetched.
    stubFetch(200, {
      ok: true,
      documents: [
        { serverRelativeUrl: '/sites/D/Docs/A.md', text: 'first', error: null },
        { serverRelativeUrl: '/sites/D/Docs/B.md', text: 'second', error: null },
      ],
    });

    const result = await fetchSharePointDocuments([document('A.md'), document('B.md')], [], NOW_ISO);

    expect(result.sources[0].id).not.toBe(result.sources[1].id);
  });

  it('asks the server for nothing when nothing was selected', async () => {
    stubFetch(200, {});
    const result = await fetchSharePointDocuments([], [], NOW_ISO);

    expect(result.sources).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
