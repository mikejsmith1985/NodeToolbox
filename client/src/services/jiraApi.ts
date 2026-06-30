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
