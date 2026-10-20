// probeAssets.test.ts — Proves the build-injected sources are read safely and the ServiceNow-window page is assembled intact.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { BOOT_PLACEHOLDER } from '../transport/bookmarkPayload.ts';
import { SCRIPT_BLOCKED_NOTICE_ID, buildSnowWindowHtml, readProbeBuildInputs } from './probeAssets.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readProbeBuildInputs', () => {
  it('returns empty sources when the page was not produced by the build (e.g. under test)', () => {
    expect(readProbeBuildInputs()).toEqual({ snowWindowAppSource: '', probeStyleSource: '' });
  });

  it('returns the sources the build defined', () => {
    vi.stubGlobal('__SNOW_WINDOW_APP_SOURCE__', 'console.log(1)');
    vi.stubGlobal('__PROBE_STYLE_SOURCE__', 'body{}');
    expect(readProbeBuildInputs()).toEqual({ snowWindowAppSource: 'console.log(1)', probeStyleSource: 'body{}' });
  });
});

describe('buildSnowWindowHtml', () => {
  it('carries the boot placeholder, the style, the app, and a notice the app removes when its script runs', () => {
    const windowHtml = buildSnowWindowHtml('runApp()', 'body{color:red}');
    expect(windowHtml).toContain(BOOT_PLACEHOLDER);
    expect(windowHtml).toContain('body{color:red}');
    expect(windowHtml).toContain('runApp()');
    expect(windowHtml).toContain(`id="${SCRIPT_BLOCKED_NOTICE_ID}"`);
  });

  it('escapes a closing script tag inside the app so the page cannot be cut short', () => {
    const windowHtml = buildSnowWindowHtml('var markup="</script><b>";', '');
    expect(windowHtml).toContain('var markup="<\\/script><b>";');
    expect(windowHtml.match(/<\/script>/g)?.length).toBe(2);
  });
});
