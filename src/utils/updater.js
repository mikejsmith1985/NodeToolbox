// src/utils/updater.js — Server-side self-update utility for NodeToolbox.
//
// Downloads the appropriate GitHub release asset (exe-zip or source-zip),
// extracts it to a staging directory, and returns the path + args needed to
// spawn the replacement process. No new npm dependencies — extraction is done
// with PowerShell's built-in Expand-Archive (Windows 10+).

'use strict';

const https          = require('https');
const fs             = require('fs');
const path           = require('path');
const os             = require('os');
const { execSync }   = require('child_process');

// ── Constants ────────────────────────────────────────────────────────────────

/** GitHub repository that hosts NodeToolbox releases. */
const RELEASE_REPO = 'mikejsmith1985/NodeToolbox';

/** Base URL for GitHub release asset downloads. */
const GITHUB_RELEASES_BASE = 'https://github.com';

/** Prefix for the one-shot PowerShell script that applies a staged update after exit. */
const APPLY_UPDATE_SCRIPT_PREFIX = 'nodetoolbox-apply-update-';

/** Delay between process-exit checks in the detached update script. */
const UPDATE_EXIT_POLL_INTERVAL_MS = 250;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Downloads `url` to `destPath`, following up to 5 HTTP redirects.
 * Returns a Promise that resolves when the file has been fully written to disk.
 *
 * @param {string} url      - Full HTTPS URL to download
 * @param {string} destPath - Absolute path where the file should be saved
 * @returns {Promise<void>}
 */
function downloadFileToPath(url, destPath) {
  return new Promise((resolve, reject) => {
    _followRedirectsAndDownload(url, destPath, 0, resolve, reject);
  });
}

/**
 * Extracts `zipPath` into `targetDirectory` using PowerShell's Expand-Archive.
 * Overwrites existing files in the target directory.
 *
 * Windows 10+ has Expand-Archive built in — no 7-zip or node-unzipper needed.
 *
 * @param {string} zipPath         - Absolute path to the .zip archive
 * @param {string} targetDirectory - Directory where contents will be extracted
 * @returns {void}
 */
