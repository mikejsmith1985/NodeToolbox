# Implementation Plan: SNow Hub Wizard (Standalone)

**Branch**: `feature/040-snow-hub-wizard` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/040-snow-hub-wizard/spec.md`

## Summary

A single, shareable HTML file that runs three wizards — Create/Modify a change, Problem → Jira, Review a change — with
no Toolbox install and no local server. **The whole feature turns on one unproven capability**: reaching ServiceNow and
Jira from a page with no server, when Chrome/Edge sever tab-to-tab messaging under ServiceNow's
`Cross-Origin-Opener-Policy: same-origin` (Toolbox abandoned exactly that path for its local HTTP bridge — CHANGELOG
"HTTP relay bridge for Chrome (COOP fix)"). So **Phase A is a live Relay Probe** the owner runs in production; nothing
else is built until its result picks the transport (research R-001, contract `relay-probe.md`).

The leading candidate (**"host in ServiceNow's origin"**): the HTML file is the *launcher* — it teaches the user to drag
one **SNow Wizard** bookmark to the bar. Clicked on a ServiceNow tab, the bookmark opens the app in a new window that
belongs to **ServiceNow's own origin**, so every ServiceNow call is a plain same-origin request with the user's session —
no relay at all. Clicked on a Jira tab the same bookmark becomes the **Jira agent**, answering the app over
`postMessage` (works only if Jira does not send COOP — the probe decides).

Everything behind the transport is **reuse, compiled from the same source**: the wizard bundle aliases
`services/relayBridgeApi.ts` to a wizard transport and injects a `/jira-proxy` fetch router, so the existing
`snowApi`, `jiraApi`, `useCrgState` (create/update/CTASK/outage/PRB-link), the formula/RCP/CTASK rules, the approval
email and the change-plan document run **unchanged**. New work is the wizard shell, the pure step/plan engines, the
CTASK × environment plan, the coaching writer, the Defect + SL + QE creator, the transport, and a single-file build.

## Technical Context

**Language/Version**: TypeScript 5 / React 19 (the existing `client/` source)

**Primary Dependencies**: existing only — React, zustand, esbuild (already a root dev dependency, used for three engine
bundles). **No new packages.**

**Storage**: the browser storage of the origin the app runs in (namespaced `snowWizard:*`): in-progress jobs, CTASK
environment defaults. Nothing leaves the browser except ServiceNow and Jira calls (FR-003b).

**Testing**: vitest + Testing Library (unit, 100% mocked); the Relay Probe and quickstart are the live/integration layer
(owner-run in production, per standing practice — Jira/SNow are reachable only there).

**Target Platform**: Chrome and Edge (current), Windows, corporate SSO sessions.

**Project Type**: single-file web application built from the existing client source tree.

**Performance Goals**: file opens < 2 s; each wizard step renders < 200 ms; Create of a 3-environment change finishes
in the same time Toolbox takes today (same calls).

**Constraints**: one HTML file; no server; no stored credentials; no new dependency; bookmark payload under the Chromium
URL limit (budget ≤ 1.5 MB, R-004); Toolbox's SNow Hub behaviour byte-identical (SNow Hub is release-critical).

**Scale/Scope**: 3 jobs, ~22 wizard screens, shared with 039's readiness engine.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Article | Verdict | Evidence |
|---|---|---|
| III Branching | ✅ | `feature/040-snow-hub-wizard` |
| IV Code quality | ✅ | engines pure, < 40-line functions, named constants (e.g. `WIZARD_BOOKMARK_BUDGET_BYTES`) |
| V Testing / TDD | ✅ | every new module has a failing test first; probe + quickstart are the live layer |
| VI Docs | ✅ | CHANGELOG per PR; spec tree exempt; no status docs |
| VII Framework-first | ✅ with **2 recorded drifts** | see below |
| VIII Release | ✅ | `scripts/local-release.ps1`; the HTML is attached to the GitHub Release as an asset |
| IX Vault | ✅ | no secrets: the user's own browser session; no token is stored or logged |
| X Proof | ✅ | Phase A probe is literal proof-before-build; SC-005 parity test |
| XI Restraint | ✅ | no dashboard |

**Framework-first (reuse map)** — 20 of 26 capabilities are reuse:

| Capability | Source | Kind |
|---|---|---|
| ServiceNow/Jira API calls | `services/snowApi.ts`, `services/jiraApi.ts` | reuse via build alias/inject |
| Create N env changes, CTASK reconcile, outage, PRB link, update existing | `hooks/useCrgState.ts` (`storageKey` option, 033) | reuse |
| Choice lists (CTASK types, fields) | `useChangeTaskTypeOptions`, existing choice readers | reuse |
| Checks | 039 `changeReadiness.ts` engine + `formulaCard`, `rcpRules`, `ctaskReviewRules`, `evidenceRules` | reuse/shared |
| AI prompt/ingest | `chgRiskCheckPrompt`, `chgGapFixPrompt`, `AiAssistPromptModal` pattern — **no unlock gate** in the Wizard (clarified: AI visible to everyone) | reuse |
| Approval email / plan PDF | `rcp/rcpApprovalEmail.ts`, `rcp/changePlanDocument.ts` (print-to-PDF) | reuse |
| Evidence attach | `testEvidence/*` (`zipArchive`, `snowAttachmentUpload`) | reuse |
| PRB read | `usePrbState` readers | reuse |
| Bundle to one file | esbuild `bundle` + `alias` + `inject` | framework-native |
| Bookmark body | `services/browserRelay.ts` token resolver | reuse (string) |
| **Transport without server** | — | **new** (documented gap: Toolbox's only working Chrome path needs its local server) |
| **Wizard shell** | 039 `components/GuidedFlow/GuidedFlowShell` | reuse if shipped, else built there once |
| CTASK × environment plan | — | new (pure) — no such rule exists (inventory) |
| Coaching note | — | new (pure) |
| Defect + SL + QE with Epic + links | — | new (pure plan + `jiraApi` writes) |
| Single-file HTML writer | — | new script (~60 lines), mirrors `scripts/generate-embedded-client.js` |

**Recorded drifts**: (1) **`useCrgState.createChg` gains one optional `ctaskEnvironmentPlan`** — omitted ⇒ every staged
CTASK on every environment (today's behaviour, byte-identical); Toolbox callers pass nothing. (2) **The wizard
transport** replaces `relayBridgeApi` only inside the wizard bundle; Toolbox's build is untouched.

## Project Structure

### Documentation (this feature)

```text
specs/040-snow-hub-wizard/
├── plan.md · research.md · data-model.md · quickstart.md
├── contracts/
│   ├── relay-probe.md           # Phase A gate — live proof of the transport
│   ├── wizard-transport.md      # bookmark roles, message protocol, alias/inject seam
│   ├── single-file-build.md     # esbuild → one HTML launcher with embedded bookmark
│   ├── wizard-shell.md          # step rules, connection banner, resume
│   ├── change-wizard.md         # Create/Modify steps + CTASK × environment plan
│   ├── checks-and-coaching.md   # shared checks, coaching note
│   └── prb-to-jira.md           # Defect + SL + QE, Epic, links, idempotent retry
└── tasks.md                     # /speckit-tasks
```

### Source Code (repository root)

```text
client/src/snowWizard/
├── probe/relayProbe.entry.ts          # Phase A — standalone probe page
├── main.entry.tsx                     # wizard app entry (React root)
├── launcher/launcherPage.ts           # the HTML file's own content: instructions + draggable bookmark
├── transport/
│   ├── bookmarkPayload.ts             # builds the javascript: bookmark (role by hostname)
│   ├── snowSameOriginTransport.ts     # same-origin fetch with X-UserToken
│   ├── jiraOpenerTransport.ts         # postMessage request/response to the Jira agent tab
│   ├── relayBridgeShim.ts             # same exports as services/relayBridgeApi.ts (aliased)
│   └── jiraProxyFetch.ts              # injected fetch: /jira-proxy/* → Jira agent
├── shell/  WizardHome.tsx · ConnectStep.tsx · ConnectionBanner.tsx · wizardJobStore.ts
├── change/ changeWizardSteps.ts · ctaskEnvironmentPlan.ts · ChangeWizard.tsx · steps/*.tsx
├── prb/    prbJiraPlan.ts · prbJiraCreate.ts · PrbWizard.tsx
├── review/ coachingNote.ts · ReviewWizard.tsx
└── **/*.test.ts(x)
scripts/build-snow-wizard.js           # esbuild bundle → dist/snow-hub-wizard.html
client/src/views/SnowHub/hooks/useCrgState.ts   # additive: optional ctaskEnvironmentPlan (drift 1)
client/src/views/SnowHub/guided/changeReadiness.ts  # 039 engine — consumed, built there if not yet shipped
```

**Structure Decision**: one new top-level folder `client/src/snowWizard/` compiled by its own esbuild entry, so the
Toolbox Vite build never sees it and it reuses Toolbox modules by import. Toolbox's SNow Hub files receive one additive
optional parameter, nothing else.

## Phasing (each phase ships alone)

| Phase | Delivers | Gate to next |
|---|---|---|
| **A** | Relay Probe HTML (attached to a release) | **owner runs it in production; the result matrix picks the transport (R-001 decision tree)** |
| B | Transport + single-file build + Home + Connect | live "connected to both" on the owner's machine |
| C | P1 New change wizard (incl. CTASK × env, checks, email/PDF) | quickstart V-01…V-06 |
| D | P2 Modify | V-07…V-09 |
| E | P3 Problem → Jira | V-10…V-12 |
| F | P4 Review + coaching | V-13…V-15 (parity with C's checks) |

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|
| A new transport | Owner chose "no server" (spec FR-003); Toolbox's working path *is* a server | Reusing the local bridge = option A/C, which the owner declined |
| Optional param on `useCrgState.createChg` | Business Checkout on PRD but not REL needs per-environment CTASK lists | A wizard-side copy of `createChg` would fork 300 lines of release-critical create logic |
