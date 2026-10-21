// build-snow-wizard.js — Builds the standalone SNow Wizard files as ONE self-contained HTML file each (feature 040).
//
// `node scripts/build-snow-wizard.js` writes dist/snow-hub-wizard.html: the installer page carrying the whole Wizard
// inside its bookmark. `--probe` writes dist/snow-wizard-probe.html, the read-only connection probe (relay-probe.md).
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

const WIZARD_SOURCE_ROOT = path.join(CLIENT_SOURCE_ROOT, 'snowWizard');

const WIZARD_BUILD = {
  title: 'Install SNow Wizard',
  launcherEntry: path.join(WIZARD_SOURCE_ROOT, 'launcher', 'launcher.entry.ts'),
  appEntry: path.join(WIZARD_SOURCE_ROOT, 'main.entry.tsx'),
  styleFiles: [
    path.join(CLIENT_SOURCE_ROOT, 'styles', 'tokens.css'),
    path.join(WIZARD_SOURCE_ROOT, 'probe', 'probePage.css'),
  ],
  // Toolbox's relay bridge talks to its local server; inside the Wizard the same API runs in the window itself.
  replacedModules: [{
    original: path.join(CLIENT_SOURCE_ROOT, 'services', 'relayBridgeApi.ts'),
    replacement: path.join(WIZARD_SOURCE_ROOT, 'transport', 'relayBridgeShim.ts'),
  }],
  // Every bare `fetch` becomes the Wizard's, which sends Toolbox's /jira-proxy calls to the Jira tab.
  injectedFiles: [path.join(WIZARD_SOURCE_ROOT, 'transport', 'jiraProxyFetch.ts')],
  outputFile: path.join(OUTPUT_DIRECTORY, 'snow-hub-wizard.html'),
};

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

