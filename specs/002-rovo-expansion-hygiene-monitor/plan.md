# Implementation Plan: Rovo Expansion + Proactive Hygiene Monitor

**Branch**: `002-rovo-expansion-hygiene-monitor` | **Date**: 2026-06-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-rovo-expansion-hygiene-monitor/spec.md`

## Summary

Expand the existing Rovo dispatch-and-poll pattern (send a prompt to an Atlassian
Automation webhook → Rovo writes its answer to a Confluence parking page → Toolbox
reads it back by `correlationId`) to three more existing surfaces, then add a new
server-side **proactive Jira hygiene monitor** scheduler. The monitor scans open
issues daily, asks Rovo to classify each hygiene violation as `FIXABLE` or
`UNFIXABLE`, applies Jira field fixes for fixable items through Toolbox's existing
Jira proxy, posts a Jira comment for unfixable items, and delivers a digest to a
Teams webhook via the existing report delivery engine. Every Rovo affordance stays
behind the Ctrl+Alt+Z passphrase gate, and all config lives in the Admin Hub.

Technical approach: **reuse, don't rebuild.** Schedulers already exist and follow a
single-`setInterval`-per-minute pattern; the Rovo exchange (`dispatchPrompt` /
`fetchResult`) is already a server-side module; report delivery and the
Atlassian-host allow-list already exist. The one genuinely new server capability is
running the **hygiene rules server-side** — today they live only in the client
(`client/src/views/Hygiene/checks/hygieneChecks.ts`). The plan extracts those pure
rule functions into a shared, server-consumable module so the scheduler evaluates
issues with the exact same logic the Hygiene view shows.

## Technical Context

**Language/Version**: Node.js (CommonJS) for the server/proxy; TypeScript + React 18 (Vite) for the client. Packaged to a single Windows `.exe` via `pkg`.

**Primary Dependencies**: Express (proxy + API routes), existing `rovoExchange` service, existing scheduler services (`standupBriefingScheduler`, `scopeChangeScheduler`, `featureChangeScheduler`), `reportWebhookDelivery` service, `reportSurfaceRegistry`; React + Zustand (`rovoStore`) on the client.

**Storage**: JSON config at `%APPDATA%\NodeToolbox\toolbox-proxy.json` via `src/config/loader.js` (survives upgrades; credential-style fields base64-obfuscated). No database. Scan-history/trend state persisted in the same config file (small, bounded).

**Testing**: Server — Jest (`npx jest`), unit tests mock all I/O. Client — Vitest (`npx vitest run`), React Testing Library. TDD (red→green→refactor).

**Target Platform**: Local Windows desktop app (`node server.js` in dev, `nodetoolbox.exe` in release). Outbound HTTPS only to Atlassian hosts + the configured Teams webhook.

**Project Type**: Web application — Express backend (`src/`) + React SPA (`client/`).

**Performance Goals**: Rovo enrichment of a scheduler run adds ≤30s to delivery (SC-001) and is non-blocking. A full per-team hygiene scan completes within one scheduler tick window and does not block other schedulers.

**Constraints**: Rovo never touches Jira — Toolbox owns all Jira reads/writes. All Rovo UI invisible without the passphrase gate. All outbound webhooks pass the existing Atlassian-host allow-list (the Teams webhook is the one allowed non-Atlassian destination, configured explicitly per team). All new config in Admin Hub only.

**Scale/Scope**: Single-user desktop tool. Per-team hygiene scan over the configured project keys' open issues (tens to low-hundreds of issues per team). 3 scheduler surfaces enriched + 2 CHG wizard steps + 1 new scheduler + 1 new Admin Hub config panel + 1 Hygiene Monitor panel.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

No `.specify/memory/constitution.md` exists; the governing rules are the Articles in
`CLAUDE.md` / `.github/copilot-instructions.md`. Gates derived from them:

| Gate (Article) | Status | Notes |
|---|---|---|
| III — Branching (feature branch, PR) | PASS | Work proceeds on `002-rovo-expansion-hygiene-monitor`; no direct commits to `main`. |
| IV — Code Quality (names, comments, <40-line funcs, no magic numbers) | PASS | New code follows the same conventions as existing schedulers/services. |
| V — Testing (three-layer, TDD, unit <10ms mocked) | PASS | Each new pure helper (rule eval, classification parse, digest builder) is unit-tested with mocked I/O before implementation. |
| VI — Documentation (CHANGELOG single source; specs/ exempt) | PASS | CHANGELOG updated per PR; this `specs/` tree is the exempt pipeline artifact. |
| VII — Framework-First (don't rebuild what exists) | PASS w/ one tracked extraction | Reuses `rovoExchange`, scheduler pattern, `reportWebhookDelivery`, allow-list, passphrase gate. The only new "infrastructure" is making the **existing** hygiene rules runnable server-side — an extraction of existing logic, not a rebuild. See Complexity Tracking. |
| VIII — Release (local pipeline only) | PASS | Ships via `scripts/local-release.ps1`; no GitHub Actions. |
| IX — Vault Zero-Knowledge (secrets injected, never in logs) | PASS | Teams webhook URL/secret stored obfuscated in config like other credentials; never logged. |
| X — Verification & Proof (behaviour evidence) | PASS | Quickstart defines runnable validation per acceptance scenario; scheduler logs record Rovo-skipped vs Rovo-applied. |
| XI — Output Restraint (one dashboard, no narration) | PASS | No new dashboards; results surface in the existing Hygiene/Admin Hub panels and Server Logs. |

**Result**: PASS. One item tracked in Complexity Tracking (server-side hygiene rule reuse).

## Project Structure

### Documentation (this feature)

```text
specs/002-rovo-expansion-hygiene-monitor/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── hygiene-monitor-api.md      # New server routes (config, scan, status)
│   └── rovo-classification.md      # Rovo prompt/response contract for classification
├── checklists/          # (pre-existing)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/                                      # Express backend (CommonJS)
├── services/
│   ├── rovoExchange.js                   # REUSE — dispatchPrompt / fetchResult
│   ├── standupBriefingScheduler.js       # EDIT — add non-blocking Rovo insight block (FR-001)
│   ├── scopeChangeScheduler.js           # EDIT — add Rovo trend paragraph (FR-002)
│   ├── featureChangeScheduler.js         # EDIT — add Rovo trend paragraph (FR-002)
│   ├── reportWebhookDelivery.js          # REUSE — Teams digest delivery (FR-012)
│   ├── hygieneRules.js                   # NEW — server-side port of the pure hygiene checks
│   ├── hygieneMonitorScheduler.js        # NEW — daily scan scheduler (FR-007..FR-012, FR-016)
│   └── rovoEnrichment.js                 # NEW — shared "dispatch + poll + fallback" helper for schedulers
├── routes/
│   ├── rovoExchange.js                   # REUSE — existing dispatch/result endpoints
│   └── hygieneMonitor.js                 # NEW — GET/POST config, POST scan, GET status (FR-013/014)
└── config/
    └── loader.js                         # EDIT — persist hygieneMonitor + scan-history sections