function extractZipWithPowerShell(zipPath, targetDirectory) {
  const escapedZip    = zipPath.replace(/'/g, "''");
  const escapedTarget = targetDirectory.replace(/'/g, "''");
  const psCommand     = `Expand-Archive -Path '${escapedZip}' -DestinationPath '${escapedTarget}' -Force`;

  execSync(`powershell -NoProfile -NonInteractive -Command "${psCommand}"`, {
    stdio: 'inherit',
    windowsHide: true,
  });
}

/**
 * Downloads and extracts the release asset for `version`, then returns the
 * information needed to spawn the replacement server process.
 *
 * Detection logic:
 *   - `process.pkg === true`  → running as a compiled exe → download exe-zip
 *   - otherwise               → running as Node.js source → download source-zip
 *
 * @param {string} version - Target release version, e.g. "0.2.9"
 * @returns {Promise<{ newExecPath: string, newExecArgs: string[] }>}
 */
async function prepareUpdate(version) {
  const isExeMode   = (process.pkg === true);
  const stagingDir  = path.join(os.tmpdir(), `nodetoolbox-update-v${version}`);
  const assetName   = isExeMode
    ? `nodetoolbox-v${version}-exe.zip`
    : `nodetoolbox-v${version}.zip`;
  const downloadUrl = `${GITHUB_RELEASES_BASE}/${RELEASE_REPO}/releases/download/v${version}/${assetName}`;
  const zipDest     = path.join(os.tmpdir(), assetName);

  // Wipe and recreate the staging directory for a clean extraction
  if (fs.existsSync(stagingDir)) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingDir, { recursive: true });

  await downloadFileToPath(downloadUrl, zipDest);
  extractZipWithPowerShell(zipDest, stagingDir);

  // Clean up the zip — we only need the extracted contents
  fs.rmSync(zipDest, { force: true });

  if (isExeMode) {
    return _buildExeUpdateResult(version, stagingDir);
  }
  return _buildZipUpdateResult(stagingDir);
}

/**
 * Spawns `newExecPath` with `newExecArgs` as a fully detached child process,
 * then calls `process.exit(0)` to terminate the current server.
 *
 * The replacement process inherits the current working directory and
 * environment so all config paths resolve identically.
 *
 * @param {string}   newExecPath - Path to the replacement executable or Node binary
 * @param {string[]} newExecArgs - Arguments to pass to the replacement process
 * @returns {void}
 */
function spawnReplacementAndExit(newExecPath, newExecArgs) {
  const childProcess = require('child_process').spawn(newExecPath, newExecArgs, {
    detached:  true,
    stdio:     'ignore',
    cwd:       resolveCurrentInstallRoot(),
    env:       process.env,
  });
  childProcess.unref();
  process.exit(0);
}

// ── Private helpers ──────────────────────────────────────────────────────────

/**
 * Returns the on-disk install root that should be updated in place.
 * In pkg mode this is the directory that contains the running exe.
 * In node/zip mode this is the directory that contains the launched server.js.
 *
 * @returns {string} Absolute install root path
 */
function resolveCurrentInstallRoot() {
  if (process.pkg === true) {
    return path.dirname(process.execPath);
  }

  if (process.argv[1]) {
    return path.dirname(path.resolve(process.argv[1]));
  }

  return path.join(__dirname, '..', '..');
}

/**
 * Escapes a string for single-quoted PowerShell literals.
 *
 * @param {string} value
 * @returns {string}
 */
function quotePowerShellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Converts a JavaScript string array into a PowerShell array literal.
 *
 * @param {string[]} values
 * @returns {string}
 */
function buildPowerShellArrayLiteral(values) {
  return `@(${values.map((value) => quotePowerShellString(value)).join(', ')})`;
}

/**
 * Writes the detached PowerShell update script and returns the command that
 * should be spawned after the current process exits.
 *
 * @param {{
 *   stagingDir: string,
 *   installRoot: string,
 *   launchPath: string,
 *   launchArgs: string[],
 *   currentExePath?: string | null,
 *   stagedExePath?: string | null
 * }} updatePlan
 * @returns {{ newExecPath: string, newExecArgs: string[] }}
 */
function buildApplyUpdateCommand(updatePlan) {
  const scriptPath = path.join(
    os.tmpdir(),
    `${APPLY_UPDATE_SCRIPT_PREFIX}${Date.now()}-${process.pid}.ps1`,
  );

  const updateScript = `
$ErrorActionPreference = 'Stop'

$currentPid = ${process.pid}
$installRoot = ${quotePowerShellString(updatePlan.installRoot)}
$stagingDir = ${quotePowerShellString(updatePlan.stagingDir)}
$launchPath = ${quotePowerShellString(updatePlan.launchPath)}
$launchArgs = ${buildPowerShellArrayLiteral(updatePlan.launchArgs)}
$exitPollIntervalMs = ${UPDATE_EXIT_POLL_INTERVAL_MS}
$currentExePath = ${quotePowerShellString(updatePlan.currentExePath || '')}
$stagedExePath = ${quotePowerShellString(updatePlan.stagedExePath || '')}

function Invoke-RobocopyMirror($sourcePath, $destinationPath) {
    if (-not (Test-Path -LiteralPath $sourcePath)) {
        return
    }

    New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
    robocopy $sourcePath $destinationPath /MIR /R:2 /W:1 /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "robocopy failed for $sourcePath"
    }
}

function Copy-ReleaseRootFiles($sourceRoot, $destinationRoot) {
    $rootFileNames = @(
        'server.js',
        'package.json',
        'package-lock.json',
        'README.md',
        '.env.example',
        'Launch Toolbox.bat',
        'Launch Toolbox Silent.vbs'
    )

    foreach ($rootFileName in $rootFileNames) {
        $sourceFilePath = Join-Path $sourceRoot $rootFileName
        if (Test-Path -LiteralPath $sourceFilePath) {
            Copy-Item -LiteralPath $sourceFilePath -Destination (Join-Path $destinationRoot $rootFileName) -Force
        }
    }
}

while (Get-Process -Id $currentPid -ErrorAction SilentlyContinue) {
    Start-Sleep -Milliseconds $exitPollIntervalMs
}

if ($stagedExePath -ne '') {
    if (-not (Test-Path -LiteralPath $stagedExePath)) {
        throw "Expected staged exe not found: $stagedExePath"
    }

    Copy-Item -LiteralPath $stagedExePath -Destination $currentExePath -Force

    $stagedLauncherPath = Join-Path $stagingDir 'Launch Toolbox Silent.vbs'
    if (Test-Path -LiteralPath $stagedLauncherPath) {
        Copy-Item -LiteralPath $stagedLauncherPath -Destination (Join-Path $installRoot 'Launch Toolbox Silent.vbs') -Force
    }

    Invoke-RobocopyMirror (Join-Path $stagingDir 'client\\dist') (Join-Path $installRoot 'client\\dist')
} else {
    Copy-ReleaseRootFiles $stagingDir $installRoot
    Invoke-RobocopyMirror (Join-Path $stagingDir 'src') (Join-Path $installRoot 'src')
    Invoke-RobocopyMirror (Join-Path $stagingDir 'scripts') (Join-Path $installRoot 'scripts')
    Invoke-RobocopyMirror (Join-Path $stagingDir 'client\\dist') (Join-Path $installRoot 'client\\dist')
    Invoke-RobocopyMirror (Join-Path $stagingDir 'node_modules') (Join-Path $installRoot 'node_modules')
}

Start-Process -FilePath $launchPath -ArgumentList $launchArgs -WorkingDirectory $installRoot -WindowStyle Hidden

try {
    if (Test-Path -LiteralPath $stagingDir) {
        Remove-Item -LiteralPath $stagingDir -Recurse -Force
    }
} catch {
    # A locked temp file should never block the relaunched app from coming back up.
}
`;

  fs.writeFileSync(scriptPath, updateScript, 'utf8');

  return {
    newExecPath: 'powershell',
    newExecArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
  };
}

/**
 * Recursively follows HTTP 3xx redirects then streams the final response body
 * to disk. GitHub's release download URLs always redirect at least once.
 *
 * @param {string}   url        - URL to fetch (may redirect)
 * @param {string}   destPath   - Destination file path
 * @param {number}   hopCount   - Number of redirects followed so far
 * @param {Function} resolve    - Promise resolve callback
 * @param {Function} reject     - Promise reject callback
 */
function _followRedirectsAndDownload(url, destPath, hopCount, resolve, reject) {
  const MAX_REDIRECTS = 10;

  if (hopCount > MAX_REDIRECTS) {
    return reject(new Error(`Too many redirects downloading ${url}`));
  }

  https.get(url, (response) => {
    // Follow redirects (GitHub sends 302 → S3 pre-signed URL)
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
      return _followRedirectsAndDownload(
        response.headers.location, destPath, hopCount + 1, resolve, reject,
      );
    }

    if (response.statusCode !== 200) {
      return reject(new Error(
        `Download failed — HTTP ${response.statusCode} for ${url}`,
      ));
    }

    const fileStream = fs.createWriteStream(destPath);
    response.pipe(fileStream);
    fileStream.on('finish', () => fileStream.close(resolve));
    fileStream.on('error', reject);
  }).on('error', reject);
}

