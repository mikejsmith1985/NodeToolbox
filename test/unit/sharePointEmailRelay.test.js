// test/unit/sharePointEmailRelay.test.js — The SharePoint transport, now driven from the server.
//
// This is the half of the intake that used to live in the browser tab, which is why the schedule had
// to live there too. Everything here executes in the user's SharePoint tab exactly as before; the
// only change is who decides what to ask for.

'use strict';

const relay = require('../../src/services/sharePointEmailRelay');

const FOLDER = '/sites/Transformers/Shared Documents/GitHub Emails';

describe('path building', () => {
  it('uses the decodedUrl alias form, which is what survives a # in a file name', () => {
    // Every GitHub PR email subject contains '#', and the older ByServerRelativeUrl form 404s on it
    // even percent-encoded. This is the exact production failure on "… (PR #2636)".
    expect(relay.buildListingPath(FOLDER)).toContain('GetFolderByServerRelativePath(decodedUrl=@folderPath)');
    expect(relay.buildDownloadPath(FOLDER, 'Update (PR #2636)')).toContain('decodedUrl=@filePath');
  });

  it('finds the managed path root so _api is addressed on the right web', () => {
    expect(relay.siteRootOfFolder(FOLDER)).toBe('/sites/Transformers');
    expect(relay.siteRootOfFolder('/teams/Alpha/Docs')).toBe('/teams/Alpha');
    expect(relay.siteRootOfFolder('/Shared Documents/x')).toBe('');
  });

  it('doubles a quote inside a name, which OData needs to read it as data', () => {
    expect(relay.encodeRestPathParameter("O'Brien")).toBe(encodeURIComponent("O''Brien"));
  });

  it('recycles rather than hard-deletes, so being wrong costs a restore', () => {
    expect(relay.buildRecyclePath(FOLDER, 'mail.eml')).toContain('/recycle()');
  });
});

describe('readNextListingPath', () => {
  it('keeps a relative next link as-is', () => {
    expect(relay.readNextListingPath('/sites/x/_api/web/next?p=2')).toBe('/sites/x/_api/web/next?p=2');
  });

  it('strips the origin from an absolute one, which would otherwise double the host', () => {
    // The bookmarklet builds its target as location.origin + path.
    expect(relay.readNextListingPath('https://contoso.sharepoint.com/sites/x/_api/next?p=2'))
      .toBe('/sites/x/_api/next?p=2');
  });

  it('treats a missing or unreadable link as the end of the listing', () => {
    expect(relay.readNextListingPath(undefined)).toBeNull();
    expect(relay.readNextListingPath('')).toBeNull();
    expect(relay.readNextListingPath('not a url')).toBeNull();
  });
});

describe('selectEmailFileNames', () => {
  it('ingests oldest first, so processing follows arrival order', () => {
    const selected = relay.selectEmailFileNames([
      { Name: 'second', TimeCreated: '2026-08-02T00:00:00Z' },
      { Name: 'first', TimeCreated: '2026-08-01T00:00:00Z' },
    ]);

    expect(selected.emailFileNames).toEqual(['first', 'second']);
  });

  it('counts skipped binaries rather than dropping them silently', () => {
    const selected = relay.selectEmailFileNames([
      { Name: 'mail-one', TimeCreated: '2026-08-01T00:00:00Z' },
      { Name: 'screenshot.png', TimeCreated: '2026-08-01T00:00:00Z' },
    ]);

    expect(selected.emailFileNames).toEqual(['mail-one']);
    expect(selected.unsupportedCount).toBe(1);
  });

  it('keeps an extensionless name, because Power Automate names files by the email subject', () => {
    const selected = relay.selectEmailFileNames([{ Name: 'Update template.yaml (PR #3800)', TimeCreated: '' }]);

    expect(selected.emailFileNames).toHaveLength(1);
  });
});

describe('collectNewSharePointSources', () => {
  it('lists, asks what is new, then downloads only those', async () => {
    const requested = [];
    const submitRelayRequest = jest.fn(async (sys, request) => {
      requested.push(request.url);
      if (request.url.includes('/Files')) {
        return { value: [{ Name: 'old-mail', TimeCreated: '2026-08-01T00:00:00Z' },
          { Name: 'new-mail', TimeCreated: '2026-08-02T00:00:00Z' }] };
      }
      return 'raw email text';
    });

    const collected = await relay.collectNewSharePointSources(
      FOLDER,
      async () => ['new-mail'],
      { submitRelayRequest },
    );

    expect(collected.sources).toEqual([{ fileName: 'new-mail', content: 'raw email text' }]);
    expect(collected.listedCount).toBe(2);
    // The already-ingested one is never downloaded — that is the whole point of the ledger.
    expect(requested.filter((url) => url.includes('old-mail'))).toHaveLength(0);
  });

  it('follows SharePoint paging, because a backlog is the normal state of this folder', async () => {
    let pageIndex = 0;
    const submitRelayRequest = jest.fn(async () => {
      pageIndex += 1;
      return pageIndex === 1
        ? { value: [{ Name: 'page-one', TimeCreated: '2026-08-01T00:00:00Z' }], 'odata.nextLink': '/sites/x/_api/next' }
        : { value: [{ Name: 'page-two', TimeCreated: '2026-08-02T00:00:00Z' }] };
    });

    const listing = await relay.listFolderEmailFiles(FOLDER, { submitRelayRequest });

    expect(listing.emailFileNames).toEqual(['page-one', 'page-two']);
  });
});

describe('recycleConfirmedFiles', () => {
  it('deletes only what the ledger confirms was recorded', async () => {
    const recycled = [];
    const submitRelayRequest = jest.fn(async (sys, request) => {
      if (request.method === 'POST') recycled.push(request.url);
      return {};
    });

    // 'failed-mail' is still new, so the run did not record it — a batch can report success while one
    // email failed to parse, and that email has to survive for somebody to look at.
    const outcome = await relay.recycleConfirmedFiles(
      FOLDER,
      ['ingested-mail', 'failed-mail'],
      async () => ['failed-mail'],
      { submitRelayRequest },
    );

    expect(outcome.deletedCount).toBe(1);
    expect(outcome.keptCount).toBe(1);
    expect(recycled.join(' ')).toContain('ingested-mail');
    expect(recycled.join(' ')).not.toContain('failed-mail');
  });

  it('keeps a file it cannot delete rather than failing the sweep', async () => {
    const submitRelayRequest = jest.fn(async (sys, request) => {
      if (request.method === 'POST') throw new Error('423 locked');
      return {};
    });

    const outcome = await relay.recycleConfirmedFiles(FOLDER, ['mail'], async () => [], { submitRelayRequest });

    // Untidy, never incorrect: the ledger stops it being processed twice.
    expect(outcome.deletedCount).toBe(0);
    expect(outcome.keptCount).toBe(1);
  });

  it('asks nothing when there is nothing to clear', async () => {
    const submitRelayRequest = jest.fn();

    expect(await relay.recycleConfirmedFiles(FOLDER, [], async () => [], { submitRelayRequest }))
      .toEqual({ deletedCount: 0, keptCount: 0 });
    expect(submitRelayRequest).not.toHaveBeenCalled();
  });
});
