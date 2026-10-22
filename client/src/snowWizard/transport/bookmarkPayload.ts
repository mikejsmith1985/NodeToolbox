// bookmarkPayload.ts — Builds the SNow Wizard's relay bookmark. The Wizard page opens ServiceNow and Jira in their own
// tabs; clicking the bookmark in each tab makes that tab answer the Wizard's requests with the user's signed-in session.
// The bookmark carries no Wizard code, so a new Wizard version never needs a new bookmark.
//
// IMPORTANT: `detectBookmarkRole`, `showWizardBadge`, `runRelayAgent` and `runBookmark` are serialized with
// `.toString()` into the bookmark and run on someone else's page. They must not reference any import or module-level
// value; everything they need arrives as arguments.

import { SNOW_HOSTNAME_FRAGMENTS, SNOW_TOKEN_RESOLVER_SOURCE } from '../../services/snowRelayShared.ts';

export type RelaySystem = 'snow' | 'jira';
export type BookmarkRole = 'snowAgent' | 'jiraAgent' | 'unknown';

/** Everything the bookmark needs, frozen into it when it is dragged to the bookmarks bar. */
export interface BookmarkConfig {
  channelName: string;
}

/** What one agent needs: its channel, and which system it serves. */
export interface RelayAgentConfig {
  channelName: string;
  system: RelaySystem;
}

// ── Runtimes (serialized into the bookmark) ──────────────────────────────────

/**
 * Decides what the bookmark does on the page it was clicked on. It only ever serves a tab the Wizard opened (one with
 * an opener); a ServiceNow host serves ServiceNow, any other host is treated as Jira, so a Jira move needs no new
 * bookmark (R-011).
 */
export function detectBookmarkRole(hostname: string, snowHostnameFragments: readonly string[], hasOpener: boolean): BookmarkRole {
  if (!hasOpener) return 'unknown';
  const normalizedHostname = hostname.toLowerCase();
  const isServiceNowPage = snowHostnameFragments.some((hostnameFragment) => normalizedHostname.indexOf(hostnameFragment) >= 0);
  return isServiceNowPage ? 'snowAgent' : 'jiraAgent';
}

/** Shows a small status badge on the page the bookmark was clicked on (click to dismiss). */
export function showWizardBadge(message: string, backgroundColor: string): void {
  const badgeId = 'snow-wizard-badge';
  let badgeElement = document.getElementById(badgeId);
  if (!badgeElement) {
    badgeElement = document.createElement('div');
    badgeElement.id = badgeId;
    badgeElement.onclick = () => badgeElement?.remove();
    document.body.appendChild(badgeElement);
  }
  badgeElement.setAttribute('style', `position:fixed;bottom:16px;right:16px;background:${backgroundColor};color:#fff;padding:10px 16px;border-radius:8px;font:600 13px sans-serif;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,.4);cursor:pointer;max-width:440px`);
  badgeElement.textContent = message;
}

/**
 * The relay: answers the Wizard page that opened this tab. Each request runs on this tab's own origin with the user's
 * session (ServiceNow also gets its session token, read fresh every time, so it never goes stale mid-job). Only the
 * opener's messages are answered, and only same-site paths are fetched. Returns a function that stops serving.
 */
