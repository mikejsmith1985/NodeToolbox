// wizardInstall.ts — Keeps the SNow Wizard inside ServiceNow's own browser storage, so the bookmark is installed ONCE
// and a new version is a file pick instead of deleting and re-dragging the bookmark (owner feedback, GH #475).
//
// The release file carries the Wizard in a JSON block; the bookmark's first click (or Settings → Update) reads that
// block and stores it in IndexedDB on the ServiceNow origin, where the bookmark reads it on every later click. The
// Wizard window is a blob: document of that same origin, so it shares the storage.
//
// The functions that run inside the bookmark live in installRuntime.ts (they must stay import-free); this file holds
// the data they are given and the window template.

import { BOOT_PLACEHOLDER } from '../transport/bookmarkPayload.ts';
import { buildSnowWindowHtml, type SnowWindowPageOptions } from '../probe/probeAssets.ts';
import type { InstallStoreConfig } from './installRuntime.ts';

export * from './installRuntime.ts';

/** Kept equal to scripts/build-snow-wizard.js (a build test checks the id and kind). */
export const INSTALL_STORE_CONFIG: InstallStoreConfig = {
  databaseName: 'snowWizard',
  storeName: 'installedApp',
  recordKey: 'current',
  payloadElementId: 'snow-wizard-install',
  payloadKind: 'snowWizardInstall',
  appPlaceholder: '__SNOW_WIZARD_APP_SOURCE__',
  stylePlaceholder: '__SNOW_WIZARD_STYLE_SOURCE__',
  bootPlaceholder: BOOT_PLACEHOLDER,
};

/** The Wizard window opened inside ServiceNow. */
export const WIZARD_WINDOW_PAGE: SnowWindowPageOptions = {
  title: 'SNow Wizard',
  blockedNotice: 'The browser stopped the SNow Wizard from starting in this window. Please tell the Toolbox team.',
  rootMarkup: '<div id="wizard-root"></div>',
};

/** The Wizard window's page with marks where the boot data, look and code go. */
export function buildWizardWindowTemplate(storeConfig: InstallStoreConfig = INSTALL_STORE_CONFIG): string {
  return buildSnowWindowHtml(storeConfig.appPlaceholder, storeConfig.stylePlaceholder, WIZARD_WINDOW_PAGE);
}
