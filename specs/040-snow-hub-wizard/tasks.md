# Tasks: SNow Hub Wizard (Standalone)

**Input**: Design documents from `specs/040-snow-hub-wizard/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: REQUIRED — the constitution (Article V) mandates TDD. Every test task is written first and must FAIL before its
implementation task starts. Unit tests are 100% mocked (vitest, `client/`); live validation is quickstart.md, run by the
owner in production.

**Organization**: Setup → **Relay Probe gate** → Foundational → one phase per user story (P1–P4) → Polish.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1 New change · US2 Modify · US3 Problem → Jira · US4 Review + coaching

## Path Conventions

- Wizard source: `client/src/snowWizard/` (own esbuild entry — never imported by Toolbox's Vite app)
- Shared with 039 (built in 039's planned location because 039 has not shipped): `client/src/components/GuidedFlow/`,
  `client/src/views/SnowHub/guided/`
- Build: `scripts/build-snow-wizard.js` → `dist/snow-hub-wizard.html`, `dist/snow-wizard-probe.html`

---

## Phase 1: Setup

**Purpose**: folder, build scripts, test wiring.

- [X] T001 Create `client/src/snowWizard/` with `probe/` and `transport/` (later phases add `launcher/ shell/ change/ prb/ review/` as they arrive; no barrel file — entries import modules directly)
- [X] T002 Add npm script `build:snow-wizard-probe` (`node scripts/build-snow-wizard.js --probe`) to root `package.json` (`build:snow-wizard` is added with the app entry in T031); confirm `esbuild` is already a root devDependency (no new package)
- [X] T003 [P] Write failing test `test/unit/build-snow-wizard.test.js` (server Jest suite — its testMatch covers `test/**`): given a stub entry, the writer emits ONE `.html` containing no `http(s)://` `<script src>`/`<link href>` and fails when the bookmark exceeds `WIZARD_BOOKMARK_BUDGET_BYTES`
- [X] T004 Implement `scripts/build-snow-wizard.js` skeleton per `contracts/single-file-build.md`: esbuild bundle (`iife`, `minify`, `local-css` loader for `.module.css`), wrap JS+CSS into one HTML string, write to `dist/`; `--probe` switches entry to `client/src/snowWizard/probe/relayProbe.entry.ts` and output to `dist/snow-wizard-probe.html`

---

## Phase 2: Relay Probe (GATE — blocks every later phase)

**Purpose**: prove the server-free transport live (research R-001, `contracts/relay-probe.md`). Ships as its own patch
release so the owner can run it in production.

- [X] T005 [P] Write failing tests `client/src/snowWizard/probe/probeResult.test.ts`: `formatProbeResult(results)` renders `PROBE v1 | <browser> | P-ID=pass|fail(reason) | …` in the contract's order; a missing probe renders `fail(not run)`, never `pass`
- [X] T006 [P] Write failing tests `client/src/snowWizard/transport/bookmarkPayload.test.ts`: `buildBookmarkHref({ appHtml, role })` returns a `javascript:` URL; role detection by hostname → `snowLauncher | jiraAgent | unknown`; the `g_ck` resolver text is the one exported from `client/src/services/browserRelay.ts` (no copy-paste drift)
- [X] T007 Implement `client/src/snowWizard/probe/probeResult.ts` (pure formatter, named constant `PROBE_FORMAT_VERSION = 'v1'`)
- [X] T008 Export the existing token-resolver string from `client/src/services/browserRelay.ts` as `SNOW_TOKEN_RESOLVER_SOURCE` (additive export only; existing bookmarklet output byte-identical — assert in `client/src/services/browserRelay.test.ts`)
- [X] T009 Implement `client/src/snowWizard/transport/bookmarkPayload.ts` (runtimes serialized with `.toString()`; role switch, blob launcher, Jira agent listener with origin checks and `/rest/` path guard per `contracts/wizard-transport.md`)
- [X] T010 Implement `client/src/snowWizard/probe/relayProbe.entry.ts` + `filePageProbe.ts` (file page) and `snowWindowProbe.entry.ts` + `snowWindowProbe.ts` (window opened inside ServiceNow), with `agentChannel.ts`, `snowProbes.ts`, `probeAssets.ts`, `probeDom.ts`, `probePage.css`: numbered steps UI for P-HEADERS, P-SNOW-BLOB, P-SNOW-WRITE-SAFE, P-SNOW-BROADCAST, P-JIRA-OPENER-FROM-BLOB, P-JIRA-OPENER-FROM-FILE, P-SNOW-OPENER-FROM-FILE, P-BOOKMARK-SIZE (1.5 MB padded bookmark), P-FILE-HANDLE, P-BROWSER; read-only calls only; copy button for the result block
- [X] T011 Build `dist/snow-wizard-probe.html` with `npm run build:snow-wizard-probe`; add a CHANGELOG `[Unreleased]` entry; release as a patch via `scripts/local-release.ps1` with the probe HTML attached as a release asset (additive step in `scripts/local-release.ps1`)
- [ ] T012 **GATE**: record the owner's probe result block in `specs/040-snow-hub-wizard/research.md` § R-001, mark the chosen branch (T1+T2 / T1+hand-off / stop), and revise `contracts/wizard-transport.md` if the branch is not T1+T2. **No task below starts until this is done.**

**Checkpoint**: transport branch chosen with live evidence.

---

## Phase 3: Foundational (blocking prerequisites for all stories)

**Purpose**: transport, shell, shared readiness engine, single-file app build.

### Tests first

- [ ] T013 [P] Failing tests `client/src/snowWizard/transport/snowSameOriginTransport.test.ts`: GET/POST/PATCH with `X-UserToken`, JSON + base64 bodies; one token refresh over `BroadcastChannel` on 401 then `expired`
- [ ] T014 [P] Failing tests `client/src/snowWizard/transport/jiraOpenerTransport.test.ts`: request/response by `requestId`, origin rejection, 30 s timeout → `status 0`; hand-off mode (if R-001 chose it) produces a `pendingHandOff` instead of posting
- [ ] T015 [P] Failing tests `client/src/snowWizard/transport/relayBridgeShim.test.ts`: exports match `client/src/services/relayBridgeApi.ts` names/signatures; `snow` → same-origin transport, `jira` → opener transport
- [ ] T016 [P] Failing tests `client/src/snowWizard/transport/jiraProxyFetch.test.ts`: `/jira-proxy/rest/...` routed to Jira transport and re-wrapped as a `Response`; any other URL passes to `globalThis.fetch` untouched
- [ ] T017 [P] Failing tests `client/src/components/GuidedFlow/GuidedFlowShell.test.tsx`: "Step N of M — title", single primary Next disabled with visible reason, Back keeps entries
- [ ] T018 [P] Failing tests `client/src/views/SnowHub/guided/changeReadiness.test.ts` per `specs/039-guided-flows/contracts/readiness-engine.md` (every item rule, null fact → `couldNotCheck`, `isReady` rule) plus formula quality-gate items from `client/src/views/SnowHub/chgFormula/formulaCard.ts`
- [ ] T019 [P] Failing tests `client/src/snowWizard/shell/wizardJobStore.test.ts`: one in-progress job per kind, resume/discard, finished jobs pruned after `FINISHED_JOB_RETENTION_DAYS = 7`, keys prefixed `snowWizard:`
- [ ] T020 [P] Failing tests `client/src/snowWizard/shell/ConnectStep.test.tsx` + `ConnectionBanner.test.tsx`: jobs disabled until both systems `connected` via a live read; banner amber on `expired` with one fix action; current step kept
- [ ] T021 [P] Failing test `client/src/snowWizard/shell/wizardCopyScan.test.tsx`: renders every wizard screen and fails on `u_[a-z]`, `cmdb_ci`, `customfield_`, `sys_id` in visible text (pattern of `poToolWithoutAi.test.tsx`)

### Implementation

- [ ] T022 [P] Implement `client/src/snowWizard/transport/snowSameOriginTransport.ts`
- [ ] T023 [P] Implement `client/src/snowWizard/transport/jiraOpenerTransport.ts` (and hand-off mode only if T012 selected it)
- [ ] T024 Implement `client/src/snowWizard/transport/relayBridgeShim.ts` (depends T022, T023)
- [ ] T025 Implement `client/src/snowWizard/transport/jiraProxyFetch.ts` (depends T023)
- [ ] T026 Wire esbuild `alias` (`client/src/services/relayBridgeApi.ts` → shim) and `inject` (`jiraProxyFetch`) in `scripts/build-snow-wizard.js`; add a build test asserting the bundle contains no `/api/relay-bridge` string
- [ ] T027 [P] Implement `client/src/components/GuidedFlow/GuidedFlowShell.tsx` + `GuidedFlowShell.module.css` (shared with 039)
- [ ] T028 [P] Implement `client/src/views/SnowHub/guided/changeReadiness.ts` (PURE, field-blind) and `changeReadinessFacts.ts` (gathers facts from existing readers: `rcpChangeFacts`, `changeOutageRecord`, `ctaskReviewApi`, `changeProblems`, risk-check review)
- [ ] T029 [P] Implement `client/src/snowWizard/shell/wizardJobStore.ts` (zustand + guarded browser storage)
- [ ] T030 Implement `client/src/snowWizard/shell/ConnectStep.tsx`, `ConnectionBanner.tsx`, `WizardHome.tsx` (three large choices + resume cards) with `client/src/snowWizard/shell/WizardShell.module.css`
- [ ] T031 Implement `client/src/snowWizard/main.entry.tsx` (React root, Home → job routing) and `client/src/snowWizard/launcher/launcherPage.ts` (version, draggable bookmark, picture-led numbered instructions)
- [ ] T032 Build `dist/snow-hub-wizard.html`; verify bookmark size under budget and that Toolbox's `cd client && npx vite build` output is unchanged (no `snowWizard` in its manifest)

**Checkpoint**: file opens, bookmark drags, Home + Connect show "connected as <you>" for both systems (quickstart V-01).

---

## Phase 4: User Story 1 — Raise a new change (P1) 🎯 MVP

**Goal**: guided Create from scope to result, incl. CTASK × environment, checks, Production email/PDF.
**Independent Test**: quickstart V-02…V-06.

### Tests first

- [ ] T033 [P] [US1] Failing tests `client/src/snowWizard/change/ctaskEnvironmentPlan.test.ts`: defaults (Business Checkout PRD+PFIX not REL; Implementation/Technical Checkout/unknown → all), saved-default overlay, `listPlanErrors` (task with no env; tick on disabled env), `filterStagedCtasksForEnvironment`
- [ ] T034 [P] [US1] Failing tests in `client/src/views/SnowHub/hooks/useCrgState.test.ts` (new cases only): `createChg(env, { ctaskEnvironmentPlan })` stages only that env's CTASKs per target; omitted option ⇒ every staged CTASK on every target. **All existing cases pass unmodified.**
- [ ] T035 [P] [US1] Failing tests `client/src/snowWizard/change/changeWizardSteps.test.ts`: pure `deriveChangeWizardStep(state)` — steps 1–11 per `contracts/change-wizard.md`, done-when rules, step 10 skipped with reason when not Production or no approval required (`rcpRules`)
- [ ] T036 [P] [US1] Failing component tests `client/src/snowWizard/change/ChangeWizard.test.tsx`: Business Checkout pre-ticked PRD/unticked REL; failing check shows one-sentence reason + one fix that returns to the right step; `couldNotCheck` blocks Create until acknowledged; AI step visible with no unlock and skippable

### Implementation

- [ ] T037 [P] [US1] Implement `client/src/snowWizard/change/ctaskEnvironmentPlan.ts` (constant `CTASK_ENVIRONMENT_DEFAULTS`, saved overlay key `snowWizard:ctaskEnvDefaults`)
- [ ] T038 [US1] Add optional `options?: { ctaskEnvironmentPlan?: CtaskEnvironmentPlan }` to `createChg` in `client/src/views/SnowHub/hooks/useCrgState.ts` using `filterStagedCtasksForEnvironment`; record the drift comment at the change (Art VII)
- [ ] T039 [P] [US1] Implement `client/src/snowWizard/change/changeWizardSteps.ts`
- [ ] T040 [P] [US1] Implement steps 1–4 in `client/src/snowWizard/change/steps/ScopeStep.tsx`, `DetailsStep.tsx`, `PlanningStep.tsx`, `EnvironmentsStep.tsx` over `useCrgState` actions; every exact-match value a `<select>` fed by ServiceNow choices
- [ ] T041 [P] [US1] Implement `client/src/snowWizard/change/steps/AiEnhanceStep.tsx` reusing `chgRiskCheckPrompt` + the `AiAssistPromptModal` copy/paste/accept pattern, **without** the `useAiAssist` unlock gate; never AI-attributed
- [ ] T042 [P] [US1] Implement `client/src/snowWizard/change/steps/EvidenceStep.tsx` reusing `client/src/views/SnowHub/testEvidence/*` (attach after create; size limit refused up front)
- [ ] T043 [P] [US1] Implement `client/src/snowWizard/change/steps/TasksStep.tsx` + `TaskEnvironmentsStep.tsx` (CTASK types from `useChangeTaskTypeOptions`; grid of task × enabled env)
- [ ] T044 [US1] Implement `client/src/snowWizard/change/steps/ChecksStep.tsx` over `buildChangeReadiness`; fixes = `chgGapFixPrompt` (propose-only) or jump-to-step
- [ ] T045 [US1] Implement `client/src/snowWizard/change/steps/ProductionPaperworkStep.tsx` reusing `rcp/rcpApprovalEmail.ts` and `rcp/ChangePlanPdfActions.tsx`/`changePlanDocument.ts`
- [ ] T046 [US1] Implement `client/src/snowWizard/change/steps/CreateResultStep.tsx` (per-env CHG links, CTASKs, outage, PRBs, evidence, failures + Retry what's missing)
- [ ] T047 [US1] Implement `client/src/snowWizard/change/ChangeWizard.tsx` (mode `create`, `useCrgState({ storageKey: 'snowWizard:change:<jobId>' })`, resume via `wizardJobStore`) and register it on Home
- [ ] T048 [US1] Rebuild the HTML; CHANGELOG entry; minor release with `dist/snow-hub-wizard.html` attached

**Checkpoint**: MVP — a first-time user creates a REL+PRD change end-to-end.

---

## Phase 5: User Story 2 — Modify an existing change (P2)

**Goal**: same steps pre-filled from an existing CHG; save only edited steps; conflict warning.
**Independent Test**: quickstart V-07…V-09.

- [ ] T049 [P] [US2] Failing tests `client/src/snowWizard/change/modifyDiff.test.ts`: pure `listEditedSteps(loaded, current)`; `detectRemoteConflicts(loadedSnapshot, freshRecord, edits)` returns field pairs changed remotely
- [ ] T050 [P] [US2] Failing component tests `client/src/snowWizard/change/ChangeWizardModify.test.tsx`: "Skip — nothing to change" leaves step unwritten; closed/cancelled CHG routes to Review; conflict dialog shows both values
- [ ] T051 [US2] Implement `client/src/snowWizard/change/modifyDiff.ts`
- [ ] T052 [US2] Add `WhichChangeStep.tsx` (number → load via `useCrgState` load-existing path) in `client/src/snowWizard/change/steps/`, and mode `modify` in `ChangeWizard.tsx` (edited-step markers; Save = `updateExistingChg` after re-read + conflict check)
- [ ] T053 [US2] CHANGELOG entry; minor release

---

## Phase 6: User Story 3 — Problem → Jira (P3)

**Goal**: one project, one Epic, Defect + SL + QE, Stories "Relates to" Defect, idempotent retry.
**Independent Test**: quickstart V-10…V-12.

- [ ] T054 [P] [US3] Failing tests `client/src/snowWizard/prb/prbJiraPlan.test.ts`: `buildPrbJiraDrafts(prb, epicKey, projectKey)` — three drafts, same project, summaries per contract, PRB number + link in every description, label `prb-<n>`
- [ ] T055 [P] [US3] Failing tests `client/src/snowWizard/prb/prbJiraCreate.test.ts` (mocked `jiraApi`): order Defect → SL → QE; Epic link field resolved by name via `services/jiraFieldMapping.ts` (no `customfield_` literal — `fieldMappingBoundary.test.ts` stays green); "Relates" link per Story; existing-label search makes retry create only missing roles/links; never a second Defect without explicit confirmation
- [ ] T056 [P] [US3] Failing component tests `client/src/snowWizard/prb/PrbWizard.test.tsx`: project `<select>` from Jira's project list with remembered default `snowWizard:prbProject`; Epic search; editable drafts; partial-failure result with Retry the rest
- [ ] T057 [US3] Implement `client/src/snowWizard/prb/prbJiraPlan.ts`
- [ ] T058 [US3] Implement `client/src/snowWizard/prb/prbJiraCreate.ts` (issue type names from live create metadata)
- [ ] T059 [US3] Implement `client/src/snowWizard/prb/PrbWizard.tsx` (steps per `contracts/prb-to-jira.md`, PRB search via existing `usePrbState` readers) and register on Home
- [ ] T060 [US3] CHANGELOG entry; minor release

---

## Phase 7: User Story 4 — Review a change with coaching (P4)

**Goal**: read-only checks identical to US1, plain-English coaching note, Copy / Open as email.
**Independent Test**: quickstart V-13…V-15.

- [ ] T061 [P] [US4] Failing tests `client/src/snowWizard/review/coachingNote.test.ts`: one item per `needsAction` in engine order; `couldNotCheck` → `notCheckedLabels` only; all-pass → ready note; `COACHING_PHRASES` covers every readiness item id (test enumerates the engine's ids); no field names in output
- [ ] T062 [P] [US4] Failing tests `client/src/snowWizard/review/readOnlyTransport.test.ts`: wrapper throws `ReviewIsReadOnlyError` on any non-GET; a full mocked review run sends zero writes
- [ ] T063 [P] [US4] Failing parity test `client/src/snowWizard/review/checksParity.test.ts`: one fixture through ChecksStep's facts path and Review's facts path yields identical item ids + states (SC-005)
- [ ] T064 [US4] Implement `client/src/snowWizard/review/coachingNote.ts` (`buildCoachingNote`, `renderCoachingNoteText`, `buildCoachingMailto` with subject `CHG <number> — changes needed before approval`)
- [ ] T065 [US4] Implement `client/src/snowWizard/review/readOnlyTransport.ts`
- [ ] T066 [US4] Implement `client/src/snowWizard/review/ReviewWizard.tsx` (number → checks → editable note → Copy / Open as email) and register on Home
- [ ] T067 [US4] CHANGELOG entry; minor release

---

## Phase 8: Polish & Cross-Cutting

- [ ] T068 [P] Edge-case tests + fixes across wizards: relay tab closed mid-step (V-16), refresh resume (V-17), zero-issue release, task with no environment, malformed AI reply rejected with nothing applied, oversize evidence refused, PRB with empty description highlighted
- [ ] T069 [P] Accessibility pass on all wizard screens: focus moves to step heading on Next/Back, every control labelled, text beside every colour signal (`client/src/snowWizard/**`)
- [ ] T070 Run full gates: `npm test`, `npm run test:dom`, `cd client && npx vitest run`, `cd client && npx tsc -b`, `npm run build:snow-wizard`; confirm `useCrgState`, `browserRelay`, `fieldMappingBoundary` existing tests pass unmodified
- [ ] T071 Owner runs `specs/040-snow-hub-wizard/quickstart.md` V-01…V-17 in production (validation happens in production; release is not held for it)

---

## Dependencies & Execution Order

| Phase | Depends on | Notes |
|---|---|---|
| 1 Setup | — | |
| 2 Relay Probe | 1 | **hard gate** at T012 |
| 3 Foundational | 2 (T012) | transport shape depends on the probe branch |
| 4 US1 (MVP) | 3 | |
| 5 US2 | 4 (reuses ChangeWizard + steps) | |
| 6 US3 | 3 only | can run in parallel with US1/US2 |
| 7 US4 | 3 (engine T028) | can run in parallel with US1; T063 parity needs T044 |
| 8 Polish | the stories being shipped | |

Within each phase: tests → pure modules → UI → release.

## Parallel Examples

- **Phase 3**: T013–T021 together (all different test files); then T022, T023, T027, T028, T029 together.
- **US1**: T033, T035, T036 together; then T037, T039, T040, T041, T042, T043 together.
- **Across stories**: after Phase 3, one agent on US1 (`change/`), one on US3 (`prb/`), one on US4 (`review/`) — disjoint folders; only T038 touches a shared Toolbox file.

## Implementation Strategy

1. **Phase 1 + 2 first and alone** — ship the probe, get the owner's result. If P-SNOW-BLOB fails, stop and report.
2. **MVP = Phase 3 + US1** — the new-change wizard in one shareable file.
3. Then US2 (small, reuses US1), US3 and US4 in parallel, each its own minor release.
