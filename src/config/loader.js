// src/config/loader.js — Manages all proxy configuration loading, saving, and templating.
//
// Configuration is sourced in two layers (lowest to highest priority):
//   1. toolbox-proxy.json  — written by the /setup wizard or edited manually
//   2. Environment variables — Forge Vault compatible, override any file values
//
// Credentials are stored in %APPDATA%\NodeToolbox\ so they persist across
// version upgrades. On first launch after a legacy install, any co-located
// toolbox-proxy.json is automatically migrated to AppData.

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');

// ── Constants ────────────────────────────────────────────────────────────────

/** Filename of the credentials config file */
const CONFIG_FILENAME = 'toolbox-proxy.json';

/**
 * Persistent AppData directory for NodeToolbox config.
 * Using APPDATA keeps credentials outside the installation folder so they
 * survive zip-extraction upgrades without user intervention.
 */
const CONFIG_DIR_PATH = path.join(process.env.APPDATA || os.homedir(), 'NodeToolbox');

/** Absolute path to the config file inside the AppData folder */
const CONFIG_FILE_PATH = path.join(CONFIG_DIR_PATH, CONFIG_FILENAME);

/**
 * Legacy path where config was stored in v0.0.5 and earlier (alongside server.js).
 * Used only during the one-time migration check on startup.
 * process.pkg is set by @yao-pkg/pkg when running as a bundled .exe.
 */
const LEGACY_CONFIG_FILE_PATH = process.pkg
  ? path.join(path.dirname(process.execPath), CONFIG_FILENAME)
  : path.join(__dirname, '..', '..', CONFIG_FILENAME);

/** Default port — matches the legacy server so existing bookmarks still work */
const DEFAULT_SERVER_PORT = 5555;

/** Default GitHub API base URL — overridable for GitHub Enterprise instances */
const DEFAULT_GITHUB_BASE_URL = 'https://api.github.com';

/**
 * Placeholder strings that indicate the user has not filled in their Jira URL.
 * Any base URL containing one of these substrings is treated as unconfigured.
 */
const JIRA_URL_PLACEHOLDER_PATTERNS = ['your-instance', 'your-jira'];

/** Maximum number of branches/PRs tracked per repo in the scheduler state */
const MAX_SEEN_BRANCHES_PER_REPO = 500;

/**
 * Credential fields that are base64-encoded when written to disk.
 * This prevents credentials from being visible in plain text to a casual viewer.
 * The _obfuscated flag in the config file signals that encoding is applied.
 */
const OBFUSCATED_CREDENTIAL_FIELDS = {
  jira:   ['username', 'apiToken', 'pat'],
  snow:   ['username', 'password'],
  github: ['pat'],
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Loads proxy configuration from toolbox-proxy.json and environment variables.
 * Runs the one-time legacy migration before loading so credentials are always
 * read from the persistent AppData location.
 *
 * Environment variables take priority, allowing Forge Vault injected credentials
 * to override any saved defaults without touching the config file.
 *
 * @returns {ProxyConfig} Merged configuration object
 */
function loadConfig() {
  migrateOldConfig();

  const configuration = buildDefaultConfig();

  applyFileConfig(configuration);
  applyEnvironmentConfig(configuration);
  normalizeSchedulerDefaults(configuration);
  normalizeBaseUrls(configuration);

  return configuration;
}

/**
 * Persists the current in-memory configuration to toolbox-proxy.json in AppData.
 * Credential fields are base64-encoded before writing so they are not stored
 * as plain text. Safe to call from any context — Node.js is single-threaded.
 *
 * @param {ProxyConfig} configuration - The current in-memory config object to save
 */
function saveConfigToDisk(configuration) {
  const schedulerMonitor = configuration.scheduler.repoMonitor;

  const diskConfig = {
    port:      configuration.port,
    sslVerify: configuration.sslVerify !== false,
    jira: {
      baseUrl:  configuration.jira.baseUrl,
      username: configuration.jira.username,
      apiToken: configuration.jira.apiToken,
      pat:      configuration.jira.pat,
    },
    snow: {
      baseUrl:  configuration.snow.baseUrl,
      username: configuration.snow.username,
      password: configuration.snow.password,
    },
    github: {
      baseUrl: configuration.github.baseUrl,
      pat:     configuration.github.pat,
    },
    scheduler: {
      repoMonitor: {
        enabled:       !!schedulerMonitor.enabled,
        repos:         schedulerMonitor.repos         || [],
        branchPattern: schedulerMonitor.branchPattern || 'feature\\/[A-Z]+-\\d+',
        intervalMin:   schedulerMonitor.intervalMin   || 15,
        transitions:   schedulerMonitor.transitions   || {},
        seenBranches:  schedulerMonitor.seenBranches  || {},
        seenCommits:   schedulerMonitor.seenCommits   || {},
        seenPrs:       schedulerMonitor.seenPrs       || {},
      },
    },
  };

  // Encode credentials before writing so they are not plaintext on disk
  diskConfig._obfuscated = true;
  encodeCredentialsForDisk(diskConfig);
  ensureConfigDirExists();

  try {
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(diskConfig, null, 2) + '\n', 'utf8');
  } catch (writeError) {
    console.error('  ⚠ Could not save config: ' + writeError.message);
  }
}

