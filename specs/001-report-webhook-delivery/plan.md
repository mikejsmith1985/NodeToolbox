# Implementation Plan: Report Webhook Delivery

**Branch**: `feature/report-webhook-delivery` | **Date**: 2026-06-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-report-webhook-delivery/spec.md`

## Summary

Add a one-click "Send to Automation" action to the three report surfaces
(Standup Briefing, Scope Change report, Feature Change report) that delivers the
**same report content the user already generates** to that team's **existing**
Atlassian Automation webhook. Delivery is **server-mediated**: the browser posts
the report to a thin internal endpoint; the server resolves the team's already-
stored `triggerUrl` + `triggerSecret`, validates the destination host against an
Atlassian allow-list, redacts credential-pattern values (notifying the user),
wraps the content in a `payloadContext` envelope, and reuses the existing
`triggerWebhook` helper to POST it. A generated `docs/automation-mappings.md`
documents each surface's payload shape and a matching Rovo System Prompt template.

## Technical Context

**Language/Version**: Node.js 18+ (server, CommonJS) · TypeScript 5 / React 18 (client, Vite)

**Primary Dependencies**: None new. Reuses native `http`/`https`, existing
`src/utils/httpClient.js#triggerWebhook`, existing per-team notification config in
`src/routes/notifications.js`, and existing client report generators.

**Storage**: Existing per-team webhook config (server-side notifications config:
`triggerUrl`, `triggerSecret`, per team/project). No new persistent store.

**Testing**: Jest for server (`src/**/*.test.js`, unit <10ms, fully mocked) ·
Vitest for client (`client` workspace).

**Target Platform**: Local developer web app (Express server + React SPA).

**Project Type**: Web application (client + server).

**Performance Goals**: User-triggered single webhook POST; perceived result in
<2s under normal network; UI never blocks on delivery.

**Constraints**: No new third-party packages (FR-010); native HTTP only;
Atlassian-host allow-list enforced server-side (FR-005); secret never in URL or
logs (FR-006); credential-pattern redaction with user notice (FR-007); all
delivery wrapped in error handling, no silent failure (FR-008).

**Scale/Scope**: 3 report surfaces; per-team destinations; low call volume
(manual, on-demand). ~5 new small server modules + 1 client action + 1 docs
generator.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

> No `.specify/memory/constitution.md` exists. The governing principles are the
> project's binding rules in `CLAUDE.md` / `.github/copilot-instructions.md`
> (Naming, Comments, Structure, Branching, Documentation discipline, Testing TDD,
> Framework-First). Gates evaluated against those.

| Gate | Status | Notes |
|------|--------|-------|
| **Framework-First** (don't rebuild what exists) | ✅ Pass | Reuses `triggerWebhook`, existing per-team config, existing report generators. New code only fills documented gaps: host allow-list, secret redaction, thin delivery endpoint + UI, docs generator. |
| **Testing (TDD, every new source file has a test, unit <10ms)** | ✅ Pass | Each new server module ships with a colocated `*.test.js` written first. Satisfies the pre-commit test-coverage gate (no bypass needed). |
| **Code Quality** (naming, ≤40-line funcs, comments, no magic values) | ✅ Pass | Enforced during implementation; named constants for the allow-list and redaction patterns. |
| **Documentation discipline** (CHANGELOG single source of truth) | ✅ Pass | CHANGELOG updated; `docs/automation-mappings.md` is a feature deliverable (FR-011), not an ad-hoc status doc. |
| **No new dependencies** | ✅ Pass | Native `http`/`https` + existing utils only. |
| **Branching (GitHub Flow)** | ✅ Pass | On `feature/report-webhook-delivery`. |

**Result**: No violations. Complexity Tracking section intentionally empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-report-webhook-delivery/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── deliver-endpoint.md
│   └── payload-envelope.schema.json
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── utils/
│   ├── httpClient.js                 # EXISTING — reuse triggerWebhook (unchanged)
│   ├── webhookHostPolicy.js          # NEW — Atlassian-host allow-list validation
│   ├── webhookHostPolicy.test.js     # NEW
│   ├── secretRedactor.js             # NEW — redact credential patterns, report status
│   └── secretRedactor.test.js        # NEW
├── services/
│   ├── reportWebhookDelivery.js      # NEW — resolve config → validate → redact → envelope → triggerWebhook
│   └── reportWebhookDelivery.test.js # NEW
├── routes/
│   ├── notifications.js              # EXISTING — config source (read team triggerUrl/secret)
│   ├── reportDelivery.js             # NEW — POST /api/reports/deliver
│   └── reportDelivery.test.js        # NEW
└── server.js                         # EXISTING — wire new route

scripts/
└── generate-automation-mappings.js   # NEW — emits docs/automation-mappings.md

docs/
└── automation-mappings.md            # GENERATED (FR-011)

client/src/
├── api/
│   └── reportDelivery.ts             # NEW — calls POST /api/reports/deliver
├── components/
│   └── SendToAutomationButton.tsx    # NEW — shared action button + result/redaction notice
└── views/
    ├── SprintDashboard/StandupTab.tsx        # EDIT — add button next to Copy Briefing
    └── ReportsHub/ReportsHubView.tsx         # EDIT — add button on Scope/Feature Change
```

**Structure Decision**: Web application. Server stays CommonJS under `src/`,
client stays React/TS under `client/src/`. Delivery logic is server-side so the
team's webhook secret never reaches the browser and host validation cannot be
bypassed by a client. The client only sends report content + the target surface
and team identifier to the internal endpoint.

## Complexity Tracking

> No constitution violations — section intentionally empty.

## Phase 0 — Research

See [research.md](./research.md). Resolves: client-direct vs server-mediated
delivery, host allow-list definition, redaction strategy, and envelope naming.

## Phase 1 — Design & Contracts

- [data-model.md](./data-model.md) — `payloadContext` envelope, delivery request,
  delivery result, host-policy and redaction rules.
- [contracts/deliver-endpoint.md](./contracts/deliver-endpoint.md) — the internal
  `POST /api/reports/deliver` contract.
- [contracts/payload-envelope.schema.json](./contracts/payload-envelope.schema.json)
  — JSON Schema for the outbound webhook body.
- [quickstart.md](./quickstart.md) — end-to-end validation scenarios.
