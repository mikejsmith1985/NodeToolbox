# Tasks: Guided Epic Intake

**Feature**: `specs/037-guided-epic-intake` | **Branch**: `feature/037-guided-epic-intake`

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [data-model.md](./data-model.md), [research.md](./research.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md)

Tests come **before** implementation within each phase (Constitution Article V — the failing test is written first).
`[P]` marks tasks that touch different files with no dependency on an incomplete task. All paths are relative to the
repository root. Intake source lives in `client/src/views/PoTool/intake/` (abbreviated below as `intake/`, always
meaning `client/src/views/PoTool/intake/`).

**Pre-commit hook reminders** (see memory): every new source file needs its test file **in the same commit**, and every
commit that changes behaviour needs a `CHANGELOG.md` edit **in the same commit**. Commit messages are bare
`type: description` (no scope). Pre-push runs `tsc -b`, which catches unused locals.

---

## Phase 1: Setup

- [X] T001 Confirm the baseline is green before any edit: run `npx vitest run src/views/PoTool src/views/Hygiene/HygieneFixControl.test.tsx src/services/fieldMappingBoundary.test.ts` in `client/` and record the pass counts in the PR description draft
- [X] T002 Create the GH #387 fixture `client/src/views/PoTool/intake/gh387Notes.fixture.ts` exporting `GH387_NOTES_TEXT` (the issue body verbatim, `•\t` / `o\t` markers preserved, fetched via `gh issue view 387 --json body -q .body`) with a one-line purpose comment; it is test data only and is imported by tests in every later phase
- [X] T003 Add an `## [Unreleased]` → `### Added` entry "Epic Intake mode in Feature Composition (feature 037)" to `CHANGELOG.md` (expanded as phases land)

---

## Phase 2: Foundational — the model and the decision engine (blocks every story)

**Purpose**: The types and the "twenty questions" engine every story reads. Nothing here touches Jira or the UI.

- [X] T004 Create `intake/epicIntakeModel.ts` with every type and constant in `data-model.md`: `EpicIntake`, `SourceLine`, `SetAsideLine`, `SetAsideReason`, `IntakeItem`, `AreaSize`, `NamedKey`, `NamedKeyLookup`, `Decision<TValue>`, `SettledBy`, `ItemDecisions` (seven slots), `DuplicateCandidate`, `EpicDraft`, `CreationRecord`, `EpicTypeResolution`, `RoundRecord`, `SummaryRow`, `SummaryAction`, `IntakeStepId`, plus `EPIC_INTAKE_SCHEMA_VERSION = 1`, `DEFAULT_INTAKE_PROJECT_KEY = 'DENP'`, `EPIC_ISSUE_TYPE_NAME = 'Epic'`, and `createOpenDecision()` / `createEmptyItemDecisions()` factories
- [X] T005 Create `intake/epicIntakeModel.test.ts` covering the factories (every slot starts `open` with `aiAttempts: 0`) — required by the pre-commit hook and proves the defaults the engine depends on
- [X] T006 Write failing contract tests in `intake/intakeChecklist.test.ts` for `contracts/decision-engine.md`: slot→step mapping (§3), all six turn rules in precedence order (§4), first-open-step derivation and mixed-turn resolution (§5), applicability cascades and re-opening on reversal (§6), and invariants INV-1…INV-6 (§7) — build intakes with small inline helpers, no fixture I/O
- [X] T007 Implement `intake/intakeChecklist.ts`: `MAX_AI_ATTEMPTS_PER_DECISION`, `INTAKE_STEP_ORDER`, `listOpenDecisions`, `readIntakeNextStep` (returns `{ step, turn, openCount, nextAction }` with plain-language `nextAction` strings free of "AI"/"prompt"/"reply"), `recordAiRejection`, `settleDecision` (refuses to overwrite a `po`-settled slot unless the new settler is also `po`), `refreshApplicability` — until T006 passes

**Checkpoint**: the engine is fully specified by tests; every story below plugs rules, rounds or UI into it.

---

