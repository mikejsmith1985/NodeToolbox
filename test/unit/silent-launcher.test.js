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
