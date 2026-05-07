// test/unit/silent-launcher.test.js — Verifies that the silent VBScript launcher
// is present and structurally correct so it can run NodeToolbox without showing
// a console window to the end user.
//
// Background: corporate users closing the terminal window by mistake (or finding
// it concerning) motivated adding a headless launch option. The VBScript runs the
// exe (or bat) with WScript.Shell windowStyle = 0 (hidden), so no terminal ever
// appears. The browser auto-opens to the dashboard as usual.

'use strict';

const fs   = require('fs');
const path = require('path');

/** Absolute path to the silent launcher VBScript at the project root */
const SILENT_LAUNCHER_PATH = path.join(__dirname, '..', '..', 'Launch Toolbox Silent.vbs');

// ── File existence ─────────────────────────────────────────────────────────────

describe('Launch Toolbox Silent.vbs — file presence', () => {
  it('exists at the project root', () => {
    // Fails before the VBS file is created
    expect(fs.existsSync(SILENT_LAUNCHER_PATH)).toBe(true);
  });

  it('is a non-empty file', () => {
    const fileStats = fs.statSync(SILENT_LAUNCHER_PATH);
    expect(fileStats.size).toBeGreaterThan(0);
  });
});

// ── Content correctness ────────────────────────────────────────────────────────

describe('Launch Toolbox Silent.vbs — content correctness', () => {
  let vbsContent;

  beforeAll(() => {
    vbsContent = fs.readFileSync(SILENT_LAUNCHER_PATH, 'utf-8');
  });

  it('uses WScript.Shell to launch a process', () => {
    // WScript.Shell is the standard Windows scripting object for process launch
    expect(vbsContent).toMatch(/WScript\.Shell/i);
  });

  it('passes window style 0 (hidden) to the Run call', () => {
    // windowStyle 0 = SW_HIDE — the launched process has no visible window.
    // The pattern matches: .Run <command>, 0, (True|False)
    expect(vbsContent).toMatch(/\.Run\b.*,\s*0\s*,/);
  });

  it('searches for the nodetoolbox-*.exe executable by name prefix', () => {
    // The VBS must locate the exe dynamically so it works across version numbers
    expect(vbsContent).toMatch(/nodetoolbox-/i);
  });

  it('falls back to Launch Toolbox.bat when no exe is found', () => {
    // Zip distribution users do not have an exe — the VBS must run the bat instead
    expect(vbsContent).toMatch(/Launch Toolbox\.bat/i);
  });

  it('includes an error message if neither exe nor bat is found', () => {
    // User-facing guidance when the launcher is placed in the wrong directory
    expect(vbsContent).toMatch(/MsgBox/i);
  });

  it('picks the exe with the most recent DateLastModified when multiple versions exist', () => {
    // If a user has nodetoolbox-v0.0.9.exe and nodetoolbox-v0.0.12.exe in the same
    // folder, running the older (buggy) version defeats the entire upgrade.
    // The VBS must compare DateLastModified and select the NEWEST file, not the first
    // one returned by filesystem iteration (which is order-dependent).
    expect(vbsContent).toMatch(/DateLastModified/i);
  });
});

// ── Corporate-PC reliability (polling + diagnostic feedback) ──────────────────
//
// v0.5.2 enhancement: the VBS now polls for server readiness after launching
// rather than fire-and-forget. This makes it safe for corporate PCs where:
//   * The exe's built-in "start" browser-open is blocked by group policy
//   * An EADDRINUSE error is swallowed by the hidden console window
//   * Antivirus delays or blocks the exe silently
// If the server doesn't become ready within the timeout, a diagnostic MsgBox
// guides the user instead of leaving them with a blank screen.

describe('Launch Toolbox Silent.vbs — corporate-PC reliability', () => {
  let vbsContent;

  beforeAll(() => {
    vbsContent = fs.readFileSync(SILENT_LAUNCHER_PATH, 'utf-8');
  });

  it('defines a named constant for the server port instead of a magic number', () => {
    // Named constants let admins see at a glance what port is expected —
    // and make it easy to update if the port changes in future.
    expect(vbsContent).toMatch(/SERVER_PORT\s*=\s*5555/i);
  });

  it('defines a named constant for the startup timeout in seconds', () => {
    // The timeout determines how long the VBS waits before showing the diagnostic
    // error.  A named constant makes the intent clear to anyone reading the file.
    expect(vbsContent).toMatch(/SERVER_READY_TIMEOUT_SECONDS\s*=/i);
  });

  it('polls for server readiness using WScript.Sleep after launching', () => {
    // WScript.Sleep pauses the VBS loop between port-check attempts.
    // Without it the loop would spin at 100% CPU and return garbage results.
    expect(vbsContent).toMatch(/WScript\.Sleep/i);
  });

  it('uses netstat to check whether the server port is listening', () => {
    // netstat is available on every Windows machine without special permissions.
    // It is more reliable than PowerShell or WinHttp which may be blocked by IT.
    expect(vbsContent).toMatch(/netstat/i);
  });

  it('opens the browser from the VBS after confirming the server is ready', () => {
    // Belt-and-suspenders: the exe also tries to open the browser, but the
    // VBS must open it independently in case the exe's "start" command is blocked
    // by corporate group policy.  The VBS uses cmd /c start to open the URL.
    expect(vbsContent).toMatch(/http:\/\/localhost/i);
  });

  it('checks whether the server is already running before launching a new instance', () => {
    // If the user clicks the VBS launcher twice, the second run should just open
    // the browser rather than try to start a second instance.
    expect(vbsContent).toMatch(/IsPortListening|isPortListening/);
  });

  it('shows a diagnostic timeout error if the server does not start in time', () => {
    // Silent failures are the hardest to debug.  A MsgBox after the timeout
    // tells the user exactly what to try next instead of leaving them stuck.
    expect(vbsContent).toMatch(/did not start/i);
  });

  it('includes SmartScreen guidance in the timeout error message', () => {
    // The most common corporate-PC cause of silent failure is SmartScreen
    // blocking the unsigned exe.  The message must tell users how to allow it.
    expect(vbsContent).toMatch(/SmartScreen/i);
  });
});
