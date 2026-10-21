// build-snow-wizard.js — Builds the standalone SNow Wizard as ONE self-contained HTML file (feature 040).
//
// `node scripts/build-snow-wizard.js` writes dist/snow-hub-wizard.html. The file IS the Wizard: open it and use it.
// Its Settings hold the ServiceNow and Jira addresses and the relay bookmark; ServiceNow and Jira are reached through
// the tabs it opens, where that bookmark answers.
//
// Framework-first: esbuild (already a dev dependency, used for three engine bundles) does all bundling; this script only
// inlines the result into one page. Nothing here is loaded from another address — the file must work when emailed.

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CLIENT_SOURCE_ROOT = path.join(REPO_ROOT, 'client', 'src');
const OUTPUT_DIRECTORY = path.join(REPO_ROOT, 'dist');

/** Same modern-browser floor as the Toolbox client (tsconfig target es2023); Chrome/Edge only. */
const BROWSER_TARGET = 'es2022';

const WIZARD_SOURCE_ROOT = path.join(CLIENT_SOURCE_ROOT, 'snowWizard');

const WIZARD_BUILD = {
  title: 'SNow Wizard',
  appEntry: path.join(WIZARD_SOURCE_ROOT, 'main.entry.tsx'),
  styleFiles: [
    path.join(CLIENT_SOURCE_ROOT, 'styles', 'tokens.css'),
    path.join(WIZARD_SOURCE_ROOT, 'shell', 'wizardPage.css'),
  ],
  // Toolbox's relay bridge talks to its local server; inside the Wizard the same API talks to the ServiceNow tab.
  replacedModules: [{
    original: path.join(CLIENT_SOURCE_ROOT, 'services', 'relayBridgeApi.ts'),
    replacement: path.join(WIZARD_SOURCE_ROOT, 'transport', 'relayBridgeShim.ts'),
  }],
  // Every bare `fetch` becomes the Wizard's, which sends Toolbox's /jira-proxy calls to the Jira tab.
  injectedFiles: [path.join(WIZARD_SOURCE_ROOT, 'transport', 'jiraProxyFetch.ts')],
  outputFile: path.join(OUTPUT_DIRECTORY, 'snow-hub-wizard.html'),
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
    '<div id="wizard-root"></div>',
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

function readReleaseVersion() {
  const packageManifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  return `v${packageManifest.version}`;
}

function readStyleSource(styleFiles) {
  return styleFiles.map((styleFile) => fs.readFileSync(styleFile, 'utf8')).join('\n');
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

/** Builds the Wizard: the app (with its ServiceNow/Jira seams swapped), inlined into one page with its look. */
async function buildWizard() {
  const appVersion = readReleaseVersion();
  const appBundle = await bundleEntry(WIZARD_BUILD.appEntry, {
    defines: { __WIZARD_VERSION__: JSON.stringify(appVersion) },
    plugins: [createModuleReplacementPlugin(WIZARD_BUILD.replacedModules)],
    injectedFiles: WIZARD_BUILD.injectedFiles,
  });
  const styleSource = `${readStyleSource(WIZARD_BUILD.styleFiles)}\n${appBundle.moduleStyleSource}`;
  const pageHtml = wrapHtmlDocument({ title: WIZARD_BUILD.title, styleSource, scriptSource: appBundle.scriptSource });
  return writeSelfContainedPage(WIZARD_BUILD.outputFile, pageHtml);
}

async function runFromCommandLine() {
  const { outputFile, byteLength } = await buildWizard();
  console.log(`✅ ${path.relative(REPO_ROOT, outputFile)} (${byteLength} bytes)`);
}

if (require.main === module) {
  runFromCommandLine().catch((buildError) => {
    console.error(`❌ ${buildError.message}`);
    process.exit(1);
  });
}

module.exports = {
  createModuleReplacementPlugin,
  escapeInlineScript,
  findExternalReferences,
  wrapHtmlDocument,
};