export function runRelayAgent(
  config: RelayAgentConfig,
  resolveUserToken: (() => string) | null,
  showBadge: (message: string, backgroundColor: string) => void,
): () => void {
  const openerWindow = window.opener as Window | null;
  if (!openerWindow) {
    showBadge('SNow Wizard: this tab was not opened from the SNow Wizard. Press Connect in the Wizard instead.', '#991b1b');
    return () => undefined;
  }
  const systemLabel = config.system === 'snow' ? 'ServiceNow' : 'Jira';
  openerWindow.postMessage({ channel: config.channelName, kind: 'hello', system: config.system }, '*');
  showBadge(`SNow Wizard is connected to this ${systemLabel} tab — keep it open; you are back in the Wizard.`, '#238636');
  // The bookmark click is a user action, which is what lets this tab hand focus back to the Wizard.
  try {
    openerWindow.focus();
  } catch {
    // Some browsers refuse; the badge still tells the user where to go.
  }

  // Inside this function on purpose: the bookmark carries no imports. Sliced, because one giant spread overflows the stack.
  const encodeBytesAsBase64 = (fileBytes: Uint8Array) => {
    const sliceSize = 8192;
    let binaryText = '';
    for (let sliceStart = 0; sliceStart < fileBytes.length; sliceStart += sliceSize) {
      binaryText += String.fromCharCode.apply(null, Array.from(fileBytes.subarray(sliceStart, sliceStart + sliceSize)));
    }
    return btoa(binaryText);
  };
  const decodeBase64ToBytes = (encodedText: string) => {
    const binaryText = atob(encodedText);
    const decodedBytes = new Uint8Array(binaryText.length);
    for (let i = 0; i < binaryText.length; i++) decodedBytes[i] = binaryText.charCodeAt(i);
    return decodedBytes;
  };
  const buildHeaders = (requestData: { contentType?: string; responseEncoding?: string }) => {
    const requestHeaders: Record<string, string> = requestData.responseEncoding === 'base64'
      ? { Accept: '*/*' }
      : { Accept: 'application/json', 'Content-Type': requestData.contentType || 'application/json' };
    if (config.system === 'snow') {
      requestHeaders['X-Requested-With'] = 'XMLHttpRequest';
      const userToken = resolveUserToken ? resolveUserToken() : '';
      if (userToken) requestHeaders['X-UserToken'] = userToken;
    }
    return requestHeaders;
  };
  const readRequestBody = (requestData: { body?: unknown; bodyEncoding?: string }) => {
    if (requestData.body == null) return undefined;
    if (requestData.bodyEncoding === 'base64') return decodeBase64ToBytes(String(requestData.body));
    return typeof requestData.body === 'string' ? requestData.body : JSON.stringify(requestData.body);
  };

  // Brings the Wizard back to the front. A tab may switch to a window it can name while the user's bookmark click still
  // counts, so the Wizard sends its name right after hello. Should the name reach nothing, the browser opens an empty
  // tab instead — that one is closed at once.
  let hasReturnedToWizard = false;
  const returnToWizard = (appWindowName: unknown) => {
    if (hasReturnedToWizard || typeof appWindowName !== 'string' || appWindowName.indexOf('snowWizardApp-') !== 0) return;
    hasReturnedToWizard = true;
    try {
      const reachedWindow = window.open('', appWindowName);
      if (reachedWindow && reachedWindow !== openerWindow) reachedWindow.close();
    } catch {
      // The badge still says where to go.
    }
  };

  const handleWizardRequest = async (messageEvent: MessageEvent) => {
    const requestData = messageEvent.data;
    if (!requestData || requestData.channel !== config.channelName) return;
    // Only the Wizard that opened this tab is ever answered — any other page gets nothing at all.
    if (messageEvent.source !== openerWindow) return;
    if (requestData.kind === 'welcome') {
      returnToWizard(requestData.appWindowName);
      return;
    }
    if (requestData.kind !== 'request') return;
    // A file:// Wizard has the origin "null", which postMessage cannot target by name.
    const replyOrigin = messageEvent.origin && messageEvent.origin !== 'null' ? messageEvent.origin : '*';
    const reply = (status: number, body: string, bodyEncoding?: 'base64') => openerWindow.postMessage(
      { channel: config.channelName, kind: 'response', requestId: requestData.requestId, status, body, ...(bodyEncoding ? { bodyEncoding } : {}) }, replyOrigin);

    const requestPath = typeof requestData.path === 'string' ? requestData.path : '';
    // Same-site paths only: "//host" would send the user's session somewhere else.
    if (requestPath.charAt(0) !== '/' || requestPath.charAt(1) === '/') {
      reply(0, 'refused: only paths on this site are served');
      return;
    }
    try {
      // `window.fetch`, never bare `fetch`: the Wizard build swaps every bare `fetch` for its own Jira-routing one
      // (esbuild inject), which would leave this serialized code calling a name that does not exist in the tab.
      const siteResponse = await window.fetch(location.origin + requestPath, {
        method: String(requestData.method || 'GET').toUpperCase(),
        credentials: 'include',
        headers: buildHeaders(requestData),
        body: readRequestBody(requestData),
      });
      if (requestData.responseEncoding !== 'base64') {
        reply(siteResponse.status, await siteResponse.text());
        return;
      }
      // A file's bytes would be damaged as text, so they cross as base64.
      reply(siteResponse.status, encodeBytesAsBase64(new Uint8Array(await siteResponse.arrayBuffer())), 'base64');
    } catch (requestError) {
      reply(0, (requestError as Error).message);
    }
  };
  window.addEventListener('message', handleWizardRequest);
  // When the Wizard page closes, this tab has no one left to serve. A Jira tab the Wizard opened closes itself so tabs
  // do not pile up; a ServiceNow tab stays open, because people keep working in it.
  const openerCheckId = setInterval(() => {
    let isOpenerClosed: boolean;
    try {
      isOpenerClosed = openerWindow.closed === true;
    } catch {
      return;
    }
    if (!isOpenerClosed) return;
    clearInterval(openerCheckId);
    window.removeEventListener('message', handleWizardRequest);
    if (config.system === 'jira') window.close();
    showBadge(`The SNow Wizard was closed — this ${systemLabel} tab is no longer connected.`, '#57606a');
  }, 1000);
  return () => {
    clearInterval(openerCheckId);
    window.removeEventListener('message', handleWizardRequest);
  };
}

/** Entry point inside the bookmark: pick a role, then run it. */
export function runBookmark(
  config: BookmarkConfig & { snowHostnameFragments: readonly string[] },
  detectRole: typeof detectBookmarkRole,
  relayAgent: typeof runRelayAgent,
  showBadge: typeof showWizardBadge,
  resolveUserToken: () => string,
): void {
  const bookmarkRole = detectRole(location.hostname, config.snowHostnameFragments, Boolean(window.opener));
  if (bookmarkRole === 'snowAgent') relayAgent({ channelName: config.channelName, system: 'snow' }, resolveUserToken, showBadge);
  else if (bookmarkRole === 'jiraAgent') relayAgent({ channelName: config.channelName, system: 'jira' }, null, showBadge);
  else showBadge('SNow Wizard: open the SNow Wizard file and press Connect — then click this bookmark in the tab it opens.', '#b08800');
}

// ── Builders (run in the Wizard page, not in the bookmark) ───────────────────

/** Assembles the bookmark's JavaScript: the shared ServiceNow token lookup plus the serialized runtimes, called once. */
export function buildBookmarkSource(config: BookmarkConfig): string {
  const frozenConfig = { ...config, snowHostnameFragments: SNOW_HOSTNAME_FRAGMENTS };
  const runtimeArguments = [JSON.stringify(frozenConfig), detectBookmarkRole, runRelayAgent, showWizardBadge, 'resolveUserToken'];
  return `(function(){${SNOW_TOKEN_RESOLVER_SOURCE};(${runBookmark})(${runtimeArguments.join(',')});})();`;
}

/**
 * Wraps the source as a draggable `javascript:` link. The source is percent-encoded because browsers decode a
 * javascript: URL before running it — any raw "%" in the code would otherwise corrupt it.
 */
export function buildBookmarkHref(config: BookmarkConfig): string {
  return `javascript:${encodeURIComponent(buildBookmarkSource(config))}`;
}
