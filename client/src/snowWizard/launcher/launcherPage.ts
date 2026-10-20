// launcherPage.ts — The page inside the shared snow-hub-wizard.html file. It is only an INSTALLER: drag the bookmark,
// open ServiceNow, close this page. The Wizard itself always opens from ServiceNow (owner's probe finding, R-001).

import { SNOW_HOSTNAME_FRAGMENTS } from '../../services/snowRelayShared.ts';
import { buildSnowWindowHtml, type SnowWindowPageOptions } from '../probe/probeAssets.ts';
import { createNode, createStep } from '../probe/probeDom.ts';
import { buildBookmarkHref } from '../transport/bookmarkPayload.ts';
import { DEFAULT_SNOW_URL, WIZARD_CHANNEL_NAME, WIZARD_PRESENCE_LOCK_NAME } from '../wizardDefaults.ts';

// Replaced with string literals by esbuild `define` in scripts/build-snow-wizard.js. Absent under test.
declare const __WIZARD_APP_SOURCE__: string | undefined;
declare const __WIZARD_STYLE_SOURCE__: string | undefined;
declare const __WIZARD_VERSION__: string | undefined;

/** The Wizard window opened inside ServiceNow. */
export const WIZARD_WINDOW_PAGE: SnowWindowPageOptions = {
  title: 'SNow Wizard',
  blockedNotice: 'The browser stopped the SNow Wizard from starting in this window. Please tell the Toolbox team.',
  rootMarkup: '<div id="wizard-root"></div>',
};

/** What the build puts into the installer: the Wizard's code and look, and its version. */
export interface LauncherBuildInputs {
  wizardAppSource: string;
  wizardStyleSource: string;
  appVersion: string;
}

/** Reads the build-injected sources; `typeof` keeps this safe where the build did not define them. */
export function readLauncherBuildInputs(): LauncherBuildInputs {
  return {
    wizardAppSource: typeof __WIZARD_APP_SOURCE__ === 'string' ? __WIZARD_APP_SOURCE__ : '',
    wizardStyleSource: typeof __WIZARD_STYLE_SOURCE__ === 'string' ? __WIZARD_STYLE_SOURCE__ : '',
    appVersion: typeof __WIZARD_VERSION__ === 'string' ? __WIZARD_VERSION__ : 'dev',
  };
}

/**
 * The Wizard bookmark. No Jira address is frozen into it and its Jira side answers only ServiceNow windows, so a Jira
 * move is a Settings change, never a re-install (R-011).
 */
export function buildWizardBookmarkHref(assets: LauncherBuildInputs): string {
  return buildBookmarkHref({
    snowWindowHtml: buildSnowWindowHtml(assets.wizardAppSource, assets.wizardStyleSource, WIZARD_WINDOW_PAGE),
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
    createStep(1, 'Put the SNow Wizard button on your bookmarks bar',
      createNode('p', {}, 'Drag the blue button onto your bookmarks bar. Cannot see the bar? Press Ctrl+Shift+B. '
        + 'If you have an older SNow Wizard bookmark, delete it first.'),
      createNode('a', { href: buildWizardBookmarkHref(dependencies.assets), 'data-wizard-bookmark': '', class: 'probe-bookmark', draggable: 'true' }, 'SNow Wizard')),
    createStep(2, 'Open ServiceNow and click the button',
      createNode('p', {}, 'Open ServiceNow, sign in if asked, then click SNow Wizard on your bookmarks bar. '
        + 'The Wizard opens in its own window. Keep the ServiceNow tab open while you work.'),
      createNode('button', { type: 'button', class: 'probe-button', onclick: () => dependencies.openWindow(DEFAULT_SNOW_URL, '_blank') }, 'Open ServiceNow')),
    createStep(3, 'That is all',
      createNode('p', {}, 'You can close this page now. Next time, just click SNow Wizard on any ServiceNow tab.')),
  );
}
