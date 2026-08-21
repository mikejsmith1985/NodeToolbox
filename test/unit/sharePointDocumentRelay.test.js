// sharePointDocumentRelay.test.js — Walking a SharePoint document library, not an inbox.
//
// The email relay reads ONE flat folder and treats every file as a message to be parsed and then
// recycled. A document library is the opposite shape: nested folders somebody organised on purpose,
// files that are reference material, and nothing to consume or delete. Sharing the path helpers is
// right; sharing the behaviour would be wrong.
//
// The rule that matters here is the walk's bounds. A library can be enormous, and a reader that
// followed it wherever it led would hang the browser tab doing the fetching.

'use strict';

const {
  browseDocumentLibrary,
  buildFolderListingPath,
  buildDocumentListingPath,
  isReadableDocumentName,
  MAX_FOLDER_DEPTH,
  planDocumentWalk,
  selectReadableDocuments,
} = require('../../src/services/sharePointDocumentRelay');

describe('buildFolderListingPath', () => {
  test('asks for the SUBFOLDERS of a folder, which the email listing never needed', () => {
    const path = buildFolderListingPath('/sites/Delivery/Shared Documents/Standards');
    expect(path).toContain('/Folders');
    expect(path).toContain('/sites/Delivery');
  });

  test('keeps the decodedUrl form, because a path with a # 404s the older one', () => {
    const path = buildFolderListingPath('/sites/Delivery/Shared Documents/Q1 #1');
    expect(path).toContain('decodedUrl=@folderPath');
    expect(path).toContain(encodeURIComponent('/sites/Delivery/Shared Documents/Q1 #1'));
  });

  test('doubles a quote in a folder name rather than breaking the OData parameter', () => {
    expect(buildFolderListingPath("/sites/D/Bob's Docs")).toContain(encodeURIComponent("Bob''s Docs"));
  });
});

describe('buildDocumentListingPath', () => {
  test('asks for the fields a person needs to choose a document', () => {
    // A bare name is not enough to pick from: when it changed and how big it is are what tell a
    // reader whether they are looking at the current standard or last year's.
    const path = buildDocumentListingPath('/sites/Delivery/Shared Documents');
    expect(path).toContain('Name');
    expect(path).toContain('TimeLastModified');
    expect(path).toContain('ServerRelativeUrl');
  });
});

describe('isReadableDocumentName', () => {
  test('accepts the text formats a document library really holds', () => {
    ['Standard.txt', 'notes.md', 'export.csv', 'page.aspx', 'summary.html'].forEach((name) => {
      expect(isReadableDocumentName(name)).toBe(true);
    });
  });

  test('accepts a spreadsheet, which the app can already read', () => {
    expect(isReadableDocumentName('Capacity.xlsx')).toBe(true);
  });

  test('refuses formats nothing here can turn into text', () => {
    // Named rather than silently skipped by the caller — a document library is mostly Word and PDF,
    // and a reader that quietly ignored them would look broken rather than limited.
    ['Spec.docx', 'Report.pdf', 'Diagram.png', 'Deck.pptx'].forEach((name) => {
      expect(isReadableDocumentName(name)).toBe(false);
    });
  });

  test('ignores case, because SharePoint preserves whatever was typed', () => {
    expect(isReadableDocumentName('STANDARD.TXT')).toBe(true);
  });
});

describe('selectReadableDocuments', () => {
  const listing = [
    { Name: 'Standard.txt', ServerRelativeUrl: '/sites/D/Standard.txt', TimeLastModified: '2026-08-01T00:00:00Z' },
    { Name: 'Spec.docx', ServerRelativeUrl: '/sites/D/Spec.docx', TimeLastModified: '2026-08-02T00:00:00Z' },
    { Name: 'Report.pdf', ServerRelativeUrl: '/sites/D/Report.pdf', TimeLastModified: '2026-08-03T00:00:00Z' },
  ];

  test('splits what it can read from what it cannot, keeping both', () => {
    const result = selectReadableDocuments(listing);

    expect(result.readable.map((document) => document.name)).toEqual(['Standard.txt']);
    expect(result.unreadable.map((document) => document.name)).toEqual(['Spec.docx', 'Report.pdf']);
  });

  test('says WHY each unreadable one was left out, in words a person can act on', () => {
    const result = selectReadableDocuments(listing);
    result.unreadable.forEach((document) => expect(document.reason).toMatch(/cannot be read as text/i));
  });

  test('survives a listing entry with no name at all', () => {
    expect(() => selectReadableDocuments([{}])).not.toThrow();
    expect(selectReadableDocuments([{}]).readable).toEqual([]);
  });
});

