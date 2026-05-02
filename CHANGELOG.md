# Changelog — NodeToolbox

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.5] — Fix: v0.0.4 Issue Resolution (Issue #15)

### Fixed
- **`src/routes/proxy.js`** — All three proxy routes (`/jira-proxy`, `/snow-proxy`, `/github-proxy`) were using `req.path` to build the downstream URL, which strips query strings. Changed to `req.url` so query parameters are correctly forwarded. This was the root cause of: Team Dashboard board search returning all boards regardless of search term, ART View Overview showing blank (JQL filters dropped), and any API call relying on GET query params.
- **`public/toolbox.html`** — Removed 35 embedded BOM (U+FEFF / zero-width no-break space) characters that appeared as garbled glyphs in some browsers.
- **`public/toolbox.html`** — Added the missing **Admin Hub** card to the home page grid. The view existed and was fully implemented, but had no entry point on the home screen. Added under a new "Administration" section.
- **`public/toolbox.html`** — Fixed `crCheckCredWarnings()`: in NodeToolbox proxy mode (`IS_NODETOOLBOX_SERVER = true`), the browser relay is never used so `CRG.relay.jiraReady` is always `false`. This caused a false "Jira not connected" warning to permanently display in SNow Hub. The function now checks `IS_NODETOOLBOX_SERVER` and suppresses the warning in proxy mode.
- **`public/toolbox.html`** — Fixed `devTestJiraPAT()`: direct `fetch()` calls are CORS-blocked in the browser context. When running on NodeToolbox (`IS_NODETOOLBOX_SERVER`), the PAT test now routes through `tbxJiraRequest()` (the server-side `/jira-proxy`), enabling a real connectivity test.
- **`public/toolbox.html`** — Removed Git Hooks references from the Dev Workspace setup wizard. The Git Hooks feature (offline PowerShell scripts) is not supported in the NodeToolbox browser environment. Removed the Git Hooks feature card from the welcome step (devWizS0), removed the Git Hooks method card from the workflow step (devWizS4), and updated the summary step (devWizS5) to reference only supported workflows (GitHub Sync and Manual Post).

### Tests Added
- `test/integration/proxy.test.js` — Three new tests verifying query string parameters are forwarded correctly for Jira, ServiceNow, and GitHub proxy routes.
- `test/unit/toolboxHtml.test.js` — Seven new static-analysis tests covering: BOM character absence, Admin Hub card DOM presence, `crCheckCredWarnings` proxy-mode guard, `devTestJiraPAT` proxy routing, and Dev Workspace wizard Git Hooks removal.

## [0.0.5] — Fix: v0.0.4 Issue Resolution (Issue #15)

## [0.0.4] — Fix: Portable launcher for distributed zip

### Fixed
- **`Launch Toolbox.bat`** (new file) — Replaced the broken `Launch Toolbox.lnk` in the distributable zip with a portable `.bat` launcher. The `.lnk` shortcut embedded absolute paths from the CI build machine (`D:\a\NodeToolbox\...`) which do not exist on the end-user's machine. The `.bat` uses `%~dp0` (the bat file's own directory at runtime) so it works correctly regardless of where the zip is extracted.
- **`scripts/local-release.ps1`** — Updated `$IncludedPaths` to bundle `Launch Toolbox.bat` instead of `Launch Toolbox.lnk`. Removed the `create-launcher.js` step (step 2/4 → now 3 steps total). Updated dry-run output.
- **`.github/workflows/release.yml`** — Removed the `node scripts/create-launcher.js` CI step, which was generating a machine-specific `.lnk` that could never be used on another machine.
- **`test/unit/local-release.test.js`** — Updated dry-run test assertions to verify `.bat` is reported and `.lnk` is not included (2 tests updated, 1 regression guard added).
- **`scripts/local-release.ps1`** — Replaced em dash (`—`) characters inside `Write-Host` double-quoted strings with plain hyphens. Windows PowerShell 5.1 misparses UTF-8 em dashes in string literals, causing `ParserError` failures on the CI runner.

### Notes
- `npm run create-launcher` still works for users who want a machine-specific desktop shortcut after extracting the zip (creates a `.lnk` with correct local paths).

## [0.0.3] — Fix: CI + release script compatibility

### Fixed
- `test/unit/local-release.test.js` — Wrapped all tests in `describeOnWindows` guard (`process.platform === 'win32' ? describe : describe.skip`). Tests were calling `powershell.exe` directly, which does not exist on Linux CI runners, causing 6 test failures on every push to main.
- `scripts/local-release.ps1` — Removed `Set-StrictMode -Version Latest`. Even assigning to automatic variables like `$LASTEXITCODE` throws `VariableIsUndefined` on a fresh `pwsh` session (GitHub Actions `windows-latest`) under latest strict mode. `$ErrorActionPreference = 'Stop'` is sufficient for build script error handling.
- `scripts/local-release.ps1` — Coerced `Where-Object` pipeline results to `[array]` so `.Count` property is always available under strict mode (returns `$null` instead of empty array when no items match).

## [0.0.2] — Phase 7: Proxy Auto-Wire

### Added
- `test/unit/toolboxHtml.test.js` — 10 static analysis tests: verifies `IS_NODETOOLBOX_SERVER` detection is present, Jira/SNow proxy routing in all four request functions, and confirms in-app connection wizard is fully removed

