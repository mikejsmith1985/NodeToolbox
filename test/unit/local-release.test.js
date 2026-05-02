// test/unit/local-release.test.js — Unit tests for the distribution packaging script.
//
// The release script packages NodeToolbox into a distributable zip.
// Tests exercise -DryRun mode so no files are written and no npm commands are run.
//
// Note: local-release.ps1 is a Windows-only script (requires PowerShell + WScript.Shell).
// These tests are skipped automatically on non-Windows platforms.

'use strict';

const path             = require('path');
const { execFileSync } = require('child_process');

// ── Platform Guard ─────────────────────────────────────────────────────────────

// The release script depends on PowerShell (powershell.exe) and WScript.Shell,
// both of which are Windows-only. On Linux/Mac CI nodes these tests are skipped.
const describeOnWindows = process.platform === 'win32' ? describe : describe.skip;

// ── Helpers ────────────────────────────────────────────────────────────────────

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'local-release.ps1');
const REPO_ROOT   = path.join(__dirname, '..', '..');

/** Runs local-release.ps1 with -DryRun and captures stdout. */
function runDryRun() {
  return execFileSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', SCRIPT_PATH,
    '-DryRun',
  ], {
    cwd:      REPO_ROOT,
    encoding: 'utf8',
    env:      { ...process.env },
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describeOnWindows('local-release.ps1', () => {
  describe('-DryRun mode', () => {
    it('exits with code 0 in dry-run mode', () => {
      expect(() => runDryRun()).not.toThrow();
    });

    it('reports that npm install would be run', () => {
      const output = runDryRun();
      expect(output).toMatch(/npm install/i);
    });

    it('reports that the portable bat launcher will be included', () => {
      const output = runDryRun();
      // Dry-run should mention the .bat launcher (not the old .lnk shortcut)
      expect(output).toMatch(/Launch Toolbox\.bat|%~dp0|portable bat/i);
    });

    it('reports the output zip file path', () => {
      const output = runDryRun();
      expect(output).toMatch(/nodetoolbox.*\.zip|dist[/\\]/i);
    });

    it('reports the version that will be used for the zip filename', () => {
      const output = runDryRun();
      // Version comes from package.json — any semver pattern is valid
      expect(output).toMatch(/\d+\.\d+\.\d+/);
    });

    it('does NOT include the .lnk shortcut in the bundle (machine-specific paths)', () => {
      const output = runDryRun();
      // .lnk files embed absolute build-machine paths — they must never be bundled
      expect(output).not.toMatch(/Launch Toolbox\.lnk/i);
    });

    it('does NOT create a dist/ directory in dry-run mode', () => {
      const fs = require('fs');
      const distPath = path.join(REPO_ROOT, 'dist');

      // Remove dist if it exists from a previous real run
      if (fs.existsSync(distPath)) fs.rmSync(distPath, { recursive: true, force: true });

      runDryRun();

      expect(fs.existsSync(distPath)).toBe(false);
    });
  });
});
