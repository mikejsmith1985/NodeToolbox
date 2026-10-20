// main.entry.tsx — Script of the SNow Wizard window (opened by the bookmark inside ServiceNow): wires real browser APIs
// into the app, or explains how to open it properly when it was opened some other way.

import { createRoot } from 'react-dom/client';

import WizardApp from './shell/WizardApp.tsx';
import type { WizardAppDependencies, WizardBoot } from './shell/useWizardConnections.ts';
import { SCRIPT_BLOCKED_NOTICE_ID } from './probe/probeAssets.ts';
import { holdWizardPresenceLock } from './shell/wizardPresence.ts';
import { WIZARD_PRESENCE_LOCK_NAME } from './wizardDefaults.ts';

// Replaced with the release version by esbuild `define` in scripts/build-snow-wizard.js.
declare const __WIZARD_VERSION__: string | undefined;

/** How long to wait for the user to click the bookmark on the Jira tab. */
const JIRA_HELLO_TIMEOUT_MS = 3 * 60 * 1000;
const JIRA_REQUEST_TIMEOUT_MS = 30 * 1000;
const TOKEN_REQUEST_TIMEOUT_MS = 3 * 1000;

function readBoot(): WizardBoot | null {
  const bootCandidate = (window as Window & { __SNOW_WIZARD_BOOT__?: unknown }).__SNOW_WIZARD_BOOT__;
  return bootCandidate && typeof bootCandidate === 'object' ? bootCandidate as WizardBoot : null;
}

function resolveMountRoot(): HTMLElement {
  const existingRoot = document.querySelector('main') ?? document.getElementById('wizard-root');
  if (existingRoot) return existingRoot as HTMLElement;
  const createdRoot = document.createElement('div');
  createdRoot.id = 'wizard-root';
  document.body.appendChild(createdRoot);
  return createdRoot;
}

const WIZARD_DEPENDENCIES: WizardAppDependencies = {
  fetchFn: (input, init) => fetch(input, init),
  createChannel: (channelName) => new BroadcastChannel(channelName),
  openWindow: (url, windowName) => window.open(url, windowName),
  listenerTarget: window,
  helloTimeoutMs: JIRA_HELLO_TIMEOUT_MS,
  requestTimeoutMs: JIRA_REQUEST_TIMEOUT_MS,
  tokenTimeoutMs: TOKEN_REQUEST_TIMEOUT_MS,
};

document.getElementById(SCRIPT_BLOCKED_NOTICE_ID)?.remove();
const wizardBoot = readBoot();
const mountRoot = resolveMountRoot();
if (wizardBoot) {
  holdWizardPresenceLock(WIZARD_PRESENCE_LOCK_NAME, navigator.locks);
  const appVersion = typeof __WIZARD_VERSION__ === 'string' ? __WIZARD_VERSION__ : 'dev';
  createRoot(mountRoot).render(<WizardApp boot={wizardBoot} dependencies={WIZARD_DEPENDENCIES} appVersion={appVersion} />);
} else {
  mountRoot.textContent = 'Open the SNow Wizard by clicking its bookmark on your ServiceNow tab.';
}
