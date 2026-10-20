// probeResult.ts — Names every connection probe and formats the one-line result the owner copies back after a live run.

/** The one channel name the probe file, its ServiceNow window and its bookmark agents talk on. */
export const PROBE_CHANNEL_NAME = 'snowWizardProbe';

/** Bumped whenever the probe set or line format changes, so an old pasted result is never misread. */
export const PROBE_FORMAT_VERSION = 'v1';

/** Every probe in `specs/040-snow-hub-wizard/contracts/relay-probe.md`. The browser is recorded in the line header. */
export type ProbeId =
  | 'P-HEADERS'
  | 'P-SNOW-BLOB'
  | 'P-SNOW-WRITE-SAFE'
  | 'P-SNOW-BROADCAST'
  | 'P-JIRA-OPENER-FROM-BLOB'
  | 'P-JIRA-OPENER-FROM-FILE'
  | 'P-SNOW-OPENER-FROM-FILE'
  | 'P-BOOKMARK-SIZE'
  | 'P-FILE-HANDLE';

/** Probes run from the probe file itself (opened from disk). */
export const FILE_PAGE_PROBE_IDS: readonly ProbeId[] = [
  'P-HEADERS',
  'P-JIRA-OPENER-FROM-FILE',
  'P-SNOW-OPENER-FROM-FILE',
  'P-BOOKMARK-SIZE',
];

/** Probes run from the window the bookmark opens inside ServiceNow's own origin. */
export const SNOW_WINDOW_PROBE_IDS: readonly ProbeId[] = [
  'P-SNOW-BLOB',
  'P-SNOW-WRITE-SAFE',
  'P-SNOW-BROADCAST',
  'P-JIRA-OPENER-FROM-BLOB',
  'P-FILE-HANDLE',
];

/** What one probe observed: a pass or a fail, always with the evidence or the browser's own reason. */
export interface ProbeOutcome {
  isPassed: boolean;
  detail: string;
}

const RESULT_SEPARATOR = ' | ';
const NOT_RUN_OUTCOME: ProbeOutcome = { isPassed: false, detail: 'not run' };

/** Keeps a reason on one line and free of the separator, so the pasted block splits unambiguously. */
function sanitizeDetail(detail: string): string {
  return detail.replace(/\s*\|\s*/g, ' / ').replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

function formatOutcome(probeId: ProbeId, outcome: ProbeOutcome): string {
  const verdict = outcome.isPassed ? 'pass' : 'fail';
  return `${probeId}=${verdict}(${sanitizeDetail(outcome.detail)})`;
}

/**
 * Builds the single line the owner pastes back into research.md. Every probe of the context appears, in contract order;
 * a probe that never ran reads `fail(not run)` so the line can never overstate what was proven.
 */
export function formatProbeResult(
  contextLabel: string,
  browserLabel: string,
  probeIds: readonly ProbeId[],
  outcomes: Partial<Record<ProbeId, ProbeOutcome>>,
): string {
  const outcomeTexts = probeIds.map((probeId) => formatOutcome(probeId, outcomes[probeId] ?? NOT_RUN_OUTCOME));
  return [`PROBE ${PROBE_FORMAT_VERSION}`, contextLabel, browserLabel, ...outcomeTexts].join(RESULT_SEPARATOR);
}

/**
 * Names the browser and its major version from the user agent. Edge is checked first because Edge's user agent also
 * carries "Chrome/"; anything else is reported as "Other browser" rather than guessed.
 */
export function describeBrowser(userAgent: string): string {
  const edgeMatch = /Edg\/(\d+)/.exec(userAgent);
  if (edgeMatch) return `Edge ${edgeMatch[1]}`;
  const chromeMatch = /Chrome\/(\d+)/.exec(userAgent);
  if (chromeMatch) return `Chrome ${chromeMatch[1]}`;
  return 'Other browser';
}
