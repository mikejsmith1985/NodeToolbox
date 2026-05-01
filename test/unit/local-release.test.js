// test/unit/local-release.test.js — Unit tests for the distribution packaging script.
//
// The release script packages NodeToolbox into a distributable zip.
// Tests exercise -DryRun mode so no files are written and no npm commands are run.

'use strict';

const path         = require('path');
const { execFileSync } = require('child_process');

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

describe('local-release.ps1', () => {
  describe('-DryRun mode', () => {
    it('exits with code 0 in dry-run mode', () => {
      expect(() => runDryRun()).not.toThrow();
    });

    it('reports that npm install would be run', () => {
      const output = runDryRun();
      expect(output).toMatch(/npm install/i);
    });

    it('reports that the launcher would be created', () => {
      const output = runDryRun();
      expect(output).toMatch(/create-launcher|Launch Toolbox\.lnk/i);
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
