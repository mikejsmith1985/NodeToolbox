# Toolbox — Node.js Architectural Pivot

## Status: POC VALIDATED ✅ — Implementation In Progress

All three services confirmed working in GPO-locked environment (Jira, GitHub, ServiceNow).
Language: **Node.js** throughout. No Python. No `.bat`/`.vbs` launchers.

---

## Problem Statement

Current deployment story for end users:
1. Download `toolbox.html` + `toolbox-server.js`
2. Open a terminal, navigate to the folder, type `node toolbox-server.js`
3. Keep the terminal open forever
4. Open browser to `localhost:5555`

**Goal:** download server + double-click launcher → browser opens → done. Zero terminal interaction.

---

## What Stays the Same

| Item | Status |
|---|---|
| `toolbox.html` + all `src/` front-end source | **Not touched** |
| `toolbox-proxy.json` config format | **Unchanged** |
| All existing API endpoints (`/api/*`, `/jira-proxy/*`, `/snow-proxy/*`, `/github-proxy/*`) | **Unchanged** |
| `build.js`, Cypress tests, `npm run build` / `npm test` | **Unchanged** |

---

## What Changes

1. `toolbox-server.js` — refactored from stdlib `http` to **Express**
2. First-run setup wizard at `/setup` — no terminal config editing, ever
3. Windows `.lnk` launcher — `npm run create-launcher` generates it
4. `toolbox-server.py`, `start-proxy-silent.vbs`, `start-proxy.bat` — **retired**
5. Connection wizard — Python download steps removed, Node.js path replaces them
6. `build.js` — embeds `toolbox-server.js` (not `.py`) for wizard download

---

## Target Architecture

```
ToolBox/
  toolbox-server.js          # Entry point — Express app
  routes/
    proxy.js                 # /jira-proxy/*, /snow-proxy/*, /github-proxy/*
    api.js                   # /api/proxy-status, /api/proxy-config, /api/snow-session
    scheduler.js             # /api/scheduler/*
    setup.js                 # /setup — first-run wizard (GET + POST /api/setup)
  middleware/
    cors.js                  # CORS headers middleware
  toolbox-proxy.json         # Credentials config (format unchanged)
  "Launch Toolbox.lnk"       # Windows shortcut → node.exe toolbox-server.js
  package.json               # express added as runtime dependency
```

---

## Phase 1 — Express Refactor

**`package.json`**
- Add `"express": "^4.21.x"` as a `dependency` (runtime, not devDependency)
- Add `"start": "node toolbox-server.js"` script
- Add `"create-launcher": "node scripts/create-launcher.js"` script

**`routes/proxy.js`**
- Express router for `/jira-proxy/*`, `/snow-proxy/*`, `/github-proxy/*`
- `proxyRequest()` and auth helpers move here verbatim from `toolbox-server.js`

**`routes/api.js`**
- Express router for `/api/proxy-status`, `/api/proxy-config`, `/api/snow-session`
- Handler functions move verbatim

**`routes/scheduler.js`**
- Express router for all `/api/scheduler/*` endpoints
- Full scheduler logic (repo monitor, Jira comment posting, transition firing) moves here

**`middleware/cors.js`**
- `writeCorsHeaders()` extracted as Express middleware

**`toolbox-server.js`** (refactor, not rewrite)
- Replace `http.createServer()` + manual 100-line router with `express()` + `app.use(router)`
- Import all routes and middleware above
- `app.listen()` replaces `server.listen()`
- All startup logging, config loading, scheduler init unchanged

---

## Phase 2 — First-Run Setup Wizard

**`routes/setup.js`**
- `GET /setup` — serves self-contained HTML wizard (same 3-card pattern as `toolbox-poc.js`)
- Cards: Jira (URL + PAT, test button), GitHub (PAT, test button), ServiceNow (URL, connectivity test)
- `POST /api/setup` — validates credentials, writes `toolbox-proxy.json`, redirects to `/`

**First-run detection in `toolbox-server.js`**
- On every `GET /`: if `toolbox-proxy.json` is missing or Jira URL is blank → `302 /setup`
- After setup saves credentials → `GET /` serves `toolbox.html` normally
- `toolbox.html` itself does not change

---

## Phase 3 — Windows Launcher

**`scripts/create-launcher.js`**
- Creates `Launch Toolbox.lnk` using `WScript.Shell` COM object
- Target: `node.exe` full path (resolved from `process.execPath` or `Get-Command node`)
- Arguments: absolute path to `toolbox-server.js`
- WorkingDirectory: repo root
- Bypasses WSH `.js` file association (confirmed working in POC validation)

**Distribution package:**
- `toolbox-server.js`
- `package.json` + `node_modules/` (after `npm install`)
- `Launch Toolbox.lnk` (pre-built)
- `toolbox.html` (from `dist/`)

---

## Phase 4 — Retire Python & Old Launchers

**Delete:**
- `toolbox-server.py`
- `start-proxy-silent.vbs`
- `start-proxy.bat`

**Update:**
- `build.js` — remove step 11 (embedding `toolbox-server.py` as `#tbx-embedded-server-py`)
- `src/js/19-conn-wizard.js` — remove "Plan B: Python proxy" step; replace with Node.js server download
- `src/js/31-misc-extras.js` — rename `tbxWizDownloadServerPy()` → `tbxWizDownloadServerJs()`

---

## Phase 5 — Release Pipeline

**`scripts/local-release.ps1`**
- Add `npm install` step before packaging
- Add `npm run create-launcher` to regenerate `.lnk`
- Bundle `Launch Toolbox.lnk` in GitHub release assets

---

## Decisions Log

| Question | Decision | Reason |
|---|---|---|
| Python vs Node.js? | Node.js | 41,539 lines of existing JS front-end; same language front-to-back |
| `.bat` launcher? | No — GPO-blocked | Confirmed in user's environment |
| `.lnk` launcher? | Yes | Targets `node.exe` directly; not GPO-restricted; proven in POC |
| `toolbox.html` changes? | No | Express just serves it; front-end is untouched |
| Config format changes? | No | `toolbox-proxy.json` format identical |
| Central deployment now? | No — architectured for it | Express → Docker → PM2 path is clear, not needed yet |
| Keep Python as fallback? | No | Clean deletion avoids user confusion |
