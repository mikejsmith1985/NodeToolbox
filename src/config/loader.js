// src/config/loader.js — Manages all proxy configuration loading, saving, and templating.
//
// Configuration is sourced in two layers (lowest to highest priority):
//   1. toolbox-proxy.json  — written by the /setup wizard or edited manually
//   2. Environment variables — Forge Vault compatible, override any file values

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Constants ────────────────────────────────────────────────────────────────

/** Filename of the credentials config file — always co-located with server.js */
const CONFIG_FILENAME = 'toolbox-proxy.json';

/**
 * Absolute path to the config file, resolved relative to the project root.
 * Using __dirname from this module (src/config/) requires going up two levels.
 */
const CONFIG_FILE_PATH = path.join(__dirname, '..', '..', CONFIG_FILENAME);

/** Default port — matches the legacy server so existing bookmarks still work */
const DEFAULT_SERVER_PORT = 5555;

/** Default GitHub API base URL — overridable for GitHub Enterprise instances */
const DEFAULT_GITHUB_BASE_URL = 'https://api.github.com';

/** Placeholder strings that indicate the user has not filled in their Jira URL */
const JIRA_URL_PLACEHOLDER_PATTERNS = ['your-instance', 'your-jira'];

/** Maximum number of branches/PRs tracked per repo in the scheduler state */
const MAX_SEEN_BRANCHES_PER_REPO = 500;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Loads proxy configuration from toolbox-proxy.json and environment variables.
 * Environment variables take priority, allowing Forge Vault injected credentials
 * to override any saved defaults without touching the config file.
 *
 * @returns {ProxyConfig} Merged configuration object
 */
function loadConfig() {
  const configuration = buildDefaultConfig();

  applyFileConfig(configuration);
  applyEnvironmentConfig(configuration);
  normalizeSchedulerDefaults(configuration);
  normalizeBaseUrls(configuration);

  return configuration;
}

/**
 * Persists the current in-memory configuration to toolbox-proxy.json.
 * Safe to call from any context — Node.js is single-threaded so no locking is needed.
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

  try {
    fs.writeFileSync(CONFIG_FILE_PATH, JSON.stringify(diskConfig, null, 2) + '\n', 'utf8');
  } catch (writeError) {
    console.error('  ⚠ Could not save config: ' + writeError.message);
  }
}

/**
 * Creates a starter toolbox-proxy.json template on first run so users can see
 * what fields are available before the setup wizard fills them in.
 * Skips creation if the file already exists.
 */
function createConfigTemplate() {
  if (fs.existsSync(CONFIG_FILE_PATH)) return;

  const templateConfig = {
    port: DEFAULT_SERVER_PORT,
    jira: {
      baseUrl:  'https://your-instance.atlassian.net',
      username: 'your-email@company.com',
      apiToken: 'your-api-token-here',
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
    console.log('  📝 Created ' + CONFIG_FILENAME + ' — edit with your credentials or use the setup wizard at /setup');
  } catch (writeError) {
    console.error('  ⚠ Could not create ' + CONFIG_FILENAME + ': ' + writeError.message);
  }
}

/**
 * Determines whether a service has a real (non-placeholder) base URL configured.
 * Used to distinguish between "user filled in a real URL" and "default template value."
 *
 * @param {{ baseUrl: string }} serviceConfig
 * @returns {boolean} True if the service appears to have a real base URL
 */
function isServiceConfigured(serviceConfig) {
  if (!serviceConfig.baseUrl) return false;

  const hasPlaceholder = JIRA_URL_PLACEHOLDER_PATTERNS.some(
    (placeholderPattern) => serviceConfig.baseUrl.indexOf(placeholderPattern) >= 0
  );

  return !hasPlaceholder;
}

// ── Private Helpers ───────────────────────────────────────────────────────────

/**
 * Builds the safe default configuration object that is used as the starting
 * point before any file or environment variable values are applied.
 *
 * @returns {ProxyConfig}
 */
function buildDefaultConfig() {
  return {
    port:      DEFAULT_SERVER_PORT,
    sslVerify: true,
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

module.exports = {
  loadConfig,
  saveConfigToDisk,
  createConfigTemplate,
  isServiceConfigured,
  CONFIG_FILE_PATH,
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
