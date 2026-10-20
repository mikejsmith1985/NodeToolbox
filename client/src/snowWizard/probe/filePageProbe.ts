// filePageProbe.ts — The probe file's own page: numbered steps that let the owner test, in production, whether the
// SNow Wizard can reach ServiceNow and Jira with no server (feature 040, contracts/relay-probe.md). Read-only throughout.

import { buildBookmarkHref } from '../transport/bookmarkPayload.ts';
import { sendAgentRequest, waitForAgentHello } from '../transport/agentChannel.ts';
import { buildSnowWindowHtml, type ProbeBuildInputs } from './probeAssets.ts';
import { createNode, createResultPanel, createStep, type ResultPanel } from './probeDom.ts';
import { FILE_PAGE_PROBE_IDS, PROBE_CHANNEL_NAME, describeBrowser } from './probeResult.ts';

/** The bookmark size the real Wizard is budgeted to (research R-004); the size test bookmark is padded to it. */
export const BIG_BOOKMARK_BUDGET_BYTES = 1.5 * 1024 * 1024;
/** How long a step waits for the owner to click the bookmark on the tab it opened. */
export const DEFAULT_HELLO_TIMEOUT_MS = 3 * 60 * 1000;
const AGENT_REQUEST_TIMEOUT_MS = 30 * 1000;
const HEADER_DETAIL_MAX_CHARACTERS = 300;
const JIRA_IDENTITY_PATH = '/rest/api/2/myself';

/** Everything the page touches outside itself, injected so it can be tested without a browser's real windows. */
export interface FilePageProbeDependencies {
  assets: ProbeBuildInputs;
  openWindow: (url: string, windowName: string) => Window | null;
  userAgent: string;
  helloTimeoutMs: number;
}

interface FilePageState {
  snowUrl: string;
  jiraUrl: string;
  snowHeaders: string;
  jiraHeaders: string;
}

function readHostname(addressText: string): string {
  try {
    return new URL(addressText.trim()).hostname;
  } catch {
    return '';
  }
}

function createTextField(labelText: string, isMultiline: boolean, onValue: (value: string) => void): HTMLLabelElement {
  const fieldNode = isMultiline
    ? createNode('textarea', { rows: '3', class: 'probe-input' })
    : createNode('input', { type: 'url', class: 'probe-input', placeholder: 'https://…' });
  fieldNode.addEventListener('input', () => onValue(fieldNode.value));
  return createNode('label', { class: 'probe-label' }, labelText, fieldNode);
}

/** The size test: a bookmark padded to the budget that only shows a badge with its own size. */
function buildBigBookmarkHref(): string {
  const badgeSource = 'var badgeNode=document.createElement("div");badgeNode.setAttribute("style","position:fixed;bottom:16px;right:16px;background:#238636;color:#fff;padding:10px 16px;border-radius:8px;font:600 13px sans-serif;z-index:2147483647");badgeNode.textContent="SNow Wizard size test ran: a 1.5 MB bookmark works here.";document.body.appendChild(badgeNode);';
  const paddingLength = Math.max(0, BIG_BOOKMARK_BUDGET_BYTES - badgeSource.length);
  return `javascript:${encodeURIComponent(`(function(){${badgeSource}})();void "${'x'.repeat(paddingLength)}";`)}`;
}

function summariseHeaders(headerText: string): string {
  return headerText.trim().replace(/\s+/g, ' ').slice(0, HEADER_DETAIL_MAX_CHARACTERS);
}

function recordHeaders(pageState: FilePageState, resultPanel: ResultPanel): void {
  if (!pageState.snowHeaders.trim() || !pageState.jiraHeaders.trim()) return;
  const headerDetail = `SNow: ${summariseHeaders(pageState.snowHeaders)}; Jira: ${summariseHeaders(pageState.jiraHeaders)}`;
  resultPanel.recordOutcome('P-HEADERS', { isPassed: true, detail: headerDetail });
}

function readDisplayName(responseBody: string): string {
  try {
    return String((JSON.parse(responseBody) as { displayName?: string }).displayName ?? '');
  } catch {
    return '';
  }
}

