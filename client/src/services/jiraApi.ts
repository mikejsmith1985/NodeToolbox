// jiraApi.ts — Typed Jira REST client routed through the Express Jira proxy.
//
// Every successful or failed call emits a `toolbox:api` CustomEvent on
// `window` so the Dev Panel view can record API activity without coupling to
// this module. The event detail shape is documented by `JiraApiEventDetail`.

const JIRA_PROXY_BASE = '/jira-proxy';
const JSON_CONTENT_TYPE = 'application/json';
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

function parseJsonResponse<ResponseBody>(response: Response): Promise<ResponseBody> {
  return response.json() as Promise<ResponseBody>;
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
