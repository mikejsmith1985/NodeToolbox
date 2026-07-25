// test/unit/outlookEmailExport.test.js — Unit tests for the Outlook→drop-folder exporter orchestration.
// PowerShell, the temp-file I/O, and the platform are all injected, so nothing here runs PowerShell,
// touches Outlook, or requires Windows.

'use strict';

const { runOutlookExport, parseExportResult } = require('../../src/services/outlookEmailExport');

/** Builds injected deps that capture the PowerShell args and return a canned stdout. */
function buildDeps(overrides = {}) {
  const state = { args: null, scriptWritten: false, scriptRemoved: false };
  const deps = {
    platform: 'win32',
    writeScript: () => { state.scriptWritten = true; return 'C:\\temp\\export.ps1'; },
    removeScript: () => { state.scriptRemoved = true; },
    runPowerShell: (args) => {
      state.args = args;
      return Promise.resolve({ stdout: 'EXPORT_RESULT {"exported":3,"total":5,"error":null}\n', stderr: '' });
    },
    ...overrides,
  };
  return { deps, state };
}

describe('runOutlookExport', () => {
  it('skips (without running PowerShell) when not on Windows', async () => {
    const { deps, state } = buildDeps({ platform: 'linux' });
    const result = await runOutlookExport({ dropFolder: 'C:\\drop' }, deps);
    expect(result.skipped).toBe(true);
    expect(result.ok).toBe(false);
    expect(state.args).toBeNull(); // PowerShell never invoked
    expect(result.message).toMatch(/only on Windows/);
  });

  it('errors when no drop folder is configured', async () => {
    const { deps } = buildDeps();
    const result = await runOutlookExport({ dropFolder: '' }, deps);
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.message).toMatch(/No drop folder/);
  });

  it('passes the source, processed, and drop folders to PowerShell as separate args', async () => {
    const { deps, state } = buildDeps();
    await runOutlookExport(
      { dropFolder: 'C:\\drop', sourceFolder: 'Inbox\\GH In', processedFolder: 'Inbox\\GH Done' },
      deps,
    );
    expect(state.args).toContain('-File');
    expect(state.args).toContain('C:\\temp\\export.ps1');
    expect(state.args[state.args.indexOf('-SourceFolderPath') + 1]).toBe('Inbox\\GH In');
    expect(state.args[state.args.indexOf('-ProcessedFolderPath') + 1]).toBe('Inbox\\GH Done');
    expect(state.args[state.args.indexOf('-DropFolder') + 1]).toBe('C:\\drop');
  });

  it('passes the lookback window as -LookbackDays (coerced to a non-negative integer)', async () => {
    const { deps, state } = buildDeps();
    await runOutlookExport({ dropFolder: 'C:\\drop', lookbackDays: '1.9' }, deps);
    expect(state.args[state.args.indexOf('-LookbackDays') + 1]).toBe('1');
  });

  it('defaults the lookback window to 0 (no limit) when unset', async () => {
    const { deps, state } = buildDeps();
    await runOutlookExport({ dropFolder: 'C:\\drop' }, deps);
    expect(state.args[state.args.indexOf('-LookbackDays') + 1]).toBe('0');
  });

  it('parses the export result marker into a success result and always cleans up the temp script', async () => {
    const { deps, state } = buildDeps();
    const result = await runOutlookExport({ dropFolder: 'C:\\drop' }, deps);
    expect(result.ok).toBe(true);
    expect(result.exportedCount).toBe(3);
    expect(result.total).toBe(5);
    expect(state.scriptRemoved).toBe(true);
  });

  it('surfaces a script-reported error from the result marker', async () => {
    const { deps } = buildDeps({
      runPowerShell: () => Promise.resolve({ stdout: 'EXPORT_RESULT {"exported":0,"total":0,"error":"Outlook folder not found: GitHub Intake"}\n', stderr: '' }),
    });
    const result = await runOutlookExport({ dropFolder: 'C:\\drop' }, deps);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Outlook folder not found/);
  });

  it('surfaces the PowerShell stderr (the real reason) instead of the generic "Command failed"', async () => {
    const { deps } = buildDeps({
      runPowerShell: () => Promise.reject(Object.assign(new Error('Command failed: powershell.exe -File x.ps1'), {
        stdout: '',
        stderr: 'x.ps1 cannot be loaded because running scripts is disabled on this system.',
      })),
    });
    const result = await runOutlookExport({ dropFolder: 'C:\\drop' }, deps);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/running scripts is disabled/);
    expect(result.message).not.toMatch(/Command failed: powershell/);
  });

  it('reports a friendly error when PowerShell itself fails with no marker', async () => {
    const { deps, state } = buildDeps({
      runPowerShell: () => Promise.reject(Object.assign(new Error("'powershell.exe' not found"), { stdout: '', stderr: '' })),
    });
    const result = await runOutlookExport({ dropFolder: 'C:\\drop' }, deps);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Outlook export failed/);
    expect(state.scriptRemoved).toBe(true); // cleanup still runs on failure
  });

  it('recovers a result marker printed before a non-zero PowerShell exit', async () => {
    const { deps } = buildDeps({
      runPowerShell: () => Promise.reject(Object.assign(new Error('exit 1'), {
        stdout: 'EXPORT_RESULT {"exported":2,"total":2,"error":null}\n',
        stderr: '',
      })),
    });
    const result = await runOutlookExport({ dropFolder: 'C:\\drop' }, deps);
    expect(result.ok).toBe(true);
    expect(result.exportedCount).toBe(2);
  });
});

describe('runOutlookExport — embedded script', () => {
  // Uses the REAL defaultWriteScript so it writes the EMBEDDED exporter script to a temp file — a guard
  // that the embedded content is present and shaped right (it ships inside the exe, no external asset).
  it('writes the embedded exporter script to a temp file, and cleans it up', async () => {
    const fs = require('fs');
    let writtenScriptPath = null;

    const result = await runOutlookExport({ dropFolder: 'C:\\drop' }, {
      platform: 'win32',
      runPowerShell: (args) => {
        writtenScriptPath = args[args.indexOf('-File') + 1];
        const scriptContent = fs.readFileSync(writtenScriptPath, 'utf8');
        expect(scriptContent).toMatch(/param\(/);
        expect(scriptContent).toContain('EXPORT_RESULT');
        return Promise.resolve({ stdout: 'EXPORT_RESULT {"exported":0,"total":0,"error":null}\n', stderr: '' });
      },
    });

    expect(result.ok).toBe(true);
    expect(fs.existsSync(writtenScriptPath)).toBe(false); // temp script removed in finally
  });
});

describe('parseExportResult', () => {
  it('returns an error result when no marker line is present', () => {
    const result = parseExportResult('some noise\nno marker here\n');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/no result marker/i);
  });

  it('reads the last marker line when several are present', () => {
    const result = parseExportResult('EXPORT_RESULT {"exported":1,"total":1}\nEXPORT_RESULT {"exported":9,"total":9}\n');
    expect(result.exportedCount).toBe(9);
  });
});
