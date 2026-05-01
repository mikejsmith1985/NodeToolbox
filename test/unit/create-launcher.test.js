// test/unit/createLauncher.test.js — Unit tests for the Windows shortcut creation script.
//
// The script runs in two modes:
//   1. Normal mode  — calls WScript.Shell COM via ActiveXObject to create a real .lnk file
//   2. Dry-run mode — skips COM calls, logs what it would do, exits without writing anything
//
// Tests always exercise dry-run mode so no .lnk file is ever written to disk and so
// the test suite can run on any OS without the WScript.Shell COM object.

'use strict';

const path      = require('path');
const { execFileSync } = require('child_process');

// ── Helpers ────────────────────────────────────────────────────────────────────

const SCRIPT_PATH   = path.join(__dirname, '..', '..', 'scripts', 'create-launcher.js');
const NODE_EXEC     = process.execPath;
const REPO_ROOT     = path.join(__dirname, '..', '..');

/** Runs create-launcher.js with --dry-run and captures stdout + stderr. */
function runDryRun(extraArgs = []) {
  const args = [SCRIPT_PATH, '--dry-run', ...extraArgs];
  const outputBuffer = execFileSync(NODE_EXEC, args, {
    cwd:      REPO_ROOT,
    encoding: 'utf8',
    env:      { ...process.env, FORCE_COLOR: '0' },
  });
  return outputBuffer;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('create-launcher.js', () => {
  describe('--dry-run mode', () => {
    it('exits with code 0 in dry-run mode', () => {
      // execFileSync throws if the exit code is non-zero
      expect(() => runDryRun()).not.toThrow();
    });

    it('reports the shortcut destination path in dry-run output', () => {
      const output = runDryRun();
      // Should mention the .lnk file name so users know what will be created
      expect(output).toMatch(/Launch Toolbox\.lnk/i);
    });

    it('reports the node executable path in dry-run output', () => {
      const output = runDryRun();
      // Target of the shortcut must be the node binary, not any arbitrary exe
      expect(output).toMatch(/node/i);
    });

    it('reports the server.js path in dry-run output', () => {
      const output = runDryRun();
      // The shortcut must point to server.js, not some other entry point
      expect(output).toMatch(/server\.js/i);
    });

    it('reports the working directory in dry-run output', () => {
      const output = runDryRun();
      // Working directory is the repo root so relative require() calls work
      expect(output).toMatch(/WorkingDirectory/i);
    });

    it('does NOT write a .lnk file in dry-run mode', () => {
      const fs = require('fs');
      const launcherPath = path.join(REPO_ROOT, 'Launch Toolbox.lnk');

      // Remove if a previous test run left one behind
      if (fs.existsSync(launcherPath)) fs.unlinkSync(launcherPath);

      runDryRun();

      expect(fs.existsSync(launcherPath)).toBe(false);
    });
  });

  describe('argument parsing', () => {
    it('prints help text when --help flag is passed', () => {
      const output = execFileSync(NODE_EXEC, [SCRIPT_PATH, '--help'], {
        cwd:      REPO_ROOT,
        encoding: 'utf8',
        env:      { ...process.env, FORCE_COLOR: '0' },
      });
      expect(output).toMatch(/Usage|usage|help/i);
    });
  });
});
