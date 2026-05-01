# Changelog — NodeToolbox

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] — Phase 1: Express Foundation

### Added
- `src/config/loader.js` — two-layer config loading (file + env vars), `loadConfig()`, `saveConfigToDisk()`, `createConfigTemplate()`, `isServiceConfigured()`
- `src/middleware/cors.js` — Express CORS middleware with preflight (OPTIONS → 204) support
- `src/utils/httpClient.js` — `proxyRequest()` core proxy engine with TLS toggle, `buildAuthHeader()`, `buildBasicAuthHeader()`, `makeGithubApiRequest()`, `makeJiraApiRequest()`
- `src/services/snowSession.js` — in-memory ServiceNow g_ck session store with expiry tracking
- `src/services/repoMonitor.js` — background GitHub repo monitor; detects new branches, commits, and PRs; posts Jira comments and fires workflow transitions
- `src/routes/proxy.js` — Express router factory for `/jira-proxy/*`, `/snow-proxy/*`, `/github-proxy/*`
- `src/routes/api.js` — Express router factory for `/api/proxy-status`, `/api/proxy-config` (GET + POST), `/api/snow-session` (GET + POST + DELETE)
- `src/routes/scheduler.js` — Express router factory for `/api/scheduler/status`, `/config` (GET + POST), `/run-now`, `/results`
- `src/utils/staticFileServer.js` — `findToolboxHtml()` searches public/ then user home dirs; `serveStaticFile()` middleware with directory traversal protection
- `server.js` — Express entry point: wires all middleware + routes, startup banner, `--open` flag, scheduler auto-start
- `public/toolbox.html` — Toolbox dashboard (ported from ToolBox project)
- `.env.example` — documents all `TBX_*` environment variables
- `README.md` — quickstart guide, API surface table, project structure

### Changed
- Forge Workflow initialized with Forge Terminal Workflow Architect
