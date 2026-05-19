// test/unit/installPaths.test.js — Unit tests for durable install path resolution.
//
// These tests protect the bootstrapper-style layout where users launch one
// stable folder and NodeToolbox runs the version selected by current.txt.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  findHighestInstalledVersion,
  normalizeVersion,
  readCurrentVersion,
  resolveInstallRootFromExecutablePath,
  resolvePayloadExecutablePath,
  writeCurrentVersion,
} = require('../../src/utils/installPaths');

describe('installPaths durable layout helpers', () => {
  let temporaryInstallRoot;

  beforeEach(() => {
    temporaryInstallRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nodetoolbox-install-paths-'));
  });

  afterEach(() => {
    fs.rmSync(temporaryInstallRoot, { recursive: true, force: true });
  });

  it('normalizes versions so pointer files never include a leading v', () => {
    expect(normalizeVersion('v0.9.41')).toBe('0.9.41');
    expect(normalizeVersion(' 0.9.42 ')).toBe('0.9.42');
  });

  it('resolves the stable install root from a versioned payload executable path', () => {
    const executablePath = path.join(
      temporaryInstallRoot,
      'versions',
      '0.9.41',
      'nodetoolbox.exe',
    );

    expect(resolveInstallRootFromExecutablePath(executablePath)).toBe(temporaryInstallRoot);
  });

  it('keeps flat legacy executable folders as the install root during migration', () => {
    const executablePath = path.join(temporaryInstallRoot, 'nodetoolbox-v0.9.40.exe');

    expect(resolveInstallRootFromExecutablePath(executablePath)).toBe(temporaryInstallRoot);
  });

  it('writes and reads the current version pointer atomically', () => {
    writeCurrentVersion(temporaryInstallRoot, 'v0.9.41');

    expect(readCurrentVersion(temporaryInstallRoot)).toBe('0.9.41');
  });

  it('resolves the fixed payload executable path for a selected version', () => {
    expect(resolvePayloadExecutablePath(temporaryInstallRoot, '0.9.41')).toBe(
      path.join(temporaryInstallRoot, 'versions', '0.9.41', 'nodetoolbox.exe'),
    );
  });

  it('finds the highest semantic version folder instead of relying on file timestamps', () => {
    fs.mkdirSync(path.join(temporaryInstallRoot, 'versions', '0.9.9'), { recursive: true });
    fs.mkdirSync(path.join(temporaryInstallRoot, 'versions', '0.9.41'), { recursive: true });
    fs.mkdirSync(path.join(temporaryInstallRoot, 'versions', '0.10.0'), { recursive: true });
    fs.writeFileSync(path.join(temporaryInstallRoot, 'versions', '0.9.9', 'nodetoolbox.exe'), '');
    fs.writeFileSync(path.join(temporaryInstallRoot, 'versions', '0.9.41', 'nodetoolbox.exe'), '');
    fs.writeFileSync(path.join(temporaryInstallRoot, 'versions', '0.10.0', 'nodetoolbox.exe'), '');

    expect(findHighestInstalledVersion(temporaryInstallRoot)).toBe('0.10.0');
  });
});
