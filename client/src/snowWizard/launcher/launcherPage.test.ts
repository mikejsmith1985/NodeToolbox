// launcherPage.test.ts — Proves the shared HTML file is only an installer: drag the bookmark, open ServiceNow, close it
// (the owner's probe finding was ending up with the tool open in two tabs).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SNOW_URL } from '../wizardDefaults.ts';
import { buildWizardBookmarkHref, mountLauncherPage, readLauncherBuildInputs, WIZARD_WINDOW_PAGE } from './launcherPage.ts';

const ASSETS = { appVersion: 'v0.304.0' };
/** The loader bookmark stays small because it carries no Wizard code — the reason it never needs re-installing. */
const LOADER_BOOKMARK_MAX_BYTES = 64 * 1024;

describe('readLauncherBuildInputs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the build-injected version, "dev" under test', () => {
    expect(readLauncherBuildInputs()).toEqual({ appVersion: 'dev' });
    vi.stubGlobal('__WIZARD_VERSION__', 'v1');
    expect(readLauncherBuildInputs()).toEqual({ appVersion: 'v1' });
  });
});

describe('buildWizardBookmarkHref', () => {
  it('freezes no Jira address and serves only ServiceNow windows (R-011)', () => {
    const bookmarkSource = decodeURIComponent(buildWizardBookmarkHref().slice('javascript:'.length));
    expect(bookmarkSource).toContain('"jiraHostname":""');
    expect(bookmarkSource).toContain('"allowedRequesterHostFragments":["service-now","servicenow"]');
    expect(bookmarkSource).toContain('"isReadOnly":false');
  });

  it('is a small loader: the window template and install store, no Wizard code', () => {
    const bookmarkHref = buildWizardBookmarkHref();
    const bookmarkSource = decodeURIComponent(bookmarkHref.slice('javascript:'.length));
    expect(bookmarkSource).toContain(WIZARD_WINDOW_PAGE.title);
    expect(bookmarkSource).toContain('"databaseName":"snowWizard"');
    expect(bookmarkSource).toContain('Install the SNow Wizard');
    expect(bookmarkHref.length).toBeLessThan(LOADER_BOOKMARK_MAX_BYTES);
    expect(() => new Function(bookmarkSource)).not.toThrow();
  });
});

describe('mountLauncherPage', () => {
  let launcherRoot: HTMLElement;

  beforeEach(() => {
    launcherRoot = document.createElement('main');
    document.body.appendChild(launcherRoot);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the version, the draggable bookmark and the three steps', () => {
    mountLauncherPage(launcherRoot, { assets: ASSETS, openWindow: vi.fn() });
    expect(launcherRoot.textContent).toContain('v0.304.0');
    expect(launcherRoot.querySelector('a[data-wizard-bookmark]')?.getAttribute('href')?.startsWith('javascript:')).toBe(true);
    expect(launcherRoot.querySelectorAll('h2').length).toBe(3);
  });

  it('says plainly that this page can be closed once the bookmark is in place', () => {
    mountLauncherPage(launcherRoot, { assets: ASSETS, openWindow: vi.fn() });
    expect(launcherRoot.textContent).toContain('You can close this page now');
  });

  it('opens the built-in ServiceNow address', () => {
    const openWindow = vi.fn();
    mountLauncherPage(launcherRoot, { assets: ASSETS, openWindow });
    (Array.from(launcherRoot.querySelectorAll('button')).find((buttonElement) => buttonElement.textContent === 'Open ServiceNow') as HTMLButtonElement).click();
    expect(openWindow).toHaveBeenCalledWith(DEFAULT_SNOW_URL, '_blank');
  });
});