/**
 * Creates a starter toolbox-proxy.json template in AppData on first run so users
 * can see what fields are available before the setup wizard fills them in.
 * Skips creation if the file already exists.
 */
function createConfigTemplate() {
  ensureConfigDirExists();

  if (fs.existsSync(CONFIG_FILE_PATH)) return;

  const templateConfig = {
    port: DEFAULT_SERVER_PORT,
    jira: {
      // Pre-filled with the organisation's Jira URL — user only needs to add their PAT
      baseUrl:  'https://jira.healthspring-jira-prod.aws.zilverton.com',
      username: '',
      apiToken: '',
      pat:      '',
    },
    snow: {
      baseUrl:  '',
      username: '',
      password: '',
    },
    github: {
      baseUrl: DEFAULT_GITHUB_BASE_URL,
      pat:     '',
    },
    scheduler: {
      repoMonitor: {
        enabled:       false,
        repos:         [],
        branchPattern: 'feature\\/[A-Z]+-\\d+',
        intervalMin:   15,
        transitions:   { branchCreated: '', commitPushed: '', prOpened: '', prMerged: '' },
        seenBranches:  {},
        seenCommits:   {},
        seenPrs:       {},
      },
    },
  };

  try {
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(templateConfig, null, 2) + '\n');
    console.log('  📝 Created ' + CONFIG_FILENAME + ' in ' + CONFIG_DIR_PATH);
  } catch (writeError) {
    console.error('  ⚠ Could not create ' + CONFIG_FILENAME + ': ' + writeError.message);
  }
}

/**
 * Determines whether a service is fully configured with both a real base URL
 * and at least one usable credential.
 *
 * A base URL alone is not sufficient — the proxy server needs a credential to
 * authenticate against the service. Without this check, a fresh install that
 * has only the pre-filled Jira URL (but no PAT yet) would incorrectly skip the
 * first-run setup wizard and leave users stuck on an unauthenticated dashboard.
 *
 * @param {{ baseUrl: string, pat?: string, apiToken?: string, password?: string }} serviceConfig
 * @returns {boolean} True when the service has a real URL and at least one credential
 */
function isServiceConfigured(serviceConfig) {
  if (!serviceConfig.baseUrl) return false;

  const hasPlaceholderUrl = JIRA_URL_PLACEHOLDER_PATTERNS.some(
    (placeholderPattern) => serviceConfig.baseUrl.indexOf(placeholderPattern) >= 0
  );
  if (hasPlaceholderUrl) return false;

  // A URL without credentials cannot make authenticated API calls
  return !!(serviceConfig.pat || serviceConfig.apiToken || serviceConfig.password);
}

// ── Private Helpers ───────────────────────────────────────────────────────────

