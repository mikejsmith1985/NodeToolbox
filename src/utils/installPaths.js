// src/utils/installPaths.js — Shared path helpers for the durable NodeToolbox install layout.
//
// The user launches a stable top-level folder, while the actual app payload lives
// in versions\<version>. current.txt selects which payload starts after reboot.

'use strict';

const fs = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

/** Folder containing immutable per-version app payloads. */
const VERSIONS_DIRECTORY_NAME = 'versions';

/** File that stores the active version selected by Admin Hub updates. */
const CURRENT_VERSION_POINTER_FILENAME = 'current.txt';

/** Fixed executable name inside every version folder. */
const PAYLOAD_EXECUTABLE_FILENAME = 'nodetoolbox.exe';

/** Stable hidden launcher users double-click from the top-level install folder. */
const SILENT_LAUNCHER_FILENAME = 'Launch Toolbox Silent.vbs';

/** Stable visible diagnostic launcher users can run when startup fails. */
const BATCH_LAUNCHER_FILENAME = 'Launch Toolbox.bat';

/** Temporary pointer suffix used so current.txt is never half-written. */
const TEMPORARY_POINTER_SUFFIX = '.new';

// ── Version helpers ──────────────────────────────────────────────────────────

/**
 * Normalizes release versions so filesystem folders and current.txt never use a leading v.
 *
 * @param {string} version - Version from a GitHub tag or package.json.
 * @returns {string} Normalized semantic version.
 */
function normalizeVersion(version) {
  return String(version || '').trim().replace(/^v/i, '');
}

/**
 * Compares two semantic version strings in ascending order.
 *
 * @param {string} firstVersion - First semantic version.
 * @param {string} secondVersion - Second semantic version.
 * @returns {number} Negative, zero, or positive comparison result.
 */
function compareSemanticVersions(firstVersion, secondVersion) {
  const firstParts = normalizeVersion(firstVersion).split('.').map((part) => Number(part) || 0);
  const secondParts = normalizeVersion(secondVersion).split('.').map((part) => Number(part) || 0);
  const longestPartCount = Math.max(firstParts.length, secondParts.length);

  for (let i = 0; i < longestPartCount; i += 1) {
    const firstPart = firstParts[i] || 0;
    const secondPart = secondParts[i] || 0;
    if (firstPart !== secondPart) {
      return firstPart - secondPart;
    }
  }

  return 0;
}

// ── Install root resolution ──────────────────────────────────────────────────

/**
 * Resolves the stable top-level install folder from an executable path.
 * Versioned payloads live under installRoot\versions\<version>\nodetoolbox.exe;
 * legacy flat installs keep the executable directly in installRoot.
 *
 * @param {string} executablePath - Absolute path to the running executable.
 * @returns {string} Stable install root path.
 */
function resolveInstallRootFromExecutablePath(executablePath) {
  const executableDirectory = path.dirname(path.resolve(executablePath));
  const versionDirectory = path.basename(executableDirectory);
  const versionsDirectory = path.dirname(executableDirectory);
  const versionsDirectoryName = path.basename(versionsDirectory).toLowerCase();

  if (versionsDirectoryName === VERSIONS_DIRECTORY_NAME && versionDirectory !== '') {
    return path.dirname(versionsDirectory);
  }

  return executableDirectory;
}

/**
 * Resolves the stable install root for the current process.
 *
 * @returns {string} Stable install root path.
 */
function resolveCurrentInstallRoot() {
  if (process.pkg) {
    return resolveInstallRootFromExecutablePath(process.execPath);
  }

  if (process.argv[1]) {
    return path.dirname(path.resolve(process.argv[1]));
  }

  return path.join(__dirname, '..', '..');
}

// ── Durable layout paths ─────────────────────────────────────────────────────

/**
 * Returns the versions directory under a stable install root.
 *
 * @param {string} installRoot - Stable top-level install directory.
 * @returns {string} Absolute versions directory path.
 */
function resolveVersionsDirectory(installRoot) {
  return path.join(installRoot, VERSIONS_DIRECTORY_NAME);
}

/**
 * Returns the version directory for a specific payload version.
 *
 * @param {string} installRoot - Stable top-level install directory.
 * @param {string} version - Release version.
 * @returns {string} Absolute payload directory path.
 */