/** P-JIRA-OPENER-FROM-FILE: open Jira from this file, wait for the agent, ask who is signed in. */
async function probeJiraFromFile(pageState: FilePageState, dependencies: FilePageProbeDependencies, resultPanel: ResultPanel): Promise<void> {
  dependencies.openWindow(pageState.jiraUrl.trim(), 'snowWizardProbeJiraFromFile');
  try {
    const { agentSource, agentOrigin } = await waitForAgentHello(window, PROBE_CHANNEL_NAME, dependencies.helloTimeoutMs, 'jira');
    const agentResponse = await sendAgentRequest(window, agentSource, agentOrigin, PROBE_CHANNEL_NAME, { method: 'GET', path: JIRA_IDENTITY_PATH }, AGENT_REQUEST_TIMEOUT_MS);
    const displayName = readDisplayName(agentResponse.body);
    const isPassed = agentResponse.status === 200 && displayName !== '';
    resultPanel.recordOutcome('P-JIRA-OPENER-FROM-FILE', { isPassed, detail: isPassed ? `Jira answered as ${displayName}` : `HTTP ${agentResponse.status} ${agentResponse.body.slice(0, 80)}` });
  } catch (caughtError) {
    resultPanel.recordOutcome('P-JIRA-OPENER-FROM-FILE', { isPassed: false, detail: (caughtError as Error).message });
  }
}

/** P-SNOW-OPENER-FROM-FILE: expected to fail (ServiceNow's opener policy); recorded either way to confirm research R-001. */
async function probeSnowFromFile(pageState: FilePageState, dependencies: FilePageProbeDependencies, resultPanel: ResultPanel): Promise<void> {
  dependencies.openWindow(pageState.snowUrl.trim(), 'snowWizardProbeSnowFromFile');
  try {
    await waitForAgentHello(window, PROBE_CHANNEL_NAME, dependencies.helloTimeoutMs, 'snow');
    resultPanel.recordOutcome('P-SNOW-OPENER-FROM-FILE', { isPassed: true, detail: 'the ServiceNow tab answered this file' });
  } catch (caughtError) {
    resultPanel.recordOutcome('P-SNOW-OPENER-FROM-FILE', { isPassed: false, detail: (caughtError as Error).message });
  }
}

function createButton(buttonText: string, onClick: () => void): HTMLButtonElement {
  return createNode('button', { type: 'button', class: 'probe-button', onclick: onClick }, buttonText);
}

function renderProbeBookmark(bookmarkSlot: HTMLElement, pageState: FilePageState, assets: ProbeBuildInputs): void {
  const jiraHostname = readHostname(pageState.jiraUrl);
  if (!jiraHostname) {
    bookmarkSlot.replaceChildren(createNode('p', { class: 'probe-hint' }, 'Enter the Jira address in step 1 first.'));
    return;
  }
  const bookmarkHref = buildBookmarkHref({
    snowWindowHtml: buildSnowWindowHtml(assets.snowWindowAppSource, assets.probeStyleSource),
    jiraHostname,
    jiraUrl: pageState.jiraUrl.trim(),
    channelName: PROBE_CHANNEL_NAME,
    isReadOnly: true,
  });
  bookmarkSlot.replaceChildren(createNode('a', { href: bookmarkHref, 'data-probe-bookmark': '', class: 'probe-bookmark', draggable: 'true' }, 'SNow Wizard probe'));
}

function createAddressStep(pageState: FilePageState, onAddressChange: () => void): HTMLElement {
  return createStep(1, 'Tell the probe where ServiceNow and Jira are',
    createTextField('ServiceNow address', false, (value) => { pageState.snowUrl = value; onAddressChange(); }),
    createTextField('Jira address', false, (value) => { pageState.jiraUrl = value; onAddressChange(); }));
}

function createBookmarkStep(bookmarkSlot: HTMLElement): HTMLElement {
  return createStep(2, 'Drag the probe bookmark to your bookmarks bar',
    createNode('p', {}, 'Drag the blue button below onto your bookmarks bar. It only reads — it never changes anything.'),
    bookmarkSlot);
}

