// sharePointDocumentsRoute.test.js — The two endpoints behind the document browser.
//
// Browsing returns NAMES; fetching returns contents for an explicit list. They are separate on
// purpose: a library holds hundreds of documents, and fetching them all to find the three that
// matter is the cost this whole design exists to avoid.

'use strict';

const mockBrowse = jest.fn();
const mockDownload = jest.fn();

jest.mock('../../src/services/sharePointDocumentRelay', () => ({
  browseDocumentLibrary: mockBrowse,
  downloadDocumentText: mockDownload,
}));

const express = require('express');
const request = require('supertest');
const createRouter = require('./sharePointDocuments');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(createRouter());
  return app;
}

beforeEach(() => {
  mockBrowse.mockReset();
  mockDownload.mockReset();
});

describe('POST /api/sharepoint-documents/browse', () => {
  test('returns what the walk found, contents and all omissions', async () => {
    mockBrowse.mockResolvedValue({
      documents: [{ name: 'Standard.md' }],
      unreadable: [{ name: 'Spec.docx', reason: 'docx cannot be read as text here' }],
      skippedTooDeep: ['/sites/D/Docs/very/deep'],
      visitedFolderCount: 3,
    });

    const response = await request(buildApp())
      .post('/api/sharepoint-documents/browse')
      .send({ folderUrl: '/sites/D/Docs' });

    expect(response.status).toBe(200);
    expect(response.body.documents).toHaveLength(1);
    expect(response.body.unreadable).toHaveLength(1);
    expect(response.body.skippedTooDeep).toHaveLength(1);
  });

  test('refuses a request with no folder rather than walking the whole site', async () => {
    const response = await request(buildApp()).post('/api/sharepoint-documents/browse').send({});
    expect(response.status).toBe(400);
    expect(mockBrowse).not.toHaveBeenCalled();
  });

  test('reports a relay failure as an upstream problem, not a crash', async () => {
    mockBrowse.mockRejectedValue(new Error('Relay bridge is not active for sharepoint'));

    const response = await request(buildApp())
      .post('/api/sharepoint-documents/browse')
      .send({ folderUrl: '/sites/D/Docs' });

    expect(response.status).toBe(502);
    expect(response.body.message).toMatch(/Relay bridge is not active/);
  });
});

describe('POST /api/sharepoint-documents/fetch', () => {
  test('reads only the documents it was asked for', async () => {
    mockDownload.mockResolvedValue('the text');

    const response = await request(buildApp())
      .post('/api/sharepoint-documents/fetch')
      .send({ serverRelativeUrls: ['/sites/D/Docs/A.md'] });

    expect(response.status).toBe(200);
    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(response.body.documents[0].text).toBe('the text');
  });

  test('one unreadable document does not abandon the rest', async () => {
    // A fetch of three that returns nothing because the second was locked is worse than one that
    // returns two and says which it could not read.
    mockDownload
      .mockResolvedValueOnce('first')
      .mockRejectedValueOnce(new Error('423 Locked'))
      .mockResolvedValueOnce('third');

    const response = await request(buildApp())
      .post('/api/sharepoint-documents/fetch')
      .send({ serverRelativeUrls: ['/a', '/b', '/c'] });

    expect(response.body.documents.map((document) => document.text)).toEqual(['first', '', 'third']);
    expect(response.body.documents[1].error).toMatch(/423 Locked/);
  });

  test('refuses an empty list rather than returning a cheerful nothing', async () => {
    const response = await request(buildApp()).post('/api/sharepoint-documents/fetch').send({ serverRelativeUrls: [] });
    expect(response.status).toBe(400);
  });

  test('refuses a list long enough to hang the relay, saying what to do instead', async () => {
    const manyUrls = Array.from({ length: 200 }, (_unused, index) => `/doc-${index}`);
    const response = await request(buildApp())
      .post('/api/sharepoint-documents/fetch')
      .send({ serverRelativeUrls: manyUrls });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/narrow the selection/i);
    expect(mockDownload).not.toHaveBeenCalled();
  });
});
