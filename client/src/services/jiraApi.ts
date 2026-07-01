// jiraApi.ts — Typed Jira REST client routed through the Express Jira proxy.
//
// Every successful or failed call emits a `toolbox:api` CustomEvent on
// `window` so the Dev Panel view can record API activity without coupling to
// this module. The event detail shape is documented by `JiraApiEventDetail`.

import type {
  CreateIssueRequest,
  CreateIssueResponse,
  CreateMetaFieldsResponse,
  CreateMetaIssueTypesResponse,
  JiraMyself,
  JiraProject,
  JiraUser,
} from '../types/jira.ts';

const JIRA_PROXY_BASE = '/jira-proxy';
const JSON_CONTENT_TYPE = 'application/json';
const NO_CONTENT_STATUS = 204;
const RESET_CONTENT_STATUS = 205;
const TOOLBOX_API_EVENT = 'toolbox:api';

/** Shape of `event.detail` for every `toolbox:api` CustomEvent dispatched on window. */
export interface JiraApiEventDetail {
  method: 'GET' | 'POST' | 'PUT';
  url: string;
  status: number | null;
  durationMs: number;
  errorMessage: string | null;
}

/** Dispatches a single API-activity event for the Dev Panel listener. */
function emitApiEvent(detail: JiraApiEventDetail): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new CustomEvent<JiraApiEventDetail>(TOOLBOX_API_EVENT, { detail }));
}

/**
 * Throws a descriptive error when the response is not OK.
 * Attempts to read Jira's JSON error body so the UI surfaces the actual
 * rejection reason (e.g. "Issue Type is required.") rather than just the
 * HTTP status code.
 */
async function assertSuccessfulResponse(response: Response, messagePrefix: string): Promise<void> {
  if (!response.ok) {
    // Start with the bare status code as the fallback description.
    let errorDetail = String(response.status);
    try {
      // Jira error bodies look like: { errorMessages: [...], errors: { field: "msg" } }
      const errorBody = await response.json() as Record<string, unknown>;
      const jiraErrorMessages = Array.isArray(errorBody.errorMessages)
        ? (errorBody.errorMessages as unknown[]).filter((msg): msg is string => typeof msg === 'string')
        : [];
      const jiraFieldErrors =
        errorBody.errors !== null && typeof errorBody.errors === 'object'
          ? Object.values(errorBody.errors as Record<string, string>)
          : [];
      const allJiraErrors = [...jiraErrorMessages, ...jiraFieldErrors].filter(Boolean);
      if (allJiraErrors.length > 0) {
        errorDetail = `${response.status} — ${allJiraErrors.join('; ')}`;
      }
    } catch {
      // JSON parsing failed — the status code is the best description we have.
    }
    throw new Error(`${messagePrefix}: ${errorDetail}`);
  }
}

function isEmptySuccessfulResponse(response: Response): boolean {
  const contentLengthHeader = response.headers?.get('content-length');
  return response.status === NO_CONTENT_STATUS
    || response.status === RESET_CONTENT_STATUS
    || contentLengthHeader === '0';
}

/**
 * Parses JSON when Jira actually returned a payload.
 * Some successful workflow endpoints respond with no content, so callers need
 * `undefined` instead of a JSON parse failure.
 */
async function parseJsonResponse<ResponseBody>(response: Response): Promise<ResponseBody> {
  if (isEmptySuccessfulResponse(response)) {
    return undefined as ResponseBody;
  }

  const responseText = await response.text();
  if (!responseText.trim()) {
    return undefined as ResponseBody;
  }

  return JSON.parse(responseText) as ResponseBody;
}

