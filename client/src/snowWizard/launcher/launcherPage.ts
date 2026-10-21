// launcherPage.ts — The page inside the shared snow-hub-wizard.html file. It is only an INSTALLER: drag the bookmark
// (once, ever), open ServiceNow, close this page. The Wizard itself always opens from ServiceNow (owner's probe
// finding, R-001), and its code is kept in ServiceNow's own browser storage — so a new version is a file pick, never
// a new bookmark (owner feedback, GH #475).

import { SNOW_HOSTNAME_FRAGMENTS } from '../../services/snowRelayShared.ts';
import { buildWizardWindowTemplate, INSTALL_STORE_CONFIG } from '../install/wizardInstall.ts';
import { createNode, createStep } from '../probe/probeDom.ts';
import { buildBookmarkHref } from '../transport/bookmarkPayload.ts';
import { DEFAULT_SNOW_URL, WIZARD_CHANNEL_NAME, WIZARD_PRESENCE_LOCK_NAME } from '../wizardDefaults.ts';

export { WIZARD_WINDOW_PAGE } from '../install/wizardInstall.ts';

// Replaced with a string literal by esbuild `define` in scripts/build-snow-wizard.js. Absent under test.
declare const __WIZARD_VERSION__: string | undefined;

/** What the build puts into the installer page's script: the version (the Wizard itself is in the page's install block). */
export interface LauncherBuildInputs {
  appVersion: string;
}

/** Reads the build-injected version; `typeof` keeps this safe where the build did not define it. */
export function readLauncherBuildInputs(): LauncherBuildInputs {
  return { appVersion: typeof __WIZARD_VERSION__ === 'string' ? __WIZARD_VERSION__ : 'dev' };
}

/**
 * The Wizard's loader bookmark. It carries no Wizard code — only the window template, where the installed Wizard is
 * kept, and the Jira agent — so it never changes between versions. No Jira address is frozen into it and its Jira side
 * answers only ServiceNow windows, so a Jira move is a Settings change, never a re-install (R-011).
 */
export function buildWizardBookmarkHref(): string {
  return buildBookmarkHref({
    windowTemplate: buildWizardWindowTemplate(),
    installStore: INSTALL_STORE_CONFIG,
    jiraHostname: '',
    channelName: WIZARD_CHANNEL_NAME,
    isReadOnly: false,
    allowedRequesterHostFragments: SNOW_HOSTNAME_FRAGMENTS,
    presenceLockName: WIZARD_PRESENCE_LOCK_NAME,
  });
}

/** Everything the installer touches outside itself. */
export interface LauncherDependencies {
  assets: LauncherBuildInputs;
  openWindow: (url: string, windowName: string) => void;
}

/** Mounts the installer page: three steps, then "you can close this page". */
export function mountLauncherPage(root: HTMLElement, dependencies: LauncherDependencies): void {
  root.replaceChildren(
    createNode('h1', {}, 'SNow Wizard'),
    createNode('p', { class: 'probe-intro' }, `Version ${dependencies.assets.appVersion}. Set up once, in about a minute — nothing to install.`),
    createStep(1, 'Put the SNow Wizard button on your bookmarks bar — once, ever',
      createNode('p', {}, 'Drag the blue button onto your bookmarks bar. Cannot see the bar? Press Ctrl+Shift+B. '
        + 'If you have an older SNow Wizard bookmark, delete it first. This button never changes again: new versions are '
        + 'installed from inside the Wizard.'),
      createNode('a', { href: buildWizardBookmarkHref(), 'data-wizard-bookmark': '', class: 'probe-bookmark', draggable: 'true' }, 'SNow Wizard')),
    createStep(2, 'Open ServiceNow and click the button',
      createNode('p', {}, 'Open ServiceNow, sign in if asked, then click SNow Wizard on your bookmarks bar. The first time, '
        + 'it asks you to choose this file (snow-hub-wizard.html) — then the Wizard opens in its own window.'),
      createNode('button', { type: 'button', class: 'probe-button', onclick: () => dependencies.openWindow(DEFAULT_SNOW_URL, '_blank') }, 'Open ServiceNow')),
    createStep(3, 'That is all',
      createNode('p', {}, 'You can close this page now. For a new version later: download the new snow-hub-wizard.html, '
        + 'then in the Wizard choose Settings → Update the SNow Wizard.')),
  );
}