## Phase 3: User Story 1 — Turn raw notes into classified items (P1) 🎯 MVP start

**Goal**: Paste notes → numbered lines → outline baseline → one classify exchange → every line accounted for.

**Independent Test**: With `GH387_NOTES_TEXT`, start an intake, ingest a hand-written classify reply, and see every
source line in exactly one item or set aside with a reason; broken replies are rejected with named reasons (US1-1…5).

### Tests first

- [X] T008 [P] [US1] Failing tests in `intake/notesOutline.test.ts` per `contracts/deterministic-rules.md` §1: `numberSourceLines` (blank lines skipped, numbering stable, marker stripped into `text`, `rawText` kept, `outlineLevel` 0/1/2), `buildOutlineBaseline` on `GH387_NOTES_TEXT` (≈25 items; "New Since OnSite", "Notes from OnSite", the intro paragraph and "Rules for Tagging…" set aside as `headingOrProse`; *Core Integration (denp-632)* owns its four `o` lines), the no-marker fallback, the "Oregon" false-marker case, `proveLineCoverage` (missing + duplicated), and `splitLinesIntoPromptParts` (never splits an item; oversize item alone)
- [X] T009 [P] [US1] Failing tests in `intake/namedKeys.test.ts` per §2: `denp-632` → `DENP-632`, per-item de-dup, `PI-26`/`Q3`/`FY27`/`1.2M` not keys, `ENCUC-12` recorded with `projectKey: 'ENCUC'`
- [X] T010 [P] [US1] Failing tests in `intake/deferralEvidence.test.ts` per §3: each phrase in the table, title-line vs sub-line behaviour, the `Risks` title, *Mass ID Card Reissue - future conversation* → deferred, *Other Transformations (No funding asks/would be funded)* → deferred
- [X] T011 [P] [US1] Failing tests in `intake/ai/intakeClassifyRound.test.ts` per `contracts/ai-rounds.md` §0–§1: prompt lists only open slots and numbered lines of its part; multi-part prompts for a long fixture; parser never throws; whole-reply failures produce one `itemId: null` rejection with **no** `aiAttempts` increment; invented `item-99` rejected; a line claimed twice rejected and kept with its baseline owner; regrouping within a part re-derives sizes/keys/deferral; `kind` ignored when rule-settled; PO-settled slot untouched; `searchTerms` sanitised and bounded (1–5, ≤60 chars); `labelProposal` stored as proposal only; `RoundRecord` appended

### Implementation

- [X] T012 [P] [US1] Implement `intake/notesOutline.ts` (named marker constants per level, `numberSourceLines`, `buildOutlineBaseline` creating items via `createEmptyItemDecisions` and calling the Phase 4 rule hooks through a passed-in `deriveItemFacts` parameter so this module stays independent of `ownershipRule.ts`, `proveLineCoverage`, `splitLinesIntoPromptParts`) until T008 passes
- [X] T013 [P] [US1] Implement `intake/namedKeys.ts` (`JIRA_KEY_IN_TEXT_PATTERN`, false-positive guard constants, `extractNamedKeys`) until T009 passes
- [X] T014 [P] [US1] Implement `intake/deferralEvidence.ts` (`DEFERRAL_PHRASES`, `findDeferralEvidence`) until T010 passes
- [X] T015 [US1] Implement `intake/intakeFacts.ts` + `intake/intakeFacts.test.ts`: `deriveItemFacts(item, lines)` that fills `namedKeys`, `deferralEvidence`, settles `kind` by rule when evidence is on the title line, and (once Phase 4 lands) `areaSizes` + size-rule owner — the single place item facts are recomputed after baseline or regrouping
- [X] T016 [US1] Create the `jqlTextTerms` sanitiser dependency needed by classify: **move** `JIRA_TEXT_RESERVED_PATTERN` and `buildIssueTextMatchTerms` from `client/src/views/Hygiene/HygieneFixControl.tsx:752,772` into `client/src/utils/jqlTextTerms.ts` (exported, with a `shouldWildcardLastTerm` option defaulting to `true`), add `client/src/utils/jqlTextTerms.test.ts`, and change `HygieneFixControl.tsx` to import it — then run `npx vitest run src/views/Hygiene/HygieneFixControl.test.tsx` **unmodified**; if it fails, revert the move (research R-007)
- [X] T017 [US1] Implement `intake/ai/intakeClassifyRound.ts` (`CLASSIFY_REPLY_KIND`, `buildClassifyPrompts` using `MAX_CHARS_PER_PROMPT` from `rewrite/ai/bulkRewriteAiAssist.ts`, `parseClassifyReply` over `extractJsonPayload`, `applyClassifyAnswers` calling `deriveItemFacts` for regrouped items and `refreshApplicability`) until T011 passes
- [X] T018 [US1] Implement `intake/startIntake.ts` + `intake/startIntake.test.ts`: `startEpicIntake({ teamProfileId, sources, nowIso, mintId })` → joins `readSourceText` output with source-title separator lines, numbers, builds the baseline, derives facts, returns a fresh `EpicIntake` — tested with `GH387_NOTES_TEXT` as a paste source