/** Records a single API call's timing and outcome via the toolbox:api event bus. */
async function trackApiCall<ReturnValue>(
  method: JiraApiEventDetail['method'],
  url: string,
  invoke: () => Promise<{ value: ReturnValue; status: number }>,
): Promise<ReturnValue> {
  const startedAt = Date.now();
  try {
    const { value, status } = await invoke();
    emitApiEvent({
      method,
      url,
      status,
      durationMs: Date.now() - startedAt,
      errorMessage: null,
    });
    return value;
  } catch (caught) {
    const errorMessage = caught instanceof Error ? caught.message : String(caught);
    const statusMatch = /:\s*(\d{3})$/.exec(errorMessage);
    emitApiEvent({
      method,
      url,
      status: statusMatch ? Number(statusMatch[1]) : null,
      durationMs: Date.now() - startedAt,
      errorMessage,
    });
    throw caught;
  }
}

/** Makes an authenticated GET request to the Jira REST API via proxy. */
export async function jiraGet<ResponseBody>(path: string): Promise<ResponseBody> {
  return trackApiCall('GET', path, async () => {
    const response = await fetch(`${JIRA_PROXY_BASE}${path}`);
    await assertSuccessfulResponse(response, `Jira GET ${path} failed`);
    const value = await parseJsonResponse<ResponseBody>(response);
    return { value, status: response.status };
  });
}

/** Makes an authenticated POST request to the Jira REST API via proxy. */
export async function jiraPost<ResponseBody>(
  path: string,
  body: unknown,
): Promise<ResponseBody> {
  return trackApiCall('POST', path, async () => {
    const response = await fetch(`${JIRA_PROXY_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': JSON_CONTENT_TYPE },
      body: JSON.stringify(body),
    });
    await assertSuccessfulResponse(response, `Jira POST ${path} failed`);
    const value = await parseJsonResponse<ResponseBody>(response);
    return { value, status: response.status };
  });
}

/**
 * Makes an authenticated PUT request to the Jira REST API via proxy.
 *
 * Jira's PUT endpoints (e.g. issue updates) typically respond with 204 No Content,
 * so this helper does not attempt to parse the response body — it simply asserts
 * success and resolves to `void` once the request completes.
 */
export async function jiraPut(path: string, body: unknown): Promise<void> {
  await trackApiCall('PUT', path, async () => {
    const response = await fetch(`${JIRA_PROXY_BASE}${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': JSON_CONTENT_TYPE },
      body: JSON.stringify(body),
    });
    await assertSuccessfulResponse(response, `Jira PUT ${path} failed`);
    return { value: undefined, status: response.status };
  });
}

// ── Jira Template Maker helpers ──

// A high page size that covers any realistic project's issue-type / field count in one request.
const CREATE_META_PAGE_SIZE = 200;

/**
 * Lists the issue types a project offers, using the modern createmeta endpoint (Jira Cloud and
 * DC 8.4+). Replaces the classic bulk `createmeta?projectKeys=` call, which Atlassian removed on
 * Cloud and Data Center 10+.
 */
export async function getProjectIssueTypes(projectKey: string): Promise<CreateMetaIssueTypesResponse> {
  const encodedProjectKey = encodeURIComponent(projectKey);
  return jiraGet<CreateMetaIssueTypesResponse>(
    `/rest/api/2/issue/createmeta/${encodedProjectKey}/issuetypes?maxResults=${CREATE_META_PAGE_SIZE}`,
  );
}

/**
 * Lists the create-screen fields (with allowed option values) for one issue type in a project,
 * using the modern createmeta endpoint.
 */
export async function getIssueTypeFields(
  projectKey: string,
  issueTypeId: string,
): Promise<CreateMetaFieldsResponse> {
  const encodedProjectKey = encodeURIComponent(projectKey);
  const encodedIssueTypeId = encodeURIComponent(issueTypeId);
  return jiraGet<CreateMetaFieldsResponse>(
    `/rest/api/2/issue/createmeta/${encodedProjectKey}/issuetypes/${encodedIssueTypeId}?maxResults=${CREATE_META_PAGE_SIZE}`,
  );
}

/** Creates a Jira issue from a built field payload and returns its id/key/self link. */
export async function createIssue(request: CreateIssueRequest): Promise<CreateIssueResponse> {
  return jiraPost<CreateIssueResponse>('/rest/api/2/issue', request);
}