/**
 * Locates the new .exe inside the staging directory and returns the result
 * object for exe-mode updates. The detached update script overwrites the
 * currently-launched exe path after shutdown so manual relaunches use the new
 * binary instead of falling back to the original download.
 *
 * @param {string} version    - Target version string
 * @param {string} stagingDir - Directory where the exe-zip was extracted
 * @returns {{ newExecPath: string, newExecArgs: string[] }}
 */
function _buildExeUpdateResult(version, stagingDir) {
  const expectedExeName   = `nodetoolbox-v${version}.exe`;
  const stagedExePath     = path.join(stagingDir, expectedExeName);
  const installRoot       = resolveCurrentInstallRoot();
  const currentExePath    = process.execPath;
  const launchArgs        = process.argv.slice(2);

  if (!fs.existsSync(stagedExePath)) {
    throw new Error(`Expected exe not found after extraction: ${stagedExePath}`);
  }

  return buildApplyUpdateCommand({
    stagingDir,
    installRoot,
    launchPath: currentExePath,
    launchArgs,
    currentExePath,
    stagedExePath,
  });
}

/**
 * Returns the result object for zip/node-mode updates. Production dependencies
 * are installed in staging first so any npm failure surfaces before the
 * running install is touched; the detached update script then copies the
 * fully-prepared release back into the original install directory in place.
 *
 * @param {string} stagingDir - Directory where the source-zip was extracted
 * @returns {{ newExecPath: string, newExecArgs: string[] }}
 */
function _buildZipUpdateResult(stagingDir) {
  const serverPath = path.join(stagingDir, 'server.js');
  const installRoot = resolveCurrentInstallRoot();
  const launchArgs = [path.join(installRoot, 'server.js'), ...process.argv.slice(2)];

  if (!fs.existsSync(serverPath)) {
    throw new Error(`server.js not found after extraction: ${serverPath}`);
  }

  execSync('npm ci --omit=dev', {
    cwd:         stagingDir,
    stdio:       'inherit',
    windowsHide: true,
  });

  return buildApplyUpdateCommand({
    stagingDir,
    installRoot,
    launchPath: process.execPath,
    launchArgs,
  });
}

module.exports = {
  downloadFileToPath,
  extractZipWithPowerShell,
  prepareUpdate,
  resolveCurrentInstallRoot,
  spawnReplacementAndExit,
  __testables: {
    buildApplyUpdateCommand,
    buildPowerShellArrayLiteral,
    quotePowerShellString,
  },
};