### UI

- [X] T019 [P] [US1] Create `intake/EpicIntakeWorkspace.module.css` with the `intake`-prefixed classes the contract names (decision badge variants rule/suggested/you, items table, line list) — reuse `FeatureCompositionTab.module.css` and `rewrite/rewrite.module.css` classes for everything else (UI Styling rule)
- [X] T020 [P] [US1] Failing tests then implementation of `intake/components/IntakeNotesPanel.tsx` + `.test.tsx`: paste box (rich paste via `readPastedText`), file drop routed by extension to `readPdfSource` / `readOutlookMessageSource` / `readWorkbookSource` (mirroring `BulkRewriteTab.readFileAsSource`), Confluence URL via `readConfluenceSource`, source list with remove, **Start intake** disabled until ≥1 source
- [X] T021 [P] [US1] Failing tests then implementation of `intake/components/IntakeJourneyStrip.tsx` + `.test.tsx`: renders `INTAKE_STEP_ORDER` with done/current/waiting classes from `rewrite.module.css`, the `nextAction` line and `openCount` — all read from `readIntakeNextStep`, never recomputed (FR-009)
- [X] T022 [P] [US1] Failing tests then implementation of `intake/components/IntakeItemsTable.tsx` + `.test.tsx`: one row per item (title/proposed title, expandable raw lines, kind, owner, sizes, named keys, candidates count, label) each with a settled-by badge (Rule / Suggested / You) and the reason exposed on hover **and** keyboard focus; set-aside lines listed in a collapsed group with reasons
- [X] T023 [US1] Failing tests then implementation of `intake/components/IntakeQuestionList.tsx` + `.test.tsx` for the US1 questions: **Kind** (5 options) and **Unassigned line** (item ids + set-aside reasons) as `<select>`s, AI suggestion pre-selected with its reason shown; answering calls `settleDecision(…, 'po', …)` / assigns the line and re-runs `proveLineCoverage`
- [X] T024 [US1] Failing tests then implementation of `intake/components/IntakeTurnPanel.tsx` + `.test.tsx`: switches on `readIntakeNextStep().turn` — `ai` mounts exactly one `PoAiPanel` (with a "Part N of M" selector when the classify round has several parts) whose `onIngest` parses, applies, and returns `{ acceptedCount, errors }`; `po` renders `IntakeQuestionList`; plus the **"Answer these myself"** button that moves every open slot in the step to the PO (sets `aiAttempts` to the maximum)
- [X] T025 [US1] Failing tests then implementation of `intake/EpicIntakeWorkspace.tsx` + `.test.tsx`: holds the in-memory `EpicIntake` (`useState`), composes `IntakeNotesPanel` → `IntakeJourneyStrip` + `IntakeItemsTable` + `IntakeTurnPanel`; test drives `GH387_NOTES_TEXT` → start → paste a valid classify reply → coverage complete, using `@testing-library/user-event`
- [X] T026 [US1] Add the mode toggle to `client/src/views/PoTool/FeatureCompositionTab.tsx` per `contracts/composition-mode.md` §1: `compositionMode` state defaulting to `'compose'`, a `role="radiogroup"` segmented control ("Compose one Feature" / "Epic Intake from notes") as the first child of `.compositionTab`, render `<EpicIntakeWorkspace dashboardTeamProfileId={dashboardTeamProfileId} />` in place of the existing body when `intake` — existing JSX and hooks stay where they are
- [X] T027 [US1] Run `npx vitest run src/views/PoTool/FeatureCompositionTab.test.tsx src/views/PoTool/poToolWithoutAi.test.tsx` **unmodified**; then add a new test file `client/src/views/PoTool/intake/compositionModeToggle.test.tsx` (kept separate so the shipped test stays byte-identical): an in-progress composition draft survives compose → intake → compose (FR-001, V-14)

