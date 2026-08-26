// docLinkRunner.test.ts — The half that talks to Jira and Confluence, and decides nothing.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet, mockJiraPost, mockCreateIssue, mockCreateIssueLink, mockFindPage, mockCrawl } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockJiraPost: vi.fn(),
  mockCreateIssue: vi.fn(),
  mockCreateIssueLink: vi.fn(),
  mockFindPage: vi.fn(),
  mockCrawl: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  jiraPost: mockJiraPost,
  createIssue: mockCreateIssue,
  createIssueLink: mockCreateIssueLink,
}));
vi.mock('../../../services/confluenceApi.ts', () => ({
  findConfluencePageByTitle: mockFindPage,
  crawlConfluencePageTree: mockCrawl,
}));

import {
  buildDocLinkGlobalId,
  createSlStoryFromDevStory,
  fetchFeatureChildren,
  scanForDocLinks,
  writeDocLink,
} from './docLinkRunner.ts';

const SCAN_REQUEST = {
  spaceKey: 'MAVertical',
  rootPageTitle: 'ENCUC: CleanUpCrew: SF Integration',
  featureProjectKeys: ['DENP'],
  featureLinkFieldId: 'Feature Link',
  // 0 = the whole tree, so the existing tests keep measuring what they were written to measure.
  windowDays: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockJiraGet.mockResolvedValue({ issues: [] });
  mockJiraPost.mockResolvedValue({});
  mockFindPage.mockResolvedValue({ id: '100', title: SCAN_REQUEST.rootPageTitle, webUrl: 'https://c/100' });
  mockCrawl.mockResolvedValue({ pages: [], isTruncated: false });
});

describe('scanForDocLinks', () => {
  it('fails loudly when the root page cannot be found', async () => {
    // An empty crawl and a missing page look identical on screen and mean opposite things.
    mockFindPage.mockResolvedValue(null);

    const outcome = await scanForDocLinks(SCAN_REQUEST);

    expect(outcome.plan).toBeNull();
    expect(outcome.failureReason).toContain('If it was renamed');
  });

  it('plans a page that names a team issue', async () => {
    mockCrawl.mockResolvedValue({
      pages: [{ id: '1', title: 'ENCUC-1088 CMS Processor', webUrl: 'https://c/1' }],
      isTruncated: false,
    });

    const outcome = await scanForDocLinks(SCAN_REQUEST);

    expect(outcome.plan?.rows[0].route.targetIssueKey).toBe('ENCUC-1088');
    // No Feature to resolve, so Jira is not asked at all.
    expect(mockJiraGet).not.toHaveBeenCalled();
  });

  it('reads each Feature ONCE, however many pages sit under it', async () => {
    // Forty pages under one Feature would otherwise ask Jira forty times.
    mockCrawl.mockResolvedValue({
      pages: [
        { id: '1', title: 'DENP-475: part one', webUrl: 'https://c/1' },
        { id: '2', title: 'DENP-475: part two', webUrl: 'https://c/2' },
      ],
      isTruncated: false,
    });

    await scanForDocLinks(SCAN_REQUEST);

    expect(mockJiraGet).toHaveBeenCalledTimes(1);
  });

  it('reports a Feature it could not read as childless instead of failing the run', async () => {
    mockCrawl.mockResolvedValue({
      pages: [{ id: '1', title: 'DENP-475: x', webUrl: 'https://c/1' }],
      isTruncated: false,
    });
    mockJiraGet.mockRejectedValue(new Error('403'));

    const outcome = await scanForDocLinks(SCAN_REQUEST);

    expect(outcome.plan?.rows[0].route.outcome).toBe('feature-has-no-children');
  });

  it('writes nothing while planning', async () => {
    mockCrawl.mockResolvedValue({
      pages: [{ id: '1', title: 'ENCUC-1088 x', webUrl: 'https://c/1' }],
      isTruncated: false,
    });

    await scanForDocLinks(SCAN_REQUEST);

    expect(mockJiraPost).not.toHaveBeenCalled();
    expect(mockCreateIssue).not.toHaveBeenCalled();
  });

  it('carries a truncated crawl through, so counts read as a floor', async () => {
    mockCrawl.mockResolvedValue({ pages: [], isTruncated: true });

    expect((await scanForDocLinks(SCAN_REQUEST)).plan?.isTruncated).toBe(true);
  });
});