/** Returns the current Jira user, used to record the author on a saved template. */
export async function getMyself(): Promise<JiraMyself> {
  return jiraGet<JiraMyself>('/rest/api/2/myself');
}

/** Fetches a single project by key — used to resolve the numeric id for the prefill URL's pid. */
export async function getProject(projectKey: string): Promise<JiraProject> {
  return jiraGet<JiraProject>(`/rest/api/2/project/${encodeURIComponent(projectKey)}`);
}

// Default page size for user search — a submitter email should match at most one user, so a small
// page is plenty while still surfacing near-matches for diagnostics.
const USER_SEARCH_PAGE_SIZE = 20;

// Older Jira Data Center rejects the `query` parameter and demands `username` instead; the proxy
// surfaces this exact phrase in the error, so we detect it and retry the legacy parameter.
const LEGACY_USER_SEARCH_HINT = 'username query parameter was not provided';

/**
 * Searches Jira users by free text (typically an email). Uses the modern `query` parameter and,
 * on the Data Center instances that reject it, transparently retries with the legacy `username`
 * parameter. Reporter resolution matches the returned users' email addresses.
 */
export async function searchUsers(query: string, maxResults: number = USER_SEARCH_PAGE_SIZE): Promise<JiraUser[]> {
  const trimmedQuery = query.trim();
  if (trimmedQuery === '') {
    return [];
  }

  const encodedQuery = encodeURIComponent(trimmedQuery);
  try {
    const results = await jiraGet<JiraUser[]>(`/rest/api/2/user/search?query=${encodedQuery}&maxResults=${maxResults}`);
    return results ?? [];
  } catch (caught) {
    const isLegacyInstance = caught instanceof Error
      && caught.message.toLowerCase().includes(LEGACY_USER_SEARCH_HINT);
    if (!isLegacyInstance) {
      throw caught;
    }
    const legacyResults = await jiraGet<JiraUser[]>(`/rest/api/2/user/search?username=${encodedQuery}&maxResults=${maxResults}`);
    return legacyResults ?? [];
  }
}

// Default page size and per-query chunk size for label searches. A submission maps to at most one
// issue, so a modest page covers a chunk; chunking keeps the JQL string a sane length.
const LABEL_SEARCH_MAX_RESULTS = 100;
const LABEL_SEARCH_CHUNK_SIZE = 50;

/** One issue returned by a label search — just its key and labels, enough to map back to a submission. */
export interface JiraLabelSearchIssue {
  key: string;
  labels: string[];
}

/** Shape of the Jira search response we consume (only key + labels). */
interface JiraSearchResponse {
  issues?: Array<{ key: string; fields?: { labels?: string[] } }>;
}

/** Splits a list into fixed-size chunks so a large label set becomes several bounded queries. */
function chunk<Item>(items: Item[], size: number): Item[][] {
  const chunks: Item[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/**
 * Finds issues carrying any of the given labels, via `labels in (...)` JQL through the proxy. Used
 * by the intake importer to detect an already-created (stamped) issue before creating a duplicate.
 * Returns each match's key and labels; chunks large label lists into multiple queries.
 */
export async function searchIssuesByLabels(labels: string[], maxResults: number = LABEL_SEARCH_MAX_RESULTS): Promise<JiraLabelSearchIssue[]> {
  const cleanedLabels = labels.map((label) => label.trim()).filter((label) => label !== '');
  if (cleanedLabels.length === 0) {
    return [];
  }

  const matches: JiraLabelSearchIssue[] = [];
  for (const labelChunk of chunk(cleanedLabels, LABEL_SEARCH_CHUNK_SIZE)) {
    const quotedLabels = labelChunk.map((label) => `"${label}"`).join(', ');
    const jql = `labels in (${quotedLabels})`;
    const response = await jiraGet<JiraSearchResponse>(
      `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=labels&maxResults=${maxResults}`,
    );
    for (const issue of response.issues ?? []) {
      matches.push({ key: issue.key, labels: issue.fields?.labels ?? [] });
    }
  }
  return matches;
}