**Checkpoint**: US1 is demonstrable end to end in the browser with AI unlocked or locked (kind questions by hand).

---

## Phase 4: User Story 2 — Decide ownership deterministically (P1)

**Goal**: Stated sizes decide; AI share decides outside 40–60; everything else is a closed PO question.

**Independent Test**: On the fixture, *Core Integration* is Enrollment by **Rule** before any exchange; an item with
equal sizes, and an item whose AI share is 50, both become PO questions (US2-1…6).

- [X] T028 [P] [US2] Failing tests in `intake/ownershipRule.test.ts` per `contracts/deterministic-rules.md` §4: every row of the parsing table (incl. `Fulfilment dev M` alias, `(1.2M)` cost, `1.2M` never size M, `Large for all` → nothing), every row of the rule table, `decideOwnerFromShare` boundaries at 40/41/59/60 and invalid inputs (−1, 101, 55.5, `"60"`), non-voting areas (Infra/Facets/Vendor/Testing/Billing/Dev) reported with `canonicalArea: null`
- [X] T029 [US2] Implement `intake/ownershipRule.ts` (`ENROLLMENT_OWNS_AT_SHARE`, `FULFILLMENT_OWNS_AT_SHARE`, area alias table, filler words, `parseAreaSizes`, `decideOwnerFromSizes` using `FEATURE_SIZING_SCALE` order from `client/src/views/ArtView/ai/piReviewSizing.ts`, `decideOwnerFromShare`) until T028 passes
- [X] T030 [US2] Extend `intake/intakeFacts.ts` (and its test) so `deriveItemFacts` fills `areaSizes` and settles `owner` by the size rule (reason `Stated sizes: Enrollment XL vs Fulfillment M`), leaving it `open` with a PO-routing reason on equal sizes
- [X] T031 [US2] Extend `intake/ai/intakeClassifyRound.ts` (and its test) so `enrollmentShare` is stored as the `owner` slot's `aiProposal` and settled via `decideOwnerFromShare` **only** when the size rule returned `undefined`; an in-band share hands the slot to the PO with the proposal shown; an invalid share is an `aiAttempts` rejection; a size-settled owner records the share but keeps the size reason (US2-1)
- [X] T032 [US2] Extend `intake/components/IntakeQuestionList.tsx` (and its test) with the **Owner** question (Enrollment · Fulfillment · Not actionable), showing the AI share and reason beside it (US2-5)
- [X] T033 [US2] Fixture assertion in `intake/startIntake.test.ts`: after `startEpicIntake(GH387)`, *Core Integration* owner = enrollment by rule; *Invoice overhaul* (Fulfilment dev M, Billing dev M) = fulfillment by rule; *ID Card Vendor Change* (Vendor/Dev/Infra/Testing only) owner still open (share needed)

**Checkpoint**: ownership is repeatable — the same notes give the same rule-settled owners every run.

---

## Phase 5: User Story 3 — Never create an Epic that already exists (P1)

**Goal**: "Check DENP" finds open Epics per Enrollment item; one match exchange; PO picks the rest; failures block
creation.