function createSnowStep(pageState: FilePageState, dependencies: FilePageProbeDependencies, resultPanel: ResultPanel): HTMLElement {
  return createStep(3, 'Open ServiceNow and click the bookmark there',
    createNode('p', {}, 'Press the button, sign in if asked, then click "SNow Wizard probe" on the ServiceNow tab. '
      + 'A new window opens with its own checks — follow it and copy its result too.'),
    createButton('Open ServiceNow from this page', () => { void probeSnowFromFile(pageState, dependencies, resultPanel); }));
}

function createJiraStep(pageState: FilePageState, dependencies: FilePageProbeDependencies, resultPanel: ResultPanel): HTMLElement {
  return createStep(4, 'Open Jira from this page and click the bookmark there',
    createNode('p', {}, 'Press the button, sign in if asked, then click "SNow Wizard probe" on the Jira tab and come back here.'),
    createButton('Open Jira from this page', () => { void probeJiraFromFile(pageState, dependencies, resultPanel); }));
}

function createHeadersStep(pageState: FilePageState, resultPanel: ResultPanel): HTMLElement {
  return createStep(5, 'Copy the security headers',
    createNode('p', {}, 'On each tab press F12 → Network → reload → click the first row → Response Headers. Copy the lines '
      + 'cross-origin-opener-policy, content-security-policy and x-frame-options (whichever exist) into the boxes.'),
    createTextField('ServiceNow headers', true, (value) => { pageState.snowHeaders = value; recordHeaders(pageState, resultPanel); }),
    createTextField('Jira headers', true, (value) => { pageState.jiraHeaders = value; recordHeaders(pageState, resultPanel); }));
}

function createSizeStep(resultPanel: ResultPanel): HTMLElement {
  const recordSize = (isPassed: boolean) => resultPanel.recordOutcome('P-BOOKMARK-SIZE', {
    isPassed,
    detail: isPassed ? `a ${BIG_BOOKMARK_BUDGET_BYTES}-byte bookmark ran` : 'the big bookmark did nothing',
  });
  return createStep(6, 'Check a full-size bookmark works',
    createNode('p', {}, 'Drag this second button to the bookmarks bar, click it on the ServiceNow tab, then say what happened.'),
    createNode('a', { href: buildBigBookmarkHref(), 'data-big-bookmark': '', class: 'probe-bookmark', draggable: 'true' }, 'SNow Wizard size test'),
    createNode('div', { class: 'probe-actions' },
      createButton('It showed the green badge', () => recordSize(true)),
      createButton('Nothing happened', () => recordSize(false))));
}

/**
 * Mounts the probe file's guided page. Each step records only what it observed; the result block below always lists
 * every file-page probe, so the owner can copy it at any time.
 */
export function mountFilePageProbe(root: HTMLElement, dependencies: FilePageProbeDependencies): void {
  const pageState: FilePageState = { snowUrl: '', jiraUrl: '', snowHeaders: '', jiraHeaders: '' };
  const resultPanel = createResultPanel('file-page', describeBrowser(dependencies.userAgent), FILE_PAGE_PROBE_IDS);
  const bookmarkSlot = createNode('div', { class: 'probe-bookmark-slot' });
  renderProbeBookmark(bookmarkSlot, pageState, dependencies.assets);

  root.replaceChildren(
    createNode('h1', {}, 'SNow Wizard connection probe'),
    createNode('p', { class: 'probe-intro' }, 'This page checks whether the SNow Wizard can talk to ServiceNow and Jira with nothing installed. '
      + 'Everything here only reads. When you are done, copy both result lines (this page and the ServiceNow window) back to the team.'),
    createAddressStep(pageState, () => renderProbeBookmark(bookmarkSlot, pageState, dependencies.assets)),
    createBookmarkStep(bookmarkSlot),
    createSnowStep(pageState, dependencies, resultPanel),
    createJiraStep(pageState, dependencies, resultPanel),
    createHeadersStep(pageState, resultPanel),
    createSizeStep(resultPanel),
    createStep(7, 'Copy the result of this page', resultPanel.element),
  );
}