### Changed
- `public/toolbox.html` — Auto-wire NodeToolbox as proxy when served from localhost:
  - Added `IS_NODETOOLBOX_SERVER` detection constant and `NODETOOLBOX_ORIGIN` variable
  - Added `tbxNodeToolboxFetch()` shared helper for all NodeToolbox proxy calls
  - Updated `tbxJiraRequest()` — routes through `/jira-proxy/*` on NodeToolbox, relay fallback for file:// mode
  - Updated `tbxSnowRequest()` — routes through `/snow-proxy/*` on NodeToolbox, relay fallback for file:// mode
  - Updated `crJiraFetch()` — NodeToolbox fast-path with correct `{ ok, status, json(), text() }` response shape
  - Updated `crSnowFetch()` — same pattern
  - Removed in-app connection wizard (556 lines): `var CONN_WIZ` state, `tbxConnWizShow/Render/Go/Step0-4/NeverShow/SaveJiraUrl/OpenJiraTab/TestRelay/VerifyJiraApi/TestProxy/CopyCommand/SetStatus/SkipSession/Relaunch/Confirm/StopPolling` functions, startup trigger, `<div id="tbx-conn-wiz-overlay">` HTML, and all associated CSS rules (43 lines)

## [0.0.1] — Phase 6: Friendly Guided Setup Wizard

### Added
- `src/routes/setup.js` — Fully redesigned as a 5-step guided wizard (Welcome → Jira → GitHub → ServiceNow → Done). Each step uses plain, jargon-free language with skip buttons for optional services. Progress indicator with animated dots. Zero external CDN dependencies — self-contained inline HTML.
- `test/integration/setup.test.js` — Expanded from 9 to 17 tests. New GET tests: welcome step, jira/github/snow/done step presence, skip buttons, progress indicator, `/api/setup` reference, Jira/SNow URL pre-fill, no external CDN URLs. POST contract unchanged.

### Changed
- `public/toolbox.html` — Removed all Python (`toolbox-server.py`) references:
  - Replaced Python wizard steps in `tbxConnWizStep3()` and `tbxWizS3Proxy()` with Node.js download/launch instructions
  - Renamed `tbxWizDownloadServerPy()` → `tbxWizDownloadServerJs()` (opens NodeToolbox releases page)
  - Updated `proxyStartCommand` → `node server.js`
  - Updated `adminHubCopyStartCommand()`, bat launcher, and silent VBScript launcher to reference `node server.js`
  - Updated proxy update banner download link to GitHub Releases page
  - Removed 1,922-line embedded `toolbox-server.py` block (replaced with one-line comment)
- `package.json` — Version bumped from `1.0.0` to `0.0.1` for initial release tag

## [1.4.0] — Phase 5: Release Pipeline

### Added
- `.github/workflows/ci.yml` — CI: runs on every PR and push to main; matrix across Node 18 + 20; `npm ci` → `npm test`; blocks merge on failure
- `.github/workflows/release.yml` — Release: triggered by `v*` tags on `windows-latest`; runs tests, creates launcher, packages zip via `local-release.ps1`, uploads to GitHub Releases via `softprops/action-gh-release@v2`

## [1.3.0] — Phase 4: Distribution Package

### Added
- `scripts/local-release.ps1` — Packages NodeToolbox into a distributable zip (`dist/nodetoolbox-vX.Y.Z.zip`). Steps: `npm install` → `create-launcher` → bundle `server.js`, `package.json`, `public/`, `src/`, `scripts/`, `node_modules/`, and the launcher shortcut. Supports `-DryRun` flag (print plan, write nothing).
- `test/unit/local-release.test.js` — 6 unit tests validating dry-run output (npm install mention, launcher mention, zip path, semver, no dist/ created)
- `package.json` `local-release` script — `npm run local-release` invokes the PowerShell packager

### Audited
- `public/toolbox.html` — Python proxy references (`toolbox-server.py`, connection wizard) are confined to legacy setup help dialogs and the embedded server file. The NodeToolbox `/setup` wizard supersedes the in-app connection wizard. No API surface changes required; all `/api/*` endpoint paths are unchanged.

## [1.2.0] — Phase 3: Windows Launcher

### Added
- `scripts/create-launcher.js` — Creates `Launch Toolbox.lnk` via VBScript helper (cscript). Sets Target = `node.exe`, Arguments = absolute path to `server.js`, WorkingDirectory = repo root, WindowStyle = hidden (no console flash). Supports `--dry-run` (no file written) and `--help` flags.
- `test/unit/createLauncher.test.js` — 7 unit tests covering dry-run output, shortcut config values, no-write guarantee, and `--help` text

### Notes
- `npm run create-launcher` (already in package.json from Phase 0) invokes this script
- The `.lnk` file is gitignored — it is a per-machine artifact

## [1.1.0] — Phase 2: First-Run Setup Wizard

### Added
- `src/routes/setup.js` — Self-contained credential wizard: `GET /setup` returns dark-themed inline HTML (no CDN, no external assets) with three service cards (Jira, GitHub, ServiceNow); `POST /api/setup` validates input, merges credentials into the live config, writes `toolbox-proxy.json`, and returns 302 → `/`
- First-run detection in `server.js` — `GET /` redirects 302 → `/setup` when none of the three services (Jira, GitHub, ServiceNow) have been configured, ensuring new users always reach the wizard instead of a non-functional dashboard
- `test/integration/setup.test.js` — 9 integration tests covering GET /setup HTML structure, config pre-fill, POST validation, trailing-slash stripping, partial-service acceptance, and duplicate-submission resilience

### Changed
- `server.js` — setup router mounted before static file middleware; first-run redirect middleware added
- `test/integration/server.test.js` — `GET /` test updated to accept 302 (setup redirect) alongside 200/404

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
