// test/unit/updater.test.js — Unit tests for durable self-update staging.
//
// These tests verify that Admin Hub updates install a new version beside the
// running payload and flip current.txt instead of overwriting the active exe.

'use strict';

const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const { downloadFileToPath, resolveCurrentInstallRoot, __testables } = require('../../src/utils/updater');

describe('updater durable version staging', () => {
  let temporaryInstallRoot;
  let temporaryStagingRoot;

  beforeEach(() => {
    temporaryInstallRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nodetoolbox-install-'));
    temporaryStagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nodetoolbox-staging-'));
  });

  afterEach(() => {
    fs.rmSync(temporaryInstallRoot, { recursive: true, force: true });
    fs.rmSync(temporaryStagingRoot, { recursive: true, force: true });
  });

  it('installs a staged release into versions and flips current.txt without touching old payloads', () => {
    const oldPayloadPath = path.join(temporaryInstallRoot, 'versions', '0.9.40', 'nodetoolbox.exe');
    const stagedPayloadDirectory = path.join(temporaryStagingRoot, 'versions', '0.9.41');
    fs.mkdirSync(path.dirname(oldPayloadPath), { recursive: true });
    fs.mkdirSync(stagedPayloadDirectory, { recursive: true });
    fs.writeFileSync(oldPayloadPath, 'old exe');
    fs.writeFileSync(path.join(stagedPayloadDirectory, 'nodetoolbox.exe'), 'new exe');
    fs.writeFileSync(path.join(temporaryStagingRoot, 'Launch Toolbox Silent.vbs'), "' launcher");
    fs.writeFileSync(path.join(temporaryStagingRoot, 'Launch Toolbox.bat'), '@echo off');

    __testables.installStagedRelease('v0.9.41', temporaryStagingRoot, temporaryInstallRoot);

    expect(fs.readFileSync(oldPayloadPath, 'utf8')).toBe('old exe');
    expect(fs.readFileSync(
      path.join(temporaryInstallRoot, 'versions', '0.9.41', 'nodetoolbox.exe'),
      'utf8',
    )).toBe('new exe');
    expect(fs.readFileSync(path.join(temporaryInstallRoot, 'current.txt'), 'utf8').trim()).toBe('0.9.41');
    expect(fs.existsSync(path.join(temporaryInstallRoot, 'Launch Toolbox Silent.vbs'))).toBe(true);
    expect(fs.existsSync(path.join(temporaryInstallRoot, 'Launch Toolbox.bat'))).toBe(true);
  });

  it('creates same-volume staging directories beside the stable install root', () => {
    const workspacePaths = __testables.createUpdateWorkspacePaths('1.2.3', 'C:\\Apps\\NodeToolbox');

    expect(workspacePaths.stagingDir).toContain('C:\\Apps\\nodetoolbox-staged-update-1.2.3-');
    expect(workspacePaths.backupRoot).toBeUndefined();
  });

  it('appends the hidden restart handoff flag to relaunch arguments exactly once', () => {
    expect(__testables.ensureRestartHandoffArgument(['--open'])).toEqual([
      '--open',
      '--restart-handoff',
    ]);
    expect(
      __testables.ensureRestartHandoffArgument(['--open', '--restart-handoff']),
    ).toEqual(['--open', '--restart-handoff']);
  });

  it('launches the stable silent bootstrapper after installing an update', () => {
    const launchCommand = __testables.buildBootstrapperLaunchCommand('C:\\Apps\\NodeToolbox');

    expect(launchCommand.newExecPath).toBe('wscript.exe');
    expect(launchCommand.newExecArgs[0]).toBe('C:\\Apps\\NodeToolbox\\Launch Toolbox Silent.vbs');
    expect(launchCommand.newExecArgs).toContain('--restart-handoff');
  });
});

describe('updater install-root detection', () => {
  const originalProcessArgv = [...process.argv];
  const originalProcessExecPath = process.execPath;
  const originalProcessPkg = process.pkg;

  afterEach(() => {
    process.argv = [...originalProcessArgv];
    Object.defineProperty(process, 'execPath', {
      configurable: true,
      value: originalProcessExecPath,
      writable: true,
    });

    if (typeof originalProcessPkg === 'undefined') {
      delete process.pkg;
    } else {
      process.pkg = originalProcessPkg;
    }
  });

  it('treats a truthy process.pkg object as exe mode', () => {
    process.pkg = {};

    expect(__testables.isPkgRuntime()).toBe(true);
  });

  it('uses the stable top-level folder when running from versions/current payload', () => {
    process.pkg = {};
    Object.defineProperty(process, 'execPath', {
      configurable: true,
      value: 'C:\\Apps\\NodeToolbox\\versions\\0.9.41\\nodetoolbox.exe',
      writable: true,
    });
    process.argv = [process.execPath];

    expect(resolveCurrentInstallRoot()).toBe('C:\\Apps\\NodeToolbox');
  });

  it('keeps the flat executable folder as the install root for legacy installs', () => {
    process.pkg = {};
    Object.defineProperty(process, 'execPath', {
      configurable: true,
      value: 'C:\\Apps\\NodeToolbox\\nodetoolbox-v0.9.40.exe',
      writable: true,
    });
    process.argv = [process.execPath];

    expect(resolveCurrentInstallRoot()).toBe('C:\\Apps\\NodeToolbox');
  });
});

describe('updater download hardening', () => {
  let temporaryDownloadPath;

  beforeEach(() => {
    temporaryDownloadPath = path.join(os.tmpdir(), `nodetoolbox-download-${Date.now()}-${process.pid}.zip`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(temporaryDownloadPath, { force: true });
  });

  it('rejects response body stream errors instead of crashing the server', async () => {
    const requestEmitter = new EventEmitter();
    const responseEmitter = new EventEmitter();
    responseEmitter.statusCode = 200;
    responseEmitter.headers = {};
    responseEmitter.pipe = jest.fn();

    jest.spyOn(https, 'get').mockImplementation((_url, responseHandler) => {
      process.nextTick(() => {
        responseHandler(responseEmitter);
        responseEmitter.emit('error', new Error('body stream dropped'));
      });
      return requestEmitter;
    });

    await expect(downloadFileToPath('https://example.com/release.zip', temporaryDownloadPath))
      .rejects
      .toThrow('body stream dropped');
    expect(responseEmitter.listenerCount('error')).toBeGreaterThan(0);
  });

  it('drains non-success responses so update download sockets are released', async () => {
    const requestEmitter = new EventEmitter();
    const responseEmitter = new EventEmitter();
    responseEmitter.statusCode = 500;
    responseEmitter.headers = {};
    responseEmitter.resume = jest.fn();

    jest.spyOn(https, 'get').mockImplementation((_url, responseHandler) => {
      process.nextTick(() => responseHandler(responseEmitter));
      return requestEmitter;
    });

    await expect(downloadFileToPath('https://example.com/release.zip', temporaryDownloadPath))
      .rejects
      .toThrow('Download failed');
    expect(responseEmitter.resume).toHaveBeenCalled();
  });
});
