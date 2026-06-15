---
description: "Task list for Report Webhook Delivery"
---

# Tasks: Report Webhook Delivery

**Input**: Design documents from `specs/001-report-webhook-delivery/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/
**Tests**: Included — the project mandates TDD (CLAUDE.md Testing rules + the
pre-commit gate requires a test for every new source file).

**Organization**: Grouped by user story. The three deliverable surfaces are
treated as independent increments:

- **US1 (P1, MVP)** — Standup Briefing → Automation webhook
- **US2 (P2)** — Scope Change report → Automation webhook
- **US3 (P3)** — Feature Change report → Automation webhook

The shared delivery engine (host policy, redaction, registry, endpoint, client
button) is Foundational and blocks all three stories.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different file, no dependency on an incomplete task)
- **[Story]**: US1 / US2 / US3 (Setup, Foundational, Polish carry no story label)

## Path Conventions

Web app: server is CommonJS under `src/`; client is React/TS under `client/src/`.

---

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 [P] Add an `[Unreleased]` stub entry for "Report Webhook Delivery" in `CHANGELOG.md`
- [x] T002 [P] Ensure `docs/` directory exists for the generated `docs/automation-mappings.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared, server-mediated delivery engine + reusable client action.
MUST complete before any user story surface can deliver. TDD: each test task
precedes its implementation.

- [x] T003 [P] Write unit tests for the Atlassian host allow-list (accept `https://automation.atlassian.com` and `*.atlassian.net`; reject `http`, non-Atlassian hosts, and look-alikes like `evil-atlassian.net.attacker.com`) in `src/utils/webhookHostPolicy.test.js`
- [x] T004 Implement `isAllowed(url)` (HTTPS only; hostname === `automation.atlassian.com` OR ends with `.atlassian.net` via dot-prefixed suffix match, never `includes()`) in `src/utils/webhookHostPolicy.js`
- [x] T005 [P] Write unit tests for the secret redactor (bearer/authorization tokens, `password=`/`pwd=`, Atlassian API tokens, `key/token/secret=` assignments, `https://user:pass@`; returns `{ value, redactionCount }`) in `src/utils/secretRedactor.test.js`
- [x] T006 Implement `redact(value)` / `redactDeep(obj)` returning redaction count and `«redacted»` marker in `src/utils/secretRedactor.js`
- [x] T007 [P] Write unit tests for the surface registry (each registered surface resolves a config record; unknown surface id throws; report shape exposed for docs) in `src/services/reportSurfaceRegistry.test.js`
- [x] T008 Create the surface registry scaffold (surface ids, labels, per-team config resolver hooks, report shapes) — single source of truth for delivery + docs — in `src/services/reportSurfaceRegistry.js`
- [x] T009 [P] Write unit tests for the delivery service (resolve config; host-fail aborts with NO send; redaction applied & counted; `payloadContext` envelope shape; `triggerWebhook` called with secret as header; 200/409/422/502 result mapping) in `src/services/reportWebhookDelivery.test.js`
- [x] T010 Implement `reportWebhookDelivery` (registry → host policy → redact → build `payloadContext` envelope → reuse `src/utils/httpClient.js#triggerWebhook` → map result) in `src/services/reportWebhookDelivery.js`
- [x] T011 [P] Write unit tests for the deliver route (400 unknown surface / empty report; 409 no destination; 422 disallowed host; 502 webhook failure; 200 success + redaction flag; secret never echoed) in `src/routes/reportDelivery.test.js`
- [x] T012 Implement `POST /api/reports/deliver` (validate → call delivery service → structured JSON result; no secret in logs) in `src/routes/reportDelivery.js`
- [x] T013 Mount the deliver route in `server.js`
- [x] T014 [P] Write the vitest spec for the client API caller (`deliverReport` posts the correct body; maps success/error results) in `client/src/api/reportDelivery.test.ts`
- [x] T015 Implement the client API caller `deliverReport({surface, teamId, report})` in `client/src/api/reportDelivery.ts`
- [x] T016 [P] Write the vitest spec for the shared send button (disabled when no destination; renders success/redaction/failure states) in `client/src/components/SendToAutomationButton.test.tsx`
- [x] T017 Implement the shared `SendToAutomationButton` (calls `deliverReport`, shows status + "N value(s) redacted" notice, never blocks UI) in `client/src/components/SendToAutomationButton.tsx`

**Checkpoint**: Engine + button exist and are unit-tested; no surface wired yet.

> Note: T008 implements all three surface resolvers up front; the per-story
> T018/T021/T024 reduce to verifying each resolver + wiring that surface's button.

---

## Phase 3: User Story 1 — Standup Briefing (P1) 🎯 MVP

**Goal**: A user can push a generated Standup Briefing to the team's Automation webhook.
**Independent test**: With a configured team, click "Send to Automation" on a briefing → 200 success; disallowed host → 422, nothing sent; clipboard copy still works.

