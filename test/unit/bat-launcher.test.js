// test/unit/bat-launcher.test.js — Validates that "Launch Toolbox.bat" is
// structurally correct so the server actually stays running after the launcher closes.
//
// Tests parse the bat file content instead of executing it so the suite runs
// without Node.js, npm, or any service credentials. The server's runtime
// behaviour (HTTP responses, routes, etc.) is covered by the integration tests
// in test/integration/server.test.js.

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Constants ─────────────────────────────────────────────────────────────────

const REPO_ROOT       = path.join(__dirname, '..', '..');
const BAT_FILE_PATH   = path.join(REPO_ROOT, 'Launch Toolbox.bat');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns every non-comment, non-empty line from the bat file.
 * Lines starting with "::" are bat-style comments and are excluded so
 * assertion patterns don't accidentally match comment text.
 */
function getExecutableLines() {
  const rawContent = fs.readFileSync(BAT_FILE_PATH, 'utf8');
  return rawContent
    .split(/\r?\n/)
    .filter((line) => {
      const trimmedLine = line.trim();
      return trimmedLine.length > 0 && !trimmedLine.startsWith('::');
    });
}

/**
 * Returns the executable line that begins with the `start` command, if any.
 * Used by multiple assertions about how the server process is launched.
 */
function findStartCommand() {
  return getExecutableLines().find((line) => /^\s*start\b/i.test(line));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Launch Toolbox.bat', () => {
  it('exists in the repository root', () => {
    // The bat file is the primary launch mechanism for zip-distribution users.
    expect(fs.existsSync(BAT_FILE_PATH)).toBe(true);
  });

  describe('dependency auto-install', () => {
    it('runs npm ci to install production dependencies on first launch', () => {
      // npm ci is faster and more deterministic than npm install because it
      // reads exactly from package-lock.json rather than resolving ranges.
      const allLines = getExecutableLines().join('\n');
      expect(allLines).toMatch(/npm\s+ci/i);
    });

    it('uses --omit=dev to skip devDependencies in the end-user install', () => {
      // Test tools like jest are in devDependencies and must not be installed
      // in the end-user distribution — they add megabytes of unnecessary files.
      const allLines = getExecutableLines().join('\n');
      expect(allLines).toMatch(/--omit=dev/i);
    });

    it('only installs when node_modules is absent (not on every launch)', () => {
      // Reinstalling on every launch wastes 15-30 seconds. The guard ensures
      // npm ci only runs when the folder was freshly extracted.
      const allLines = getExecutableLines().join('\n');
      expect(allLines).toMatch(/if not exist.*node_modules/i);
    });
  });

  describe('server process launch', () => {
    it('uses the start command to launch node in a separate persistent window', () => {
      // A bare "node server.js" would block the bat and hold the terminal open.
      // "start" detaches the server into its own window that persists independently.
      const startLine = findStartCommand();
      expect(startLine).toBeDefined();
    });

    it('does NOT use the /b flag on the start command', () => {
      // /b runs the process inside the current console without a new window.
      // When the bat file exits, that console closes — killing the Node process
      // with it. This was the root cause of the "window goes away" bug in v0.0.6.
      const startLine = findStartCommand();
      expect(startLine).not.toMatch(/\/b\b/i);
    });

    it('gives the server window a descriptive title so users can find it', () => {
      // A titled window shows up in Alt-Tab and Task Manager as "NodeToolbox Server"
      // rather than a generic "cmd.exe" entry, reducing user confusion.
      const startLine = findStartCommand();
      expect(startLine).toMatch(/start\s+"NodeToolbox/i);
    });

    it('passes --open to auto-open the dashboard in the default browser', () => {
      // Without --open the user must manually navigate to http://localhost:5555.
      // --open triggers openBrowserToDashboard() in server.js on startup.
      const startLine = findStartCommand();
      expect(startLine).toMatch(/--open/);
    });

    it('launches node server.js as the entry point', () => {
      // server.js is the sole Express entry point — nothing else should be started.
      const startLine = findStartCommand();
      expect(startLine).toMatch(/node\s+server\.js/i);
    });
  });

  describe('working directory', () => {
    it('changes to the batch file own directory using %~dp0', () => {
      // %~dp0 expands to the directory containing the bat file regardless of
      // where the user double-clicks it. Without this, relative paths (server.js,
      // node_modules\) resolve against the user's shell CWD — the wrong folder.
      const allLines = getExecutableLines().join('\n');
      expect(allLines).toMatch(/%~dp0/);
    });
  });
});
