// jiraProxyFetch.ts — Inside the Wizard bundle this is INJECTED as the global `fetch` (esbuild inject in
// scripts/build-snow-wizard.js). Toolbox's jiraApi calls `/jira-proxy/...` on its local server; here those calls go to
// the Jira tab instead, and every other request is an ordinary browser fetch. jiraApi itself is unchanged.

import { readJiraTransport } from './wizardTransports.ts';

const JIRA_PROXY_PREFIX = '/jira-proxy';
const HTTP_NO_CONTENT = 204;

function readRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function readRequestBody(init: RequestInit | undefined): string | undefined {
  if (init?.body === undefined || init.body === null) return undefined;
  if (typeof init.body !== 'string') throw new TypeError('The SNow Wizard sends Jira only text bodies');
  return init.body;
}

/** The Wizard's `fetch`: Jira-proxy calls go to the Jira tab; everything else is the browser's own fetch. */
export async function wizardFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requestUrl = readRequestUrl(input);
  if (!requestUrl.startsWith(JIRA_PROXY_PREFIX)) return globalThis.fetch(input, init);

  const jiraTransport = readJiraTransport();
  if (!jiraTransport) throw new TypeError('Jira is not connected — press "Open Jira" in the SNow Wizard.');
  const jiraResponse = await jiraTransport.execute({
    method: ((init?.method ?? 'GET').toUpperCase()) as 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: requestUrl.slice(JIRA_PROXY_PREFIX.length),
    body: readRequestBody(init),
  });
  // Status 0 means Jira was never reached — the same thing a browser reports as a failed fetch.
  if (jiraResponse.status === 0) throw new TypeError(`Jira did not answer: ${jiraResponse.body}`);
  const responseBody = jiraResponse.status === HTTP_NO_CONTENT ? null : jiraResponse.body;
  return new Response(responseBody, { status: jiraResponse.status, headers: { 'Content-Type': 'application/json' } });
}

// esbuild `inject` replaces every bare `fetch` in the Wizard bundle with this export.
export { wizardFetch as fetch };