function resolveVersionDirectory(installRoot, version) {
  return path.join(resolveVersionsDirectory(installRoot), normalizeVersion(version));
}

/**
 * Returns the fixed executable path for a specific payload version.
 *
 * @param {string} installRoot - Stable top-level install directory.
 * @param {string} version - Release version.
 * @returns {string} Absolute payload executable path.
 */
function resolvePayloadExecutablePath(installRoot, version) {
  return path.join(resolveVersionDirectory(installRoot, version), PAYLOAD_EXECUTABLE_FILENAME);
}

/**
 * Returns the current-version pointer file path.
 *
 * @param {string} installRoot - Stable top-level install directory.
 * @returns {string} Absolute current.txt path.
 */
function resolveCurrentPointerPath(installRoot) {
  return path.join(installRoot, CURRENT_VERSION_POINTER_FILENAME);
}

/**
 * Returns the stable hidden launcher path.
 *
 * @param {string} installRoot - Stable top-level install directory.
 * @returns {string} Absolute VBScript path.
 */
function resolveSilentLauncherPath(installRoot) {
  return path.join(installRoot, SILENT_LAUNCHER_FILENAME);
}

/**
 * Returns the stable visible launcher path.
 *
 * @param {string} installRoot - Stable top-level install directory.
 * @returns {string} Absolute batch file path.
 */
function resolveBatchLauncherPath(installRoot) {
  return path.join(installRoot, BATCH_LAUNCHER_FILENAME);
}

// ── Pointer and discovery helpers ────────────────────────────────────────────

/**
 * Reads the selected current version, returning null when no valid pointer exists.
 *
 * @param {string} installRoot - Stable top-level install directory.
 * @returns {string|null} Current version or null.
 */
function readCurrentVersion(installRoot) {
  const pointerPath = resolveCurrentPointerPath(installRoot);
  if (!fs.existsSync(pointerPath)) {
    return null;
  }

  const pointerValue = normalizeVersion(fs.readFileSync(pointerPath, 'utf8'));
  return pointerValue === '' ? null : pointerValue;
}

/**
 * Atomically writes the current version pointer.
 *
 * @param {string} installRoot - Stable top-level install directory.
 * @param {string} version - Version to select.
 * @returns {void}
 */
function writeCurrentVersion(installRoot, version) {
  const normalizedVersion = normalizeVersion(version);
  const pointerPath = resolveCurrentPointerPath(installRoot);
  const temporaryPointerPath = pointerPath + TEMPORARY_POINTER_SUFFIX;

  fs.mkdirSync(installRoot, { recursive: true });
  fs.writeFileSync(temporaryPointerPath, normalizedVersion + '\n', 'utf8');
  fs.renameSync(temporaryPointerPath, pointerPath);
}

/**
 * Finds the highest installed version folder using semantic version ordering.
 *
 * @param {string} installRoot - Stable top-level install directory.
 * @returns {string|null} Highest installed version or null.
 */
function findHighestInstalledVersion(installRoot) {
  const versionsDirectory = resolveVersionsDirectory(installRoot);
  if (!fs.existsSync(versionsDirectory)) {
    return null;
  }

  const installedVersions = fs.readdirSync(versionsDirectory, { withFileTypes: true })
    .filter((directoryEntry) => directoryEntry.isDirectory())
    .map((directoryEntry) => directoryEntry.name)
    .filter((version) => fs.existsSync(resolvePayloadExecutablePath(installRoot, version)));

  if (installedVersions.length === 0) {
    return null;
  }

  installedVersions.sort(compareSemanticVersions);
  return installedVersions[installedVersions.length - 1];
}

module.exports = {
  BATCH_LAUNCHER_FILENAME,
  CURRENT_VERSION_POINTER_FILENAME,
  PAYLOAD_EXECUTABLE_FILENAME,
  SILENT_LAUNCHER_FILENAME,
  VERSIONS_DIRECTORY_NAME,
  compareSemanticVersions,
  findHighestInstalledVersion,
  normalizeVersion,
  readCurrentVersion,
  resolveBatchLauncherPath,
  resolveCurrentInstallRoot,
  resolveCurrentPointerPath,
  resolveInstallRootFromExecutablePath,
  resolvePayloadExecutablePath,
  resolveSilentLauncherPath,
  resolveVersionDirectory,
  resolveVersionsDirectory,
  writeCurrentVersion,
};