describe('fetchFeatureChildren', () => {
  it('searches by the Feature Link field the caller named, not by parent', async () => {
    // This instance attaches a story to a Feature by that field; `parent` does not carry it.
    mockJiraGet.mockResolvedValue({ issues: [{ key: 'ENCUC-1', fields: { summary: '[SL] x' } }] });

    const children = await fetchFeatureChildren('DENP-475', 'Feature Link');

    expect(decodeURIComponent(String(mockJiraGet.mock.calls[0][0]))).toContain('"Feature Link" = "DENP-475"');
    expect(children[0]).toEqual({ issueKey: 'ENCUC-1', summary: '[SL] x', assigneeCanInternalTest: null });
  });
});

describe('writeDocLink', () => {
  it('uses a stable globalId, so a nightly run updates rather than duplicating', async () => {
    // Without it an issue quietly accumulates thirty copies of one document.
    await writeDocLink('ENCUC-2358', 'COB/MSP Test Cases', 'https://c/1', '1');

    const [path, body] = mockJiraPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/rest/api/2/issue/ENCUC-2358/remotelink');
    expect(body.globalId).toBe(buildDocLinkGlobalId('1'));
  });

  it('points at the page and names it', async () => {
    await writeDocLink('ENCUC-2358', 'COB/MSP Test Cases', 'https://c/1', '1');

    const body = mockJiraPost.mock.calls[0][1] as { object: { url: string; title: string } };
    expect(body.object.url).toBe('https://c/1');
    expect(body.object.title).toBe('COB/MSP Test Cases');
  });
});

describe('createSlStoryFromDevStory', () => {
  const CLONE_REQUEST = {
    devStoryKey: 'ENCUC-2213',
    devStorySummary: '[DEV] COB/MSP ingestion',
    projectKey: 'ENCUC',
    issueTypeId: '10001',
    containmentLinkTypeName: 'Container',
  };

  it('creates the SL story with only the tag swapped', async () => {
    mockCreateIssue.mockResolvedValue({ key: 'ENCUC-2358' });

    const outcome = await createSlStoryFromDevStory(CLONE_REQUEST);

    const payload = mockCreateIssue.mock.calls[0][0] as { fields: { summary: string } };
    expect(payload.fields.summary).toBe('[SL] COB/MSP ingestion');
    expect(outcome.slStoryKey).toBe('ENCUC-2358');
  });

  it('links the new story as contained IN the dev story', async () => {
    mockCreateIssue.mockResolvedValue({ key: 'ENCUC-2358' });

    await createSlStoryFromDevStory(CLONE_REQUEST);

    expect(mockCreateIssueLink).toHaveBeenCalledWith({
      type: { name: 'Container' },
      inwardIssue: { key: 'ENCUC-2358' },
      outwardIssue: { key: 'ENCUC-2213' },
    });
  });

  it('keeps the created story when the link fails, and says the link failed', async () => {
    // A story that exists but is not yet nested is a smaller problem than one rolled back, and the
    // link can be added by hand.
    mockCreateIssue.mockResolvedValue({ key: 'ENCUC-2358' });
    mockCreateIssueLink.mockRejectedValue(new Error('No such link type'));

    const outcome = await createSlStoryFromDevStory(CLONE_REQUEST);

    expect(outcome.slStoryKey).toBe('ENCUC-2358');
    expect(outcome.linkError).toContain('No such link type');
  });
});
