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
import {
  assembleWizardHtml,
  openInstallStore,
  parseInstallFile,
  readInstalledWizard,
  writeInstalledWizard,
  type InstallStoreConfig,
  type InstalledWizard,
} from '../install/installRuntime.ts';

/** Placeholder in the Wizard window's HTML that the launcher replaces with the boot data (origin, token, channel). */
export const BOOT_PLACEHOLDER = '__SNOW_WIZARD_BOOT_JSON__';

export type BookmarkRole = 'snowLauncher' | 'jiraAgent' | 'unknown';

/** Everything the bookmark needs, frozen into it when the owner drags it to the bookmarks bar. */
export interface BookmarkConfig {
  /** The probe's window page, carried whole. The Wizard leaves it out: its code lives in ServiceNow's storage instead. */
  snowWindowHtml?: string;
  /** The Wizard window's page with marks for its code and look, filled from the installed Wizard (wizardInstall.ts). */
  windowTemplate?: string;
  /** Where the installed Wizard is kept; present only on the Wizard's loader bookmark. */
  installStore?: InstallStoreConfig;
  /** The probe freezes the Jira host; the Wizard leaves it empty so a Jira move needs no new bookmark (R-011). */
  jiraHostname: string;
  channelName: string;
  jiraUrl?: string;
  isReadOnly?: boolean;
  allowedRequesterHostFragments?: readonly string[];
  /**
   * The Web Lock an open Wizard window holds for its whole life. The browser itself answers "is it held?", so a Wizard
   * tab the browser has put to sleep still counts as open. Absent for the probe.
   */
  presenceLockName?: string;
}

/** Badge helper handed to the runtimes (they cannot import it — see the file header). */
export interface BookmarkTools {
  showBadge: (message: string, backgroundColor: string) => void;
  readIsLockHeld: (lockName: string | undefined) => Promise<boolean>;
  /** The install helpers (installRuntime.ts) and the install panel; present only on the Wizard's loader bookmark. */
  install?: InstallTools;
}

/** The install helpers handed to the bookmark (they cannot be imported there — see the file header). */
export interface InstallTools {
  openStore: typeof openInstallStore;
  readInstalled: typeof readInstalledWizard;
  writeInstalled: typeof writeInstalledWizard;
  parseFile: typeof parseInstallFile;
  assemble: typeof assembleWizardHtml;
  showInstallPanel: typeof showInstallPanel;
}

/** What one install attempt from a chosen file came to. */
export interface InstallAttempt {
  installedWizard: InstalledWizard | null;
  /** False when the browser would not keep it: it still opens this once. */
  isKept: boolean;
}

/**
 * True while some window of this site holds the named Web Lock. The browser answers, not the holder, so a sleeping
 * Wizard tab still counts. Runs inside the bookmark, so it uses nothing outside itself.
 */
