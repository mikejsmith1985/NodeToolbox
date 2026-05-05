// test/unit/loader.test.js — Unit tests for the configuration loader module.
// Tests config loading from file, environment variable overrides, disk persistence,
// credential obfuscation, and config migration from the legacy co-located location.

'use strict';

const path = require('path');
const os   = require('os');

// Mock the filesystem before requiring the module under test so we can
// control what the loader "sees" without touching real files on disk.
jest.mock('fs');
const fsMock = require('fs');

const {
  loadConfig,
  isServiceConfigured,
  isServiceBaseUrlSet,
  createConfigTemplate,
  migrateOldConfig,
  CONFIG_FILE_PATH,
  CONFIG_DIR_PATH,
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
    expect(configuration.sslVerify).toBe(false);
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

// ── isServiceBaseUrlSet() ─────────────────────────────────────────────────────

describe('isServiceBaseUrlSet()', () => {
  it('returns false when baseUrl is empty', () => {
    expect(isServiceBaseUrlSet({ baseUrl: '' })).toBe(false);
  });

  it('returns false when baseUrl contains placeholder text', () => {
    expect(isServiceBaseUrlSet({ baseUrl: 'https://your-instance.atlassian.net' })).toBe(false);
    expect(isServiceBaseUrlSet({ baseUrl: 'https://your-jira.atlassian.net' })).toBe(false);
  });

  it('returns true for a real base URL even without credentials', () => {
    expect(isServiceBaseUrlSet({ baseUrl: 'https://acme.atlassian.net' })).toBe(true);
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

  it('returns false when baseUrl is real but credentials are missing', () => {
    expect(isServiceConfigured({ baseUrl: 'https://acme.atlassian.net' })).toBe(false);
    expect(isServiceConfigured({ baseUrl: 'https://acme.atlassian.net', pat: '' })).toBe(false);
  });

  it('returns true when baseUrl is real and at least one credential is present', () => {
    expect(isServiceConfigured({ baseUrl: 'https://acme.atlassian.net', pat: 'token123' })).toBe(true);
    expect(isServiceConfigured({ baseUrl: 'https://snow.example.com', apiToken: 'tok' })).toBe(true);
    expect(isServiceConfigured({ baseUrl: 'https://snow.example.com', password: 'pw' })).toBe(true);
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

  it('creates the AppData config directory before writing the template', () => {
    // The config directory may not exist on a fresh machine — it must be created first.
    fsMock.existsSync.mockReturnValue(false);
    fsMock.mkdirSync.mockImplementation(() => {});
    fsMock.writeFileSync.mockImplementation(() => {});

    createConfigTemplate();

    expect(fsMock.mkdirSync).toHaveBeenCalledWith(CONFIG_DIR_PATH, { recursive: true });
  });
});

// ── CONFIG_FILE_PATH & CONFIG_DIR_PATH ────────────────────────────────────────

describe('CONFIG_FILE_PATH', () => {
  it('points to a toolbox-proxy.json inside the NodeToolbox AppData folder', () => {
    const expectedDir = path.join(process.env.APPDATA || os.homedir(), 'NodeToolbox');
    expect(CONFIG_FILE_PATH).toBe(path.join(expectedDir, 'toolbox-proxy.json'));
  });

  it('CONFIG_DIR_PATH is the parent directory of CONFIG_FILE_PATH', () => {
    expect(CONFIG_DIR_PATH).toBe(path.dirname(CONFIG_FILE_PATH));
  });
});

// ── Credential Obfuscation ────────────────────────────────────────────────────

describe('saveConfigToDisk() — obfuscation', () => {
  beforeEach(resetEnvironment);

  it('stores credential fields as base64, not plaintext', () => {
    const { saveConfigToDisk } = require('../../src/config/loader');
    fsMock.existsSync.mockReturnValue(true);
    fsMock.mkdirSync.mockImplementation(() => {});

    let writtenContent;
    fsMock.writeFileSync.mockImplementation((_filePath, content) => {
      writtenContent = content;
    });

    saveConfigToDisk({
      port: 5555,
      sslVerify: true,
      jira:   { baseUrl: 'https://jira.example.com', username: 'alice', apiToken: 'my-api-token', pat: 'my-jira-pat' },
      snow:   { baseUrl: 'https://snow.example.com', username: 'bob',   password: 'secret-pass' },
      github: { baseUrl: 'https://api.github.com',   pat: 'ghp-token' },
      scheduler: { repoMonitor: { enabled: false, repos: [], branchPattern: '', intervalMin: 15, transitions: {}, seenBranches: {}, seenCommits: {}, seenPrs: {} } },
    });

    const savedData = JSON.parse(writtenContent);

    // Non-credential fields should still be plaintext
    expect(savedData._obfuscated).toBe(true);
    expect(savedData.jira.baseUrl).toBe('https://jira.example.com');

    // Credential fields must NOT match the original plaintext
    expect(savedData.jira.pat).not.toBe('my-jira-pat');
    expect(savedData.jira.apiToken).not.toBe('my-api-token');
    expect(savedData.jira.username).not.toBe('alice');
    expect(savedData.snow.username).not.toBe('bob');
    expect(savedData.snow.password).not.toBe('secret-pass');
    expect(savedData.github.pat).not.toBe('ghp-token');

    // And the encoded values must decode back to the originals
    expect(Buffer.from(savedData.jira.pat,      'base64').toString('utf8')).toBe('my-jira-pat');
    expect(Buffer.from(savedData.jira.apiToken, 'base64').toString('utf8')).toBe('my-api-token');
    expect(Buffer.from(savedData.jira.username, 'base64').toString('utf8')).toBe('alice');
    expect(Buffer.from(savedData.snow.username, 'base64').toString('utf8')).toBe('bob');
    expect(Buffer.from(savedData.snow.password, 'base64').toString('utf8')).toBe('secret-pass');
    expect(Buffer.from(savedData.github.pat,    'base64').toString('utf8')).toBe('ghp-token');
  });
});

describe('loadConfig() — deobfuscation', () => {
  beforeEach(resetEnvironment);

  it('decodes base64 credentials from an obfuscated config file', () => {
    const obfuscatedConfig = {
      _obfuscated: true,
      port: 5555,
      jira:   { baseUrl: 'https://jira.example.com', username: Buffer.from('alice').toString('base64'), pat: Buffer.from('my-pat').toString('base64'), apiToken: '' },
      snow:   { baseUrl: 'https://snow.example.com', username: Buffer.from('bob').toString('base64'), password: Buffer.from('secret').toString('base64') },
      github: { baseUrl: 'https://api.github.com',   pat: Buffer.from('ghp-token').toString('base64') },
    };

    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify(obfuscatedConfig));

    const configuration = loadConfig();

    expect(configuration.jira.username).toBe('alice');
    expect(configuration.jira.pat).toBe('my-pat');
    expect(configuration.snow.username).toBe('bob');
    expect(configuration.snow.password).toBe('secret');
    expect(configuration.github.pat).toBe('ghp-token');
  });

  it('loads plaintext credentials from a legacy (non-obfuscated) config file without error', () => {
    // Old configs written before v0.0.6 have no _obfuscated flag — they are plaintext.
    const legacyConfig = {
      jira:   { baseUrl: 'https://jira.example.com', pat: 'plain-pat' },
      github: { pat: 'plain-gh-token' },
    };

    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify(legacyConfig));

    const configuration = loadConfig();

    expect(configuration.jira.pat).toBe('plain-pat');
    expect(configuration.github.pat).toBe('plain-gh-token');
  });
});

// ── Config Migration ──────────────────────────────────────────────────────────

describe('migrateOldConfig()', () => {
  beforeEach(resetEnvironment);

  it('does nothing when no legacy co-located config exists', () => {
    // Neither the legacy path nor the AppData path has a config
    fsMock.existsSync.mockReturnValue(false);

    expect(() => migrateOldConfig()).not.toThrow();
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    expect(fsMock.unlinkSync).not.toHaveBeenCalled();
  });

  it('migrates legacy config to AppData and removes the original file', () => {
    const legacyPlaintextConfig = {
      jira:   { baseUrl: 'https://jira.example.com', pat: 'plain-jira-pat', username: 'alice', apiToken: '' },
      snow:   { baseUrl: '', username: '', password: '' },
      github: { pat: 'plain-gh-pat', baseUrl: 'https://api.github.com' },
    };

    // Legacy file exists, AppData file does NOT yet exist
    fsMock.existsSync.mockImplementation((filePath) => {
      if (filePath === CONFIG_FILE_PATH) return false;  // AppData not yet present
      return true;                                       // legacy file is present
    });
    fsMock.readFileSync.mockReturnValue(JSON.stringify(legacyPlaintextConfig));
    fsMock.mkdirSync.mockImplementation(() => {});
    fsMock.writeFileSync.mockImplementation(() => {});
    fsMock.unlinkSync.mockImplementation(() => {});

    migrateOldConfig();

    // Config was written to AppData (with obfuscation)
    expect(fsMock.writeFileSync).toHaveBeenCalledWith(
      CONFIG_FILE_PATH,
      expect.stringContaining('"_obfuscated": true'),
      'utf8'
    );

    // Credentials in the written file must be base64-encoded
    const writtenContent = fsMock.writeFileSync.mock.calls[0][1];
    const writtenData    = JSON.parse(writtenContent);
    expect(Buffer.from(writtenData.jira.pat, 'base64').toString('utf8')).toBe('plain-jira-pat');
    expect(Buffer.from(writtenData.github.pat, 'base64').toString('utf8')).toBe('plain-gh-pat');

    // Old file must be deleted after successful migration
    expect(fsMock.unlinkSync).toHaveBeenCalled();
  });

  it('deletes the legacy file without re-migrating when AppData config already exists', () => {
    // Both files exist — AppData wins; legacy file should just be cleaned up
    fsMock.existsSync.mockReturnValue(true);
    fsMock.unlinkSync.mockImplementation(() => {});

    migrateOldConfig();

    // Must NOT overwrite the existing AppData config
    expect(fsMock.writeFileSync).not.toHaveBeenCalled();
    // Must delete the redundant legacy file
    expect(fsMock.unlinkSync).toHaveBeenCalled();
  });
});