**Independent Test**: With mocked Jira returning an open match for one item and a Done issue for a named key, the
open one is offered, the Done one becomes a PO question, and a failed search marks the item "not checked" (US3-1…7).

- [X] T034 [P] [US3] Failing tests in `intake/duplicateSearch.test.ts` per `contracts/duplicate-search.md` §5: `buildDuplicateSearchJql` shape — `project = "DENP" AND issuetype = "<name>" AND statusCategory != Done AND ((…) OR (…))` with the OR group parenthesised, terms sanitised via `jqlTextTerms` **without** wildcard and quoted via `escapeJqlValue`, `null` when nothing survives; every row of the named-key table via `classifyNamedKeyLookup`; `resolveEpicType` resolved/missing/error and **no query ever naming `Feature`**; `runDuplicateSearch` with mocked deps — rule settles `existing` for one open named DENP Epic, `createNew` for zero hits, both candidates when two named Epics, `failed` + reason on request error, saves progress per item via callback
- [X] T035 [P] [US3] Failing tests in `intake/ai/intakeMatchRound.test.ts` per `contracts/ai-rounds.md` §2: prompt lists only open `duplicate` slots with each item's own candidates; a key from another item's list rejected; unknown key rejected; `low` confidence → PO with the pick pre-selected; `high` settles with `settledBy: 'ai'`
- [X] T036 [US3] Export `readFailureReason` from `client/src/views/PoTool/jira/runCommit.ts` (additive; its existing tests pass unmodified) — used by T034's failure reason and by Phase 7
- [X] T037 [US3] Implement `intake/duplicateSearch.ts` (`DUPLICATE_SEARCH_MAX_RESULTS`, `DESCRIPTION_EXCERPT_MAX_CHARS`, `buildDuplicateSearchJql`, `classifyNamedKeyLookup`, `resolveEpicType` over `getProjectIssueTypes`, `runDuplicateSearch` with injected `searchIssues` / `fetchIssueByKey` / `extractHttpStatus`, sequential, rule-fallback terms from title words ≥3 chars) plus a small `createDuplicateSearchDeps()` wiring production `jiraGet` / `services/issueLookup.ts` — until T034 passes
- [X] T038 [US3] Implement `intake/ai/intakeMatchRound.ts` (`MATCH_REPLY_KIND`, `buildMatchPrompt`, `parseMatchReply`, `applyMatchAnswers`) until T035 passes
- [X] T039 [US3] Extend `intake/components/IntakeTurnPanel.tsx` (and its test) with the Toolbox turn: **Check DENP** button, `Checked N of M` progress, retry-failed-only, Epic-type `missing` / `error` banners naming what DENP offers; and the match round via the single `PoAiPanel`
- [X] T040 [US3] Extend `intake/components/IntakeQuestionList.tsx` (and its test) with **Match** (each candidate key + summary · None of these — create new · Not actionable) and **Named key unusable** (Use it anyway · Create new · Not actionable) questions, reason shown
- [X] T041 [US3] Extend `intake/components/IntakeItemsTable.tsx` (and its test) to show candidates (linked keys, status) and the **not checked** state with its reason

**Checkpoint**: an intake can reach `confirmLabels` with every Enrollment item matched or marked create-new.

---

## Phase 6: User Story 4 — Create the missing Enrollment Epics (P1)

**Goal**: Confirm labels → draft (AI or manual) → per-draft accept → pre-flight required fields → sequential,
failure-isolated, idempotent create.

**Independent Test**: With three create-new items, accept two and decline one; mocked `createIssue` receives exactly two
payloads, each with one label, a nine-section description, and no sizes; a mid-batch failure does not stop the others
(US4-1…6).

