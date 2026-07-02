// sharepointIntakeApi.ts — Reads the SharePoint intake List through the browser relay (the user's
// session), returning JSON. Two reads: the list /fields (to resolve display→internal names,
// including the reserved-id case) and the paged /items. No stored credentials, no app registration.
// See spec 007 contracts §C and research R2/R3.

import { postRelayRequest, waitForRelayResult } from './relayBridgeApi.ts';
import type { RelayResult } from '../types/relay.ts';
import { INTAKE_DISPLAY_COLUMNS } from '../views/JiraIntake/lib/mapSharePointItem.ts';

const RELAY_SYSTEM = 'sharepoint' as const;
const ITEMS_PAGE_SIZE = 200;
const FIELDS_PAGE_SIZE = 500;

export interface SharePointSource {
  /** Site-relative URL, e.g. /sites/CUCIntake. */
  siteRelativeUrl: string;
  /** List title, e.g. Jira-Intake. */
  listName: string;
}

export interface SharePointFieldMap {
  /** Display title → internal field name (e.g. id → _x0069_d). */
  byDisplayName: Map<string, string>;
  /** Expected intake columns not found on the List (drives FR-010 reporting). */
  missingColumns: string[];
}

let relayRequestCounter = 0;

/** A unique-enough id to match a relay request with its result. */
function nextRequestId(): string {
  relayRequestCounter += 1;
  return `sp-${Date.now()}-${relayRequestCounter}`;
}

/**
 * Parses whatever the user pasted — a site-relative path (`/sites/CUCIntake`), a full site URL, or
 * even the full List URL (`https://tenant.sharepoint.com/sites/CUCIntake/Lists/Jira-Intake/AllItems.aspx`)
 * — into the site-relative path plus, when present, the List name. Lets the user paste the address
 * bar and have it "just work". Pure (no I/O).
 */
export function parseSharePointListUrl(input: string): { siteRelativeUrl: string; listName?: string } {
  const trimmed = input.trim();
  if (trimmed === '') {
    return { siteRelativeUrl: '' };
  }

  // Reduce a full URL to its path; keep a bare path as-is.
  let path = trimmed;
  if (/:\/\//.test(trimmed)) {
    try {
      path = new URL(trimmed).pathname;
    } catch {
      path = trimmed;
    }
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    // Leave the path as-is if it isn't validly encoded.
  }

  // The List name (if the URL points at a list) is the segment after /Lists/.
  const listMatch = /\/lists\/([^/]+)/i.exec(path);
  const listName = listMatch ? listMatch[1] : undefined;

  // Managed-path sites (/sites/<name> or /teams/<name>) have a well-known root — prefer it so a
  // pasted page or list URL reduces cleanly to just the site path.
  const managedPathMatch = /^\/(sites|teams)\/[^/]+/i.exec(path);
  let sitePath: string;
  if (managedPathMatch) {
    sitePath = managedPathMatch[0];
  } else {
    // Root-hosted (or unknown) site: cut before /Lists/ or the REST /_api/ segment, then drop a
    // trailing page segment such as /AllItems.aspx.
    const lowerPath = path.toLowerCase();
    const listsIndex = lowerPath.indexOf('/lists/');
    const apiIndex = lowerPath.indexOf('/_api/');
    sitePath = listsIndex >= 0 ? path.slice(0, listsIndex) : apiIndex >= 0 ? path.slice(0, apiIndex) : path;
    sitePath = sitePath.replace(/\/[^/]*\.aspx$/i, '');
  }

  const withLeadingSlash = sitePath === '' || sitePath.startsWith('/') ? sitePath : `/${sitePath}`;
  return { siteRelativeUrl: withLeadingSlash.replace(/\/+$/, ''), listName };
}

/** Normalizes a site-relative URL (accepts a full site/List URL too): leading slash, no trailing slash. */
export function normalizeSitePath(siteRelativeUrl: string): string {
  return parseSharePointListUrl(siteRelativeUrl).siteRelativeUrl;
}

