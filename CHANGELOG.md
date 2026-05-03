# Changelog — NodeToolbox

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.13] — Fix: v0.0.13 UI Issues

### Fixed
- **Relay warnings showed despite proxy being connected** — `TOOLBOX_VERSION` and
  `MIN_PROXY_SERVER_VERSION` were still set to the old standalone HTML Toolbox value
  `'0.24.25'`. The Node.js proxy reports `'0.0.13'` from `package.json`, so the UI
  incorrectly treated the proxy as outdated and showed relay-required banners everywhere.
  Updated constants to match Node.js versioning; `MIN_PROXY_SERVER_VERSION` is now
  `'0.0.1'` so any v0.x proxy is accepted.
- **`tbxUpdateConnBar` only checked relay, not proxy** — All connection status dots
  evaluated only `CRG.relay.jiraReady` / `CRG.relay.snowReady` (bookmarklet relay).
  Now also reads `sessionStorage.tbxProxyStatus` so dots go green when the proxy server
  has Jira / ServiceNow credentials configured. Mode label shows `"proxy"` instead of
  `"relay"` when connected via proxy.
- **`tbxRenderJiraAuthWidget` always showed relay setup steps** — Dev Workspace, Sprint
  Dashboard, ART View, Work Log, DSU, and My Issues all displayed relay instructions even
  when the proxy had Jira ready. Now shows a `"Jira connected via proxy"` green badge
  and returns early when proxy Jira is ready, skipping the relay setup flow entirely.
- **`miSyncRelayStatus` only checked relay** — My Issues connection bar showed a relay
  warning even when the proxy was fully connected. Now ORs proxy Jira ready with relay
  ready so the warning is hidden in both connected modes.
- **AdminHub stuck on "Loading…"** — `adminHubOnOpen()` existed but was never called
  because `admin-hub` was missing from the `showView` dispatch IIFE. Added the missing
  case so AdminHub initialises correctly when the user navigates to it.
- **Text Tools URL Encoder and Base64 panels stacked vertically** — Both tools were
  missing the `<div class="panels">` wrapper that provides the two-column CSS Grid
  layout used by Smart Formatter and JSON Formatter. Wrapped each tool's input/output
  `<div class="panel">` pair in `.panels` so they render side-by-side. The Base64 error
  message div was moved inside the input panel to avoid disrupting the grid.
- **Update checker pointed at old ToolBox repo** — `TOOLBOX_UPDATE_REPO` was
  `'mikejsmith1985/ToolBox'`. Changed to `'mikejsmith1985/NodeToolbox'` so GitHub
  release checks target the correct repository.
- **`<title>` still read "Toolbox v0.24.25"** — Browser tab now shows
  `"NodeToolbox v0.0.13"` to match the Node.js application name and version.

---

### Fixed (v0.0.12 / previous [Unreleased])
- **Root cause of "HTML not found" on corporate PCs** — The `resolvePortConflict`
  function previously detected an existing NodeToolbox on port 5555 and redirected the
  browser to it, then called `process.exit(0)`. If that old stuck session was a
  pre-fix v0.0.9/v0.0.10 instance, the user was silently handed back to a broken server.
  v0.0.13 removes this "reuse" path entirely: any process occupying port 5555 is now
  killed unconditionally so only the newest, fixed version runs.
- **VBS launcher now picks the newest exe** — `Launch Toolbox Silent.vbs` previously
  exited the loop on the first `nodetoolbox-*.exe` match, which was filesystem-order
  dependent. It now iterates all matches and selects the file with the most recent
  `DateLastModified`, ensuring upgrades take effect immediately.
- **`/api/proxy-status` version** — Was hardcoded as `"1.0.0"`. Now reads from
  `package.json` so the version reported to clients is always accurate.

### Added
- **`GET /api/diagnostic`** — New endpoint returning runtime health information:
  `cachedHtmlLoaded`, `htmlLoadMethod` (`'require'` / `'readFileSync'` / `null`),
  `pkgSnapshot`, `nodeVersion`, and `platform`. Enables remote triage of HTML-serving
  failures on corporate PCs without physical access to the machine.
