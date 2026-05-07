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

function assertSuccessfulResponse(response: Response, messagePrefix: string): void {
  if (!response.ok) {
    throw new Error(`${messagePrefix}: ${response.status}`);
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
    assertSuccessfulResponse(response, `Jira GET ${path} failed`);
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
    assertSuccessfulResponse(response, `Jira POST ${path} failed`);
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
    assertSuccessfulResponse(response, `Jira PUT ${path} failed`);
    return { value: undefined, status: response.status };
  });
}
