// bookmarkPayload.ts — Builds the one SNow Wizard bookmark: on ServiceNow it opens the Wizard inside ServiceNow's own
// origin; on Jira it becomes the agent that answers the Wizard's Jira requests (feature 040, wizard-transport.md).
//
// Framework-first drift (Art VII): Toolbox's relay needs its local server as the go-between because Chrome severs
// tab-to-tab messaging under ServiceNow's Cross-Origin-Opener-Policy. The Wizard has no server by the owner's decision,
// so this bookmark moves the app INTO ServiceNow's origin instead (a blob: window) and keeps tab messaging only for Jira.
//
// IMPORTANT: the `run*` functions and `detectBookmarkRole` are serialized with `.toString()` into the bookmark and run on
// someone else's page. They must not reference any import or module-level value; everything they need arrives as
// arguments.

import { SNOW_HOSTNAME_FRAGMENTS, SNOW_TOKEN_RESOLVER_SOURCE } from '../../services/snowRelayShared.ts';

/** Placeholder in the Wizard window's HTML that the launcher replaces with the boot data (origin, token, channel). */
export const BOOT_PLACEHOLDER = '__SNOW_WIZARD_BOOT_JSON__';

export type BookmarkRole = 'snowLauncher' | 'jiraAgent' | 'unknown';

/** Everything the bookmark needs, frozen into it when the owner drags it to the bookmarks bar. */
export interface BookmarkConfig {
  snowWindowHtml: string;
  /** The probe freezes the Jira host; the Wizard leaves it empty so a Jira move needs no new bookmark (R-011). */
  jiraHostname: string;
  channelName: string;
  jiraUrl?: string;
  isReadOnly?: boolean;
  allowedRequesterHostFragments?: readonly string[];
}

/** Badge helper handed to the runtimes (they cannot import it — see the file header). */
export interface BookmarkTools {
  showBadge: (message: string, backgroundColor: string) => void;
}

/** The subset of the config the Jira agent reads. */
export interface JiraAgentConfig {
  channelName: string;
  isReadOnly?: boolean;
  /**
   * When set, only windows on these hosts may send requests (the Wizard runs inside ServiceNow, so this is the
   * ServiceNow host fragments). Absent only for the probe, whose file page has no host to check.
   */
  allowedRequesterHostFragments?: readonly string[];
}

// ── Runtimes (serialized into the bookmark) ──────────────────────────────────

/**
 * Decides what the bookmark does from the page it was clicked on. With a frozen Jira host (the probe) only that host
 * is an agent; without one (the Wizard) any non-ServiceNow tab that the Wizard opened is — its requests are then
 * accepted only from ServiceNow windows, so the Jira address can change without re-installing the bookmark.
 */
