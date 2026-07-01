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

/** Normalizes a site-relative URL: ensure a leading slash, drop any trailing slashes. */
export function normalizeSitePath(siteRelativeUrl: string): string {
  const trimmed = siteRelativeUrl.trim();
  if (trimmed === '') {
    return '';
  }
  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, '');
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

/** Issues a GET through the relay against the SharePoint origin and returns parsed JSON. */
async function relayGet<ResponseBody>(path: string): Promise<ResponseBody> {
  const requestId = nextRequestId();
  await postRelayRequest({ sys: RELAY_SYSTEM, id: requestId, method: 'GET', path });
  const result = await waitForRelayResult(requestId, RELAY_SYSTEM);
  if (!result.ok) {
    throw new Error(`SharePoint request failed (status ${result.status})${result.error ? `: ${result.error}` : ''}.`);
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
