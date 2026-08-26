// pageRecency.test.ts — Narrowing a crawl to the pages that actually changed.

import { describe, expect, it } from 'vitest';

import { describeWindow, isPageWithinWindow, readPageRecency, readWindowDays } from './pageRecency.ts';

const NOW_ISO = '2026-08-26T12:00:00.000Z';

describe('readPageRecency', () => {
  it('takes the LATER of created and modified', () => {
    // A page created a year ago and edited yesterday is news.
    const recency = readPageRecency({
      createdIso: '2025-08-26T12:00:00.000Z',
      lastModifiedIso: '2026-08-25T12:00:00.000Z',
    });

    expect(recency.changedAtIso).toBe('2026-08-25T12:00:00.000Z');
    expect(recency.kind).toBe('updated');
  });

  it('calls a page NEW when it has never been edited since it was written', () => {
    // Which matters: a new page almost certainly needs linking, an edited one may already be linked.
    const recency = readPageRecency({
      createdIso: '2026-08-25T12:00:00.000Z',
      lastModifiedIso: '2026-08-25T12:00:00.000Z',
    });

    expect(recency.kind).toBe('new');
  });

  it('handles a page with only a creation date', () => {
    const recency = readPageRecency({ createdIso: '2026-08-25T12:00:00.000Z', lastModifiedIso: null });

    expect(recency.changedAtIso).toBe('2026-08-25T12:00:00.000Z');
    expect(recency.kind).toBe('new');
  });

  it('handles a page with only a modified date', () => {
    const recency = readPageRecency({ createdIso: null, lastModifiedIso: '2026-08-25T12:00:00.000Z' });

    expect(recency.changedAtIso).toBe('2026-08-25T12:00:00.000Z');
    expect(recency.kind).toBe('updated');
  });

  it('reports UNKNOWN rather than guessing when Confluence gave no dates', () => {
    expect(readPageRecency({ createdIso: null, lastModifiedIso: null }))
      .toEqual({ changedAtIso: null, kind: 'unknown' });
  });

  it('reports unknown for an unreadable timestamp rather than an Invalid Date', () => {
    expect(readPageRecency({ createdIso: 'not a date', lastModifiedIso: null }).kind).toBe('unknown');
  });
});

describe('isPageWithinWindow', () => {
  const editedYesterday = { createdIso: '2025-01-01T00:00:00.000Z', lastModifiedIso: '2026-08-25T12:00:00.000Z' };
  const editedLastMonth = { createdIso: '2025-01-01T00:00:00.000Z', lastModifiedIso: '2026-07-20T12:00:00.000Z' };

  it('keeps a page edited inside the window', () => {
    expect(isPageWithinWindow(editedYesterday, 7, NOW_ISO)).toBe(true);
  });

  it('drops a page whose last change is older than the window', () => {
    // The whole point: a nightly run should not re-report two hundred pages dealt with weeks ago.
    expect(isPageWithinWindow(editedLastMonth, 7, NOW_ISO)).toBe(false);
  });

  it('keeps a page created inside the window even though it is old-looking elsewhere', () => {
    expect(isPageWithinWindow(
      { createdIso: '2026-08-24T12:00:00.000Z', lastModifiedIso: null }, 7, NOW_ISO,
    )).toBe(true);
  });

  it('treats a window of zero or less as NO window', () => {
    // The honest reading of "no filter", and it keeps the setting optional without a second switch.
    expect(isPageWithinWindow(editedLastMonth, 0, NOW_ISO)).toBe(true);
    expect(isPageWithinWindow(editedLastMonth, -5, NOW_ISO)).toBe(true);
  });

  it('KEEPS a page whose dates Confluence never returned', () => {
    // Dropping it would hide exactly the pages whose metadata is broken — the ones most likely wrong.
    expect(isPageWithinWindow({ createdIso: null, lastModifiedIso: null }, 7, NOW_ISO)).toBe(true);
  });

  it('includes a page changed exactly on the boundary', () => {
    expect(isPageWithinWindow(
      { createdIso: null, lastModifiedIso: '2026-08-19T12:00:00.000Z' }, 7, NOW_ISO,
    )).toBe(true);
  });

  it('excludes a page changed just past the boundary', () => {
    expect(isPageWithinWindow(
      { createdIso: null, lastModifiedIso: '2026-08-19T11:59:00.000Z' }, 7, NOW_ISO,
    )).toBe(false);
  });
});

describe('readWindowDays', () => {
  it('reads a typed number of days', () => {
    expect(readWindowDays('7')).toBe(7);
  });

  it('treats blank, zero and nonsense all as no window', () => {
    // A half-typed value must never silently narrow a scan to nothing.
    expect(readWindowDays('')).toBe(0);
    expect(readWindowDays('   ')).toBe(0);
    expect(readWindowDays('0')).toBe(0);
    expect(readWindowDays('abc')).toBe(0);
  });

  it('does not invert a negative into a future filter', () => {
    expect(readWindowDays('-5')).toBe(0);
  });
});

describe('describeWindow', () => {
  it('says the window, so a count is never read as the whole tree', () => {
    expect(describeWindow(7)).toBe('pages created or edited in the last 7 days');
  });

  it('says one day without a plural', () => {
    expect(describeWindow(1)).toBe('pages created or edited in the last 1 day');
  });

  it('says plainly when there is no window at all', () => {
    expect(describeWindow(0)).toBe('every page in the tree');
  });
});
