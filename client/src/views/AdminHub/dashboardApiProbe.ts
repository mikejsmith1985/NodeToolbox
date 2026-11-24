// dashboardApiProbe.ts — Pure helpers for the read-only probe of Jira's dashboard and Rich Filters APIs (GH #511).
//
// Background (plain English): we want Toolbox to rebuild the Enrollment dashboard itself after a migration,
// but Jira Data Center has no documented way to create dashboards or gadgets, and the Rich Filters app's API
// is not public. Before building an importer we need facts, not guesses. The probe only READS (GET requests),
// tries a short list of likely endpoints, and produces a compact report the owner pastes back so we can see
// which endpoints exist and what they return. This module holds the pure parts: which paths to try, how to
// summarise a reply, and how to format the report.

// ── Named constants ──

/** The longest body excerpt kept per endpoint, so the pasted report stays readable. */
export const PROBE_SNIPPET_LENGTH = 400;
/** How many top-level keys are listed when describing a reply's shape. */
const SHAPE_KEY_LIMIT = 12;
/** Only Jira REST paths may be probed; anything else is ignored. */
const REST_PATH_PATTERN = /^\/rest\/[\w\-./?=&%]+$/;

/** Documented, read-only Jira endpoints that show the instance version, dashboards, filters and apps. */
const BASE_PROBE_PATHS: readonly string[] = [
  '/rest/api/2/serverInfo',
  '/rest/api/2/dashboard?filter=my',
  '/rest/api/2/dashboard?filter=favourite',
  '/rest/api/2/filter/favourite',
  '/rest/plugins/1.0/',
];

/**
 * Guesses at the Rich Filters app's REST namespace. None is documented; a 404 is an answer too, and the
 * plugin list above (when the user is allowed to read it) names the real app key for the next attempt.
 */
const RICH_FILTER_GUESS_PATHS: readonly string[] = [
  '/rest/qotilabs-rich-filters/1.0/rich-filters',
  '/rest/rich-filters/1.0/rich-filters',
  '/rest/richfilters/1.0/filters',
  '/rest/qotilabs/rich-filters/1.0/filters',
];

/** One probed endpoint's outcome. */
export interface ProbeResult {
  path: string;
  /** HTTP status, or null when no status could be read (network failure). */
  status: number | null;
  shape: string;
  snippet: string;
  /** For a redirect: one line per hop followed ("302 → target (note)", then the followed path's own status). */
  redirects?: string[];
}

// ── Path planning ──

/** Gadget-list paths to try for one dashboard; Data Center's gadget REST resource is internal. */
function buildDashboardDetailPaths(dashboardId: string): string[] {
  const encodedId = encodeURIComponent(dashboardId);
  return [
    `/rest/api/2/dashboard/${encodedId}`,
    `/rest/dashboards/1.0/${encodedId}/gadget`,
    `/rest/gadget/1.0/dashboards/${encodedId}/gadgets`,
  ];
}

/**
 * Lists every path the probe will GET: the documented endpoints, the Rich Filters guesses, detail paths
 * for each dashboard found, and finally one optional owner-typed path (only if it is a Jira REST path).
 */
export function buildProbePaths(dashboardIds: readonly string[], customPath: string): string[] {
  const paths = [...BASE_PROBE_PATHS, ...RICH_FILTER_GUESS_PATHS];
  for (const dashboardId of dashboardIds) paths.push(...buildDashboardDetailPaths(dashboardId));
  const trimmedCustomPath = customPath.trim();
  if (REST_PATH_PATTERN.test(trimmedCustomPath)) paths.push(trimmedCustomPath);
  return paths;
}

// ── Redirects ──

/** How many redirects in a row the probe follows before giving up, so a redirect loop cannot run forever. */
export const MAX_REDIRECT_HOPS = 3;
/** Redirect statuses run from 300 up to (not including) 400. */
const FIRST_REDIRECT_STATUS = 300;
const FIRST_CLIENT_ERROR_STATUS = 400;
/** Addresses Jira sends a request to when it wants a signed-in browser session instead of a token. */
const LOGIN_TARGET_PATTERN = /login|os_destination|saml|\bsso\b|\/auth\b/i;
/** Any base URL, used only to read a relative redirect target's path. */
const RELATIVE_URL_BASE = 'https://jira.invalid';