- [X] T042 [P] [US4] Failing tests in `intake/ai/intakeDraftRound.test.ts` per `contracts/ai-rounds.md` §3: prompt carries only each create-new item's own lines and the nine labels built from `SECTION_LABELS`/`VALIDATION_MARKER`; summary 1–255 chars; description normalised + de-attributed; PO-edited draft not overwritten; `buildManualDraft` yields nine sections with flagged placeholders
- [X] T043 [P] [US4] Failing tests in `intake/epicCreate.test.ts` per `contracts/epic-create.md` §5: `readUnansweredEpicRequiredFields` (Epic Name by field name → auto; other required-no-default → `TransitionRequiredField`; supplied ids ignored), `buildEpicCreatePayload` (one label, Epic Name only when required, batch answers merged via `buildTransitionFieldsPayload`, no size/cost/rationale text, throws for unaccepted or unlabelled items), `runEpicCreates` (sequential, `creating` written before POST, `created`/`failed` after, continues past a failure, never re-posts `created`, `creating` recovery adopts an exact-summary match and otherwise posts)
- [X] T044 [US4] Implement `intake/ai/intakeDraftRound.ts` (`DRAFT_REPLY_KIND`, `buildDraftPrompt`, `parseDraftReply`, `applyDraftAnswers`, `buildManualDraft`) until T042 passes
- [X] T045 [US4] Implement `intake/epicCreate.ts` (`EPIC_NAME_FIELD_NAME_PATTERN`, `INTAKE_SUPPLIED_FIELD_IDS`, `readUnansweredEpicRequiredFields`, `buildEpicCreatePayload`, `runEpicCreates` with injected `createIssue` / `searchIssues` / `nowIso` and `readFailureReason`) until T043 passes — **no `customfield_` literal anywhere** (the ratchet)
- [X] T046 [US4] Extend `intake/components/IntakeQuestionList.tsx` (and its test) with the **Label** question (Roadmap · Stability), the AI proposal and reason shown, never auto-settled (FR-020)
- [X] T047 [P] [US4] Failing tests then implementation of `intake/components/IntakeDraftReview.tsx` + `.test.tsx`: each create-new item's draft with editable summary + description (textarea), label shown, flagged-section hint, **Accept** / **Decline**; editing sets `editedByPo: true`; with AI locked the manual draft is shown pre-filled
- [X] T048 [P] [US4] Failing tests then implementation of `intake/components/IntakeCreatePanel.tsx` + `.test.tsx`: pre-flight via `getIssueTypeFields` → `TransitionRequiredFields` (from `client/src/components/TransitionRequiredFields`) once for the batch; **Create N Epics** disabled until Epic type resolved + required fields complete + ≥1 accepted draft; per-item progress and Jira's failure reason; **Retry failed**
- [X] T049 [US4] Wire `IntakeDraftReview` and `IntakeCreatePanel` into `intake/components/IntakeTurnPanel.tsx` for the `draft` and `create` steps (and extend its test)

**Checkpoint**: Epics can be created in DENP from the intake; nothing is written without a per-draft accept.

---

## Phase 7: User Story 5 — The table for the call (P1)

**Goal**: One copyable table — every work item once, with a key or a reason.

**Independent Test**: At the end of a mocked GH #387 run, `buildSummaryRows` lists every work item once; Copy table
writes `text/html` and `text/plain` (US5-1…3, SC-006).

- [X] T050 [P] [US5] Failing tests in `intake/intakeSummary.test.ts` per `contracts/summary-and-store.md` §1 and §3: each row of the action table, the key/open invariant, source order, non-work items in the "Also in the notes" group, `formatStatedSizes` output `Enrollment XL (1.2M) · Fulfillment M · Infra XL · Facets M`, Markdown and HTML columns, HTML escaping of `<`, `&`, `"`
- [X] T051 [US5] Implement `intake/intakeSummary.ts` (`buildSummaryRows` using `buildJiraBrowseUrl` from `client/src/utils/jiraBrowseUrl.ts`, `renderSummaryMarkdown`, `renderSummaryHtml` with inline borders and no classes, `formatStatedSizes`) until T050 passes
- [X] T052 [US5] Failing tests then implementation of `intake/components/IntakeSummaryTable.tsx` + `.test.tsx`: renders rows with linked keys and an `open` state, **Copy table** writes a `ClipboardItem` with both flavours and falls back to `writeText(markdown)` when `ClipboardItem` is undefined (pattern: `client/src/utils/downloadElementImage.ts`), copy feedback via `useCopyFeedback`
- [X] T053 [US5] Mount `IntakeSummaryTable` in `intake/EpicIntakeWorkspace.tsx` whenever at least one item exists (extend its test)

