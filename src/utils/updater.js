// src/utils/updater.js — Server-side durable self-update utility for NodeToolbox.
//
// Downloads the single release zip, stages the new payload under versions\<version>,
// flips current.txt, and relaunches through the stable VBScript bootstrapper. The
// running executable is never overwritten, which keeps updates reliable after reboot.

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const childProcess = require('child_process');
const { execSync } = childProcess;

const {
  BATCH_LAUNCHER_FILENAME,
  PAYLOAD_EXECUTABLE_FILENAME,
  SILENT_LAUNCHER_FILENAME,
  normalizeVersion,
  resolveCurrentInstallRoot: resolveDurableInstallRoot,
  resolvePayloadExecutablePath,
  resolveSilentLauncherPath,
  resolveVersionDirectory,
  writeCurrentVersion,
} = require('./installPaths');

// ── Constants ────────────────────────────────────────────────────────────────

/** GitHub repository that hosts NodeToolbox releases. */
const RELEASE_REPO = 'mikejsmith1985/NodeToolbox';

/** Base URL for GitHub release asset downloads. */
const GITHUB_RELEASES_BASE = 'https://github.com';

/** Prefix for a fully prepared update directory staged beside the live install. */
const STAGED_UPDATE_DIR_PREFIX = 'nodetoolbox-staged-update-';

/** Hidden launch flag used to identify updater-driven restart handoffs. */
const RESTART_HANDOFF_ARGUMENT = '--restart-handoff';

/** Single release asset suffix retained for compatibility with existing exe updaters. */
const SINGLE_RELEASE_ASSET_SUFFIX = '-exe.zip';

/** Legacy root exe prefix included in the release zip for old updaters. */
const LEGACY_EXE_PREFIX = 'nodetoolbox-v';

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Downloads `url` to `destPath`, following HTTP redirects.
 *
 * @param {string} url - Full HTTPS URL to download.
 * @param {string} destPath - Absolute path where the file should be saved.
 * @returns {Promise<void>}
 */
function downloadFileToPath(url, destPath) {
  return new Promise((resolve, reject) => {
    followRedirectsAndDownload(url, destPath, 0, resolve, reject);
  });
}

/**
 * Extracts `zipPath` into `targetDirectory` using PowerShell's Expand-Archive.
 *
 * @param {string} zipPath - Absolute path to the zip archive.
 * @param {string} targetDirectory - Directory where contents will be extracted.
 * @returns {void}
 */
