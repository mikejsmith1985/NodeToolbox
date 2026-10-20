// snowWindowProbe.ts — The checks run inside the window the bookmark opens in ServiceNow's own origin: can this window
// call ServiceNow directly, refresh its token, reach Jira, and remember the Wizard file? (feature 040, relay-probe.md)

import { sendAgentRequest, waitForAgentHello } from '../transport/agentChannel.ts';
import { SCRIPT_BLOCKED_NOTICE_ID } from './probeAssets.ts';
import { createNode, createResultPanel, createStep, type ResultPanel } from './probeDom.ts';
import { PROBE_CHANNEL_NAME, SNOW_WINDOW_PROBE_IDS, describeBrowser } from './probeResult.ts';
import {
  pickAndRememberFile,
  readRememberedFile,
  runSnowBroadcastProbe,
  runSnowIdentityProbe,
  runSnowReadProbe,
  type FileHandleStore,
  type FilePicker,
  type TokenChannel,
} from './snowProbes.ts';

const AGENT_REQUEST_TIMEOUT_MS = 30 * 1000;
const JIRA_IDENTITY_PATH = '/rest/api/2/myself';

/** What the bookmark hands this window when it opens it (see bookmarkPayload.runSnowLauncher). */
export interface SnowWindowBoot {
  instanceOrigin: string;
  userToken: string;
  channelName: string;
  jiraUrl: string;
}

/** Everything this window touches outside itself, injected so it can be tested without real windows or storage. */
export interface SnowWindowProbeDependencies {
  fetchFn: (input: string, init?: RequestInit) => Promise<Response>;
  createChannel: (channelName: string) => TokenChannel;
  openWindow: (url: string, windowName: string) => Window | null;
  pickFiles: FilePicker | undefined;
  handleStore: FileHandleStore;
  userAgent: string;
  broadcastTimeoutMs: number;
  helloTimeoutMs: number;
}

async function runServiceNowChecks(boot: SnowWindowBoot, dependencies: SnowWindowProbeDependencies, resultPanel: ResultPanel): Promise<void> {
  const [identityOutcome, readOutcome] = await Promise.all([
    runSnowIdentityProbe(dependencies.fetchFn, boot.instanceOrigin, boot.userToken),
    runSnowReadProbe(dependencies.fetchFn, boot.instanceOrigin, boot.userToken),
  ]);
  resultPanel.recordOutcome('P-SNOW-BLOB', identityOutcome);
  resultPanel.recordOutcome('P-SNOW-WRITE-SAFE', readOutcome);
  resultPanel.recordOutcome('P-SNOW-BROADCAST', await runSnowBroadcastProbe(
    dependencies.createChannel, boot.channelName || PROBE_CHANNEL_NAME, boot.userToken, dependencies.broadcastTimeoutMs));
}

/** P-JIRA-OPENER-FROM-BLOB: the target design's Jira path — this ServiceNow-origin window opens Jira and asks it. */
async function probeJiraFromThisWindow(boot: SnowWindowBoot, dependencies: SnowWindowProbeDependencies, resultPanel: ResultPanel): Promise<void> {
  dependencies.openWindow(boot.jiraUrl, 'snowWizardProbeJiraFromSnow');
  try {
    const channelName = boot.channelName || PROBE_CHANNEL_NAME;
    const { agentSource, agentOrigin } = await waitForAgentHello(window, channelName, dependencies.helloTimeoutMs, 'jira');
    const agentResponse = await sendAgentRequest(window, agentSource, agentOrigin, channelName, { method: 'GET', path: JIRA_IDENTITY_PATH }, AGENT_REQUEST_TIMEOUT_MS);
    const isPassed = agentResponse.status === 200;
    resultPanel.recordOutcome('P-JIRA-OPENER-FROM-BLOB', { isPassed, detail: isPassed ? 'Jira answered this window' : `HTTP ${agentResponse.status} ${agentResponse.body.slice(0, 80)}` });
  } catch (caughtError) {
    resultPanel.recordOutcome('P-JIRA-OPENER-FROM-BLOB', { isPassed: false, detail: (caughtError as Error).message });
  }
}

function createButton(buttonText: string, onClick: () => void): HTMLButtonElement {
  return createNode('button', { type: 'button', class: 'probe-button', onclick: onClick }, buttonText);
}

function createJiraStep(boot: SnowWindowBoot, dependencies: SnowWindowProbeDependencies, resultPanel: ResultPanel): HTMLElement {
  return createStep(2, 'Open Jira from this window',
    createNode('p', {}, 'Press the button, then click "SNow Wizard probe" on the Jira tab and come back here.'),
    createButton('Open Jira from this window', () => { void probeJiraFromThisWindow(boot, dependencies, resultPanel); }));
}

function createFileStep(dependencies: SnowWindowProbeDependencies, resultPanel: ResultPanel): HTMLElement {
  const recordFile = async (runFileProbe: () => ReturnType<typeof readRememberedFile>) => resultPanel.recordOutcome('P-FILE-HANDLE', await runFileProbe());
  return createStep(3, 'Check this window can remember a file',
    createNode('p', {}, 'Pick any file (the probe file is fine). Then close this window, click the bookmark on ServiceNow again, '
      + 'and press "Read it again" — that proves a one-click restart would work.'),
    createNode('div', { class: 'probe-actions' },
      createButton('Pick a file', () => { void recordFile(() => pickAndRememberFile(dependencies.pickFiles, dependencies.handleStore)); }),
      createButton('Read it again', () => { void recordFile(() => readRememberedFile(dependencies.handleStore)); })));
}

/**
 * Mounts the ServiceNow-window probe. Its first act removes the "script was blocked" notice — if that notice is still
 * on screen, the browser refused to run this window's code. The ServiceNow checks run immediately; Jira and the file
 * check wait for the owner. The session token is used, never displayed.
 */
export function mountSnowWindowProbe(root: HTMLElement, boot: SnowWindowBoot, dependencies: SnowWindowProbeDependencies): void {
  document.getElementById(SCRIPT_BLOCKED_NOTICE_ID)?.remove();
  const resultPanel = createResultPanel('snow-window', describeBrowser(dependencies.userAgent), SNOW_WINDOW_PROBE_IDS);
  root.replaceChildren(
    createNode('h1', {}, 'SNow Wizard — ServiceNow window checks'),
    createNode('p', { class: 'probe-intro' }, `This window belongs to ${boot.instanceOrigin}. Everything here only reads.`),
    createStep(1, 'ServiceNow checks (automatic)', createNode('p', {}, 'These ran as soon as this window opened — see the result below.')),
    createJiraStep(boot, dependencies, resultPanel),
    createFileStep(dependencies, resultPanel),
    createStep(4, 'Copy the result of this window', resultPanel.element),
  );
  void runServiceNowChecks(boot, dependencies, resultPanel);
}