/** Reads the path and query out of an absolute or relative address; null when it cannot be parsed. */
function readUrlPath(location: string): string | null {
  try {
    const targetUrl = new URL(location, RELATIVE_URL_BASE);
    return `${targetUrl.pathname}${targetUrl.search}`;
  } catch {
    return null;
  }
}

/** True for an HTTP redirect status (3xx). */
export function isRedirectStatus(status: number | null): boolean {
  return status !== null && status >= FIRST_REDIRECT_STATUS && status < FIRST_CLIENT_ERROR_STATUS;
}

/**
 * Decides what a redirect target means. A login page means the endpoint wants a signed-in browser session, so
 * it is not followed (the relay, which runs in a signed-in Jira tab, may answer it). Another Jira REST address
 * is followed. Anything else is reported but not followed, because the probe only reads REST.
 */
export function describeRedirectTarget(location: string): { followPath: string | null; note: string } {
  if (LOGIN_TARGET_PATTERN.test(location)) {
    return { followPath: null, note: 'login page — needs a signed-in Jira session; run the probe with the Jira relay connected' };
  }
  const targetPath = readUrlPath(location);
  if (targetPath === null) return { followPath: null, note: 'unreadable address' };
  if (REST_PATH_PATTERN.test(targetPath)) return { followPath: targetPath, note: 'followed' };
  return { followPath: null, note: 'not a REST address — not followed' };
}

// ── Reply summarising ──

/** Reads the HTTP status out of a jiraGet failure message ("Jira GET … failed: 404 — reason"). */
export function readStatusFromFailure(failureMessage: string): number | null {
  const match = /failed:\s*(\d{3})\b/.exec(String(failureMessage || ''));
  return match ? Number(match[1]) : null;
}

/** Lists an object's top-level keys, capped so a wide reply still fits on one line. */
function listKeys(value: Record<string, unknown>): string {
  return Object.keys(value).slice(0, SHAPE_KEY_LIMIT).join(', ');
}

/** Describes a successful reply's shape and keeps a short excerpt of it. */
export function summarizeProbeBody(body: unknown): { shape: string; snippet: string } {
  const snippet = JSON.stringify(body ?? null).slice(0, PROBE_SNIPPET_LENGTH);
  if (Array.isArray(body)) {
    const firstItem = body[0];
    const itemKeys = firstItem && typeof firstItem === 'object' ? listKeys(firstItem as Record<string, unknown>) : typeof firstItem;
    return { shape: `array(${body.length}) of {${itemKeys}}`, snippet };
  }
  if (body && typeof body === 'object') return { shape: `object {${listKeys(body as Record<string, unknown>)}}`, snippet };
  return { shape: typeof body, snippet };
}

/** The slice of GET /rest/plugins/1.0/ this module reads. */
interface PluginListShape {
  plugins?: Array<{ key?: string; name?: string }>;
}

/** Picks installed apps whose key or name mentions rich filters, as "key — name" lines. */
export function findRichFilterApps(pluginList: unknown): string[] {
  const plugins = (pluginList as PluginListShape | null)?.plugins;
  if (!Array.isArray(plugins)) return [];
  return plugins
    .filter((plugin) => /rich[\s-]?filter/i.test(`${plugin.key ?? ''} ${plugin.name ?? ''}`))
    .map((plugin) => `${plugin.key ?? '?'} — ${plugin.name ?? '?'}`);
}

/** Formats the probe results as plain text, one block per endpoint, ready to paste into a GitHub issue. */
export function formatProbeReport(results: readonly ProbeResult[], richFilterApps: readonly string[]): string {
  const header = [
    'Enrollment Dashboard Kit — API probe (read-only)',
    `Rich Filters apps: ${richFilterApps.length > 0 ? richFilterApps.join('; ') : 'none visible (plugin list may need admin)'}`,
    '',
  ];
  const lines = results.map((result) => {
    const statusText = result.status === null ? 'ERR' : String(result.status);
    const redirectLines = (result.redirects ?? []).map((hop) => `\n     ↳ ${hop}`).join('');
    return `${statusText}  ${result.path}${result.shape ? `\n     shape: ${result.shape}` : ''}\n     ${result.snippet}${redirectLines}`;
  });
  return [...header, ...lines].join('\n');
}
