// src/services/outlookEmailExport.js — Runs the bundled PowerShell exporter that pulls GitHub notification
// emails from an Outlook folder into the intake drop folder as .msg files.
//
// This is the "managed from Toolbox" replacement for a standalone script + Task Scheduler: because the
// server runs on the same Windows machine as Outlook, it can drive the export itself, right before each
// intake sweep. The PowerShell exporter is EMBEDDED in this file (pkg would not reliably bundle a loose
// .ps1 into the packaged exe), written to a temp .ps1 per run, and executed with execFile (an args array —
// NOT a shell — so folder names cannot inject). Every external boundary (platform, PowerShell execution,
// temp-file I/O) is injectable so the orchestration is unit-testable without Windows, PowerShell, or Outlook.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

// The marker the script prints as its final, machine-readable line: "EXPORT_RESULT {json}".
const RESULT_MARKER = 'EXPORT_RESULT ';
const POWERSHELL_TIMEOUT_MS = 120 * 1000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

// The exporter script is EMBEDDED here (String.raw, so backslashes in Outlook paths survive) rather than
// shipped as a separate file: pkg's asset bundling did not reliably include a loose .ps1 in the packaged
// exe, so embedding guarantees it is always present. It is written to a temp .ps1 per run so PowerShell can
// -File it. This String is the single source of truth for the exporter.
const EXPORT_SCRIPT_CONTENT = String.raw`# exportGithubEmails.ps1 — Save GitHub notification emails from an Outlook folder to a local drop folder
# as .msg files, so NodeToolbox's GitHub Email Intake can process them. Invoked by the server before each
# intake sweep; NOT meant to be run by hand. No macros, no admin, no GitHub API: it attaches to Outlook via
# COM, exports each mail in the source folder to .msg, then moves it to a "processed" folder so it is never
# exported twice. It touches only non-sensitive properties (Subject, EntryID, MessageClass, SaveAs, Move),
# so Outlook's programmatic-access guard does not prompt. Final line is "EXPORT_RESULT {json}".

param(
    [string]$SourceFolderPath    = 'Inbox\GitHub Intake',
    [string]$ProcessedFolderPath = 'Inbox\GitHub Processed',
    [string]$DropFolder          = (Join-Path $env:USERPROFILE 'Documents\gh_emails'),
    # Only export mail received within the last N days. 0 = no limit (export everything in the folder).
    [int]$LookbackDays           = 0
)

# olMSGUnicode: preserves the Unicode transport headers (X-GitHub-Sender, List-ID, etc.) the engine reads.
$OL_SAVE_AS_MSG_UNICODE = 9
# olFolderInbox: well-known id for the default Inbox, the anchor for folder-path lookups.
$OL_FOLDER_INBOX = 6

# Walks an Outlook folder path like "Inbox\GitHub Intake" and returns the MAPIFolder, or throws.
function Resolve-OutlookFolder($namespace, [string]$folderPath) {
    $parts = $folderPath -split '\\' | Where-Object { $_ -ne '' }
    $inbox = $namespace.GetDefaultFolder($OL_FOLDER_INBOX)

    if ($parts[0] -ieq 'Inbox') {
        $current = $inbox
        $remaining = $parts | Select-Object -Skip 1
    } else {
        $current = $inbox.Parent
        $remaining = $parts
    }

    foreach ($name in $remaining) {
        $next = $null
        foreach ($sub in $current.Folders) {
            if ($sub.Name -ieq $name) { $next = $sub; break }
        }
        if ($null -eq $next) {
            throw "Outlook folder not found: '$name' under '$($current.Name)'. Create it in Outlook first."
        }
        $current = $next
    }
    return $current
}

# Turns an email subject into a safe .msg filename, made unique with a slice of the mail's EntryID.
function Get-SafeFileName([string]$subject, [string]$entryId) {
    $safeSubject = ($subject -replace '[\\/:*?"<>|\r\n\t]', '_').Trim()
    if ([string]::IsNullOrWhiteSpace($safeSubject)) { $safeSubject = 'github-notification' }
    if ($safeSubject.Length -gt 120) { $safeSubject = $safeSubject.Substring(0, 120) }
    $uniqueSuffix = $entryId.Substring(0, [Math]::Min(12, $entryId.Length))
    return ('{0}_{1}.msg' -f $safeSubject, $uniqueSuffix)
}

# Emits the machine-readable result line the server looks for, then stops.
function Write-ExportResult([int]$exported, [int]$total, [string]$errorMessage) {
    $summary = @{ exported = $exported; total = $total; error = $errorMessage }
    Write-Output ('EXPORT_RESULT ' + (ConvertTo-Json $summary -Compress))
}

$outlook = $null
$namespace = $null
try {
    if (-not (Test-Path $DropFolder)) {
        New-Item -ItemType Directory -Path $DropFolder -Force | Out-Null
    }

    $outlook = New-Object -ComObject Outlook.Application
    $namespace = $outlook.GetNamespace('MAPI')

    $sourceFolder = Resolve-OutlookFolder $namespace $SourceFolderPath
    $processedFolder = Resolve-OutlookFolder $namespace $ProcessedFolderPath

    # Snapshot to a fixed array first — moving items while iterating a live .Items collection skips messages.
    $items = @($sourceFolder.Items)
    # Lookback window: skip anything older than N days so a months-deep backlog is not exported all at once.
    if ($LookbackDays -gt 0) {
        $cutoff = (Get-Date).AddDays(-$LookbackDays)
        $items = @($items | Where-Object { $_.ReceivedTime -and $_.ReceivedTime -ge $cutoff })
    }
    $exportedCount = 0
    foreach ($item in $items) {
        if ($item.MessageClass -notlike 'IPM.Note*') { continue }
        try {
            $fileName = Get-SafeFileName $item.Subject $item.EntryID
            $fullPath = Join-Path $DropFolder $fileName
            $item.SaveAs($fullPath, $OL_SAVE_AS_MSG_UNICODE)
            # Only move AFTER a successful save, so a failed export retries next run.
            [void]$item.Move($processedFolder)
            $exportedCount += 1
        } catch {
            Write-Output ("WARN export failed for '$($item.Subject)': $($_.Exception.Message)")
        }
    }

    Write-ExportResult $exportedCount $items.Count $null
} catch {
    Write-ExportResult 0 0 $_.Exception.Message
} finally {
    if ($namespace) { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($namespace) | Out-Null }
    if ($outlook)   { [System.Runtime.InteropServices.Marshal]::ReleaseComObject($outlook) | Out-Null }
    [System.GC]::Collect()
    [System.GC]::WaitForPendingFinalizers()
}
`;

/** Returns the embedded exporter script. */
function loadScriptContent() {
  return EXPORT_SCRIPT_CONTENT;
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
  // Lookback window in days (0 = no limit); coerced to a safe non-negative integer.
  const lookbackDays = Math.max(0, Math.floor(Number((exportConfig && exportConfig.lookbackDays) || 0)) || 0);

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
      '-LookbackDays', String(lookbackDays),
    ];
    const { stdout } = await runPowerShell(args);
    return parseExportResult(stdout);
  } catch (execError) {
    const combinedOutput = (execError.stdout || '') + (execError.stderr || '');
    // The script may still have printed a result marker before a non-zero exit — prefer it when present.
    if (combinedOutput.includes(RESULT_MARKER)) {
      return parseExportResult(combinedOutput);
    }
    // Surface the ACTUAL PowerShell error (stderr) — otherwise all we get is "Command failed", which hides
    // the reason (e.g. an execution-policy or Constrained-Language-Mode block on locked-down machines).
    const stderrDetail = String(execError.stderr || '').replace(/\s+/g, ' ').trim().slice(0, 600);
    return {
      ok: false,
      exportedCount: 0,
      total: 0,
      message: 'Outlook export failed: ' + (stderrDetail || execError.message || String(execError)),
    };
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
