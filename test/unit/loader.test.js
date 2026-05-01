// test/unit/config.test.js — Unit tests for the configuration loader module.
// Tests config loading from file, environment variable overrides, and disk persistence.

'use strict';

const path = require('path');

// Mock the filesystem before requiring the module under test so we can
// control what the loader "sees" without touching real files on disk.
jest.mock('fs');
const fsMock = require('fs');

const {
  loadConfig,
  isServiceConfigured,
  createConfigTemplate,
} = require('../../src/config/loader');

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Resets all fs mocks and environment variables between tests. */
function resetEnvironment() {
  jest.resetAllMocks();
  // Remove all TBX_* environment variables that might bleed between tests
  const envKeysToRemove = [
    'TBX_PORT', 'TBX_JIRA_URL', 'JIRA_PAT', 'TBX_JIRA_PAT',
    'JIRA_USERNAME', 'JIRA_API_TOKEN', 'JIRA_PASSWORD',
    'TBX_SNOW_URL', 'SERVICE_NOW_USERNAME', 'SERVICE_NOW_PASSWORD',
    'GITHUB_TOKEN', 'TBX_GITHUB_TOKEN', 'TBX_SSL_VERIFY',
  ];
  envKeysToRemove.forEach((envKey) => delete process.env[envKey]);
}

// ── loadConfig() ─────────────────────────────────────────────────────────────

describe('loadConfig()', () => {
  beforeEach(resetEnvironment);

  it('returns safe defaults when no config file and no env vars exist', () => {
    fsMock.existsSync.mockReturnValue(false);

    const configuration = loadConfig();

    expect(configuration.port).toBe(5555);
    expect(configuration.sslVerify).toBe(true);
    expect(configuration.jira.baseUrl).toBe('');
    expect(configuration.snow.baseUrl).toBe('');
    expect(configuration.github.baseUrl).toBe('https://api.github.com');
    expect(configuration.github.pat).toBe('');
  });

  it('loads values from a valid toolbox-proxy.json file', () => {
    const sampleConfig = {
      port: 8080,
      jira: { baseUrl: 'https://jira.example.com', pat: 'jira-pat-abc' },
      snow: { baseUrl: 'https://snow.example.com', username: 'user', password: 'pass' },
      github: { pat: 'gh-pat-xyz' },
    };
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify(sampleConfig));

    const configuration = loadConfig();

    expect(configuration.port).toBe(8080);
    expect(configuration.jira.baseUrl).toBe('https://jira.example.com');
    expect(configuration.jira.pat).toBe('jira-pat-abc');
    expect(configuration.snow.username).toBe('user');
    expect(configuration.github.pat).toBe('gh-pat-xyz');
  });

  it('strips trailing slashes from base URLs', () => {
    const sampleConfig = {
      jira: { baseUrl: 'https://jira.example.com///' },
      snow: { baseUrl: 'https://snow.example.com/' },
    };
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify(sampleConfig));

    const configuration = loadConfig();

    expect(configuration.jira.baseUrl).toBe('https://jira.example.com');
    expect(configuration.snow.baseUrl).toBe('https://snow.example.com');
  });

  it('environment variables override config file values', () => {
    const sampleConfig = { jira: { baseUrl: 'https://jira.example.com', pat: 'file-pat' } };
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify(sampleConfig));

    process.env.TBX_JIRA_PAT = 'env-pat-override';
    process.env.GITHUB_TOKEN = 'gh-token-from-env';

    const configuration = loadConfig();

    expect(configuration.jira.pat).toBe('env-pat-override');
    expect(configuration.github.pat).toBe('gh-token-from-env');
  });

  it('TBX_SSL_VERIFY=false disables cert verification', () => {
    fsMock.existsSync.mockReturnValue(false);
    process.env.TBX_SSL_VERIFY = 'false';

    const configuration = loadConfig();

    expect(configuration.sslVerify).toBe(false);
  });

  it('TBX_SSL_VERIFY=0 also disables cert verification', () => {
    fsMock.existsSync.mockReturnValue(false);
    process.env.TBX_SSL_VERIFY = '0';

    const configuration = loadConfig();

    expect(configuration.sslVerify).toBe(false);
  });

  it('handles malformed JSON in config file gracefully', () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue('{ this is not valid json }');

    // Should not throw — returns safe defaults when file is corrupt
    expect(() => loadConfig()).not.toThrow();
    const configuration = loadConfig();
    expect(configuration.port).toBe(5555);
  });

  it('initializes scheduler repoMonitor defaults when not configured', () => {
    fsMock.existsSync.mockReturnValue(false);

    const configuration = loadConfig();

    expect(configuration.scheduler.repoMonitor.enabled).toBe(false);
    expect(Array.isArray(configuration.scheduler.repoMonitor.repos)).toBe(true);
    expect(configuration.scheduler.repoMonitor.intervalMin).toBe(15);
  });

  it('uses TBX_PORT environment variable for port', () => {
    fsMock.existsSync.mockReturnValue(false);
    process.env.TBX_PORT = '9999';

    const configuration = loadConfig();

    expect(configuration.port).toBe(9999);
  });
});

// ── isServiceConfigured() ────────────────────────────────────────────────────

describe('isServiceConfigured()', () => {
  it('returns false when baseUrl is empty', () => {
    expect(isServiceConfigured({ baseUrl: '' })).toBe(false);
  });

  it('returns false when baseUrl contains placeholder text', () => {
    expect(isServiceConfigured({ baseUrl: 'https://your-instance.atlassian.net' })).toBe(false);
    expect(isServiceConfigured({ baseUrl: 'https://your-jira.atlassian.net' })).toBe(false);
  });

  it('returns true for a real base URL', () => {
    expect(isServiceConfigured({ baseUrl: 'https://acme.atlassian.net' })).toBe(true);
  });
});

// ── createConfigTemplate() ───────────────────────────────────────────────────

describe('createConfigTemplate()', () => {
  beforeEach(resetEnvironment);

  it('does not create a file if one already exists', () => {
    fsMock.existsSync.mockReturnValue(true);

    createConfigTemplate();

    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
  });

  it('writes a template file when no config exists', () => {
    fsMock.existsSync.mockReturnValue(false);
    fsMock.writeFileSync.mockImplementation(() => {});

    createConfigTemplate();

    expect(fsMock.writeFileSync).toHaveBeenCalledTimes(1);
    const writtenContent = fsMock.writeFileSync.mock.calls[0][1];
    const parsedTemplate = JSON.parse(writtenContent);
    expect(parsedTemplate.port).toBe(5555);
    expect(parsedTemplate.jira).toBeDefined();
    expect(parsedTemplate.snow).toBeDefined();
    expect(parsedTemplate.github).toBeDefined();
  });

  it('handles writeFileSync errors without crashing', () => {
    fsMock.existsSync.mockReturnValue(false);
    fsMock.writeFileSync.mockImplementation(() => { throw new Error('disk full'); });

    expect(() => createConfigTemplate()).not.toThrow();
  });
});