describe('planDocumentWalk', () => {
  test('starts at the folder it was given', () => {
    const plan = planDocumentWalk('/sites/Delivery/Shared Documents', []);
    expect(plan.foldersToVisit).toEqual(['/sites/Delivery/Shared Documents']);
  });

  test('queues the subfolders it discovers', () => {
    const plan = planDocumentWalk('/sites/D/Docs', [
      { ServerRelativeUrl: '/sites/D/Docs/Standards' },
      { ServerRelativeUrl: '/sites/D/Docs/Archive' },
    ]);

    expect(plan.foldersToVisit).toContain('/sites/D/Docs/Standards');
    expect(plan.foldersToVisit).toContain('/sites/D/Docs/Archive');
  });

  test('stops descending past the depth limit rather than following a library forever', () => {
    // A document library can be enormous, and the browser tab doing the fetching is the user's own.
    // The bound is stated so a truncated walk is a reported fact, not a silent one.
    const deepFolder = '/sites/D/Docs' + '/deeper'.repeat(MAX_FOLDER_DEPTH + 2);
    const plan = planDocumentWalk('/sites/D/Docs', [{ ServerRelativeUrl: deepFolder }]);

    expect(plan.foldersToVisit).not.toContain(deepFolder);
    expect(plan.skippedTooDeep).toContain(deepFolder);
  });

  test('never queues the same folder twice, so a loop cannot spin', () => {
    const plan = planDocumentWalk('/sites/D/Docs', [
      { ServerRelativeUrl: '/sites/D/Docs/Standards' },
      { ServerRelativeUrl: '/sites/D/Docs/Standards' },
    ]);

    const standardsCount = plan.foldersToVisit.filter((folder) => folder.endsWith('/Standards')).length;
    expect(standardsCount).toBe(1);
  });

  test('ignores a subfolder entry carrying no url', () => {
    expect(() => planDocumentWalk('/sites/D/Docs', [{}])).not.toThrow();
  });
});

describe('browseDocumentLibrary', () => {
  /** Answers listing requests from a fixture keyed by folder, so the walk runs with no SharePoint. */
  function relayStub(libraryByFolder) {
    return async (system, request) => {
      const folderMatch = /@folderPath='([^']*)'/.exec(request.url);
      const folder = decodeURIComponent((folderMatch ? folderMatch[1] : '').replace(/''/g, "'"));
      const contents = libraryByFolder[folder] || { files: [], folders: [] };
      const isFolderListing = request.url.includes('/Folders');
      return { value: isFolderListing ? contents.folders : contents.files };
    };
  }

  test('collects documents from every folder it walks into', async () => {
    const result = await browseDocumentLibrary('/sites/D/Docs', {
      submitRelayRequest: relayStub({
        '/sites/D/Docs': {
          files: [{ Name: 'Root.md', ServerRelativeUrl: '/sites/D/Docs/Root.md' }],
          folders: [{ ServerRelativeUrl: '/sites/D/Docs/Standards' }],
        },
        '/sites/D/Docs/Standards': {
          files: [{ Name: 'Accessibility.md', ServerRelativeUrl: '/sites/D/Docs/Standards/Accessibility.md' }],
          folders: [],
        },
      }),
    });

    expect(result.documents.map((document) => document.name).sort()).toEqual(['Accessibility.md', 'Root.md']);
    expect(result.visitedFolderCount).toBe(2);
  });

  test('records where each document was found, because two folders can hold one name', async () => {
    const result = await browseDocumentLibrary('/sites/D/Docs', {
      submitRelayRequest: relayStub({
        '/sites/D/Docs': { files: [{ Name: 'Notes.md', ServerRelativeUrl: '/x' }], folders: [] },
      }),
    });

    expect(result.documents[0].folderPath).toBe('/sites/D/Docs');
  });

  test('reports what it could not read rather than leaving it out silently', async () => {
    const result = await browseDocumentLibrary('/sites/D/Docs', {
      submitRelayRequest: relayStub({
        '/sites/D/Docs': { files: [{ Name: 'Spec.docx', ServerRelativeUrl: '/x' }], folders: [] },
      }),
    });

    expect(result.documents).toEqual([]);
    expect(result.unreadable[0].name).toBe('Spec.docx');
  });

  test('visits a folder once however many times it is linked', async () => {
    // A library that links a folder into itself would otherwise walk forever, on the user's own tab.
    const result = await browseDocumentLibrary('/sites/D/Docs', {
      submitRelayRequest: relayStub({
        '/sites/D/Docs': { files: [], folders: [{ ServerRelativeUrl: '/sites/D/Docs' }] },
      }),
    });

    expect(result.visitedFolderCount).toBe(1);
  });
});
