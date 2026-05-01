#!/usr/bin/env node
// scripts/create-launcher.js — Creates a Windows shortcut for NodeToolbox.
//
// Writes "Launch Toolbox.lnk" to the repository root so users can double-click
// to start the proxy server without opening a terminal.
//
// Usage:
//   node scripts/create-launcher.js          # creates the shortcut
//   node scripts/create-launcher.js --dry-run # prints config, writes nothing
//   node scripts/create-launcher.js --help    # prints usage
//
// The shortcut runs: node.exe "<repo-root>\server.js"
// with WindowStyle hidden so no console window flashes on startup.

'use strict';

const path = require('path');
const fs   = require('fs');

// ── Constants ─────────────────────────────────────────────────────────────────

/** Shortcut filename placed at the repository root */
const SHORTCUT_FILENAME = 'Launch Toolbox.lnk';

/** WindowStyle value for WScript.Shell that hides the console window */
const WINDOW_STYLE_HIDDEN = 7;

/** The Node.js executable that will run the server */
const NODE_EXECUTABLE_PATH = process.execPath;

/** Absolute path to server.js (the Express entry point) */
const SERVER_JS_PATH = path.resolve(__dirname, '..', 'server.js');

/** The shortcut is written here — always the repository root */
const SHORTCUT_DESTINATION_PATH = path.resolve(__dirname, '..', SHORTCUT_FILENAME);

/** Repository root directory (used as WorkingDirectory for the shortcut) */
const REPO_ROOT_PATH = path.resolve(__dirname, '..');

// ── CLI Entry Point ────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help')) {
    printHelp();
    return;
  }

  const isDryRun = args.includes('--dry-run');

  if (isDryRun) {
    runDryRun();
  } else {
    createShortcut();
  }
}

// ── Shortcut Creation ─────────────────────────────────────────────────────────

/**
 * Creates the Windows .lnk shortcut using the WScript.Shell COM object.
 * This function requires a Windows environment — it will throw on other OSes.
 */
function createShortcut() {
  if (process.platform !== 'win32') {
    console.error('  ✗ Windows shortcut creation requires Windows (WScript.Shell is unavailable on this platform)');
    console.error('  Use --dry-run to test the script on non-Windows environments.');
    process.exit(1);
  }

  if (!fs.existsSync(SERVER_JS_PATH)) {
    console.error('  ✗ server.js not found at: ' + SERVER_JS_PATH);
    console.error('  Run this script from the NodeToolbox repository root.');
    process.exit(1);
  }

  try {
    // WScript.Shell is a Windows COM object available via ActiveXObject in Node.js
    // when running with the `winax` package, OR via cscript/wscript in shell.
    // Here we use the built-in `new ActiveXObject` approach that works when the
    // Node.js host has Windows Script Host available (standard Windows installs).
    const wshell   = new ActiveXObject('WScript.Shell'); // eslint-disable-line no-undef
    const shortcut = wshell.CreateShortcut(SHORTCUT_DESTINATION_PATH);

    shortcut.TargetPath       = NODE_EXECUTABLE_PATH;
    shortcut.Arguments        = '"' + SERVER_JS_PATH + '"';
    shortcut.WorkingDirectory = REPO_ROOT_PATH;
    shortcut.WindowStyle      = WINDOW_STYLE_HIDDEN;
    shortcut.Description      = 'Start the NodeToolbox proxy server';
    shortcut.Save();

    console.log('  ✅ Created: ' + SHORTCUT_DESTINATION_PATH);
    console.log('  → Target:   ' + NODE_EXECUTABLE_PATH);
    console.log('  → Args:     "' + SERVER_JS_PATH + '"');
    console.log('  → WorkingDirectory: ' + REPO_ROOT_PATH);
  } catch (comError) {
    // Fallback: WScript.Shell unavailable — generate a VBScript helper and run it
    console.warn('  ⚠ ActiveXObject unavailable — falling back to VBScript helper');
    createShortcutViaVbscript();
  }
}

