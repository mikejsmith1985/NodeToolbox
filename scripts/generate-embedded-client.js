#!/usr/bin/env node
// scripts/generate-embedded-client.js — Bakes the React build into a JS module.
//
// Why: @yao-pkg/pkg's `assets` configuration silently fails to include
// client/dist/ in some setups (the snapshot virtual filesystem returns ENOENT
// for files that should be present). To guarantee the React SPA ships inside
// the exe, we generate src/embeddedClient.js that contains every file's bytes
// as a base64 string literal. pkg always bundles JS source/bytecode, so the
// React build is now part of the executable's bytecode itself — no asset
// virtualization required.
//
// Output module shape:
//   module.exports = {
//     'index.html': Buffer.from('PCFkb2N0...', 'base64'),
//     'favicon.svg': Buffer.from('PHN2Z...',  'base64'),
//     'assets/index-AbCd.js': Buffer.from('aW1...', 'base64'),
//     ...
//   };
//
// Usage: node scripts/generate-embedded-client.js
// Run during the release pipeline AFTER `npm run build:client` and BEFORE pkg.

'use strict';

const fs   = require('fs');
const path = require('path');

const REPO_ROOT          = path.join(__dirname, '..');
const CLIENT_DIST_DIR    = path.join(REPO_ROOT, 'client', 'dist');
const OUTPUT_MODULE_PATH = path.join(REPO_ROOT, 'src', 'embeddedClient.js');

/**
 * Recursively lists every file path beneath the given directory.
 * Returns paths relative to the directory (forward-slash separated for
 * portability across the embedded URL → file lookup).
 *
 * @param {string} rootDir - Absolute directory to walk
 * @returns {string[]} Array of relative file paths (using '/' separator)
 */
function listFilesRecursively(rootDir) {
  const collectedFiles = [];

  function walk(currentDir, relativePrefix) {
    const directoryEntries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const directoryEntry of directoryEntries) {
      const absoluteEntryPath = path.join(currentDir, directoryEntry.name);
      const relativeEntryPath = relativePrefix
        ? relativePrefix + '/' + directoryEntry.name
        : directoryEntry.name;

      if (directoryEntry.isDirectory()) {
        walk(absoluteEntryPath, relativeEntryPath);
      } else if (directoryEntry.isFile()) {
        collectedFiles.push(relativeEntryPath);
      }
    }
  }

  walk(rootDir, '');
  return collectedFiles;
}

/**
 * Generates the embedded-client JavaScript module that contains every
 * file in client/dist/ as a base64-encoded Buffer literal.
 *
 * @returns {void}
 */
function generateEmbeddedClientModule() {
  if (!fs.existsSync(CLIENT_DIST_DIR)) {
    console.error('  ✗ client/dist/ does not exist — run `npm run build:client` first.');
    process.exit(1);
  }

  const relativeFilePaths = listFilesRecursively(CLIENT_DIST_DIR);
  if (relativeFilePaths.length === 0) {
    console.error('  ✗ client/dist/ is empty — nothing to embed.');
    process.exit(1);
  }

  // Stable alphabetical order so generated output is deterministic across builds.
  relativeFilePaths.sort();

  const moduleHeader =
    '// src/embeddedClient.js — AUTO-GENERATED. Do not edit by hand.\n' +
    '//\n' +
    '// Every file under client/dist/ at release time, base64-encoded so the\n' +
    '// React SPA is embedded in the JavaScript bytecode that pkg bundles into\n' +
    '// the exe. The static middleware looks up requested URL paths against\n' +
    '// this map, guaranteeing the SPA ships inside the executable.\n' +
    '//\n' +
    '// Regenerate with: node scripts/generate-embedded-client.js\n\n' +
    "'use strict';\n\n" +
    'module.exports = {\n';

  let totalEncodedBytes = 0;
  const moduleEntries = relativeFilePaths.map((relativeFilePath) => {
    const absoluteFilePath = path.join(CLIENT_DIST_DIR, ...relativeFilePath.split('/'));
    const fileContentBuffer = fs.readFileSync(absoluteFilePath);
    const base64Content     = fileContentBuffer.toString('base64');
    totalEncodedBytes      += base64Content.length;

    // JSON.stringify gives us safely-escaped strings for both the key and the
    // base64 payload (which never contains a quote character anyway).
    return '  ' + JSON.stringify(relativeFilePath) +
           ': Buffer.from(' + JSON.stringify(base64Content) + ", 'base64'),\n";
  });

  const moduleFooter = '};\n';
  const moduleSource = moduleHeader + moduleEntries.join('') + moduleFooter;

  // Make sure src/ exists (it should, but be defensive)
  fs.mkdirSync(path.dirname(OUTPUT_MODULE_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_MODULE_PATH, moduleSource);

  console.log(
    '  ✓ Embedded ' + relativeFilePaths.length + ' files (' +
    Math.round(totalEncodedBytes / 1024) + ' KB base64) → ' +
    path.relative(REPO_ROOT, OUTPUT_MODULE_PATH)
  );
}

generateEmbeddedClientModule();