function extractZipWithPowerShell(zipPath, targetDirectory) {
  const escapedZip = zipPath.replace(/'/g, "''");
  const escapedTarget = targetDirectory.replace(/'/g, "''");
  const powerShellCommand = `Expand-Archive -Path '${escapedZip}' -DestinationPath '${escapedTarget}' -Force`;

  execSync(`powershell -NoProfile -NonInteractive -Command "${powerShellCommand}"`, {
    stdio: 'inherit',
    windowsHide: true,
  });
}

/**
 * Downloads and installs a release version into the durable versions folder.
 *
 * @param {string} version - Target release version, e.g. "0.9.41".
 * @returns {Promise<{ newExecPath: string, newExecArgs: string[] }>}
 */
async function prepareUpdate(version) {
  const normalizedVersion = normalizeVersion(version);
  const installRoot = resolveCurrentInstallRoot();
  const { stagingDir } = createUpdateWorkspacePaths(normalizedVersion, installRoot);
  const assetName = buildSingleReleaseAssetName(normalizedVersion);
  const downloadUrl = `${GITHUB_RELEASES_BASE}/${RELEASE_REPO}/releases/download/v${normalizedVersion}/${assetName}`;
  const zipDestinationPath = path.join(os.tmpdir(), assetName);

  recreateDirectory(stagingDir);

  try {
    await downloadFileToPath(downloadUrl, zipDestinationPath);
    extractZipWithPowerShell(zipDestinationPath, stagingDir);
    installStagedRelease(normalizedVersion, stagingDir, installRoot);
    return buildBootstrapperLaunchCommand(installRoot);
  } finally {
    fs.rmSync(zipDestinationPath, { force: true });
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }
}

/**
 * Spawns `newExecPath` with `newExecArgs` as a fully detached child process.
 *
 * @param {string} newExecPath - Path to the replacement executable or launcher.
 * @param {string[]} newExecArgs - Arguments to pass to the replacement process.
 * @param {string} [workingDirectory] - Working directory for the detached process.
 * @returns {import('child_process').ChildProcess}
 */
function spawnDetachedProcess(
  newExecPath,
  newExecArgs,
  workingDirectory = resolveCurrentInstallRoot(),
) {
  const detachedProcess = childProcess.spawn(newExecPath, newExecArgs, {
    detached: true,
    stdio: 'ignore',
    cwd: workingDirectory,
    env: process.env,
    windowsHide: true,
  });
  detachedProcess.unref();
  return detachedProcess;
}

/**
 * Spawns the prepared replacement process and then exits the current server.
 *
 * @param {string} newExecPath - Path to the replacement launcher.
 * @param {string[]} newExecArgs - Arguments to pass to the replacement process.
 * @returns {void}
 */
function spawnReplacementAndExit(newExecPath, newExecArgs) {
  spawnDetachedProcess(newExecPath, newExecArgs);
  process.exit(0);
}

// ── Durable staging helpers ─────────────────────────────────────────────────

/**
 * Returns the stable on-disk install root.
 *
 * @returns {string} Stable install root path.
 */
function resolveCurrentInstallRoot() {
  return resolveDurableInstallRoot();
}

/** Returns true when NodeToolbox is running from a pkg-built executable. */
function isPkgRuntime() {
  return Boolean(process.pkg);
}

/**
 * Ensures updater-driven relaunches are marked so startup can use fail-fast logic.
 *
 * @param {string[]} launchArgs - Existing launch arguments.
 * @returns {string[]} Launch arguments with restart handoff included once.
 */
function ensureRestartHandoffArgument(launchArgs) {
  return launchArgs.includes(RESTART_HANDOFF_ARGUMENT)
    ? [...launchArgs]
    : [...launchArgs, RESTART_HANDOFF_ARGUMENT];
}

/**
 * Creates a same-volume staging path beside the live install root.
 *
 * @param {string} version - Target version.
 * @param {string} installRoot - Stable install root.
 * @returns {{ stagingDir: string }}
 */
function createUpdateWorkspacePaths(version, installRoot) {
  const installParentDirectory = path.dirname(installRoot);
  const uniqueSuffix = `${normalizeVersion(version)}-${Date.now()}-${process.pid}`;
  return {
    stagingDir: path.join(installParentDirectory, `${STAGED_UPDATE_DIR_PREFIX}${uniqueSuffix}`),
  };
}

/**
 * Copies a staged release into versions\<version> and selects it via current.txt.
 *
 * @param {string} version - Target version.
 * @param {string} stagingDir - Extracted release zip directory.
 * @param {string} installRoot - Stable install root.
 * @returns {void}
 */
function installStagedRelease(version, stagingDir, installRoot) {
  const normalizedVersion = normalizeVersion(version);
  const stagedVersionDirectory = resolveStagedVersionDirectory(stagingDir, normalizedVersion);
  const targetVersionDirectory = resolveVersionDirectory(installRoot, normalizedVersion);
  const targetExecutablePath = resolvePayloadExecutablePath(installRoot, normalizedVersion);

  if (!fs.existsSync(path.join(stagedVersionDirectory, PAYLOAD_EXECUTABLE_FILENAME))) {
    throw new Error(`Release payload missing ${PAYLOAD_EXECUTABLE_FILENAME} for v${normalizedVersion}`);
  }

  fs.rmSync(targetVersionDirectory, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(targetVersionDirectory), { recursive: true });
  fs.cpSync(stagedVersionDirectory, targetVersionDirectory, { recursive: true });

  if (!fs.existsSync(targetExecutablePath)) {
    throw new Error(`Installed payload missing after copy: ${targetExecutablePath}`);
  }

  copyStableLauncherIfPresent(stagingDir, installRoot, SILENT_LAUNCHER_FILENAME);
  copyStableLauncherIfPresent(stagingDir, installRoot, BATCH_LAUNCHER_FILENAME);
  writeCurrentVersion(installRoot, normalizedVersion);
}

/**
 * Builds the stable bootstrapper command used after an update is staged.
 *
 * @param {string} installRoot - Stable install root.
 * @returns {{ newExecPath: string, newExecArgs: string[] }}
 */
function buildBootstrapperLaunchCommand(installRoot) {
  return {
    newExecPath: 'wscript.exe',
    newExecArgs: ensureRestartHandoffArgument([resolveSilentLauncherPath(installRoot)]),
  };
}

// ── Private helpers ──────────────────────────────────────────────────────────

/**
 * Builds the single user-facing release asset name.
 *
 * @param {string} version - Normalized release version.
 * @returns {string} Release zip asset name.
 */
function buildSingleReleaseAssetName(version) {
  return `${LEGACY_EXE_PREFIX}${normalizeVersion(version)}${SINGLE_RELEASE_ASSET_SUFFIX}`;
}

/**
 * Recreates a directory from scratch.
 *
 * @param {string} directoryPath - Directory to recreate.
 * @returns {void}
 */
function recreateDirectory(directoryPath) {
  fs.rmSync(directoryPath, { recursive: true, force: true });
  fs.mkdirSync(directoryPath, { recursive: true });
}

/**
 * Resolves the staged version folder, including legacy one-exe release layouts.
 *
 * @param {string} stagingDir - Extracted release directory.
 * @param {string} version - Normalized release version.
 * @returns {string} Directory containing nodetoolbox.exe.
 */
function resolveStagedVersionDirectory(stagingDir, version) {
  const durableVersionDirectory = path.join(stagingDir, 'versions', version);
  if (fs.existsSync(path.join(durableVersionDirectory, PAYLOAD_EXECUTABLE_FILENAME))) {
    return durableVersionDirectory;
  }

  const legacyExecutablePath = path.join(stagingDir, `${LEGACY_EXE_PREFIX}${version}.exe`);
  if (!fs.existsSync(legacyExecutablePath)) {
    return durableVersionDirectory;
  }

  const migratedVersionDirectory = path.join(stagingDir, 'legacy-version-payload', version);
  recreateDirectory(migratedVersionDirectory);
  fs.copyFileSync(legacyExecutablePath, path.join(migratedVersionDirectory, PAYLOAD_EXECUTABLE_FILENAME));

  const legacyClientDistDirectory = path.join(stagingDir, 'client', 'dist');
  if (fs.existsSync(legacyClientDistDirectory)) {
    fs.cpSync(
      legacyClientDistDirectory,
      path.join(migratedVersionDirectory, 'client', 'dist'),
      { recursive: true },
    );
  }

  return migratedVersionDirectory;
}

/**
 * Copies a stable top-level launcher from a staged release when present.
 *
 * @param {string} stagingDir - Extracted release directory.
 * @param {string} installRoot - Stable install root.
 * @param {string} launcherFilename - Launcher filename.
 * @returns {void}
 */
function copyStableLauncherIfPresent(stagingDir, installRoot, launcherFilename) {
  const stagedLauncherPath = path.join(stagingDir, launcherFilename);
  if (!fs.existsSync(stagedLauncherPath)) {
    return;
  }

  fs.copyFileSync(stagedLauncherPath, path.join(installRoot, launcherFilename));
}

/**
 * Recursively follows HTTP 3xx redirects then streams the final response body to disk.
 *
 * @param {string} url - URL to fetch.
 * @param {string} destPath - Destination file path.
 * @param {number} hopCount - Number of redirects followed so far.
 * @param {Function} resolve - Promise resolve callback.
 * @param {Function} reject - Promise reject callback.
 * @returns {void}
 */
function followRedirectsAndDownload(url, destPath, hopCount, resolve, reject) {
  const maxRedirects = 10;

  if (hopCount > maxRedirects) {
    reject(new Error(`Too many redirects downloading ${url}`));
    return;
  }

  https.get(url, (downloadResponse) => {
    if (downloadResponse.statusCode >= 300 && downloadResponse.statusCode < 400 && downloadResponse.headers.location) {
      downloadResponse.resume();
      followRedirectsAndDownload(downloadResponse.headers.location, destPath, hopCount + 1, resolve, reject);
      return;
    }

    if (downloadResponse.statusCode !== 200) {
      downloadResponse.resume();
      reject(new Error(`Download failed — HTTP ${downloadResponse.statusCode} for ${url}`));
      return;
    }

    const fileStream = fs.createWriteStream(destPath);
    downloadResponse.on('error', reject);
    downloadResponse.pipe(fileStream);
    fileStream.on('finish', () => fileStream.close(resolve));
    fileStream.on('error', reject);
  }).on('error', reject);
}

module.exports = {
  downloadFileToPath,
  extractZipWithPowerShell,
  prepareUpdate,
  resolveCurrentInstallRoot,
  spawnDetachedProcess,
  spawnReplacementAndExit,
  __testables: {
    buildBootstrapperLaunchCommand,
    buildSingleReleaseAssetName,
    createUpdateWorkspacePaths,
    ensureRestartHandoffArgument,
    installStagedRelease,
    isPkgRuntime,
    resolveStagedVersionDirectory,
  },
};
