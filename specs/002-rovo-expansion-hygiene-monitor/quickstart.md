# Quickstart & Validation: Rovo Expansion + Proactive Hygiene Monitor

Runnable validation scenarios proving the feature works end-to-end. Each maps to an
acceptance scenario / success criterion in [spec.md](./spec.md). Implementation
detail lives in `tasks.md` (Phase 2) and the code — this is the run/verify guide.

## Prerequisites
- NodeToolbox running in dev: `node server.js` (or the built `nodetoolbox.exe`).
- Client built when testing UI: `npm run build:client`.
- Rovo configured (Admin Hub → ⚡ Rovo): webhook URL + secret + parking page id; the
  Atlassian Automation rule writes the marker + `{{rovoResponse}}` to the page.
- Passphrase gate unlocked in the session (Ctrl+Alt+Z → passphrase).
- A Teams incoming webhook URL for a test channel (Phase 2 digest).

## Test commands
- Server unit tests: `npx jest src/services/hygieneRules.test.js src/services/hygieneMonitorScheduler.test.js src/services/rovoEnrichment.test.js src/routes/hygieneMonitor.test.js`
- Client unit tests: `cd client && npx vitest run src/views/Hygiene src/views/SnowHub src/views/AdminHub`
- Full suites before release: `npx jest` and `cd client && npx vitest run`

---

## Phase 1 — Scheduler enrichment

### V1 — Standup briefing insight block (FR-001, SC-001, SC-008)
1. Configure a standup briefing schedule due now; ensure Rovo enabled + unlocked.
2. Let the scheduler fire (or trigger its test endpoint).
3. **Expect**: the Confluence post shows a Rovo insight block **above** the data
   tables; Server Logs show the enrichment ran; delivery time within +30s of baseline.
4. **Negative (SC-008)**: point Rovo at an unreachable webhook; fire again.
   **Expect**: the briefing still publishes, no Rovo block, log line
   `[Rovo] enrichment skipped (<reason>)`, no user-facing error.

### V2 — Scope/Feature change trend paragraph (FR-002, SC-002)
1. Configure a scope-change (and feature-change) report with real changes; fire it.
2. **Expect**: a Rovo trend paragraph appears above the change table naming the
   release most at risk. With Rovo down, the report still publishes (non-blocking).

---

## Phase 1 — CHG wizard extension

### V3 — Draft with Rovo, Step 3 (FR-004, SC-003, SC-007)
1. In the CHG wizard, fetch Jira issues (Step 1). Without unlocking, confirm the
   "Draft with Rovo" action is **not visible** (SC-007).
2. Unlock (Ctrl+Alt+Z), go to Step 3, click **Draft with Rovo**.
3. **Expect**: Short Description + Description populate from the Jira content within
   a reasonable wait; both remain editable; you can proceed without using it (FR-006).

### V4 — Risk check with Rovo, Step 6 (FR-005, SC-003)
1. Complete Steps 3–5; at Step 6 click **Risk check with Rovo**.
2. **Expect**: an inline list of gaps/risks appears before submission; you may submit
   regardless. Re-lock (Ctrl+Alt+Z) ⇒ both actions disappear without reload (FR-015).

---

## Phase 2 — Proactive hygiene monitor

### V5 — Configure a team (FR-014)
1. Admin Hub → Hygiene Monitor config: add a team (name, project keys, `06:00`,
   Mon–Fri, Teams webhook, field mappings, enabled checks). Save.
2. **Expect**: `GET /api/hygiene-monitor/config` reflects it; secret not echoed;
   config survives a restart (persisted in `%APPDATA%`).

### V6 — Manual scan, fix + comment (FR-008/009/010/011, SC-005)
1. Seed a project with a known **fixable** violation (e.g. missing acceptance
   criteria) and a known **unfixable** one (e.g. missing assignee).
2. Hygiene Monitor panel (unlocked) → **Scan Now**; watch progress.
3. **Expect**: the fixable field is updated in Jira (visible on the issue) and only
   counts as resolved after a 2xx; the unfixable issue receives **one** Jira comment
   with owner guidance, attributed to the hygiene monitor.

### V7 — Digest to Teams + trend (FR-012, SC-004, SC-009)
1. After V6, check the Teams channel.
2. **Expect**: a digest listing issues scanned / violations / fixes applied / actions
   required. Run a second scan ⇒ digest shows a trend ↑/↓ vs the prior scan.
3. **Negative**: clear the Teams webhook ⇒ scan still runs and applies fixes/comments;
   digest delivery is silently skipped.

### V8 — Dedup + edge cases (FR-016, SC-006)
1. Re-run the scan in the same cycle against the same unfixable issue.
2. **Expect**: no second comment for the same violation in that cycle (exactly one).
3. **Malformed Rovo / rejected Jira field**: confirm the affected issue is skipped or
   re-routed to a comment, the run continues, and the failure appears in the digest.

### V9 — Clean scan (edge case)
1. Point a team at a project with zero violations; scan.
2. **Expect**: a digest is still delivered confirming a clean scan; no Jira comments.

---

## Gate before release
- All new unit tests green; full `npx jest` and `vitest run` green.
- SC-007 spot check: with the gate locked, no Rovo button/panel/insight is reachable.
- SC-008 spot check: every briefing/report still publishes with Rovo forced offline.
