// test/unit/local-release.test.js — Unit tests for the distribution packaging script.
//
// The release script packages NodeToolbox into a distributable zip.
// Tests exercise -DryRun mode so no files are written and no npm commands are run.
//
// Note: local-release.ps1 is a Windows-only script (requires PowerShell + WScript.Shell).
// These tests are skipped automatically on non-Windows platforms.

'use strict';

const fs               = require('fs');
const path             = require('path');
const { execFileSync } = require('child_process');

// ── Platform Guard ─────────────────────────────────────────────────────────────

// The release script depends on PowerShell (powershell.exe) and WScript.Shell,
// both of which are Windows-only. On Linux/Mac CI nodes these tests are skipped.
const describeOnWindows = process.platform === 'win32' ? describe : describe.skip;

// ── Helpers ────────────────────────────────────────────────────────────────────

const SCRIPT_PATH = path.join(__dirname, '..', '..', 'scripts', 'local-release.ps1');
const REPO_ROOT   = path.join(__dirname, '..', '..');

/**
 * Runs local-release.ps1 with -DryRun and captures stdout.
 *
 * `bumpType` is optional. Passing one matters: every original test omitted it, so the version-bump
 * path was never exercised in a dry run — which is exactly where the dry run used to write to disk.
 */
function runDryRun(bumpType) {
  const scriptArguments = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT_PATH];
  if (bumpType) {
    scriptArguments.push(bumpType);
  }
  scriptArguments.push('-DryRun');

  return execFileSync('powershell.exe', scriptArguments, {
    cwd:      REPO_ROOT,
    encoding: 'utf8',
    env:      { ...process.env },
  });
}

/** The version currently recorded in package.json, read fresh from disk. */
function readPackageVersion() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describeOnWindows('local-release.ps1', () => {
  // A dry run that mutates the repo is worse than no dry run at all: it silently sets up the next
  // real run to bump twice. These tests pass a bump type, which the original suite never did.
  describe('-DryRun with a version bump — writes nothing', () => {
    it('does NOT modify package.json', () => {
      const versionBefore = readPackageVersion();

      runDryRun('minor');

      expect(readPackageVersion()).toBe(versionBefore);
    });

    it('does NOT modify package-lock.json', () => {
      const lockPath = path.join(REPO_ROOT, 'package-lock.json');
      const lockBefore = fs.readFileSync(lockPath, 'utf8');

      runDryRun('minor');

      expect(fs.readFileSync(lockPath, 'utf8')).toBe(lockBefore);
    });

    it('does not modify package.json for an explicit version either', () => {
      const versionBefore = readPackageVersion();

      runDryRun('9.9.9');

      expect(readPackageVersion()).toBe(versionBefore);
    });

    it('still reports the version the release WOULD use, so the preview is useful', () => {
      // Computing the next version without writing it is the whole trick.
      const currentVersion = readPackageVersion();
      const [major, minor] = currentVersion.split('.').map(Number);

      const output = runDryRun('minor');

      expect(output).toContain(`${major}.${minor + 1}.0`);
    });

    it('reports the next patch version for a patch bump', () => {
      const [major, minor, patch] = readPackageVersion().split('.').map(Number);

      const output = runDryRun('patch');

      expect(output).toContain(`${major}.${minor}.${patch + 1}`);
    });

    it('reports the next major version for a major bump', () => {
      const [major] = readPackageVersion().split('.').map(Number);

      const output = runDryRun('major');

      expect(output).toContain(`${major + 1}.0.0`);
    });

    it('reports an explicit version verbatim', () => {
      const output = runDryRun('9.9.9');

      expect(output).toContain('9.9.9');
    });

    it('names the zip after the version it would release, not the current one', () => {
      const [major, minor] = readPackageVersion().split('.').map(Number);

      const output = runDryRun('minor');

      expect(output).toContain(`nodetoolbox-v${major}.${minor + 1}.0-exe.zip`);
    });
  });

  // The release must never tag a commit that does not carry the version being released. That
  // happened once (v0.69.0 pointed at a commit reading 0.68.7) because the version-bump commit was
  // refused by the pre-commit hook and the script carried on regardless.
  describe('bumping from main is caught before anything is built', () => {
    /** The branch the repo is on right now — these assertions depend on it. */
    function currentBranch() {
      return execFileSync('git', ['branch', '--show-current'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    }

    it('warns in the dry run when a bump would be attempted from main', () => {
      if (currentBranch() !== 'main') {
        // Only meaningful on main; on a feature branch there is nothing to warn about.
        return;
      }

      expect(runDryRun('minor')).toMatch(/pre-commit hook refuses commits to main/i);
    });

    it('does NOT warn when releasing from a feature branch', () => {
      if (currentBranch() === 'main') {
        return;
      }

      expect(runDryRun('minor')).not.toMatch(/pre-commit hook refuses commits to main/i);
    });

    it('does not warn when no bump is requested, since nothing needs committing', () => {
      expect(runDryRun()).not.toMatch(/pre-commit hook refuses commits to main/i);
    });
  });

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

    it('does NOT include node_modules in the distributable bundle', () => {
      // node_modules causes thousands of tiny files — extracting them on Windows
      // is extremely slow. The bundle must omit them; users install via npm ci on first run.
      const output = runDryRun();
      expect(output).not.toMatch(/node_modules/i);
    });

    it('reports the durable current.txt and versions layout', () => {
      // The release zip must make launch simple: stable launchers at the top and
      // the selected executable under versions\<version>.
      const output = runDryRun();
      expect(output).toMatch(/current\.txt/i);
      expect(output).toMatch(/versions/i);
      expect(output).toMatch(/nodetoolbox\.exe/i);
    });

    it('reports that an exe payload will be built for the single release zip', () => {
      // A standalone .exe payload lets users run NodeToolbox without installing Node.js.
      const output = runDryRun();
      expect(output).toMatch(/\.exe|nodetoolbox.*exe/i);
    });

    it('reports that a GitHub Release will be published', () => {
      // The script must publish directly to GitHub — running the script is the
      // complete release process, not just a local build step.
      const output = runDryRun();
      expect(output).toMatch(/GitHub Release|gh release create/i);
    });

    it('reports that exactly one zip asset will be published for safe download', () => {
      // One asset avoids confusing first-time users while still avoiding direct
      // browser downloads of a raw unsigned executable.
      const output = runDryRun();
      expect(output).toMatch(/single zip asset|one user-facing zip/i);
      expect(output).toMatch(/-exe\.zip/i);
    });
  });
});