- **`cachedHtmlLoadMethod`** export on `staticFileServer` — Tracks which code path
  successfully populated the HTML cache at startup (`'require'` in the pkg exe,
  `'readFileSync'` in development/ZIP). Consumed by `/api/diagnostic`.

## [0.0.11] — Fix: Dashboard HTML Compiled Into Exe Snapshot

### Fixed
- **"File Not Found" page shown after setup wizard — confirmed root cause and real fix
  (Issue #22, v0.0.10 partial fix)** — The v0.0.10 fix pre-loaded `toolbox.html` via
  `fs.readFileSync` at module startup. This appeared to work on the build machine because
  `C:\...\public\toolbox.html` existed on the build machine's real disk — not from the
  pkg snapshot. On any other machine (including the user's corporate PC) that path does
  not exist, `readFileSync` throws silently, `cachedDashboardHtml` stays `null`, and the
  "File Not Found" page is returned. The real fix converts `toolbox.html` into a JavaScript
  module (`src/generated/dashboardHtmlContent.js`) before the `pkg` build.
  `@yao-pkg/pkg` compiles JS modules directly into the exe snapshot so `require()` always
  works identically on every machine — no filesystem path matching, no build-machine-
  specific absolute paths, no silent failures.

### Added
- **`scripts/generate-dashboard-module.js`** — New pre-build script that reads
  `public/toolbox.html` and writes it as `src/generated/dashboardHtmlContent.js`
  (a `module.exports = "..."` string). `local-release.ps1` runs this automatically
  before the `pkg` build step so the HTML is always compiled into the exe snapshot.
- **`test/integration/exe-real-world-flow.test.js`** — New integration test that
  copies the `.exe` to an isolated temp directory, renames `public/toolbox.html` on
  the build machine (blocking the readFileSync fallback), and validates the full user
  flow: server start → redirect to setup → POST credentials → dashboard returns 200
  with valid HTML. This is the "exact real world scenario" test that would have caught
  the v0.0.10 partial fix before release.

### Changed
- **`src/utils/staticFileServer.js`** — Pre-load priority updated: `require('../generated/
  dashboardHtmlContent')` is now the primary path (pkg snapshot via JS module); `readFileSync`
  is the fallback for development/zip environments where the generated file is absent.
- **`scripts/local-release.ps1`** — Adds step `[4/6]` to run `generate-dashboard-module.js`
  before the `pkg` build; step count updated from 5 to 6 throughout.
- **`src/generated/`** added to `.gitignore` — the generated module is a build artifact,
  not source code.

### Tests
- `test/unit/generate-dashboard-module.test.js` — NEW: 6 tests verifying the generator
  script creates a valid JS module that exactly matches `public/toolbox.html`.
- `test/integration/exe-real-world-flow.test.js` — NEW: 5 integration tests (see above).
- `test/unit/pkg-snapshot.test.js` — Updated descriptions to reflect the JS-module-first
  approach instead of the readFileSync approach.

## [0.0.10] — Fix: Dashboard Loads After Setup, Silent Launch Option

### Fixed
- **"File Not Found" page shown immediately after setup wizard (Issue #22)** — After
  completing the setup wizard in the `.exe` distribution, the browser was redirected to
  `/` but received the "⚠ toolbox.html not found" error page instead of the dashboard.
  Root cause: `@yao-pkg/pkg` patches `fs.readFileSync` for snapshot assets but does NOT
  reliably patch `fs.existsSync`. `findToolboxHtml()` used `existsSync`, which returned
  `false` for every path in the snapshot, so the middleware concluded the file was missing.
  Fix: `toolbox.html` is now pre-loaded at module startup using `readFileSync` (which IS
  intercepted by pkg). Every subsequent `GET /` is served from that in-memory cache —
  no per-request `existsSync` call required, and the fix works identically in zip and
  exe distributions.

### Added
- **`Launch Toolbox Silent.vbs`** — New headless launcher included in both the zip and
  exe-zip distributions. Double-clicking the VBScript starts NodeToolbox without any
  visible console window (`WScript.Shell.Run` with windowStyle `0 = SW_HIDE`). The
  browser auto-opens to the dashboard exactly as with the regular launchers. Works with
  both distribution types: finds `nodetoolbox-*.exe` for the exe-zip and falls back to
  `Launch Toolbox.bat` for the zip distribution. Includes a `MsgBox` error if neither
  launcher is found (e.g. wrong directory). Aimed at corporate users who find the
  terminal window concerning or are worried about accidentally closing it.

### Changed
- **`scripts/local-release.ps1`** — The exe-zip now contains both the `.exe` and the
  new `Launch Toolbox Silent.vbs`. Previously it contained only the `.exe`. The zip
  also includes `Launch Toolbox Silent.vbs` alongside the existing bat launcher.

### Tests
- `test/unit/pkg-snapshot.test.js` — NEW: 4 tests covering `cachedDashboardHtml` export,
  HTML content validity, and that `serveStaticFile` returns 200 when `existsSync` is
  stubbed to `false` (direct simulation of the pkg environment).
- `test/unit/silent-launcher.test.js` — NEW: 7 tests verifying the VBScript file exists,
  is non-empty, uses `WScript.Shell`, passes window style `0` (hidden), searches for
  `nodetoolbox-*.exe` by prefix, falls back to `Launch Toolbox.bat`, and shows a
  `MsgBox` error when nothing is found.

## [0.0.9] — Fix: Startup Errors Now Visible, Corporate SSL Fixed

### Fixed
- **Server crash on port conflict was silent** — Without a `server.on('error')` handler,
  an `EADDRINUSE` error (port 5555 already in use by another process) threw an unhandled
  exception: the console window closed instantly and the user saw nothing. A handler is
  now in place with a clear human-readable message that explains the two recovery options
  (close the conflicting process, or change the port in config). The window is kept open
  via `process.stdin.resume()` so the user can read the message before dismissing it.
- **Unexpected startup panics also kept invisible** — Added `process.on('uncaughtException')`
  to catch module-not-found and other startup throws (e.g. a failed `npm ci`) with plain-
  English guidance, and the same stdin-resume keep-alive so the window stays open.
- **`Launch Toolbox.bat` used `start` — errors always hidden** — The previous `start
  "NodeToolbox Server" node server.js` spawned a detached child window. If the server
  crashed in that child, the child window closed immediately. Changed to running
  `node server.js --open` directly in the bat's own window (POC pattern): the bat
  window IS the server window, stays open until the user closes it, and any crash output
  is fully visible.
- **`npm ci --silent` suppressed install errors** — Removed `--silent` so npm install
  output (including errors) is visible. Added diagnostic hints in the error message:
  corporate proxy hints, registry config command.
- **`sslVerify` defaulted to `true` — broke on corporate SSL inspection** — `toolbox-poc.js`
  line 221 uses `rejectUnauthorized: false` explicitly. This is required for Zscaler /
  Forcepoint / corporate MITM proxies that replace upstream TLS certs. Changed the
  NodeToolbox default to `false` to match the proven POC behaviour. Users who require
  strict cert verification can set `"sslVerify": true` in their config file.

### Tests Added / Updated
- `test/unit/startup-reliability.test.js` — 7 new tests: `server.on('error')` presence,
  EADDRINUSE message, stdin keep-alive, `uncaughtException` handler, bat direct execution,
  `--open` passthrough, `sslVerify: false` default.
- `test/unit/bat-launcher.test.js` — Updated "server process launch" section to assert
  **direct** node execution (no `start`) and scoped the `/b` check to the launch line only.
- `test/unit/loader.test.js` — Updated `sslVerify` default assertion to `false`.

## [0.0.8] — Fix: Exe Auto-Opens Browser, Pkg Asset Path Verified

### Fixed
- **Exe browser auto-open** — Double-clicking `nodetoolbox-vX.Y.Z.exe` no longer leaves the
  user staring at a console window. The server now detects `process.pkg` (truthy in all
  bundled exe builds) and automatically opens `http://localhost:5555` in the default
  browser — identical behaviour to `Launch Toolbox.bat --open`, no command-line flags needed.
- **Static-asset path compatibility with pkg** — Confirmed `staticFileServer.js` derives
  `PUBLIC_DIRECTORY_PATH` from `__dirname`, which `@yao-pkg/pkg` remaps to the virtual
  snapshot filesystem root at bundle time. The `public/**/*` assets declared in
  `package.json → pkg.assets` are therefore resolved correctly inside the `.exe`.

### Tests Added
- `test/unit/exe-launch.test.js` — 5 new tests covering: `process.pkg` presence in the
  auto-open condition, preservation of the `--open` argv path, combined `||` logic in the
  single `if` block, `__dirname` usage in `staticFileServer.js`, and absence of `process.cwd()`
  calls that would break inside the pkg bundle.

## [0.0.7] — Fix: Launcher Window Disappears, Exe Download Blocked

### Fixed
- **`Launch Toolbox.bat`** — Server window disappearing on launch (v0.0.6 regression).
  The `start /b` flag ran Node inside the launcher's console window without creating
  a new one. When the bat file exited, the console closed and killed the Node process
  with it. Changed to `start "NodeToolbox Server"` which opens a dedicated, persistent
  server window — the dashboard stays alive after the launcher closes.
- **Exe download blocked by browser** — The raw `nodetoolbox-vX.Y.Z.exe` triggered
  security warnings in Chrome/Edge that prevented download. The release now ships the
  exe inside a dedicated `nodetoolbox-vX.Y.Z-exe.zip`, bypassing browser exe filters.

### Tests Added
- `test/unit/bat-launcher.test.js` — 9 new tests covering: bat file existence, `npm ci`
  auto-install logic, `start` command structure (no `/b`, has window title `"NodeToolbox
  Server"`, passes `--open`), working-directory anchor via `%~dp0`.
- `test/integration/bat-launch.test.js` — 5 functional tests that **actually execute
  `Launch Toolbox.bat` via `cmd.exe`**, let the bat exit, then verify the server is
  still alive on port 5555. Uses `netstat -ano` + `taskkill /F /PID` for
  environment-agnostic process management (no PowerShell restrictions).

## [0.0.6] — Persistent Config, Credential Obfuscation & Slim Distribution

### Added
- **Persistent config across upgrades**: credentials are now stored in
  `%APPDATA%\NodeToolbox\toolbox-proxy.json` instead of alongside `server.js`.
  Upgrading to a new version no longer requires re-running the setup wizard.
- **Credential obfuscation**: PATs, API tokens, and passwords are base64-encoded
  on disk so they are not visible in plain text to a casual viewer.
- **Automatic migration**: on first launch of v0.0.6+, any existing co-located
  `toolbox-proxy.json` is automatically imported to AppData and the original file
  is removed.
- **Slim distribution zip**: `node_modules` is no longer bundled in the release
  zip. The zip now contains ~30 files instead of ~5 000+, making extraction
  near-instant. Dependencies are auto-installed via `npm ci` on first launch.
- **Single-file Windows exe**: the release now ships a standalone
  `nodetoolbox-vX.Y.Z.exe` built with `@yao-pkg/pkg`. No extraction or Node.js
  install required — download and double-click.

### Changed
- `Launch Toolbox.bat` now auto-installs production dependencies (`npm ci
  --omit=dev`) when `node_modules` is absent, enabling the slim zip workflow.
- Release script (`local-release.ps1`) now publishes the GitHub Release
  directly using `gh release create` — no GitHub Actions required.
  Running the script is the complete release process: build zip, build exe,
  create tag, upload assets.
- Release script (`local-release.ps1`) accepts an optional `patch`/`minor`/`major`
  positional argument to bump the version in `package.json` before building.

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