export function detectBookmarkRole(
  hostname: string,
  snowHostnameFragments: readonly string[],
  jiraHostname: string,
  hasOpener = false,
): BookmarkRole {
  const normalizedHostname = hostname.toLowerCase();
  const isServiceNowPage = snowHostnameFragments.some((hostnameFragment) => normalizedHostname.indexOf(hostnameFragment) >= 0);
  if (isServiceNowPage) return 'snowLauncher';
  const normalizedJiraHostname = jiraHostname.trim().toLowerCase();
  if (normalizedJiraHostname !== '') return normalizedHostname === normalizedJiraHostname ? 'jiraAgent' : 'unknown';
  return hasOpener ? 'jiraAgent' : 'unknown';
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

const DEFAULT_AGENT_TOOLS: BookmarkTools = { showBadge: showWizardBadge };

/**
 * Jira agent: answers the Wizard window that opened this Jira tab. Runs each request on Jira's own origin with the
 * user's session, so no Jira password or token ever exists. Only `/rest/` paths are served, and only reads while
 * read-only (the probe). The probe replies to `*` because a file:// opener has the origin "null"; the real Wizard pins
 * the opener's origin (wizard-transport.md).
 */
export function runJiraAgent(config: JiraAgentConfig, tools: BookmarkTools = DEFAULT_AGENT_TOOLS): () => void {
  const openerWindow = window.opener as Window | null;
  if (!openerWindow) {
    tools.showBadge('SNow Wizard: no Wizard window is connected to this tab — the browser cut the link. Note this in the probe.', '#991b1b');
    return () => undefined;
  }
  openerWindow.postMessage({ channel: config.channelName, kind: 'hello', system: 'jira' }, '*');
  tools.showBadge('SNow Wizard is connected to this Jira tab — keep it open; you are back in the Wizard.', '#238636');
  // The bookmark click is a user action, which is what lets this tab hand focus back to the Wizard window.
  try {
    openerWindow.focus();
  } catch {
    // Some browsers refuse; the badge still tells the user where to go.
  }
  const allowedFragments = config.allowedRequesterHostFragments;
  const isRequesterAllowed = (requesterOrigin: string) => {
    if (!allowedFragments) return true;
    const requesterHostname = requesterOrigin.replace(/^[a-z]+:\/\//i, '').split(':')[0].toLowerCase();
    return allowedFragments.some((hostFragment) => requesterHostname.indexOf(hostFragment) >= 0);
  };

  const handleWizardRequest = async (messageEvent: MessageEvent) => {
    const requestData = messageEvent.data;
    if (!requestData || requestData.channel !== config.channelName || requestData.kind !== 'request') return;
    // A page that is not ServiceNow gets no answer at all — not even a refusal carrying Jira data.
    if (!isRequesterAllowed(messageEvent.origin)) return;
    const replyTarget = (messageEvent.source as Window | null) ?? openerWindow;
    const replyOrigin = messageEvent.origin && messageEvent.origin !== 'null' ? messageEvent.origin : '*';
    const reply = (status: number, body: string) => replyTarget.postMessage(
      { channel: config.channelName, kind: 'response', requestId: requestData.requestId, status, body }, replyOrigin);

    const requestMethod = String(requestData.method || 'GET').toUpperCase();
    if (typeof requestData.path !== 'string' || requestData.path.indexOf('/rest/') !== 0) {
      reply(0, 'refused: only /rest/ paths are served');
      return;
    }
    if (config.isReadOnly && requestMethod !== 'GET') {
      reply(0, 'refused: this bookmark is read-only');
      return;
    }
    try {
      const jiraResponse = await fetch(location.origin + requestData.path, {
        method: requestMethod,
        credentials: 'include',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        // Bodies travel as the exact text Jira should receive; objects (older callers) are serialized once.
        body: requestData.body == null ? undefined : (typeof requestData.body === 'string' ? requestData.body : JSON.stringify(requestData.body)),
      });
      reply(jiraResponse.status, await jiraResponse.text());
    } catch (requestError) {
      reply(0, (requestError as Error).message);
    }
  };
  window.addEventListener('message', handleWizardRequest);
  // Returned so a caller (or a test) can stop serving; the bookmark itself serves until the tab closes.
  return () => window.removeEventListener('message', handleWizardRequest);
}

/**
 * ServiceNow launcher: opens the Wizard window as a blob: document created by this ServiceNow page, so the window
 * belongs to ServiceNow's origin and calls ServiceNow directly. If a Wizard window is already open (it answers a "ping"
 * on the same-origin channel) it is NOT opened twice — the owner's probe finding — it just receives a fresh session
 * token. Also says hello to a window that opened this tab (the probe's file-page test).
 */
export function runSnowLauncher(
  config: BookmarkConfig & { bootPlaceholder: string; pingWaitMs?: number },
  resolveUserToken: () => string,
  tools: BookmarkTools,
): void {
  try {
    (window.opener as Window | null)?.postMessage({ channel: config.channelName, kind: 'hello', system: 'snow' }, '*');
  } catch {
    // A severed opener throws on some browsers; the probe records the missing hello instead.
  }
  let isWizardAlreadyOpen = false;
  const tokenChannel = new BroadcastChannel(config.channelName);
  tokenChannel.onmessage = (messageEvent: MessageEvent) => {
    if (messageEvent.data?.kind === 'tokenRequest') tokenChannel.postMessage({ kind: 'token', token: resolveUserToken() });
    if (messageEvent.data?.kind === 'pong') isWizardAlreadyOpen = true;
  };
  const openWizardWindow = () => {
    const bootData = { instanceOrigin: location.origin, userToken: resolveUserToken(), channelName: config.channelName, jiraUrl: config.jiraUrl ?? '' };
    // Every "<" becomes its JSON escape (backslash, then u003c; the backslash is built from char 92 so no escaping layer
    // can eat it), so the boot data can never close the window's <script> element early.
    const bootJson = JSON.stringify(bootData).split('<').join(String.fromCharCode(92) + 'u003c');
    const windowHtml = config.snowWindowHtml.split(config.bootPlaceholder).join(bootJson);
    const openedWindow = window.open(URL.createObjectURL(new Blob([windowHtml], { type: 'text/html' })), 'snowWizardApp');
    tools.showBadge(
      openedWindow ? 'SNow Wizard opened in its own window — keep this ServiceNow tab open.' : 'The browser blocked the Wizard window — allow pop-ups for this site, then click again.',
      openedWindow ? '#238636' : '#991b1b',
    );
  };
  tokenChannel.postMessage({ kind: 'ping' });
  // A short wait for a "pong"; the click still counts as the user's action when the window opens after it.
  setTimeout(() => {
    if (!isWizardAlreadyOpen) return openWizardWindow();
    tokenChannel.postMessage({ kind: 'token', token: resolveUserToken() });
    tools.showBadge('The SNow Wizard is already open in its own window — switch to it. Its ServiceNow connection was refreshed.', '#238636');
  }, config.pingWaitMs ?? 400);
}

/** Entry point inside the bookmark: pick a role, then run it. */
export function runBookmark(
  config: BookmarkConfig & { bootPlaceholder: string; snowHostnameFragments: readonly string[] },
  detectRole: typeof detectBookmarkRole,
  snowLauncher: typeof runSnowLauncher,
  jiraAgent: typeof runJiraAgent,
  showBadge: typeof showWizardBadge,
  resolveUserToken: () => string,
): void {
  const tools = { showBadge };
  const bookmarkRole = detectRole(location.hostname, config.snowHostnameFragments, config.jiraHostname, Boolean(window.opener));
  if (bookmarkRole === 'snowLauncher') {
    snowLauncher(config, resolveUserToken, tools);
  } else if (bookmarkRole === 'jiraAgent') {
    jiraAgent(config, tools);
  } else {
    showBadge('SNow Wizard: click this on your ServiceNow tab, or on Jira when the Wizard asks you to.', '#b08800');
  }
}

// ── Builders (run in the Wizard / probe page, not in the bookmark) ───────────

/** Assembles the bookmark's JavaScript: the shared token resolver plus the serialized runtimes, called once. */
export function buildBookmarkSource(config: BookmarkConfig): string {
  const frozenConfig = {
    ...config,
    isReadOnly: config.isReadOnly ?? true,
    bootPlaceholder: BOOT_PLACEHOLDER,
    snowHostnameFragments: SNOW_HOSTNAME_FRAGMENTS,
  };
  const runtimeArguments = [JSON.stringify(frozenConfig), detectBookmarkRole, runSnowLauncher, runJiraAgent, showWizardBadge, 'resolveUserToken'];
  return `(function(){${SNOW_TOKEN_RESOLVER_SOURCE};(${runBookmark})(${runtimeArguments.join(',')});})();`;
}

/**
 * Wraps the source as a draggable `javascript:` link. The source is percent-encoded because browsers decode a
 * javascript: URL before running it — any raw "%" in the Wizard's code would otherwise corrupt it.
 */
export function buildBookmarkHref(config: BookmarkConfig): string {
  return `javascript:${encodeURIComponent(buildBookmarkSource(config))}`;
}
