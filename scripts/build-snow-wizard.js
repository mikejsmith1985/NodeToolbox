// build-snow-wizard.js — Builds the standalone SNow Wizard files as ONE self-contained HTML file each (feature 040).
//
// `node scripts/build-snow-wizard.js --probe` writes dist/snow-wizard-probe.html: the read-only connection probe the owner
// runs in production before any Wizard step is built (specs/040-snow-hub-wizard/contracts/relay-probe.md).
//
// Framework-first: esbuild (already a dev dependency, used for three engine bundles) does all bundling; this script only
// inlines the result into one page. Nothing here is loaded from another address — the file must work when emailed.

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLIENT_SOURCE_ROOT = path.join(REPO_ROOT, 'client', 'src');
const OUTPUT_DIRECTORY = path.join(REPO_ROOT, 'dist');

/** The bookmark that carries the Wizard must stay under Chromium's 2 MB URL cap with room to spare (research R-004). */
const WIZARD_BOOKMARK_BUDGET_BYTES = 1.5 * 1024 * 1024;
/** Same modern-browser floor as the Toolbox client (tsconfig target es2023); Chrome/Edge only. */
const BROWSER_TARGET = 'es2022';

const PROBE_BUILD = {
  title: 'SNow Wizard connection probe',
  fileEntry: path.join(CLIENT_SOURCE_ROOT, 'snowWizard', 'probe', 'relayProbe.entry.ts'),
  snowWindowEntry: path.join(CLIENT_SOURCE_ROOT, 'snowWizard', 'probe', 'snowWindowProbe.entry.ts'),
  styleFiles: [
    path.join(CLIENT_SOURCE_ROOT, 'styles', 'tokens.css'),
    path.join(CLIENT_SOURCE_ROOT, 'snowWizard', 'probe', 'probePage.css'),
  ],
  outputFile: path.join(OUTPUT_DIRECTORY, 'snow-wizard-probe.html'),
};

// ── Pure helpers (unit-tested in test/unit/build-snow-wizard.test.js) ─────────

/** Stops "</script>" inside inlined code from ending the script element early. */
function escapeInlineScript(scriptSource) {
  return scriptSource.replace(/<\/script/gi, '<\\/script');
}

/** One complete HTML document with the style and script inlined. */
function wrapHtmlDocument({ title, styleSource, scriptSource }) {
  return [
    '<!doctype html>',
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<style>${styleSource}</style>`,
    '</head><body>',
    `<script>${escapeInlineScript(scriptSource)}</script>`,
    '</body></html>',
  ].join('');
}

const EXTERNAL_REFERENCE_PATTERNS = [
  /<script\b[^>]*\bsrc=["'](https?:[^"']+)["']/gi,
  /<link\b[^>]*\bhref=["'](https?:[^"']+)["']/gi,
  /url\(\s*["']?(https?:[^"')\s]+)["']?\s*\)/gi,
];

/** Every script, stylesheet or font the page would fetch from another address, in page order (must be none). */
function findExternalReferences(pageHtml) {
  const foundReferences = [];
  EXTERNAL_REFERENCE_PATTERNS.forEach((referencePattern) => {
    for (const referenceMatch of pageHtml.matchAll(referencePattern)) {
      foundReferences.push({ position: referenceMatch.index, address: referenceMatch[1] });
    }
  });
  return foundReferences.sort((first, second) => first.position - second.position).map((reference) => reference.address);
}

/** Fails the build when a bookmark would be too large to drag and run reliably. */
function assertWithinBookmarkBudget(bookmarkByteLength) {
  if (bookmarkByteLength > WIZARD_BOOKMARK_BUDGET_BYTES) {
    throw new Error(`The SNow Wizard bookmark is ${bookmarkByteLength} bytes, over the ${WIZARD_BOOKMARK_BUDGET_BYTES}-byte budget.`);
  }
}

// ── Build steps ──────────────────────────────────────────────────────────────

async function bundleToString(entryPoint, defines = {}) {
  const esbuild = require('esbuild');
  const buildResult = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    format: 'iife',
    minify: true,
    target: BROWSER_TARGET,
    define: defines,
    logLevel: 'warning',
  });
  return buildResult.outputFiles[0].text;
}

function readStyleSource(styleFiles) {
  return styleFiles.map((styleFile) => fs.readFileSync(styleFile, 'utf8')).join('\n');
}

/** Builds the probe: the ServiceNow-window script first, then the file page that carries it inside its bookmark. */
async function buildProbe() {
  const styleSource = readStyleSource(PROBE_BUILD.styleFiles);
  const snowWindowSource = await bundleToString(PROBE_BUILD.snowWindowEntry);
  // The bookmark carries the ServiceNow-window page percent-encoded; checking that size here keeps a too-big probe
  // from ever being shipped.
  assertWithinBookmarkBudget(Buffer.byteLength(encodeURIComponent(snowWindowSource + styleSource)));
  const filePageSource = await bundleToString(PROBE_BUILD.fileEntry, {
    __SNOW_WINDOW_APP_SOURCE__: JSON.stringify(snowWindowSource),
    __PROBE_STYLE_SOURCE__: JSON.stringify(styleSource),
  });
  const pageHtml = wrapHtmlDocument({ title: PROBE_BUILD.title, styleSource, scriptSource: filePageSource });
  const externalReferences = findExternalReferences(pageHtml);
  if (externalReferences.length > 0) {
    throw new Error(`The probe must be self-contained but references: ${externalReferences.join(', ')}`);
  }
  fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  fs.writeFileSync(PROBE_BUILD.outputFile, pageHtml, 'utf8');
  return { outputFile: PROBE_BUILD.outputFile, byteLength: Buffer.byteLength(pageHtml) };
}

async function runFromCommandLine() {
  const isProbeBuild = process.argv.includes('--probe');
  if (!isProbeBuild) {
    // The Wizard app itself arrives after the probe has chosen the transport (tasks.md T012 gate).
    throw new Error('Only the probe exists so far: run with --probe.');
  }
  const { outputFile, byteLength } = await buildProbe();
  console.log(`✅ ${path.relative(REPO_ROOT, outputFile)} (${byteLength} bytes)`);
}

if (require.main === module) {
  runFromCommandLine().catch((buildError) => {
    console.error(`❌ ${buildError.message}`);
    process.exit(1);
  });
}

module.exports = {
  WIZARD_BOOKMARK_BUDGET_BYTES,
  assertWithinBookmarkBudget,
  escapeInlineScript,
  findExternalReferences,
  wrapHtmlDocument,
};