**Checkpoint**: the full P1 flow — notes to table — is complete (MVP).

---

## Phase 8: User Story 6 — Pick up where I left off (P2)

**Goal**: The intake survives closing the browser; resume lands on the same step; discard needs confirmation.

**Independent Test**: Save mid-way, unmount, remount → same step, same answers; created keys not re-created (US6-1/2,
V-11).

- [X] T054 [P] [US6] Failing tests in `intake/epicIntakeStore.test.ts` per `contracts/summary-and-store.md` §2–§3: full-record round-trip, wrong `schemaVersion` → `unreadable`, corrupt enum → `unreadable`, two team profiles isolated, `listEpicIntakes` newest-first, `saveEpicIntake` returns `false` when storage throws
- [X] T055 [US6] Implement `intake/epicIntakeStore.ts` (`EPIC_INTAKE_STORAGE_PREFIX`, `EPIC_INTAKE_WARN_BYTES`, `normalizeEpicIntake`, `saveEpicIntake`, `loadEpicIntake`, `listEpicIntakes`, `deleteEpicIntake` over `buildTeamScopedStorageKey` and `canPersistDrafts`) until T054 passes
- [X] T056 [P] [US6] Failing tests then implementation of `intake/components/IntakeResumeBar.tsx` + `.test.tsx`: saved intakes for this team (name, updated, open count from `listOpenDecisions`), **Resume**, **Discard** behind a confirmation (no browser `confirm()` — an inline confirm step), **Start new**; `unreadable` records offered Discard only
- [X] T057 [US6] Wire persistence into `intake/EpicIntakeWorkspace.tsx`: save after every ingest, PO answer, per-item search progress and create transition; show the "This browser is not saving — finish in one sitting." warning when `canPersistDrafts()` is false; extend its test with the unmount/remount resume case and the created-keys-not-reposted case

**Checkpoint**: all six stories complete.

---

## Phase 9: Polish & Cross-Cutting

- [X] T058 *(Delivered as `intake/epicIntakeWithoutAi.test.tsx` so the shipped sweep stays byte-identical — the shared file mocks `featureReviewFixes.ts` down to one export, which the create step needs.)* Add one **additive** case to `client/src/views/PoTool/poToolWithoutAi.test.tsx`: AI locked, switch Feature Composition to Epic Intake, drive `GH387_NOTES_TEXT` through every step by PO answers with mocked Jira, assert `findAnyAiAffordance` finds nothing at each step (R-011, FR-026, V-13); existing cases untouched
- [X] T059 [P] Add a fixture-level success-criteria test in `intake/gh387SuccessCriteria.test.ts`: with canned classify/match/draft replies for GH #387, the intake reaches `done` in **3** exchanges (SC-001) and PO questions other than labels ≤ one per five work items (SC-004)
- [X] T060 [P] *(Budget set at 50 ms, not 5 ms, so full-suite parallel load cannot make it flaky; it still catches quadratic work.)* Add a performance guard in `intake/notesOutline.test.ts`: baseline + coverage + `readIntakeNextStep` on a 200-line synthetic note complete under 5 ms (plan Performance Goals)
- [X] T061 [P] Update the stale header comment in `client/src/services/jiraIssueTypes.ts` (lines 1–9, 27–33) to record that DENP now defines Epic (feature 037 note) — comment only, no behaviour change
- [X] T062 Complete the `CHANGELOG.md` entry: what the mode does, the rules-before-AI guarantees, the `jqlTextTerms` move, and "Known: `issuetype = Feature` surfaces after the DENP rename are tracked separately"
- [ ] T063 Run the full gates from `quickstart.md`: intake suite, `FeatureCompositionTab.test.tsx` + `poToolWithoutAi.test.tsx`, `HygieneFixControl.test.tsx` (unmodified), `fieldMappingBoundary.test.ts`, `npx tsc -b`, then `npm test` at the repo root — all green before PR
- [ ] T064 Open the PR to `main` with the quickstart V-01…V-14 table as the production validation checklist, and file follow-up issues for R-014 (the four `issuetype = Feature` surfaces; `draftModel.ts:225` dropping PDF/email/SharePoint sources)