/** Escapes single quotes for a SharePoint getbytitle('...') segment. */
function escapeListTitle(listName: string): string {
  return listName.replace(/'/g, "''");
}

/** Reduces an odata nextLink (absolute or relative) to an origin-relative path for the relay. */
function toRelativePath(nextLink: string): string {
  const absoluteMatch = /^https?:\/\/[^/]+(\/.*)$/i.exec(nextLink);
  if (absoluteMatch) {
    return absoluteMatch[1];
  }
  return nextLink.startsWith('/') ? nextLink : `/${nextLink}`;
}

/** Parses the raw relay response text as JSON. */
function parseRelayData<ResponseBody>(result: RelayResult): ResponseBody {
  if (typeof result.data === 'string') {
    try {
      return JSON.parse(result.data) as ResponseBody;
    } catch {
      throw new Error('SharePoint returned an unreadable response.');
    }
  }
  return result.data as ResponseBody;
}

/**
 * Pulls a human-readable message out of a SharePoint error response so a 403/404 tells the user
 * WHY (e.g. "Access denied" / "List does not exist"). Handles both `odata.error` (nometadata) and
 * verbose `error` shapes, falling back to a trimmed snippet of the raw body.
 */
function extractSharePointErrorMessage(rawBody: unknown): string {
  if (typeof rawBody !== 'string' || rawBody.trim() === '') {
    return '';
  }
  try {
    const parsed = JSON.parse(rawBody) as { 'odata.error'?: { message?: { value?: string } }; error?: { message?: { value?: string } } };
    const message = parsed['odata.error']?.message?.value ?? parsed.error?.message?.value;
    if (message) {
      return message;
    }
  } catch {
    // Not JSON — fall through to a trimmed raw snippet.
  }
  return rawBody.slice(0, 300);
}

/** Issues a GET through the relay against the SharePoint origin and returns parsed JSON. */
async function relayGet<ResponseBody>(path: string): Promise<ResponseBody> {
  const requestId = nextRequestId();
  await postRelayRequest({ sys: RELAY_SYSTEM, id: requestId, method: 'GET', path });
  const result = await waitForRelayResult(requestId, RELAY_SYSTEM);
  if (!result.ok) {
    // Surface SharePoint's own message (and the request path) so 403/404 causes are diagnosable.
    const detail = extractSharePointErrorMessage(result.data) || result.error || '';
    throw new Error(`SharePoint request failed (status ${result.status}) for ${path}${detail ? ` — ${detail}` : ''}`);
  }
  return parseRelayData<ResponseBody>(result);
}

interface SharePointFieldsResponse {
  value?: Array<{ Title?: string; InternalName?: string }>;
}

interface SharePointItemsResponse {
  value?: Record<string, unknown>[];
  'odata.nextLink'?: string;
  '@odata.nextLink'?: string;
}

/** Reads the List's fields and builds the display→internal map plus any missing expected columns. */
export async function resolveListFieldMap(source: SharePointSource): Promise<SharePointFieldMap> {
  const sitePath = normalizeSitePath(source.siteRelativeUrl);
  const listTitle = escapeListTitle(source.listName);
  const path = `${sitePath}/_api/web/lists/getbytitle('${listTitle}')/fields`
    + `?$select=Title,InternalName&$filter=Hidden eq false&$top=${FIELDS_PAGE_SIZE}`;

  const response = await relayGet<SharePointFieldsResponse>(path);
  const byDisplayName = new Map<string, string>();
  for (const field of response.value ?? []) {
    if (field.Title && field.InternalName) {
      byDisplayName.set(field.Title, field.InternalName);
    }
  }
  const missingColumns = INTAKE_DISPLAY_COLUMNS.filter((displayName) => !byDisplayName.has(displayName));
  return { byDisplayName, missingColumns };
}

/** Reads all List items (following pagination) selecting only the mapped internal field names. */
export async function fetchListItems(source: SharePointSource, fieldMap: Map<string, string>): Promise<Record<string, unknown>[]> {
  const sitePath = normalizeSitePath(source.siteRelativeUrl);
  const listTitle = escapeListTitle(source.listName);
  const internalNames = INTAKE_DISPLAY_COLUMNS
    .map((displayName) => fieldMap.get(displayName))
    .filter((internalName): internalName is string => Boolean(internalName));
  const selectClause = internalNames.length > 0
    ? `&$select=${internalNames.map(encodeURIComponent).join(',')}`
    : '';

  let path: string = `${sitePath}/_api/web/lists/getbytitle('${listTitle}')/items?$top=${ITEMS_PAGE_SIZE}${selectClause}`;
  const items: Record<string, unknown>[] = [];
  // Follow odata nextLink until the List is exhausted (FR-005 — no silent truncation).
  while (path !== '') {
    const page = await relayGet<SharePointItemsResponse>(path);
    for (const item of page.value ?? []) {
      items.push(item);
    }
    const nextLink = page['odata.nextLink'] ?? page['@odata.nextLink'];
    path = nextLink ? toRelativePath(nextLink) : '';
  }
  return items;
}