- [x] T018 [US1] Verify the `standup-briefing` resolver (added to the registry in T008) resolves the standup config's per-team `triggerUrl`/`triggerSecret` from `src/routes/standupBriefing.js`
- [x] T019 [US1] Add `SendToAutomationButton` beside "Copy Briefing", passing the current `briefingText`, in `client/src/views/SprintDashboard/StandupTab.tsx`
- [x] T020 [P] [US1] Extend the StandupTab test to cover the send action, the no-destination disabled state, and that **Copy Briefing still works**, in `client/src/views/SprintDashboard/StandupTab.test.tsx`

**Checkpoint**: US1 is independently shippable (MVP).

---

## Phase 4: User Story 2 — Scope Change report (P2)

**Goal**: A user can push the on-screen Scope Change report to the team's Automation webhook.
**Independent test**: On the Scope Change tab, "Send to Automation" delivers the current report; ART Combined and single-team both resolve a destination or surface 409; copy still works.

- [x] T021 [US2] Verify the `scope-change` resolver (added to the registry in T008) reuses the notifications scope-change per-team `triggerUrl`/`triggerSecret` from `src/routes/notifications.js`
- [x] T022 [US2] Add `SendToAutomationButton` to the Scope Change report, passing the current report rows, in `client/src/views/ReportsHub/ReportsHubView.tsx`
- [x] T023 [P] [US2] Add a scope-change send-payload test (release/sprint split) in `client/src/views/ReportsHub/buildSendPayload.test.ts`; the SendToAutomationButton wiring is covered by `client/src/components/SendToAutomationButton.test.tsx`

**Checkpoint**: US1 + US2 deliverable independently.

---

## Phase 5: User Story 3 — Feature Change report (P3)

**Goal**: A user can push the on-screen Feature Change report to the team's Automation webhook.
**Independent test**: On the Feature Change report, "Send to Automation" delivers the current report; team without a label/destination surfaces 409; copy still works.

- [x] T024 [US3] Verify the `feature-change` resolver (added to the registry in T008) reuses the notifications feature-change per-team config from `src/routes/notifications.js`
- [x] T025 [US3] Add `SendToAutomationButton` to the Feature Change report in `client/src/views/ReportsHub/ReportsHubView.tsx`
- [x] T026 [P] [US3] Add a feature-change send-payload test (featureChanges wrap) in `client/src/views/ReportsHub/buildSendPayload.test.ts`

**Checkpoint**: All three surfaces deliver.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [x] T027 [P] Implement the docs generator (reads the surface registry, emits per-surface JSON schema + example + Rovo "Use Rovo agent" System Prompt template using `{{webhookData.payloadContext.*}}`) in `scripts/generate-automation-mappings.js`
- [x] T028 [P] Add a unit test for the docs generator (one entry per surface; smart-value references present) in `test/unit/generate-automation-mappings.test.js`
- [x] T029 Generate `docs/automation-mappings.md` by running `node scripts/generate-automation-mappings.js`
- [x] T030 [P] Finalize the `CHANGELOG.md` Added entries for all three surfaces and the security posture (host allow-list, redaction)
- [x] T031 Run `npm test`, `cd client && npm test`, and `npm run build:client`; confirm `git diff package.json client/package.json` shows no new dependencies (FR-010); walk quickstart scenarios 1–6 in `specs/001-report-webhook-delivery/quickstart.md`

---

## Dependencies & Story Completion Order

```text
Setup (T001–T002)
   └─► Foundational (T003–T017)   ← blocks all stories
          ├─► US1 Standup Briefing (T018–T020)   ← MVP
          ├─► US2 Scope Change      (T021–T023)
          └─► US3 Feature Change    (T024–T026)
                 └─► Polish (T027–T031)
```

- TDD pairs (test→impl): T003→T004, T005→T006, T007→T008, T009→T010,
  T011→T012, T014→T015, T016→T017.
- T010 depends on T004, T006, T008. T012 depends on T010. T013 depends on T012.
  T015 depends on T013 (route mounted). T017 depends on T015.
- US1/US2/US3 each depend only on the Foundational phase, so they are mutually
  independent and can be delivered in any order after Foundational.
- The three surface resolvers ship together in the registry (T008); T018/T021/T024
  verify them, so no per-story registry edits are needed.
- T023 and T026 are both authored in `buildSendPayload.test.ts` (one helper test
  file), so the shaping logic for both surfaces is covered together.

## Parallel Execution Examples

- **Foundational test/scaffold kickoff (different files)**: T003, T005, T007,
  T009, T011, T014, T016 can be authored in parallel before their implementations.
- **Per-story tests**: T020, T023, T026 are [P] (StandupTab test + the two
  `buildSendPayload` payload tests are independent of the engine impl tasks).
- **Polish**: T027, T028, T030 are [P] (distinct files).

## Implementation Strategy

- **MVP = Setup + Foundational + US1** (Standup Briefing). Ship and validate the
  full secure pipeline against one surface first. Destination config for US1 is
  confirmed present in `src/routes/standupBriefing.js` (per-team `triggerUrl`/`triggerSecret`).
- Then add US2 and US3 — each is a thin registry entry + one client button + a
  test, reusing the proven engine.
- Polish (docs generation + CHANGELOG + full test/build) closes out FR-011 and
  the success criteria.