---

## Dependencies & Execution Order

### Phase dependencies

```
Phase 1 Setup ─► Phase 2 Foundational ─► US1 ─► US2 ─► US3 ─► US4 ─► US5 ─► Polish
                                            └──────────────────────────► US6 ─┘
```

- **US1** needs the engine (Phase 2). It creates `intakeFacts.ts`, `jqlTextTerms.ts` and the workspace shell that
  every later story extends.
- **US2** extends `intakeFacts.ts` and the classify round, so it follows US1.
- **US3** needs owners (only Enrollment items are searched) and `jqlTextTerms.ts` (T016).
- **US4** needs `duplicate = createNew` items (US3) and `readFailureReason` (T036).
- **US5** reads every outcome, so it follows US4. Its pure module (T050/T051) can start as early as Phase 2.
- **US6** depends only on the model and the workspace (US1). It can run in parallel with US2–US5 on a separate agent,
  and it is wired last (T057), when the workspace is stable.

### Within each story

The tests are written and failing → the pure module → the UI extension → the wiring. Shared files are edited
**sequentially** across stories, never in parallel: `IntakeQuestionList.tsx`, `IntakeTurnPanel.tsx`,
`intakeClassifyRound.ts`, `intakeFacts.ts` and `EpicIntakeWorkspace.tsx`.

## Parallel Opportunities

| Wave | Tasks | Why they are independent |
|---|---|---|
| A (after T007) | T008 ∥ T009 ∥ T010 ∥ T011 ∥ T028 ∥ T050 ∥ T054 | separate test files, each against the model only |
| B | T012 ∥ T013 ∥ T014 ∥ T029 ∥ T051 ∥ T055 | separate pure modules |
| C (after T016, T036) | T034 ∥ T035 ∥ T042 ∥ T043 | separate modules; each is given the model plus reused primitives |
| D (UI) | T019 ∥ T020 ∥ T021 ∥ T022; later T047 ∥ T048; T056 | separate component files |

For agents: one agent per wave-B module. Architecture review of T007 (the engine) and T017 (the classify ingest) is
the Opus-tier work; component tasks are Sonnet-tier.

## Implementation Strategy

- **MVP = Phases 1–7** (US1–US5, all P1). That is the smallest thing that answers the product call: notes in, DENP
  keys out.
- **Increment 1** (US1 + US2): classification and ownership with no Jira calls at all. This is safe to ship dark
  behind the mode toggle.
- **Increment 2** (US3): read-only Jira; still no writes.
- **Increment 3** (US4 + US5): the first writes, each gated by a per-draft accept.
- **Increment 4** (US6): persistence.
- Each increment keeps `FeatureCompositionTab.test.tsx` green unmodified, and each can be released through
  `scripts/local-release.ps1`. Live validation happens in production afterwards (quickstart).

## Story → Task Map

| Story | Priority | Tasks | Count |
|---|---|---|---|
| Setup | — | T001–T003 | 3 |
| Foundational | — | T004–T007 | 4 |
| US1 Classify notes | P1 | T008–T027 | 20 |
| US2 Ownership | P1 | T028–T033 | 6 |
| US3 Duplicate check | P1 | T034–T041 | 8 |
| US4 Create Epics | P1 | T042–T049 | 8 |
| US5 Summary table | P1 | T050–T053 | 4 |
| US6 Resume | P2 | T054–T057 | 4 |
| Polish | — | T058–T064 | 7 |
| **Total** | | | **64** |
