// pageRecency.ts — Only the pages that have actually changed.
//
// A tree crawl finds everything every time, so a nightly run re-reports two hundred pages that were
// dealt with weeks ago and the handful that matter are buried. Narrowing to a window turns the scan
// from an inventory into a to-do list.
//
// The window is measured against the LATER of created and last-modified. A page created a year ago
// and edited yesterday is news; so is one created yesterday. Using only the creation date would miss
// every update, and using only the edit date is usually equivalent but not guaranteed to be — some
// Confluence deployments leave `version.when` unset on a page nobody has touched since creation.
//
// Pure: it is handed a clock rather than reading one, so "was this in the last 7 days" is testable
// without waiting a week.

/** Whatever a crawled page knows about when it changed. */
export interface PageRecencyInput {
  lastModifiedIso: string | null;
  createdIso: string | null;
}

/** Why a page is in the window — which is the difference between two kinds of work. */
export type PageRecencyKind = 'new' | 'updated' | 'unknown';

/** One page's recency verdict. */
export interface PageRecency {
  /** The later of created and modified, or null when neither was readable. */
  changedAtIso: string | null;
  kind: PageRecencyKind;
}

const MILLISECONDS_PER_DAY = 86_400_000;

/** Milliseconds for an ISO stamp, or null when it cannot be read. */
function readInstantMs(isoText: string | null): number | null {
  if (isoText === null || isoText.trim() === '') return null;
  const parsedMs = new Date(isoText).getTime();
  return Number.isFinite(parsedMs) ? parsedMs : null;
}

/**
 * When a page last changed, and whether that change was its creation.
 *
 * A page whose created and modified stamps match has never been edited, so it is NEW — which matters
 * because a new page almost certainly needs linking while an edited one may already be linked and
 * only needs a second look.
 *
 * Returns `unknown` rather than guessing when Confluence gave no dates at all. An unknown page is
 * deliberately KEPT by the filter below: dropping a page because its metadata was missing would hide
 * exactly the pages whose metadata is broken.
 */
export function readPageRecency(page: PageRecencyInput): PageRecency {
  const modifiedMs = readInstantMs(page.lastModifiedIso);
  const createdMs = readInstantMs(page.createdIso);

  if (modifiedMs === null && createdMs === null) {
    return { changedAtIso: null, kind: 'unknown' };
  }

  const changedAtIso = (modifiedMs ?? 0) >= (createdMs ?? 0)
    ? (page.lastModifiedIso ?? page.createdIso)
    : (page.createdIso ?? page.lastModifiedIso);

  // Equal stamps mean it has never been edited since it was written.
  const isNew = createdMs !== null && (modifiedMs === null || modifiedMs <= createdMs);
  return { changedAtIso, kind: isNew ? 'new' : 'updated' };
}

/**
 * Whether a page changed within the last `windowDays`, measured from `nowIso`.
 *
 * A window of 0 or less means NO window — everything passes. That is the honest reading of "no
 * filter" and keeps the setting optional without a separate on/off switch to forget.
 *
 * A page with no dates at all passes. The filter narrows work; it must not silently hide a page
 * whose metadata Confluence failed to return, because that is the page most likely to be wrong.
 */
export function isPageWithinWindow(
  page: PageRecencyInput,
  windowDays: number,
  nowIso: string,
): boolean {
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    return true;
  }

  const recency = readPageRecency(page);
  const changedMs = readInstantMs(recency.changedAtIso);
  if (changedMs === null) {
    return true;
  }

  const nowMs = readInstantMs(nowIso);
  if (nowMs === null) {
    return true;
  }

  return nowMs - changedMs <= windowDays * MILLISECONDS_PER_DAY;
}

/**
 * Reads the window setting a person typed.
 *
 * Blank, zero and nonsense all mean "no window", so a half-typed value never silently narrows a scan
 * to nothing. Negative numbers are treated the same way rather than inverted into a bizarre future
 * filter.
 */
export function readWindowDays(rawWindowDays: string): number {
  const parsedDays = Number.parseInt(String(rawWindowDays ?? '').trim(), 10);
  return Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 0;
}

/** Says the window in the words a report uses, so a count is never read as the whole tree. */
export function describeWindow(windowDays: number): string {
  return windowDays <= 0
    ? 'every page in the tree'
    : `pages created or edited in the last ${windowDays} day${windowDays === 1 ? '' : 's'}`;
}