/**
 * Migrates a legacy co-located config file (v0.0.5 and earlier) to the persistent
 * AppData location. Automatically called on every startup — a no-op after first run.
 *
 * Migration rules:
 *   - No legacy file → skip entirely
 *   - AppData file already exists → clean up legacy file only (AppData wins)
 *   - Otherwise → encode credentials, write to AppData, delete legacy file
 */
function migrateOldConfig() {
  if (!fs.existsSync(LEGACY_CONFIG_FILE_PATH)) return;

  // AppData config already exists — just remove the redundant legacy copy
  if (fs.existsSync(CONFIG_FILE_PATH)) {
    deleteLegacyConfigFile();
    return;
  }

  let legacyFileData;
  try {
    legacyFileData = JSON.parse(fs.readFileSync(LEGACY_CONFIG_FILE_PATH, 'utf8'));
  } catch (parseError) {
    console.warn('  ⚠ Could not parse legacy config for migration: ' + parseError.message);
    return;
  }

  ensureConfigDirExists();

  // Mark as obfuscated and encode before writing to the new location
  legacyFileData._obfuscated = true;
  encodeCredentialsForDisk(legacyFileData);
  fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(legacyFileData, null, 2) + '\n', 'utf8');
  deleteLegacyConfigFile();
  console.log('  ✅ Config migrated to ' + CONFIG_DIR_PATH);
}

/**
 * Builds the safe default configuration object that is used as the starting
 * point before any file or environment variable values are applied.
 *
 * @returns {ProxyConfig}
 */
function buildDefaultConfig() {
  return {
    port: DEFAULT_SERVER_PORT,
    // Default to false (skip TLS verification) to work out-of-the-box on corporate
    // networks that use SSL inspection tools (Zscaler, Forcepoint, etc.) which
    // replace server certificates with their own CA. This matches the behaviour of
    // the original toolbox-poc.js (rejectUnauthorized: false). Users who require
    // strict cert checking can set "sslVerify": true in their config file.
    sslVerify: false,
    jira: {
      baseUrl:  '',
      username: '',
      apiToken: '',
      pat:      '',
    },
    snow: {
      baseUrl:  '',
      username: '',
      password: '',
    },
    github: {
      baseUrl: DEFAULT_GITHUB_BASE_URL,
      pat:     '',
    },
    scheduler: {},
  };
}

/**
 * Merges values from toolbox-proxy.json into the configuration object.
 * Silently skips loading if the file does not exist or cannot be parsed.
 *
 * @param {ProxyConfig} configuration - Mutated in place
 */
function applyFileConfig(configuration) {
  if (!fs.existsSync(CONFIG_FILE_PATH)) return;

  let fileConfig;
  try {
    const fileContent = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
    fileConfig = JSON.parse(fileContent);
  } catch (parseError) {
    console.error('  ⚠ Failed to parse ' + CONFIG_FILENAME + ': ' + parseError.message);
    return;
  }

  // Decode credentials before merging — obfuscation is transparent to callers
  if (fileConfig._obfuscated) {
    decodeCredentialsFromDisk(fileConfig);
  }

  if (fileConfig.port)      configuration.port      = fileConfig.port;
  if (fileConfig.sslVerify !== undefined) configuration.sslVerify = !!fileConfig.sslVerify;

  if (fileConfig.jira) {
    const jiraFields = ['baseUrl', 'username', 'apiToken', 'pat'];
    jiraFields.forEach((fieldName) => {
      if (fileConfig.jira[fieldName]) configuration.jira[fieldName] = fileConfig.jira[fieldName];
    });
  }

  if (fileConfig.snow) {
    const snowFields = ['baseUrl', 'username', 'password'];
    snowFields.forEach((fieldName) => {
      if (fileConfig.snow[fieldName]) configuration.snow[fieldName] = fileConfig.snow[fieldName];
    });
  }

  if (fileConfig.github) {
    if (fileConfig.github.pat)     configuration.github.pat     = fileConfig.github.pat;
    if (fileConfig.github.baseUrl) configuration.github.baseUrl = fileConfig.github.baseUrl;
  }

  if (fileConfig.scheduler) {
    configuration.scheduler = JSON.parse(JSON.stringify(fileConfig.scheduler));
  }
}

