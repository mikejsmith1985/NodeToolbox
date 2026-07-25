// src/services/outlookEmailExport.js — Runs the bundled PowerShell exporter that pulls GitHub notification
// emails from an Outlook folder into the intake drop folder as .msg files.
//
// This is the "managed from Toolbox" replacement for a standalone script + Task Scheduler: because the
// server runs on the same Windows machine as Outlook, it can drive the export itself, right before each
// intake sweep. The PowerShell script (scripts/exportGithubEmails.ps1) is read once, written to a temp file
// per run, and executed with execFile (an args array — NOT a shell — so folder names cannot inject). Every
// external boundary (platform, PowerShell execution, temp-file I/O) is injectable so the orchestration is
// unit-testable without Windows, PowerShell, or Outlook.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// Path to the exporter script, a bundled asset (see package.json pkg.assets) so it ships inside the
// packaged exe and arrives with every in-app update. It is read LAZILY (not at module load) and cached, so
// a packaging problem degrades to a friendly per-run error instead of crashing server boot.
const EXPORT_SCRIPT_PATH = path.join(__dirname, 'scripts', 'exportGithubEmails.ps1');

// The marker the script prints as its final, machine-readable line: "EXPORT_RESULT {json}".
const RESULT_MARKER = 'EXPORT_RESULT ';
const POWERSHELL_TIMEOUT_MS = 120 * 1000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

let cachedScriptContent = null;
/** Reads the bundled exporter script once and caches it; throws a clear error if the asset is missing. */
function loadScriptContent() {
  if (cachedScriptContent === null) {
    try {
      cachedScriptContent = fs.readFileSync(EXPORT_SCRIPT_PATH, 'utf8');
    } catch (readError) {
      throw new Error('Outlook exporter script is missing from this build: ' + readError.message);
    }
  }
  return cachedScriptContent;
}

/** Writes the exporter script to a fresh temp .ps1 (real filesystem, so PowerShell can -File it) and returns its path. */
function defaultWriteScript() {
  const scriptPath = path.join(os.tmpdir(), 'nodetoolbox-outlook-export.ps1');
  fs.writeFileSync(scriptPath, loadScriptContent(), 'utf8');
  return scriptPath;
}

/** Best-effort removal of the temp script; a leftover temp file must never fail the run. */
function defaultRemoveScript(scriptPath) {
  try {
    fs.unlinkSync(scriptPath);
  } catch (_removeError) {
    // ignore — a stale temp script is harmless and overwritten next run
  }
}

/** Runs PowerShell with the given argument array, resolving { stdout, stderr }. */
function defaultRunPowerShell(args) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', args, { windowsHide: true, timeout: POWERSHELL_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
      (execError, stdout, stderr) => {
        if (execError) {
          execError.stdout = stdout;
          execError.stderr = stderr;
          return reject(execError);
        }
        resolve({ stdout, stderr });
      });
  });
}

/** Parses the script's "EXPORT_RESULT {json}" line out of stdout into a normalized result object. */
function parseExportResult(stdout) {
  const lines = String(stdout || '').split(/\r?\n/);
  const markerLine = lines.reverse().find((line) => line.startsWith(RESULT_MARKER));
  if (!markerLine) {
    return { ok: false, exportedCount: 0, total: 0, message: 'Export produced no result marker.', raw: String(stdout || '').slice(0, 2000) };
  }

  let parsed;
  try {
    parsed = JSON.parse(markerLine.slice(RESULT_MARKER.length));
  } catch (_parseError) {
    return { ok: false, exportedCount: 0, total: 0, message: 'Could not parse the export result line.', raw: markerLine };
  }

  if (parsed.error) {
    return { ok: false, exportedCount: 0, total: Number(parsed.total) || 0, message: String(parsed.error) };
  }
  const exportedCount = Number(parsed.exported) || 0;
  const total = Number(parsed.total) || 0;
  return { ok: true, exportedCount, total, message: 'Exported ' + exportedCount + ' of ' + total + ' Outlook message(s).' };
}

/**
 * Runs the Outlook export once. Returns a normalized result (never throws): a Windows-only guard yields a
 * skipped result off-Windows; a missing drop folder or a PowerShell/Outlook failure yields an error result.
 *
 * @param {{ sourceFolder?: string, processedFolder?: string, dropFolder?: string }} exportConfig
 * @param {object} [deps] - injectable boundaries: platform, runPowerShell, writeScript, removeScript
 * @returns {Promise<object>}
 */
async function runOutlookExport(exportConfig, deps = {}) {
  const platform = deps.platform || process.platform;
  if (platform !== 'win32') {
    return { ok: false, skipped: true, exportedCount: 0, total: 0, message: 'Outlook export runs only on Windows (where Outlook and PowerShell are available).' };
  }

  const dropFolder = String((exportConfig && exportConfig.dropFolder) || '').trim();
  if (dropFolder === '') {
    return { ok: false, skipped: false, exportedCount: 0, total: 0, message: 'No drop folder configured for the Outlook export.' };
  }
  const sourceFolder = String((exportConfig && exportConfig.sourceFolder) || 'Inbox\\GitHub Intake').trim();
  const processedFolder = String((exportConfig && exportConfig.processedFolder) || 'Inbox\\GitHub Processed').trim();

  const writeScript = deps.writeScript || defaultWriteScript;
  const removeScript = deps.removeScript || defaultRemoveScript;
  const runPowerShell = deps.runPowerShell || defaultRunPowerShell;

  let scriptPath = null;
  try {
    scriptPath = writeScript();
    const args = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
      '-SourceFolderPath', sourceFolder,
      '-ProcessedFolderPath', processedFolder,
      '-DropFolder', dropFolder,
    ];
    const { stdout } = await runPowerShell(args);
    return parseExportResult(stdout);
  } catch (execError) {
    const combinedOutput = (execError.stdout || '') + (execError.stderr || '');
    // The script may still have printed a result marker before a non-zero exit — prefer it when present.
    if (combinedOutput.includes(RESULT_MARKER)) {
      return parseExportResult(combinedOutput);
    }
    return { ok: false, exportedCount: 0, total: 0, message: 'Outlook export failed: ' + (execError.message || String(execError)) };
  } finally {
    if (scriptPath) {
      removeScript(scriptPath);
    }
  }
}

module.exports = {
  runOutlookExport,
  parseExportResult,
};
