// test/unit/updater.test.js — Unit tests for the self-update command generation.
//
// These tests verify that update staging produces a detached PowerShell apply
// script which writes back into the original install directory instead of
// relaunching from a temporary extraction folder.

'use strict';

const fs = require('fs');

const { __testables } = require('../../src/utils/updater');

/** Returns the generated PowerShell script path from a buildApplyUpdateCommand result. */
function readGeneratedScriptPath(updateCommand) {
  return updateCommand.newExecArgs[updateCommand.newExecArgs.length - 1];
}

describe('updater apply-update command generation', () => {
  const generatedScriptPaths = [];

  afterEach(() => {
    for (const scriptPath of generatedScriptPaths) {
      if (fs.existsSync(scriptPath)) {
        fs.rmSync(scriptPath, { force: true });
      }
    }
    generatedScriptPaths.length = 0;
  });

  it('builds a zip-mode apply script that copies into the original install root', () => {
    const updateCommand = __testables.buildApplyUpdateCommand({
      stagingDir: 'C:\\Temp\\nodetoolbox-update-v1.2.3',
      installRoot: 'C:\\Apps\\NodeToolbox',
      launchPath: 'C:\\Program Files\\nodejs\\node.exe',
      launchArgs: ['C:\\Apps\\NodeToolbox\\server.js', '--open'],
    });

    const generatedScriptPath = readGeneratedScriptPath(updateCommand);
    generatedScriptPaths.push(generatedScriptPath);
    const generatedScript = fs.readFileSync(generatedScriptPath, 'utf8');

    expect(updateCommand.newExecPath).toBe('powershell');
    expect(updateCommand.newExecArgs).toContain('-File');
    expect(generatedScript).toContain("$installRoot = 'C:\\Apps\\NodeToolbox'");
    expect(generatedScript).toContain("Copy-ReleaseRootFiles $stagingDir $installRoot");
    expect(generatedScript).toContain("Invoke-RobocopyMirror (Join-Path $stagingDir 'src') (Join-Path $installRoot 'src')");
    expect(generatedScript).toContain(
      "Invoke-RobocopyMirror (Join-Path $stagingDir 'node_modules') (Join-Path $installRoot 'node_modules')",
    );
    expect(generatedScript).toContain("$launchArgs = @('C:\\Apps\\NodeToolbox\\server.js', '--open')");
  });

  it('builds an exe-mode apply script that overwrites the current exe path before relaunch', () => {
    const updateCommand = __testables.buildApplyUpdateCommand({
      stagingDir: 'C:\\Temp\\nodetoolbox-update-v1.2.3',
      installRoot: 'C:\\Apps\\NodeToolbox',
      launchPath: 'C:\\Apps\\NodeToolbox\\nodetoolbox-v1.1.0.exe',
      launchArgs: ['--no-open'],
      currentExePath: 'C:\\Apps\\NodeToolbox\\nodetoolbox-v1.1.0.exe',
      stagedExePath: 'C:\\Temp\\nodetoolbox-update-v1.2.3\\nodetoolbox-v1.2.3.exe',
    });

    const generatedScriptPath = readGeneratedScriptPath(updateCommand);
    generatedScriptPaths.push(generatedScriptPath);
    const generatedScript = fs.readFileSync(generatedScriptPath, 'utf8');

    expect(generatedScript).toContain(
      "$currentExePath = 'C:\\Apps\\NodeToolbox\\nodetoolbox-v1.1.0.exe'",
    );
    expect(generatedScript).toContain(
      "$stagedExePath = 'C:\\Temp\\nodetoolbox-update-v1.2.3\\nodetoolbox-v1.2.3.exe'",
    );
    expect(generatedScript).toContain(
      'Copy-Item -LiteralPath $stagedExePath -Destination $currentExePath -Force',
    );
    expect(generatedScript).toContain('Invoke-RobocopyMirror (Join-Path $stagingDir');
    expect(generatedScript).toContain("(Join-Path $installRoot 'client\\dist')");
    expect(generatedScript).toContain("$launchArgs = @('--no-open')");
  });
});