/**
 * Applies environment variable overrides to the configuration object.
 * These take the highest priority — useful for CI/CD and Forge Vault injection.
 *
 * @param {ProxyConfig} configuration - Mutated in place
 */
function applyEnvironmentConfig(configuration) {
  if (process.env.TBX_PORT) {
    const parsedPort = parseInt(process.env.TBX_PORT, 10);
    if (parsedPort > 0) configuration.port = parsedPort;
  }

  if (process.env.TBX_JIRA_URL)  configuration.jira.baseUrl  = process.env.TBX_JIRA_URL;
  if (process.env.JIRA_USERNAME)  configuration.jira.username = process.env.JIRA_USERNAME;
  if (process.env.JIRA_API_TOKEN) configuration.jira.apiToken = process.env.JIRA_API_TOKEN;

  // TBX_JIRA_PAT takes priority over JIRA_PAT (namespace-prefixed version wins)
  if (process.env.JIRA_PAT)     configuration.jira.pat = process.env.JIRA_PAT;
  if (process.env.TBX_JIRA_PAT) configuration.jira.pat = process.env.TBX_JIRA_PAT;

  // JIRA_PASSWORD is an alias for JIRA_API_TOKEN — kept for backwards compatibility
  if (process.env.JIRA_PASSWORD && !configuration.jira.apiToken) {
    configuration.jira.apiToken = process.env.JIRA_PASSWORD;
  }

  if (process.env.TBX_SNOW_URL)          configuration.snow.baseUrl  = process.env.TBX_SNOW_URL;
  if (process.env.SERVICE_NOW_USERNAME)   configuration.snow.username = process.env.SERVICE_NOW_USERNAME;
  if (process.env.SERVICE_NOW_PASSWORD)   configuration.snow.password = process.env.SERVICE_NOW_PASSWORD;

  // TBX_GITHUB_TOKEN takes priority over GITHUB_TOKEN (namespace-prefixed version wins)
  if (process.env.GITHUB_TOKEN)     configuration.github.pat = process.env.GITHUB_TOKEN;
  if (process.env.TBX_GITHUB_TOKEN) configuration.github.pat = process.env.TBX_GITHUB_TOKEN;

  // TBX_SSL_VERIFY=false disables cert verification for Zscaler/corporate SSL inspection
  const sslVerifyValue = (process.env.TBX_SSL_VERIFY || '').trim().toLowerCase();
  if (sslVerifyValue === 'false' || sslVerifyValue === '0' || sslVerifyValue === 'no') {
    configuration.sslVerify = false;
  }
}

/**
 * Ensures the scheduler.repoMonitor object has all required fields with safe defaults.
 * Runs after file + env loading so partial configs are safely filled in.
 *
 * @param {ProxyConfig} configuration - Mutated in place
 */
function normalizeSchedulerDefaults(configuration) {
  configuration.scheduler            = configuration.scheduler            || {};
  configuration.scheduler.repoMonitor = configuration.scheduler.repoMonitor || {};

  const repoMonitor = configuration.scheduler.repoMonitor;
  repoMonitor.enabled       = repoMonitor.enabled       !== undefined ? repoMonitor.enabled : false;
  repoMonitor.repos         = Array.isArray(repoMonitor.repos)         ? repoMonitor.repos  : [];
  repoMonitor.branchPattern = repoMonitor.branchPattern || 'feature\\/[A-Z]+-\\d+';
  repoMonitor.intervalMin   = repoMonitor.intervalMin   || 15;
  repoMonitor.transitions   = repoMonitor.transitions   || {
    branchCreated: '',
    commitPushed:  '',
    prOpened:      '',
    prMerged:      '',
  };
  repoMonitor.seenBranches  = repoMonitor.seenBranches  || {};
  repoMonitor.seenCommits   = repoMonitor.seenCommits   || {};
  repoMonitor.seenPrs       = repoMonitor.seenPrs       || {};
}

