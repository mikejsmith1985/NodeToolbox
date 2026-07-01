// sharepointIntakeApi.test.ts — Covers the field-map resolution (incl. reserved-id + missing
// columns) and paginated item fetch, with the relay mocked.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { postRelayRequest, waitForRelayResult } from './relayBridgeApi.ts';
import { fetchListItems, normalizeSitePath, resolveListFieldMap } from './sharepointIntakeApi.ts';

vi.mock('./relayBridgeApi.ts', () => ({ postRelayRequest: vi.fn(), waitForRelayResult: vi.fn() }));
const postRequestMock = vi.mocked(postRelayRequest);
const waitResultMock = vi.mocked(waitForRelayResult);

const SOURCE = { siteRelativeUrl: '/sites/CUCIntake', listName: 'Jira-Intake' };

/** Queues a relay result (raw JSON text) for the next waitForRelayResult call. */
function relayReturns(body: unknown): void {
  waitResultMock.mockResolvedValueOnce({ id: 'x', ok: true, status: 200, data: JSON.stringify(body), error: null });
}

afterEach(() => { vi.clearAllMocks(); });

describe('normalizeSitePath', () => {
  it('ensures a leading slash and strips trailing slashes', () => {
    expect(normalizeSitePath('sites/CUCIntake/')).toBe('/sites/CUCIntake');
    expect(normalizeSitePath('/sites/CUCIntake')).toBe('/sites/CUCIntake');
    expect(normalizeSitePath('   ')).toBe('');
  });
});

describe('resolveListFieldMap', () => {
  it('builds display→internal map and reports missing expected columns', async () => {
    relayReturns({
      value: [
        { Title: 'id', InternalName: '_x0069_d' },       // reserved id renamed
        { Title: 'summary', InternalName: 'summary' },
        { Title: 'project', InternalName: 'project' },
      ],
    });

    const map = await resolveListFieldMap(SOURCE);
    expect(map.byDisplayName.get('id')).toBe('_x0069_d');
    expect(map.byDisplayName.get('summary')).toBe('summary');
    expect(map.missingColumns).toContain('submittedAt'); // not in the mocked fields
    const requestedPath = postRequestMock.mock.calls[0][0].path;
    expect(requestedPath).toContain("/sites/CUCIntake/_api/web/lists/getbytitle('Jira-Intake')/fields");
  });
});

describe('fetchListItems', () => {
  it('follows odata.nextLink across pages and returns all items', async () => {
    relayReturns({ value: [{ Id: 1 }], 'odata.nextLink': "https://contoso.sharepoint.com/sites/CUCIntake/_api/web/lists/getbytitle('Jira-Intake')/items?$skiptoken=p2" });
    relayReturns({ value: [{ Id: 2 }] });

    const fieldMap = new Map<string, string>([['id', '_x0069_d'], ['summary', 'summary']]);
    const items = await fetchListItems(SOURCE, fieldMap);

    expect(items).toEqual([{ Id: 1 }, { Id: 2 }]);
    expect(postRequestMock).toHaveBeenCalledTimes(2);
    // Second request uses the origin-relative nextLink path.
    expect(postRequestMock.mock.calls[1][0].path).toContain('$skiptoken=p2');
  });

  it('rejects when the relay reports a non-ok result', async () => {
    waitResultMock.mockResolvedValueOnce({ id: 'x', ok: false, status: 403, data: null, error: 'Access denied' });
    await expect(fetchListItems(SOURCE, new Map([['id', 'id']]))).rejects.toThrow(/403|Access denied/);
  });
});
