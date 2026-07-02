// sharepointIntakeApi.test.ts — Covers the field-map resolution (incl. reserved-id + missing
// columns) and paginated item fetch, with the relay mocked.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { postRelayRequest, waitForRelayResult } from './relayBridgeApi.ts';
import { fetchListItems, interpretSharePointProbes, normalizeSitePath, parseSharePointListUrl, probeSharePoint, resolveListFieldMap, type SharePointProbe } from './sharepointIntakeApi.ts';

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

describe('parseSharePointListUrl', () => {
  it('reduces a full List URL to the site path, extracts the list name, and keeps a full site URL', () => {
    const parsed = parseSharePointListUrl('https://contoso.sharepoint.com/sites/CUCIntake/Lists/Jira-Intake/AllItems.aspx');
    expect(parsed.siteRelativeUrl).toBe('/sites/CUCIntake');
    expect(parsed.listName).toBe('Jira-Intake');
    expect(parsed.siteFullUrl).toBe('https://contoso.sharepoint.com/sites/CUCIntake');
  });

  it('returns no full site URL for a bare site-relative path (no host)', () => {
    expect(parseSharePointListUrl('/sites/CUCIntake').siteFullUrl).toBeUndefined();
  });

  it('reduces a full site URL (no list) to the site path', () => {
    const parsed = parseSharePointListUrl('https://contoso.sharepoint.com/sites/CUCIntake/SitePages/Home.aspx');
    expect(parsed.siteRelativeUrl).toBe('/sites/CUCIntake');
    expect(parsed.listName).toBeUndefined();
  });

  it('leaves a bare site-relative path unchanged', () => {
    expect(parseSharePointListUrl('/sites/CUCIntake').siteRelativeUrl).toBe('/sites/CUCIntake');
  });

  it('handles a root-site list URL', () => {
    const parsed = parseSharePointListUrl('https://contoso.sharepoint.com/Lists/Jira-Intake/AllItems.aspx');
    expect(parsed.siteRelativeUrl).toBe('');
    expect(parsed.listName).toBe('Jira-Intake');
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

describe('probeSharePoint', () => {
  it('runs the three read probes and reports each status without throwing', async () => {
    waitResultMock.mockResolvedValueOnce({ id: '1', ok: true, status: 200, data: JSON.stringify({ LoginName: 'i:0#.f|m|jo@contoso.com' }), error: null });
    waitResultMock.mockResolvedValueOnce({ id: '2', ok: true, status: 200, data: JSON.stringify({ Title: 'Jira-Intake', ItemCount: 12 }), error: null });
    waitResultMock.mockResolvedValueOnce({ id: '3', ok: false, status: 403, data: JSON.stringify({ 'odata.error': { message: { value: 'Attempted to perform an unauthorized operation.' } } }), error: null });

    const results = await probeSharePoint('/sites/CleanUpCrew', 'Jira-Intake');

    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ ok: true, status: 200 });
    expect(results[0].detail).toContain('jo@contoso.com');
    expect(results[1].detail).toContain('12 item');
    expect(results[2]).toMatchObject({ ok: false, status: 403 });
    expect(results[2].detail).toMatch(/unauthorized operation/i);
    // Escapes the list title into getbytitle for all list-scoped probes.
    expect(postRequestMock.mock.calls[1][0].path).toContain("getbytitle('Jira-Intake')");
  });
});

describe('interpretSharePointProbes', () => {
  const probe = (ok: boolean): SharePointProbe => ({ label: 'x', path: '/p', ok, status: ok ? 200 : 403, detail: ok ? 'OK' : 'Denied' });

  it('flags a relay/context issue when everything succeeds', () => {
    expect(interpretSharePointProbes([probe(true), probe(true), probe(true)])).toMatch(/relay header\/context|developer/i);
  });

  it('flags an account/tenant block when everything fails', () => {
    expect(interpretSharePointProbes([probe(false), probe(false), probe(false)])).toMatch(/guest|tenant|blocked/i);
  });

  it('flags a list-permission issue when auth works but the list read fails', () => {
    expect(interpretSharePointProbes([probe(true), probe(false), probe(false)])).toMatch(/shared link|Read on the list/i);
  });
});