/** One complete HTML document with the style and script inlined, and any data block (inert JSON) before the script. */
function wrapHtmlDocument({ title, styleSource, scriptSource, dataBlock = '' }) {
  return [
    '<!doctype html>',
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<style>${styleSource}</style>`,
    '</head><body>',
    dataBlock,
    `<script>${escapeInlineScript(scriptSource)}</script>`,
    '</body></html>',
  ].join('');
}

// Kept equal to INSTALL_STORE_CONFIG in client/src/snowWizard/install/wizardInstall.ts (a test checks).
const INSTALL_PAYLOAD_ELEMENT_ID = 'snow-wizard-install';
const INSTALL_PAYLOAD_KIND = 'snowWizardInstall';

/**
 * The Wizard as an inert JSON block, read by the bookmark's install panel and by Settings → Update (wizardInstall.ts).
 * The code is pre-escaped for the <script> it is later placed in, and every "<" in the JSON becomes its escape so
 * nothing inside can end this block early.
 */
function buildInstallPayloadBlock({ version, appSource, styleSource }) {
  const payloadJson = JSON.stringify({ kind: INSTALL_PAYLOAD_KIND, version, appSource: escapeInlineScript(appSource), styleSource });
  const safeJson = payloadJson.replace(/</g, '\\u003c');
  return `<script type="application/json" id="${INSTALL_PAYLOAD_ELEMENT_ID}">${safeJson}</script>`;
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

/**
 * An esbuild plugin that swaps whole source files: whenever an import resolves to `original`, `replacement` is used.
 * esbuild's own `alias` only maps package names, not project files, so this is the documented plugin seam for it.
 */
function createModuleReplacementPlugin(replacedModules) {
  return {
    name: 'snow-wizard-module-replacement',
    setup(build) {
      build.onResolve({ filter: /\.tsx?$/ }, (resolveArgs) => {
        const resolvedPath = path.resolve(resolveArgs.resolveDir, resolveArgs.path);
        const matchingModule = replacedModules.find((replacedModule) => path.resolve(replacedModule.original) === resolvedPath);
        return matchingModule ? { path: path.resolve(matchingModule.replacement) } : undefined;
      });
    },
  };
}

// ── Build steps ──────────────────────────────────────────────────────────────

/** Bundles one entry; returns its JavaScript and any CSS (from .module.css files) as strings. */
async function bundleEntry(entryPoint, { defines = {}, plugins = [], injectedFiles = [] } = {}) {
  const esbuild = require('esbuild');
  const buildResult = await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    write: false,
    outdir: path.join(OUTPUT_DIRECTORY, '.snow-wizard-bundle'),
    format: 'iife',
    minify: true,
    target: BROWSER_TARGET,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': JSON.stringify('production'), ...defines },
    plugins,
    inject: injectedFiles,
    logLevel: 'warning',
  });
  const readOutput = (extension) => buildResult.outputFiles.filter((outputFile) => outputFile.path.endsWith(extension)).map((outputFile) => outputFile.text).join('\n');
  return { scriptSource: readOutput('.js'), moduleStyleSource: readOutput('.css') };
}

async function bundleToString(entryPoint, defines = {}) {
  return (await bundleEntry(entryPoint, { defines })).scriptSource;
}

function readReleaseVersion() {
  const packageManifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  return `v${packageManifest.version}`;
}

function writeSelfContainedPage(outputFile, pageHtml) {
  const externalReferences = findExternalReferences(pageHtml);
  if (externalReferences.length > 0) {
    throw new Error(`${path.basename(outputFile)} must be self-contained but references: ${externalReferences.join(', ')}`);
  }
  fs.mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  fs.writeFileSync(outputFile, pageHtml, 'utf8');
  return { outputFile, byteLength: Buffer.byteLength(pageHtml) };
}

/** Builds the Wizard: the app (with its ServiceNow/Jira seams swapped), then the installer page that carries it. */
async function buildWizard() {
  const appVersion = readReleaseVersion();
  const baseStyleSource = readStyleSource(WIZARD_BUILD.styleFiles);
  const appBundle = await bundleEntry(WIZARD_BUILD.appEntry, {
    defines: { __WIZARD_VERSION__: JSON.stringify(appVersion) },
    plugins: [createModuleReplacementPlugin(WIZARD_BUILD.replacedModules)],
    injectedFiles: WIZARD_BUILD.injectedFiles,
  });
  const wizardStyleSource = `${baseStyleSource}\n${appBundle.moduleStyleSource}`;
  // The bookmark is now a small loader; the Wizard travels in the page's install block and lives in ServiceNow's storage.
  const launcherSource = await bundleToString(WIZARD_BUILD.launcherEntry, { __WIZARD_VERSION__: JSON.stringify(appVersion) });
  const dataBlock = buildInstallPayloadBlock({ version: appVersion, appSource: appBundle.scriptSource, styleSource: wizardStyleSource });
  const pageHtml = wrapHtmlDocument({ title: WIZARD_BUILD.title, styleSource: baseStyleSource, scriptSource: launcherSource, dataBlock });
  return writeSelfContainedPage(WIZARD_BUILD.outputFile, pageHtml);
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
  return writeSelfContainedPage(PROBE_BUILD.outputFile, pageHtml);
}

async function runFromCommandLine() {
  const isProbeBuild = process.argv.includes('--probe');
  const { outputFile, byteLength } = isProbeBuild ? await buildProbe() : await buildWizard();
  console.log(`✅ ${path.relative(REPO_ROOT, outputFile)} (${byteLength} bytes)`);
}

if (require.main === module) {
  runFromCommandLine().catch((buildError) => {
    console.error(`❌ ${buildError.message}`);
    process.exit(1);
  });
}

module.exports = {
  INSTALL_PAYLOAD_ELEMENT_ID,
  INSTALL_PAYLOAD_KIND,
  buildInstallPayloadBlock,
  WIZARD_BOOKMARK_BUDGET_BYTES,
  createModuleReplacementPlugin,
  assertWithinBookmarkBudget,
  escapeInlineScript,
  findExternalReferences,
  wrapHtmlDocument,
};
