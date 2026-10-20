// launcherPage.test.ts — Proves the shared HTML file is only an installer: drag the bookmark, open ServiceNow, close it
// (the owner's probe finding was ending up with the tool open in two tabs).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SNOW_URL } from '../wizardDefaults.ts';
import { buildWizardBookmarkHref, mountLauncherPage, readLauncherBuildInputs, WIZARD_WINDOW_PAGE } from './launcherPage.ts';

const ASSETS = { wizardAppSource: 'void 0', wizardStyleSource: '', appVersion: 'v0.304.0' };

describe('readLauncherBuildInputs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the build-injected sources, empty under test', () => {
    expect(readLauncherBuildInputs()).toEqual({ wizardAppSource: '', wizardStyleSource: '', appVersion: 'dev' });
    vi.stubGlobal('__WIZARD_APP_SOURCE__', 'app');
    vi.stubGlobal('__WIZARD_STYLE_SOURCE__', 'css');
    vi.stubGlobal('__WIZARD_VERSION__', 'v1');
    expect(readLauncherBuildInputs()).toEqual({ wizardAppSource: 'app', wizardStyleSource: 'css', appVersion: 'v1' });
  });
});

describe('buildWizardBookmarkHref', () => {
  it('freezes no Jira address and serves only ServiceNow windows (R-011)', () => {
    const bookmarkSource = decodeURIComponent(buildWizardBookmarkHref(ASSETS).slice('javascript:'.length));
    expect(bookmarkSource).toContain('"jiraHostname":""');
    expect(bookmarkSource).toContain('"allowedRequesterHostFragments":["service-now","servicenow"]');
    expect(bookmarkSource).toContain('"isReadOnly":false');
  });

  it('carries the Wizard window page', () => {
    const bookmarkSource = decodeURIComponent(buildWizardBookmarkHref(ASSETS).slice('javascript:'.length));
    expect(bookmarkSource).toContain(WIZARD_WINDOW_PAGE.title);
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
