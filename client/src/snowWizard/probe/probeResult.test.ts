// probeResult.test.ts — Proves the probe's copy-back result block is complete, ordered, and never overstates a pass.

import { describe, expect, it } from 'vitest';

import {
  FILE_PAGE_PROBE_IDS,
  PROBE_FORMAT_VERSION,
  SNOW_WINDOW_PROBE_IDS,
  describeBrowser,
  formatProbeResult,
} from './probeResult.ts';

describe('formatProbeResult', () => {
  it('renders every probe of the context in the contract order, prefixed with version, context and browser', () => {
    const resultBlock = formatProbeResult('file-page', 'Chrome 141', FILE_PAGE_PROBE_IDS, {
      'P-HEADERS': { isPassed: true, detail: 'recorded' },
      'P-JIRA-OPENER-FROM-FILE': { isPassed: false, detail: 'no hello in 180s' },
    });

    const expectedPrefix = `PROBE ${PROBE_FORMAT_VERSION} | file-page | Chrome 141 | P-HEADERS=pass(recorded) | P-JIRA-OPENER-FROM-FILE=fail(no hello in 180s)`;
    expect(resultBlock.startsWith(expectedPrefix)).toBe(true);
    FILE_PAGE_PROBE_IDS.forEach((probeId) => expect(resultBlock).toContain(`${probeId}=`));
  });

  it('reports a probe that never ran as fail(not run), never as a pass', () => {
    const resultBlock = formatProbeResult('snow-window', 'Edge 141', SNOW_WINDOW_PROBE_IDS, {});

    SNOW_WINDOW_PROBE_IDS.forEach((probeId) => expect(resultBlock).toContain(`${probeId}=fail(not run)`));
    expect(resultBlock).not.toContain('=pass');
  });

  it('keeps the block on one line and the separator unambiguous even when a reason contains | or newlines', () => {
    const resultBlock = formatProbeResult('file-page', 'Chrome 141', ['P-HEADERS'], {
      'P-HEADERS': { isPassed: false, detail: 'COOP=same-origin | XFO=DENY\nsecond line' },
    });

    expect(resultBlock).not.toContain('\n');
    expect(resultBlock).toContain('P-HEADERS=fail(COOP=same-origin / XFO=DENY second line)');
  });
});

describe('describeBrowser', () => {
  it('names Edge before Chrome because Edge user agents also contain "Chrome/"', () => {
    const edgeUserAgent = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.57';
    expect(describeBrowser(edgeUserAgent)).toBe('Edge 141');
  });

  it('names Chrome with its major version', () => {
    const chromeUserAgent = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141.0.7390.66 Safari/537.36';
    expect(describeBrowser(chromeUserAgent)).toBe('Chrome 141');
  });

  it('falls back to "Other browser" rather than guessing', () => {
    expect(describeBrowser('Mozilla/5.0 Firefox/131.0')).toBe('Other browser');
  });
});