/**
 * Strips trailing slashes from all base URLs to prevent double-slash
 * issues when path segments are appended later.
 *
 * @param {ProxyConfig} configuration - Mutated in place
 */
function normalizeBaseUrls(configuration) {
  if (configuration.jira.baseUrl) {
    configuration.jira.baseUrl = configuration.jira.baseUrl.replace(/\/+$/, '');
  }
  if (configuration.snow.baseUrl) {
    configuration.snow.baseUrl = configuration.snow.baseUrl.replace(/\/+$/, '');
  }
  configuration.github.baseUrl = (configuration.github.baseUrl || DEFAULT_GITHUB_BASE_URL)
    .replace(/\/+$/, '');
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Base64-encodes each credential field listed in OBFUSCATED_CREDENTIAL_FIELDS
 * for the matching service section in diskConfig. Mutates diskConfig in place.
 * Only encodes non-empty string values — empty fields are left as-is.
 * Callers are responsible for setting _obfuscated = true before writing to disk.
 *
 * @param {object} diskConfig - The config object about to be written to disk
 */
function encodeCredentialsForDisk(diskConfig) {
  for (const [serviceName, fieldNames] of Object.entries(OBFUSCATED_CREDENTIAL_FIELDS)) {
    if (!diskConfig[serviceName]) continue;
    for (const fieldName of fieldNames) {
      const fieldValue = diskConfig[serviceName][fieldName];
      if (fieldValue) {
        diskConfig[serviceName][fieldName] = Buffer.from(fieldValue, 'utf8').toString('base64');
      }
    }
  }
}

/**
 * Base64-decodes each credential field listed in OBFUSCATED_CREDENTIAL_FIELDS
 * from the matching service section in fileData. Mutates fileData in place.
 * Wraps each decode in try/catch so a single corrupt value does not block startup.
 *
 * @param {object} fileData - The parsed JSON object read from disk
 */
function decodeCredentialsFromDisk(fileData) {
  for (const [serviceName, fieldNames] of Object.entries(OBFUSCATED_CREDENTIAL_FIELDS)) {
    if (!fileData[serviceName]) continue;
    for (const fieldName of fieldNames) {
      const fieldValue = fileData[serviceName][fieldName];
      if (!fieldValue) continue;
      try {
        fileData[serviceName][fieldName] = Buffer.from(fieldValue, 'base64').toString('utf8');
      } catch (_decodeError) {
        // Leave the value unchanged — it may have been written by an older version
      }
    }
  }
}

/**
 * Creates the AppData config directory if it does not already exist.
 * Called before any file write so we never get ENOENT on a fresh machine.
 */
function ensureConfigDirExists() {
  if (!fs.existsSync(CONFIG_DIR_PATH)) {
    fs.mkdirSync(CONFIG_DIR_PATH, { recursive: true });
  }
}

/**
 * Removes the legacy co-located config file after a successful migration.
 * Non-fatal — a warning is logged if the delete fails (e.g., read-only filesystem).
 */
function deleteLegacyConfigFile() {
  try {
    fs.unlinkSync(LEGACY_CONFIG_FILE_PATH);
  } catch (deleteError) {
    console.warn('  ⚠ Could not remove legacy config file: ' + deleteError.message);
  }
}

module.exports = {
  loadConfig,
  saveConfigToDisk,
  createConfigTemplate,
  migrateOldConfig,
  isServiceConfigured,
  JIRA_URL_PLACEHOLDER_PATTERNS,
  CONFIG_FILE_PATH,
  CONFIG_DIR_PATH,
  MAX_SEEN_BRANCHES_PER_REPO,
};

/**
 * @typedef {object} ProxyConfig
 * @property {number}   port       - Port the server listens on
 * @property {boolean}  sslVerify  - Whether to verify TLS certificates
 * @property {JiraConfig}   jira
 * @property {SnowConfig}   snow
 * @property {GithubConfig} github
 * @property {SchedulerConfig} scheduler
 */
