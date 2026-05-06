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
 * @returns {Promise<{ mode: 'exe'|'zip', newExecPath: string, newExecArgs: string[] }>}
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
    cwd:       process.cwd(),
    env:       process.env,
  });
  childProcess.unref();
  process.exit(0);
}

// ── Private helpers ──────────────────────────────────────────────────────────

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
 * object for exe-mode updates. The new exe is copied next to the currently
 * running exe so the user can launch it from the same familiar location.
 *
 * @param {string} version    - Target version string
 * @param {string} stagingDir - Directory where the exe-zip was extracted
 * @returns {{ mode: 'exe', newExecPath: string, newExecArgs: string[] }}
 */
function _buildExeUpdateResult(version, stagingDir) {
  const expectedExeName   = `nodetoolbox-v${version}.exe`;
  const stagedExePath     = path.join(stagingDir, expectedExeName);
  const currentExeDir     = path.dirname(process.execPath);
  const finalExePath      = path.join(currentExeDir, expectedExeName);

  if (!fs.existsSync(stagedExePath)) {
    throw new Error(`Expected exe not found after extraction: ${stagedExePath}`);
  }

  fs.copyFileSync(stagedExePath, finalExePath);

  return { mode: 'exe', newExecPath: finalExePath, newExecArgs: [] };
}

/**
 * Locates server.js inside the extracted zip directory, runs `npm ci` to
 * install production dependencies, and returns the result object for
 * zip/node-mode updates.
 *
 * @param {string} stagingDir - Directory where the source-zip was extracted
 * @returns {{ mode: 'zip', newExecPath: string, newExecArgs: string[] }}
 */
function _buildZipUpdateResult(stagingDir) {
  const serverPath = path.join(stagingDir, 'server.js');

  if (!fs.existsSync(serverPath)) {
    throw new Error(`server.js not found after extraction: ${serverPath}`);
  }

  // Install production dependencies in the freshly extracted directory
  execSync('npm ci --omit=dev', {
    cwd:         stagingDir,
    stdio:       'inherit',
    windowsHide: true,
  });

  return { mode: 'zip', newExecPath: process.execPath, newExecArgs: [serverPath] };
}

module.exports = {
  downloadFileToPath,
  extractZipWithPowerShell,
  prepareUpdate,
  spawnReplacementAndExit,
};
