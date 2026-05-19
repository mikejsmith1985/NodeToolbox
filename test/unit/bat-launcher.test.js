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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Launch Toolbox.bat', () => {
  it('exists in the repository root', () => {
    // The bat file is the primary launch mechanism for zip-distribution users.
    expect(fs.existsSync(BAT_FILE_PATH)).toBe(true);
  });

  describe('durable bootstrapper layout', () => {
    it('reads current.txt to find the selected payload version', () => {
      // The visible launcher must match the silent launcher: current.txt is the
      // durable source of truth for which version starts after reboot.
      const allLines = getExecutableLines().join('\n');
      expect(allLines).toMatch(/current\.txt/i);
    });

    it('starts the fixed executable from the versions folder', () => {
      // Users no longer need Node.js or npm. The batch file launches the bundled
      // payload chosen by current.txt.
      const allLines = getExecutableLines().join('\n');
      expect(allLines).toMatch(/versions/i);
      expect(allLines).toMatch(/nodetoolbox\.exe/i);
    });

    it('does not require npm during normal end-user launch', () => {
      // The single release asset includes the executable payload, so a corporate
      // user can launch without installing Node dependencies.
      const allLines = getExecutableLines().join('\n');
      expect(allLines).not.toMatch(/npm\s+ci|npm\s+install/i);
    });

    it('uses numeric version comparison instead of alphabetical sort fallback', () => {
      // Alphabetical sort would choose 0.9.9 after 0.10.0 and corrupt current.txt.
      // The batch launcher must compare major/minor/patch numbers like the VBS.
      const allLines = getExecutableLines().join('\n');
      expect(allLines).toMatch(/SelectHigherVersion/i);
      expect(allLines).toMatch(/CANDIDATE_MAJOR_VERSION/i);
      expect(allLines).not.toMatch(/dir \/b \/ad.*sort/i);
    });

    it('clears a stale current.txt value before scanning installed fallback versions', () => {
      // If current.txt points to a missing newer version, the fallback scan must
      // still select the highest installed working payload.
      const allLines = getExecutableLines().join('\n');
      expect(allLines).toMatch(/if not defined PAYLOAD_PATH \(\n\s*set "SELECTED_VERSION="/i);
    });
  });

  describe('server process launch', () => {
    it('runs the payload executable directly without the start command', () => {
      // Running directly keeps errors visible in the diagnostic launcher window.
      const serverLaunchLine = getExecutableLines().find((line) => /^"%PAYLOAD_PATH%"/.test(line.trim()));
      expect(serverLaunchLine).toBeDefined();
      expect(serverLaunchLine.trim()).not.toMatch(/^start\s/i);
    });

    it('does NOT use the /b flag (would detach and silently kill the server)', () => {
      // /b runs the process in the current console without a new window. When the
      // bat file exits, the console closes and Node dies with it.
      const serverLaunchLine = getExecutableLines().find((line) => /^"%PAYLOAD_PATH%"/.test(line.trim()));
      expect(serverLaunchLine).toBeDefined();
      expect(serverLaunchLine).not.toMatch(/\/b\b/i);
    });

    it('passes --open to auto-open the dashboard in the default browser', () => {
      // Without --open the user must manually navigate to http://localhost:5555.
      // --open triggers openBrowserToDashboard() in server.js on startup.
      const serverLaunchLine = getExecutableLines().find((line) => /^"%PAYLOAD_PATH%"/.test(line.trim()));
      expect(serverLaunchLine).toMatch(/--open/);
    });

    it('launches the selected payload executable as the entry point', () => {
      const serverLaunchLine = getExecutableLines().find((line) => /^"%PAYLOAD_PATH%"/.test(line.trim()));
      expect(serverLaunchLine).toMatch(/%PAYLOAD_PATH%/);
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