export async function readIsPresenceLockHeld(lockName: string | undefined): Promise<boolean> {
  if (!lockName || !navigator.locks) return false;
  try {
    const lockSnapshot = await navigator.locks.query();
    return (lockSnapshot.held ?? []).some((heldLock) => heldLock.name === lockName);
  } catch {
    return false;
  }
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

/**
 * The panel shown on the ServiceNow page when no Wizard is installed yet: choose the release file, then open the
 * Wizard. A visible file chooser is used on purpose — the user's own click opens it, so no browser blocks it.
 */
export function showInstallPanel(installFromText: (fileText: string) => Promise<InstallAttempt>, openInstalled: (installedWizard: InstalledWizard) => void): void {
  const panelId = 'snow-wizard-install-panel';
  document.getElementById(panelId)?.remove();
  const panel = document.createElement('div');
  panel.id = panelId;
  panel.setAttribute('style', 'position:fixed;top:80px;left:50%;transform:translateX(-50%);width:min(520px,92vw);background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:12px;padding:20px 24px;font:14px/1.5 sans-serif;z-index:2147483647;box-shadow:0 12px 40px rgba(0,0,0,.5)');
  const addLine = (tagName: string, text: string, style: string) => {
    const lineElement = document.createElement(tagName);
    lineElement.textContent = text;
    lineElement.setAttribute('style', style);
    panel.appendChild(lineElement);
    return lineElement;
  };
  addLine('h2', 'Install the SNow Wizard', 'margin:0 0 8px;font-size:18px');
  addLine('p', 'Choose the snow-hub-wizard.html file you downloaded. You only do this once — after that the bookmark just '
    + 'opens the Wizard. A newer version is installed from the Wizard’s Settings.', 'margin:0 0 12px');
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.html,text/html';
  panel.appendChild(fileInput);
  const statusLine = addLine('p', '', 'margin:12px 0 0;font-weight:600');
  const buttonStyle = 'margin:12px 8px 0 0;padding:8px 16px;border-radius:6px;border:0;font:600 14px sans-serif;cursor:pointer';
  const closeButton = document.createElement('button');
  closeButton.textContent = 'Not now';
  closeButton.setAttribute('style', `${buttonStyle};background:#30363d;color:#e6edf3`);
  closeButton.onclick = () => panel.remove();
  fileInput.onchange = async () => {
    const chosenFile = fileInput.files?.[0];
    if (!chosenFile) return;
    statusLine.textContent = 'Installing…';
    const attempt = await installFromText(await chosenFile.text());
    const installedWizard = attempt.installedWizard;
    if (!installedWizard) {
      statusLine.textContent = '✗ That is not the SNow Wizard file (snow-hub-wizard.html). Choose it again.';
      return;
    }
    statusLine.textContent = attempt.isKept
      ? `✓ SNow Wizard ${installedWizard.version} is installed.`
      : `✓ SNow Wizard ${installedWizard.version} opens this time, but the browser would not keep it — you will be asked again.`;
    fileInput.remove();
    const openButton = document.createElement('button');
    openButton.textContent = 'Open the SNow Wizard';
    openButton.setAttribute('style', `${buttonStyle};background:#1f6feb;color:#fff`);
    openButton.onclick = () => {
      openInstalled(installedWizard);
      panel.remove();
    };
    panel.insertBefore(openButton, closeButton);
  };
  panel.appendChild(closeButton);
  document.body.appendChild(panel);
}

const DEFAULT_AGENT_TOOLS: BookmarkTools = { showBadge: showWizardBadge, readIsLockHeld: readIsPresenceLockHeld };

/**
 * Jira agent: answers the Wizard window that opened this Jira tab. Runs each request on Jira's own origin with the
 * user's session, so no Jira password or token ever exists. Only `/rest/` paths (plus reads of attachment files, sent
 * back as base64) are served, and only reads while
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

  // Inside this function on purpose: the bookmark carries no imports. Sliced, because one giant spread overflows the stack.
  const encodeBytesAsBase64 = (fileBytes: Uint8Array) => {
    const sliceSize = 8192;
    let binaryText = '';
    for (let sliceStart = 0; sliceStart < fileBytes.length; sliceStart += sliceSize) {
      binaryText += String.fromCharCode.apply(null, Array.from(fileBytes.subarray(sliceStart, sliceStart + sliceSize)));
    }
    return btoa(binaryText);
  };

  const handleWizardRequest = async (messageEvent: MessageEvent) => {
    const requestData = messageEvent.data;
    if (!requestData || requestData.channel !== config.channelName || requestData.kind !== 'request') return;
    // A page that is not ServiceNow gets no answer at all — not even a refusal carrying Jira data.
    if (!isRequesterAllowed(messageEvent.origin)) return;
    const replyTarget = (messageEvent.source as Window | null) ?? openerWindow;
    const replyOrigin = messageEvent.origin && messageEvent.origin !== 'null' ? messageEvent.origin : '*';
    const reply = (status: number, body: string, bodyEncoding?: 'base64') => replyTarget.postMessage(
      { channel: config.channelName, kind: 'response', requestId: requestData.requestId, status, body, ...(bodyEncoding ? { bodyEncoding } : {}) }, replyOrigin);

    const requestMethod = String(requestData.method || 'GET').toUpperCase();
    const requestPath = typeof requestData.path === 'string' ? requestData.path : '';
    // Jira serves attachment files outside /rest/, so that one folder is allowed too — and only ever read.
    const isAttachmentRead = requestPath.indexOf('/secure/attachment/') === 0 && requestMethod === 'GET';
    if (requestPath.indexOf('/rest/') !== 0 && !isAttachmentRead) {
      reply(0, 'refused: only /rest/ paths and attachment reads are served');
      return;
    }
    if (config.isReadOnly && requestMethod !== 'GET') {
      reply(0, 'refused: this bookmark is read-only');
      return;
    }
    const isBase64Reply = requestData.responseEncoding === 'base64';
    try {
      const jiraResponse = await fetch(location.origin + requestPath, {
        method: requestMethod,
        credentials: 'include',
        headers: isBase64Reply ? { Accept: '*/*' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
        // Bodies travel as the exact text Jira should receive; objects (older callers) are serialized once.
        body: requestData.body == null ? undefined : (typeof requestData.body === 'string' ? requestData.body : JSON.stringify(requestData.body)),
      });
      if (!isBase64Reply) {
        reply(jiraResponse.status, await jiraResponse.text());
        return;
      }
      // A file's bytes would be damaged as text, so they cross as base64.
      reply(jiraResponse.status, encodeBytesAsBase64(new Uint8Array(await jiraResponse.arrayBuffer())), 'base64');
    } catch (requestError) {
      reply(0, (requestError as Error).message);
    }
  };
  window.addEventListener('message', handleWizardRequest);
  // When the Wizard window closes, this tab has no one left to serve (a new Wizard always opens its own Jira tab), so
  // it closes itself instead of piling up. The Wizard opened it, which is what lets a script close it; if the browser
  // still refuses, a badge says it can be closed.
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
    window.close();
    tools.showBadge('The SNow Wizard window was closed — you can close this Jira tab.', '#57606a');
  }, 1000);
  // Returned so a caller (or a test) can stop serving; the bookmark itself serves until the tab closes.
  return () => {
    clearInterval(openerCheckId);
    window.removeEventListener('message', handleWizardRequest);
  };
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
  const buildBootJson = () => {
    const bootData = { instanceOrigin: location.origin, userToken: resolveUserToken(), channelName: config.channelName, jiraUrl: config.jiraUrl ?? '' };
    // Every "<" becomes its JSON escape (backslash, then u003c; the backslash is built from char 92 so no escaping layer
    // can eat it), so the boot data can never close the window's <script> element early.
    return JSON.stringify(bootData).split('<').join(String.fromCharCode(92) + 'u003c');
  };
  const openWindowWithHtml = (windowHtml: string) => {
    const openedWindow = window.open(URL.createObjectURL(new Blob([windowHtml], { type: 'text/html' })), 'snowWizardApp');
    tools.showBadge(
      openedWindow ? 'SNow Wizard opened in its own window — keep this ServiceNow tab open.' : 'The browser blocked the Wizard window — allow pop-ups for this site, then click again.',
      openedWindow ? '#238636' : '#991b1b',
    );
  };
  const openWizardWindow = () => {
    const install = tools.install;
    const storeConfig = config.installStore;
    const windowTemplate = config.windowTemplate;
    // The probe carries its whole window page; the Wizard's loader reads the installed Wizard from ServiceNow's storage.
    if (!install || !storeConfig || !windowTemplate) {
      openWindowWithHtml((config.snowWindowHtml ?? '').split(config.bootPlaceholder).join(buildBootJson()));
      return;
    }
    const openInstalled = (installedWizard: InstalledWizard) => openWindowWithHtml(install.assemble(windowTemplate, installedWizard, buildBootJson(), storeConfig));
    const installFromText = async (fileText: string) => {
      const installedWizard = install.parseFile(fileText, storeConfig);
      if (!installedWizard) return { installedWizard: null, isKept: false };
      try {
        await install.writeInstalled(storeConfig, install.openStore, installedWizard);
        return { installedWizard, isKept: true };
      } catch {
        return { installedWizard, isKept: false };
      }
    };
    void install.readInstalled(storeConfig, install.openStore).then((installedWizard) => {
      if (installedWizard) openInstalled(installedWizard);
      else install.showInstallPanel(installFromText, openInstalled);
    });
  };
  const refreshOpenWizard = () => {
    tokenChannel.postMessage({ kind: 'token', token: resolveUserToken() });
    tokenChannel.postMessage({ kind: 'attention' });
    tools.showBadge('The SNow Wizard is already open — switch to the tab named "SNow Wizard". Its ServiceNow connection was refreshed.', '#238636');
  };
  tokenChannel.postMessage({ kind: 'ping' });
  // A short wait for a "pong"; the click still counts as the user's action when the window opens after it.
  setTimeout(() => {
    // The ServiceNow tab and the Wizard sit in separate window groups (ServiceNow's pop-up isolation header), so
    // window.open can never find the Wizard by name. The presence lock is the reliable check; the pong covers Wizard
    // windows from before the lock existed.
    void tools.readIsLockHeld(config.presenceLockName).then((isLockHeld) => (isLockHeld || isWizardAlreadyOpen ? refreshOpenWizard() : openWizardWindow()));
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
  readIsLockHeld: typeof readIsPresenceLockHeld,
  install?: InstallTools,
): void {
  const tools = { showBadge, readIsLockHeld, install };
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
  const runtimeArguments: unknown[] = [JSON.stringify(frozenConfig), detectBookmarkRole, runSnowLauncher, runJiraAgent, showWizardBadge, 'resolveUserToken', readIsPresenceLockHeld];
  // Only the Wizard's loader carries the install helpers; the probe's bookmark stays as it was.
  if (config.installStore) {
    runtimeArguments.push(`{openStore:${openInstallStore},readInstalled:${readInstalledWizard},writeInstalled:${writeInstalledWizard},`
      + `parseFile:${parseInstallFile},assemble:${assembleWizardHtml},showInstallPanel:${showInstallPanel}}`);
  }
  return `(function(){${SNOW_TOKEN_RESOLVER_SOURCE};(${runBookmark})(${runtimeArguments.join(',')});})();`;
}

/**
 * Wraps the source as a draggable `javascript:` link. The source is percent-encoded because browsers decode a
 * javascript: URL before running it — any raw "%" in the Wizard's code would otherwise corrupt it.
 */
export function buildBookmarkHref(config: BookmarkConfig): string {
  return `javascript:${encodeURIComponent(buildBookmarkSource(config))}`;
}
