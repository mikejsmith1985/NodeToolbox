// main.entry.tsx — Script of snow-hub-wizard.html: the file IS the SNow Wizard. Wires real browser APIs into the app
// and mounts it; ServiceNow and Jira are reached through the tabs the app opens.

import { createRoot } from 'react-dom/client';

import WizardApp from './shell/WizardApp.tsx';
import type { WizardAppDependencies } from './shell/useWizardConnections.ts';

// Replaced with the release version by esbuild `define` in scripts/build-snow-wizard.js.
declare const __WIZARD_VERSION__: string | undefined;

/** How long to wait for the user to sign in and click the bookmark in a tab the Wizard opened. */
const HELLO_TIMEOUT_MS = 3 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;

function resolveMountRoot(): HTMLElement {
  const existingRoot = document.getElementById('wizard-root');
  if (existingRoot) return existingRoot;
  const createdRoot = document.createElement('div');
  createdRoot.id = 'wizard-root';
  document.body.appendChild(createdRoot);
  return createdRoot;
}

const WIZARD_DEPENDENCIES: WizardAppDependencies = {
  openWindow: (url, windowName) => window.open(url, windowName),
  listenerTarget: window,
  helloTimeoutMs: HELLO_TIMEOUT_MS,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
};

const appVersion = typeof __WIZARD_VERSION__ === 'string' ? __WIZARD_VERSION__ : 'dev';
createRoot(resolveMountRoot()).render(<WizardApp dependencies={WIZARD_DEPENDENCIES} appVersion={appVersion} />);
