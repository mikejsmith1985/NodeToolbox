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
export function parseSharePointListUrl(input: string): { siteRelativeUrl: string; listName?: string; siteFullUrl?: string } {
  const trimmed = input.trim();
  if (trimmed === '') {
    return { siteRelativeUrl: '' };
  }

  // Reduce a full URL to its path; keep a bare path as-is. Capture the origin so we can also return
  // a full, openable site URL (used by the Connection Bar's "Open SharePoint" button).
  let path = trimmed;
  let origin = '';
  if (/:\/\//.test(trimmed)) {
    try {
      const parsedUrl = new URL(trimmed);
      path = parsedUrl.pathname;
      origin = parsedUrl.origin;
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

  const siteRelativeUrl = (sitePath === '' || sitePath.startsWith('/') ? sitePath : `/${sitePath}`).replace(/\/+$/, '');
  // A full, openable site URL is available only when the input carried a host.
  const siteFullUrl = origin !== '' ? `${origin}${siteRelativeUrl}` : undefined;
  return { siteRelativeUrl, listName, siteFullUrl };
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

// ── Relay diagnostics ──

export interface SharePointProbe {
  /** Human label for the check (e.g. "Signed-in user (auth)"). */
  label: string;
  /** The REST path that was probed. */
  path: string;
  ok: boolean;
  status: number;
  /** A short success summary or SharePoint's own error text. */
  detail: string;
}

/** Summarizes a successful probe body (login name / item count) without dumping raw JSON. */
function summarizeProbeOk(rawBody: unknown): string {
  if (typeof rawBody !== 'string') {
    return 'OK';
  }
  try {
    const parsed = JSON.parse(rawBody) as { LoginName?: string; ItemCount?: number; Title?: string };
    if (parsed.LoginName) {
      return `OK — ${parsed.LoginName}`;
    }
    if (typeof parsed.ItemCount === 'number') {
      return `OK — ${parsed.ItemCount} item(s)`;
    }
  } catch {
    // Non-JSON success — just report OK.
  }
  return 'OK';
}

/**
 * Runs three escalating read probes through the relay to localize a 403: can the account read its
 * own identity (auth), the list object (list permission), and the list schema (fields). Never
 * throws — each probe returns its own status + message so the caller can render a full picture.
 */
export async function probeSharePoint(siteRelativeUrl: string, listName: string): Promise<SharePointProbe[]> {
  const site = normalizeSitePath(siteRelativeUrl);
  const encodedList = listName.replace(/'/g, "''"); // OData escapes a single quote by doubling it.
  const probes = [
    { label: 'Signed-in user (auth)', path: `${site}/_api/web/currentuser?$select=LoginName,IsSiteAdmin` },
    { label: `List read ('${listName}')`, path: `${site}/_api/web/lists/getbytitle('${encodedList}')?$select=Title,ItemCount` },
    { label: 'List fields (schema)', path: `${site}/_api/web/lists/getbytitle('${encodedList}')/fields?$select=Title&$top=1` },
  ];

  const results: SharePointProbe[] = [];
  for (const probe of probes) {
    const requestId = nextRequestId();
    try {
      await postRelayRequest({ sys: RELAY_SYSTEM, id: requestId, method: 'GET', path: probe.path });
      const result = await waitForRelayResult(requestId, RELAY_SYSTEM);
      results.push({
        label: probe.label,
        path: probe.path,
        ok: result.ok,
        status: result.status,
        detail: result.ok ? summarizeProbeOk(result.data) : (extractSharePointErrorMessage(result.data) || result.error || 'Denied'),
      });
    } catch (caught) {
      results.push({ label: probe.label, path: probe.path, ok: false, status: 0, detail: caught instanceof Error ? caught.message : 'Relay error' });
    }
  }
  return results;
}

/**
 * Turns probe results into a plain-English conclusion that points at the likely fix — mirrors the
 * "how to read it" table so users don't need to interpret status codes themselves.
 */
export function interpretSharePointProbes(results: SharePointProbe[]): string {
  if (results.length === 0) {
    return '';
  }
  const [auth, listRead] = results;
  if (results.every((probe) => probe.ok)) {
    return '✅ All reads succeeded. If a pull still fails, this is a relay header/context issue — send this to the developer.';
  }
  if (results.every((probe) => !probe.ok)) {
    return '⛔ REST is blocked for your account on this site — often a guest/external account or a tenant API lockdown. Try a member account, or ask a SharePoint admin.';
  }
  if (auth?.ok && listRead && !listRead.ok) {
    return '🔑 You can sign in but cannot read the list — you likely see it via a shared link (Limited Access). Ask the site owner to grant your account Read on the list/site.';
  }
  return '⚠️ Mixed results — the first failing check above shows exactly where access stops.';
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
