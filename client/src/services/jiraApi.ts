// jiraApi.ts — Typed Jira REST client routed through the Express Jira proxy.

const JIRA_PROXY_BASE = '/jira-proxy';
const JSON_CONTENT_TYPE = 'application/json';

function assertSuccessfulResponse(response: Response, messagePrefix: string): void {
  if (!response.ok) {
    throw new Error(`${messagePrefix}: ${response.status}`);
  }
}

function parseJsonResponse<ResponseBody>(response: Response): Promise<ResponseBody> {
  return response.json() as Promise<ResponseBody>;
}

/** Makes an authenticated GET request to the Jira REST API via proxy. */
export async function jiraGet<ResponseBody>(path: string): Promise<ResponseBody> {
  const response = await fetch(`${JIRA_PROXY_BASE}${path}`);

  assertSuccessfulResponse(response, `Jira GET ${path} failed`);
  return parseJsonResponse<ResponseBody>(response);
}

/** Makes an authenticated POST request to the Jira REST API via proxy. */
export async function jiraPost<ResponseBody>(
  path: string,
  body: unknown,
): Promise<ResponseBody> {
  const response = await fetch(`${JIRA_PROXY_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': JSON_CONTENT_TYPE },
    body: JSON.stringify(body),
  });

  assertSuccessfulResponse(response, `Jira POST ${path} failed`);
  return parseJsonResponse<ResponseBody>(response);
}