client/src/                               # React SPA (TypeScript)
├── views/
│   ├── SnowHub/
│   │   ├── tabs/CreateChgTab.tsx         # EDIT — "Draft with Rovo" (Step 3), "Risk check" (Step 6)
│   │   └── hooks/useRovoExchange.ts      # REUSE — dispatch/poll hook
│   ├── Hygiene/
│   │   ├── HygieneView.tsx               # EDIT — mount the gated Hygiene Monitor panel (FR-013)
│   │   ├── checks/hygieneChecks.ts       # REUSE/REFACTOR — pure checks become the shared source of truth
│   │   └── components/HygieneMonitorPanel.tsx   # NEW — last/next scan, per-team trends, Scan Now
│   └── AdminHub/
│       └── HygieneMonitorPanel.tsx       # NEW — config form (schedule, project keys, Teams webhook, mappings)
└── store/rovoStore.ts                    # REUSE — shared passphrase-gate unlock state
```

**Structure Decision**: Existing Express-backend + React-SPA split. New server
modules sit beside the existing schedulers and reuse their lifecycle; new client
panels mount inside the existing Hygiene and Admin Hub views. The shared
hygiene-rule logic is the single deliberate new server module, justified below.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| New server module `hygieneRules.js` mirroring logic in `client/.../hygieneChecks.ts` | The proactive monitor is a server-side scheduler; the rule functions must run where the scan runs, and the Hygiene view + monitor must agree exactly on what counts as a violation. | A headless scheduler cannot call the client to evaluate rules. Re-implementing rules ad hoc in the scheduler would drift from the Hygiene view. The plan therefore **extracts the existing pure check functions** (already `(issue, fieldConfig) → flag`) into one shared, dependency-free module — minimizing duplication rather than rebuilding. Field mappings stay Admin-Hub-driven so both sides remain in lockstep. |
