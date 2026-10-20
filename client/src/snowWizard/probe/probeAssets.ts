// probeAssets.ts — Reads the sources the build injects into the probe file and assembles the ServiceNow-window page.

import { BOOT_PLACEHOLDER } from '../transport/bookmarkPayload.ts';

// Replaced with string literals by esbuild `define` in scripts/build-snow-wizard.js. Absent under test or in Toolbox.
declare const __SNOW_WINDOW_APP_SOURCE__: string | undefined;
declare const __PROBE_STYLE_SOURCE__: string | undefined;

/** Id of the line that tells the owner the window's script was blocked; the script removes it as its first act. */
export const SCRIPT_BLOCKED_NOTICE_ID = 'snow-wizard-script-blocked';

/** The two sources the probe file carries for the window it opens inside ServiceNow. */
export interface ProbeBuildInputs {
  snowWindowAppSource: string;
  probeStyleSource: string;
}

/** Reads the build-injected sources; `typeof` keeps this safe where the build did not define them. */
export function readProbeBuildInputs(): ProbeBuildInputs {
  return {
    snowWindowAppSource: typeof __SNOW_WINDOW_APP_SOURCE__ === 'string' ? __SNOW_WINDOW_APP_SOURCE__ : '',
    probeStyleSource: typeof __PROBE_STYLE_SOURCE__ === 'string' ? __PROBE_STYLE_SOURCE__ : '',
  };
}

/** Stops "</script>" inside inlined code from ending the script element early. */
function escapeInlineScript(scriptSource: string): string {
  return scriptSource.replace(/<\/script/gi, '<\\/script');
}

/**
 * The page the bookmark opens as a blob: window inside ServiceNow. It shows a "script was blocked" line by default —
 * if ServiceNow's content policy stops inline script in that window, the owner sees exactly that, and the probe records
 * it as P-SNOW-BLOB=fail.
 */
export function buildSnowWindowHtml(appSource: string, styleSource: string): string {
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>SNow Wizard — ServiceNow window checks</title>',
    `<style>${styleSource}</style></head><body>`,
    `<p id="${SCRIPT_BLOCKED_NOTICE_ID}" class="probe-blocked">If you can read this line, the browser blocked this window's script. `,
    'Record P-SNOW-BLOB=fail(script blocked) in the probe result.</p><main></main>',
    `<script>window.__SNOW_WIZARD_BOOT__=${BOOT_PLACEHOLDER};</script>`,
    `<script>${escapeInlineScript(appSource)}</script>`,
    '</body></html>',
  ].join('');
}