/**
 * Fallback shortcut creation using a temporary VBScript file.
 * Used when the Node.js runtime does not expose ActiveXObject (Node.js on Windows
 * does not have ActiveXObject natively — this is the real primary path).
 */
function createShortcutViaVbscript() {
  const tempVbsPath = path.join(require('os').tmpdir(), 'create-toolbox-lnk.vbs');

  const vbsContent = [
    'Set WshShell = WScript.CreateObject("WScript.Shell")',
    'Set oShortcut = WshShell.CreateShortcut("' + SHORTCUT_DESTINATION_PATH.replace(/\\/g, '\\\\') + '")',
    'oShortcut.TargetPath = "' + NODE_EXECUTABLE_PATH.replace(/\\/g, '\\\\') + '"',
    'oShortcut.Arguments = """' + SERVER_JS_PATH.replace(/\\/g, '\\\\') + '"""',
    'oShortcut.WorkingDirectory = "' + REPO_ROOT_PATH.replace(/\\/g, '\\\\') + '"',
    'oShortcut.WindowStyle = ' + WINDOW_STYLE_HIDDEN,
    'oShortcut.Description = "Start the NodeToolbox proxy server"',
    'oShortcut.Save()',
    'WScript.Echo "Shortcut created: ' + SHORTCUT_DESTINATION_PATH.replace(/\\/g, '\\\\') + '"',
  ].join('\r\n');

  fs.writeFileSync(tempVbsPath, vbsContent, 'utf8');

  try {
    const { execFileSync } = require('child_process');
    const cscriptOutput = execFileSync('cscript', ['//NoLogo', tempVbsPath], {
      encoding: 'utf8',
      windowsHide: true,
    });
    console.log('  ✅ Created: ' + SHORTCUT_DESTINATION_PATH);
    console.log('  ' + cscriptOutput.trim());
  } finally {
    // Always clean up the temporary VBScript file
    try { fs.unlinkSync(tempVbsPath); } catch (_) {}
  }
}

// ── Dry-Run Mode ───────────────────────────────────────────────────────────────

/**
 * Prints what the script would do without writing anything to disk.
 * Used in tests and for validating the configuration before committing.
 */
function runDryRun() {
  console.log('  [dry-run] Shortcut would be created with the following settings:');
  console.log('');
  console.log('  Shortcut:         ' + SHORTCUT_DESTINATION_PATH + ' (' + SHORTCUT_FILENAME + ')');
  console.log('  TargetPath:       ' + NODE_EXECUTABLE_PATH + ' (node)');
  console.log('  Arguments:        "' + SERVER_JS_PATH + '"');
  console.log('  WorkingDirectory: ' + REPO_ROOT_PATH);
  console.log('  WindowStyle:      ' + WINDOW_STYLE_HIDDEN + ' (hidden)');
  console.log('  Description:      Start the NodeToolbox proxy server');
  console.log('');
  console.log('  Run without --dry-run to create the shortcut.');
}

// ── Help Text ─────────────────────────────────────────────────────────────────

/**
 * Prints usage information to stdout.
 */
function printHelp() {
  console.log([
    '',
    'Usage: node scripts/create-launcher.js [options]',
    '',
    'Creates a Windows shortcut "Launch Toolbox.lnk" in the repository root.',
    'Double-clicking the shortcut starts the NodeToolbox proxy server silently.',
    '',
    'Options:',
    '  --dry-run    Print what would be created without writing any files',
    '  --help       Show this help message',
    '',
    'Requirements:',
    '  - Windows OS with Windows Script Host (standard on all Windows installs)',
    '  - server.js must exist in the repository root',
    '',
    'After creating the shortcut, move or copy it to your Desktop for easy access.',
    '',
  ].join('\n'));
}

// ── Run ───────────────────────────────────────────────────────────────────────

main();
