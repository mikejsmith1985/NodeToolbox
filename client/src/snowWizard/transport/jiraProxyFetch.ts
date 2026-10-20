// jiraProxyFetch.ts — Inside the Wizard bundle this is INJECTED as the global `fetch` (esbuild inject in
// scripts/build-snow-wizard.js). Toolbox's jiraApi calls `/jira-proxy/...` on its local server; here those calls go to
// the Jira tab instead, and every other request is an ordinary browser fetch. jiraApi itself is unchanged.

import { readJiraTransport } from './wizardTransports.ts';

const JIRA_PROXY_PREFIX = '/jira-proxy';
const HTTP_NO_CONTENT = 204;
/** Where Jira serves attachment files; these come back as bytes, not JSON. */
const ATTACHMENT_PATH_PREFIX = '/secure/attachment/';
/** What an older Jira-tab bookmark answers when asked for a file it cannot send. */
const OLD_BOOKMARK_REFUSAL = 'refused: only /rest/ paths are served';
const OUTDATED_BOOKMARK_MESSAGE = 'The SNow Wizard bookmark is out of date, so it cannot fetch files from Jira. '
  + 'Drag the new bookmark from the Wizard to your bookmarks bar, then press "Open Jira" again.';

function readRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function readRequestBody(init: RequestInit | undefined): string | undefined {
  if (init?.body === undefined || init.body === null) return undefined;
  if (typeof init.body !== 'string') throw new TypeError('The SNow Wizard sends Jira only text bodies');
  return init.body;
}

function decodeBase64ToBytes(encodedText: string): Uint8Array<ArrayBuffer> {
  const binaryText = atob(encodedText);
  const decodedBytes = new Uint8Array(binaryText.length);
  for (let i = 0; i < binaryText.length; i++) decodedBytes[i] = binaryText.charCodeAt(i);
  return decodedBytes;
}

/**
 * Fetches one Jira attachment through the Jira tab, as base64, and hands back its exact bytes. A tab running an older
 * bookmark either refuses or sends the file as text (damaged); both are refused with a plain "update the bookmark".
 */
async function fetchAttachmentFile(jiraTransport: NonNullable<ReturnType<typeof readJiraTransport>>, attachmentPath: string): Promise<Response> {
  const jiraResponse = await jiraTransport.execute({ method: 'GET', path: attachmentPath, body: undefined, responseEncoding: 'base64' });
  if (jiraResponse.status === 0 && jiraResponse.body === OLD_BOOKMARK_REFUSAL) throw new TypeError(OUTDATED_BOOKMARK_MESSAGE);
  if (jiraResponse.status === 0) throw new TypeError(`Jira did not answer: ${jiraResponse.body}`);
  if (jiraResponse.bodyEncoding !== 'base64') {
    if (jiraResponse.status >= 200 && jiraResponse.status < 300) throw new TypeError(OUTDATED_BOOKMARK_MESSAGE);
    return new Response(jiraResponse.body, { status: jiraResponse.status });
  }
  return new Response(decodeBase64ToBytes(jiraResponse.body), { status: jiraResponse.status, headers: { 'Content-Type': 'application/octet-stream' } });
}

/** The Wizard's `fetch`: Jira-proxy calls go to the Jira tab; everything else is the browser's own fetch. */
export async function wizardFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requestUrl = readRequestUrl(input);
  if (!requestUrl.startsWith(JIRA_PROXY_PREFIX)) return globalThis.fetch(input, init);

  const jiraTransport = readJiraTransport();
  if (!jiraTransport) throw new TypeError('Jira is not connected — press "Open Jira" in the SNow Wizard.');
  const jiraPath = requestUrl.slice(JIRA_PROXY_PREFIX.length);
  if (jiraPath.startsWith(ATTACHMENT_PATH_PREFIX)) return fetchAttachmentFile(jiraTransport, jiraPath);
  const jiraResponse = await jiraTransport.execute({
    method: ((init?.method ?? 'GET').toUpperCase()) as 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: jiraPath,
    body: readRequestBody(init),
  });
  // Status 0 means Jira was never reached — the same thing a browser reports as a failed fetch.
  if (jiraResponse.status === 0) throw new TypeError(`Jira did not answer: ${jiraResponse.body}`);
  const responseBody = jiraResponse.status === HTTP_NO_CONTENT ? null : jiraResponse.body;
  return new Response(responseBody, { status: jiraResponse.status, headers: { 'Content-Type': 'application/json' } });
}

// esbuild `inject` replaces every bare `fetch` in the Wizard bundle with this export.
export { wizardFetch as fetch };
