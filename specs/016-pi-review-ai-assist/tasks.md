---
description: "Task list for Single AI Unlock + PI Review AI Assistance"
---

# Tasks: Single AI Unlock + PI Review AI Assistance

**Input**: Design documents from `specs/016-pi-review-ai-assist/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: INCLUDED and TDD-ordered — the constitution (Article V) mandates a failing test before implementation.
Write each test task first, **watch it fail**, then implement. This is not optional here.

**Organization**: Setup → Foundational (the sizing scale, shared by US2 and US4) → one phase per user story in
priority order → Polish. This feature is **client-only**: every path below is under `client/`, and the Node server
(`src/`) is deliberately untouched.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US4 (from spec.md); Setup/Foundational/Polish carry no story label
- All paths are repository-relative.

## Story priorities

| Story | Priority | Independently shippable? |
|---|---|---|
| **US1** — One unlock prompt | **P1** | ✅ Yes — a defect fix, pure deletion, depends on nothing. **The MVP.** |
| **US2** — Size a PI Review page | **P2** | ✅ Yes — ships as a read-only advisory panel (suggestions visible, nothing applied) |
| **US3** — Stay in control | **P3** | ✅ Yes — adds accept/reject on top of US2's suggestions |
| **US4** — Size by hand | **P4** | ✅ Yes — the sizing card is independent of everything except the scale constant |

---

## Phase 1: Setup (Shared)

- [X] T001 Add a `## [Unreleased]` stub entry to `CHANGELOG.md` naming feature 016 (one AI unlock prompt; PI Review
  AI Assistance), to be fleshed out in Polish. The pre-commit hook requires a staged CHANGELOG for any source change

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The T-shirt sizing scale — the single definition read by both the prompt builder (US2) and the sizing
card (US4), so the rubric on screen and the rubric given to the model can never disagree.

**⚠️ Blocks US2 and US4.** **Does NOT block US1** — the unlock fix depends on nothing and may proceed in parallel
from the start.

- [X] T002 [P] Write failing unit tests in `client/src/views/ArtView/ai/piReviewSizing.test.ts`: the scale maps
  XS→10, S→20, M→40, L→60, XL→80 exactly; `XXL` yields **no** number (research R-7); a size outside the vocabulary
  returns null and is never coerced (FR-020); the vocabulary is closed
- [X] T003 Create `client/src/views/ArtView/ai/piReviewSizing.ts`: export the frozen `FEATURE_SIZING_SCALE`
  constant, the `FeatureSizeName` type, `readPointsForSize(size)` returning `number | null`, and
  `SIZING_GUIDANCE_URL`. No magic numbers — the scale IS the constant (Article IV). Make T002 green

---

## Phase 3: User Story 1 — One unlock prompt (P1) 🥇 MVP

**Goal**: Ctrl+Alt+Z raises exactly one passphrase prompt in every view, instead of up to four stacked ones.

**Independent test**: Press Ctrl+Alt+Z on each of the five affected surfaces — exactly one prompt each time; one
correct passphrase still unlocks every AI affordance app-wide; a second press still re-locks.

**Why first**: it is a reported defect, it is pure deletion (research R-1 verified the survivor lacks no behaviour of
the duplicates, including the re-lock toggle), and US2's button appears behind the very gate this repairs — so
fixing it first means US2 is developed against one prompt, not five.

### Tests first (red)

- [X] T004 [US1] In `client/src/views/SprintDashboard/SprintDashboardView.test.tsx`: rewrite the four tests that
  assert on `getByLabelText('Protected tools passphrase')` (lines ~877, 909, 948, 1024, 1075) to unlock via the
  shared store — `act(() => setAiAssistUnlocked(true))`, the pattern already used at
  `client/src/views/AdminHub/AdminHubView.test.tsx:250`. Add a failing assertion that Ctrl+Alt+Z renders **no**
  view-owned passphrase prompt (Pointing and Release Notes)
- [X] T005 [P] [US1] In `client/src/views/SnowHub/tabs/CreateChgTab.test.tsx`: rewrite the four gate-owning tests
  (~754 "shows the passphrase modal when Ctrl+Alt+Z is pressed", ~764 "closes … when Cancel is clicked", ~775 and
  ~794 "unlocks AI Assist …") to unlock via the store, and add a failing assertion that Ctrl+Alt+Z renders no
  view-owned prompt. Keep every assertion about the `⚡ Run via AI Assist (auto)` button — the affordance stays
- [X] T006 [P] [US1] In `client/src/views/SprintDashboard/RiskManagementSection.test.tsx`: add a failing assertion
  that Ctrl+Alt+Z renders no view-owned passphrase prompt (this file has no existing passphrase tests to rewrite)

### Implementation (green) — pure deletion

- [X] T007 [US1] In `client/src/views/SprintDashboard/SprintDashboardView.tsx`: remove **both** gates — the Pointing
  gate (keydown effect ~4327-4345, modal ~4727, `isPassphraseModalVisible` ~4139) and the Release Notes gate
  (keydown ~6060-6083, modal ~6608, state ~5863) — plus the local `HIDDEN_AI_ASSIST_SHORTCUT_KEY` (~156) and the now
  unused `verifyPassphrase` destructure. **Keep** every `isUnlocked` read and every AI affordance
- [X] T008 [P] [US1] In `client/src/views/SprintDashboard/RiskManagementSection.tsx`: remove the keydown effect
  (286-303), the passphrase focus effect (~306-311), the submit handler (~313-325), `isPassphraseModalVisible`
  (~228), the modal JSX (~511) and `HIDDEN_AI_ASSIST_SHORTCUT_KEY` (~30). **Keep** line ~218's `isUnlocked` and the
  `isAiAssistUnlocked` gate at ~442
- [X] T009 [P] [US1] In `client/src/views/SnowHub/tabs/CreateChgTab.tsx`: remove the keydown effect (~2465-2483),
  `isPassphraseModalVisible` (~2367) and the modal JSX (~2713). **Keep** the `⚡ Run via AI Assist (auto)` button
  (~2765) and its unlock gate
- [X] T010 [US1] Remove any import left unused by T007–T009 (`setAiAssistUnlocked`, `verifyPassphrase`) and run
  `cd client; npx eslint src/views/SprintDashboard src/views/SnowHub` clean. `client/src/components/AiAssistUnlockGate/`
  and `client/src/store/aiAssistStore.ts` MUST remain **untouched** — the gate is the survivor

### Checkpoint

- [X] T011 [US1] Prove US1: `cd client; npx vitest run src/components/AiAssistUnlockGate src/views/SprintDashboard
  src/views/SnowHub src/views/AdminHub` green, and the gate's own five tests still pass unmodified. Manually walk
  **quickstart Scenarios A and B** — one prompt on all five surfaces, and every AI affordance still present after a
  single unlock (SC-001, SC-002). US1 is now shippable on its own

---

## Phase 4: User Story 2 — Size a PI Review page (P2)

**Goal**: A PO clicks AI Assistance and sees, per Feature on the page, a suggested T-shirt size with its derived
points plus risk/dependency/implementation notes — grounded in the Features' own Jira content.

**Independent test**: With AI unlocked and in edit mode, open the panel on a page with Features: the full prompt is
readable before anything is sent, it carries each Feature's key/summary/priority/description/AC/links and the scale,
and a pasted reply yields per-Feature suggestions. **Nothing is applied** — this phase ships as a read-only advisory
panel, which is exactly why it is independently shippable.

**Depends on**: Phase 2 (the scale). Not on US1, though US1 shipping first makes manual testing sane.

### Tests first (red)

- [X] T012 [P] [US2] Write failing unit tests in `client/src/views/ArtView/ai/piReviewAiAssist.test.ts` for the
  prompt builder: includes per Feature the key, summary, priority, description, acceptance criteria and linked
  issues (FR-013); embeds the scale from `FEATURE_SIZING_SCALE` (FR-014); renders an absent description/AC as an
  **explicit absence**, never an empty label (FR-015); asks for a **size and never a point number**
  (FR-017, contracts/ai-reply-contract.md); instructs use of only the listed issue keys. **FR-031**: a page of
  N Features yields **one** prompt containing all N — assert with N>1 so a single-Feature fixture cannot pass
  the test vacuously
- [X] T013 [US2] Write failing unit tests in `client/src/views/ArtView/ai/piReviewAiAssist.test.ts` (same file as
  T012, so not parallel with it) for the parser, per
  `specs/016-pi-review-ai-assist/contracts/ai-reply-contract.md` — use its worked example verbatim: a `kind` other
  than `piReview` rejects the **whole** reply; a size outside the vocabulary drops to `null` but the **row
  survives** with its notes; an unknown `issueKey` lands in `unknownKeys` and is never applied (FR-021); a missing
  `issueKey` increments `unparsedCount`; a partial reply yields the valid items plus a report (FR-024); a reply
  claiming `points` has it **ignored** (points derive from the size); `XXL` yields `needsPoints` with no number
- [X] T014 [P] [US2] Write failing unit tests in `client/src/views/ArtView/ai/piReviewAiFetch.test.ts` (Jira mocked):
  resolves AC field ids via `resolveAcceptanceCriteriaFieldIds`; flattens description and AC with
  `normalizeRichTextToPlainText`; returns `null` (not `''`) for absent fields; splits the row's dependency/risks
  cells on **`\n`**, not `', '` (research R-4); batches keys like `fetchPiReviewFeatureIssues` does

### Implementation (green)

- [X] T015 [US2] Create `client/src/views/ArtView/ai/piReviewAiAssist.ts` — `buildPiReviewAiPrompt(contexts)`
  returning the prompt text, embedding `FEATURE_SIZING_SCALE`. Model the shape on
  `client/src/views/FeatureCanvas/ai/canvasAiAssist.ts` (context header + per-item lines + inline JSON example).
  Make T012 green
- [X] T016 [US2] In the same file add `parsePiReviewAiReply(replyText, knownIssueKeys)` returning
  `PiReviewAiRunResult` (data-model.md). Use the shared `client/src/utils/extractJsonPayload.ts` — the envelope is
  object-rooted precisely so no third ad-hoc array extractor is needed (research R-3). Guard `parsed.kind !== 'piReview'`.
  Be **lenient per field, strict per key**. Derive points via `readPointsForSize` — never read a `points` field.
  Make T013 green
- [X] T017 [US2] Create `client/src/views/ArtView/ai/piReviewAiFetch.ts` — `fetchPiReviewAiContexts(rows)` building
  `PiReviewAiFeatureContext[]`. Reuse `client/src/utils/acceptanceCriteria.ts` and
  `client/src/utils/richTextPlainText.ts` as-is (Article VII). Resolve AC field ids **once per fetch**, not per
  batch. This is a **separate on-demand fetch**: do NOT touch `DEFAULT_LINK_FIELDS` in
  `client/src/views/ArtView/piReviewJira.ts` or the server's `RECONCILE_FIELDS` (research R-2). Make T014 green
- [X] T018 [P] [US2] Write a failing test in `client/src/views/ReportsHub/ReportAiPanel.test.tsx`: when `onRunAuto`
  is supplied the panel renders a `⚡ Run via AI Assist (auto)` button, disabled while `isRunning`; when it is
  omitted the panel is unchanged for its two existing consumers (`BacklogRemediationPanel`, `PersonalFlowTab`)
- [X] T019 [US2] Extend `client/src/views/ReportsHub/ReportAiPanel.tsx` with **optional** `onRunAuto?` and
  `isRunning?` props — additive only, never a fork (Article VII; the alternative is a third copy of a shell that
  already exists twice). Make T018 green
- [X] T020 [P] [US2] Write failing component tests in `client/src/views/ArtView/ai/PiReviewAiPanel.test.tsx`: hidden
  while AI Assist is locked (FR-007); explains and does not dispatch when the page has no Features (FR-009); the
  prompt is readable and copyable **before** anything is sent (FR-010); both the manual paste and the auto path
  reach **one** apply function; an automation failure shows a clear message and leaves the manual path working
  (FR-012)
- [X] T021 [US2] Create `client/src/views/ArtView/ai/PiReviewAiPanel.tsx` using the extended `ReportAiPanel` as the
  shell and `client/src/views/SnowHub/hooks/useAiAssistExchange.ts` for the auto path. Follow the
  `RiskManagementSection.tsx:356-408` rule: **auto is a shortcut past the paste box, not a second pipeline** — both
  call the same `applyResponse(text)`. `runAiAssistExchange` never throws, so handle `{ok:false, message}` rather
  than try/catch. Make T020 green
- [X] T022 [US2] Write a failing test in `client/src/views/ArtView/PiReviewTab.test.tsx`: the AI Assistance
  affordance is absent in **view mode** and present in **edit mode** when unlocked (FR-008), and absent when locked
  regardless of mode (FR-007). Drive the unlock via `act(() => setAiAssistUnlocked(true))`
- [X] T023 [US2] Mount the panel in `client/src/views/ArtView/PiReviewTab.tsx` behind `canEditContent` (line 766) so
  it appears only in edit mode and only when unlocked (FR-007, FR-008). Nothing but the mount lands in this file —
  it is already 2,600 lines. Make T022 green

### Checkpoint

- [X] T024 [US2] Prove US2: `cd client; npx vitest run src/views/ArtView src/views/ReportsHub` green. Manually walk
  **quickstart Scenarios C, D and F** — panel gating, prompt readable first, auto path plus its failure mode.
  Suggestions are visible and **nothing has been applied**; the page is not dirty

---

## Phase 5: User Story 3 — Stay in control (P3)

**Goal**: The user accepts or rejects each suggestion row by row, and an accepted one touches **exactly two cells**:
Point Estimate (replace) and Implementation Notes (append). Nothing else ever moves.

**Independent test**: Given suggestions from US2, accept one → that row's estimate and notes update, the page reports
unsaved changes, no Confluence write happens, and every other suggestion stays pending. Reject one → the row is
untouched. Reload after saving → notes are still there and nothing moved between columns.

**Depends on**: US2 (needs parsed suggestions).

### Tests first (red)

- [X] T025 [P] [US3] Write failing unit tests in `client/src/views/ArtView/ai/piReviewAiApply.test.ts` for
  **`specs/016-pi-review-ai-assist/contracts/cell-write-contract.md`** — this is the feature's most valuable test.
  Assert invariant **CW-1**: applying any suggestion leaves **every** `PiReviewRow` field other than `pointEstimate`
  and `notes` referentially unchanged — explicitly including `dependency`, `risks` and `priority` (FR-025).
  **CW-2**: a non-accepted suggestion changes nothing. **CW-3**: applying twice equals applying once. **CW-4**
  (unit level): the function is **pure** — it performs no I/O and returns a new row rather than mutating one
  (its behavioural counterpart, "accepting never writes to Confluence", is asserted at the panel in T032).
  **CW-5**: `description`/`acceptanceCriteria` never appear on a row
- [X] T026 [US3] Write failing unit tests in `client/src/views/ArtView/ai/piReviewAiApply.test.ts` (same file as
  T025) for note application: labels are exactly
  `Dependency note`, `Risk note`, `Implementation note`; order is existing → Dependency → Risk → Implementation
  (mirroring `piReviewJira.ts:402,405`); lines join with `\n`; blank-ish values (`n/a`, `none`, `-`) are dropped;
  each note is capped at `MAX_AI_NOTE_LENGTH` (300) **before** the append; re-applying does not duplicate a line
  (FR-027). **FR-028**: a risk or dependency the AI identifies that has **no** corresponding Jira link is still
  recorded as a note — no key is invented, and `dependency`/`risks` stay untouched
- [X] T027 [US3] Write failing unit tests in `client/src/views/ArtView/ai/piReviewAiApply.test.ts` (same file as
  T025) for the estimate: a valid size replaces the cell with
  the **derived** points; `size === null` leaves the estimate **untouched** while the item survives for its notes;
  `XXL` cannot be applied without `userSuppliedPoints` (research R-7); a row with an existing human estimate reports
  a conflict rather than silently replacing (FR-023)

### Implementation (green)

- [X] T028 [US3] In `client/src/views/ArtView/piReviewJira.ts`: **export** the existing module-private
  `appendUniqueNoteLine` (line 271). Change nothing about its behaviour — reconciliation writes the same column with
  the same convention, and a second implementation would drift (research R-4). ⚠️ This file is bundled into the
  server engine, so `npm run build:pi-review-engine && npm run test:dom` must stay green
- [X] T029 [US3] Create `client/src/views/ArtView/ai/piReviewAiApply.ts` — `applyPiReviewSuggestion(row, suggestion)`
  returning a new row. Use the exported `appendUniqueNoteLine`; never assign `notes` directly. Add
  `MAX_AI_NOTE_LENGTH` as a named constant (Article IV) — the column's first length cap, needed because Confluence
  renders the whole cell on one line (research R-4). Make T025–T027 green
- [X] T030 [P] [US3] Write failing component tests in
  `client/src/views/ArtView/ai/PiReviewSuggestionTable.test.tsx`: each suggestion is shown against its Feature with
  its size and derived points (FR-019); **nothing reaches the table before Accept** (FR-018); accepting one leaves
  the others pending (FR-032); reject leaves the row untouched; an `XXL` row shows `XXL (100+) — set a value` and
  **cannot be accepted** until a number is entered; unknown keys and unparsed items are reported, not applied
- [X] T031 [US3] Create `client/src/views/ArtView/ai/PiReviewSuggestionTable.tsx` — the feature's one genuinely new
  component (research R-6 verified no reuse candidate exists; justification comment required at the component per
  Article VII). Per row: current vs proposed for the two writable cells, the rationale, and Accept/Reject. Model the
  row on `client/src/views/FeatureCanvas/ai/AiSuggestionPanel.tsx:266-280` but as a real parameterised component.
  Make T030 green
- [X] T032 [US3] Write a failing test in `client/src/views/ArtView/ai/PiReviewAiPanel.test.tsx` for the accept
  wiring: accepting a suggestion applies it to the row **and** marks the page as having unsaved changes (FR-022,
  invariant I-2); accepting **never** triggers a Confluence write (**invariant CW-4** — assert the update/save
  path is not called); an item whose key is not on the page is filtered out before display and never applied
  (FR-021); rejecting leaves the row untouched
- [X] T033 [US3] Wire the table into `PiReviewAiPanel.tsx`: Accept calls `applyPiReviewSuggestion` and marks the page
  with unsaved changes (FR-022, invariant I-2); it must **not** write to Confluence (CW-4). Filter items to known
  keys before display — the `AiSuggestionPanel.tsx:197` guard, which is FR-021. Make T032 green
- [X] T034 [US3] Write a failing test in `client/src/views/ArtView/ai/PiReviewAiPanel.test.tsx`, then implement in
  `client/src/views/ArtView/ai/PiReviewAiPanel.tsx`, for **FR-030**: the panel states that an accepted estimate can
  update the Jira issue, and the statement is visible **before** any Accept control is reachable. ⚠️ Treat this as a
  first-class requirement, not UI copy — Q2 chose "no special case", so an accepted estimate arms the existing
  `pendingEstimateUpdate` write-back (`piReviewJira.ts:410-416`) and this disclosure is the only thing between the
  user and an unexpected Jira edit

### Checkpoint

- [X] T035 [US3] Prove US3: `cd client; npx vitest run src/views/ArtView` green. Manually walk **quickstart
  Scenarios E and G** — accept/reject, only two cells move, and every awkward reply (wrong `kind`, `HUGE` size,
  ghost key, partial reply, prose, `XXL`, double-paste). Save then Reload: notes persist and nothing moved columns

---

## Phase 6: User Story 4 — Size by hand (P4)

**Goal**: The T-shirt scale is visible on the PI Review tab without leaving it, and links to the Confluence guidance
— whether or not AI Assist is unlocked, because manual sizing is the norm.

**Independent test**: With AI Assist **locked**, open the PI Review tab — the scale is visible, correct, and links
out. It matches the scale embedded in the prompt.

**Depends on**: Phase 2 (the scale) only. Independent of US1, US2 and US3.

- [X] T036 [P] [US4] Write failing component tests in `client/src/views/ArtView/ai/PiReviewSizingCard.test.tsx`:
  renders XS 10 · S 20 · M 40 · L 60 · XL 80 · XXL 100+ from `FEATURE_SIZING_SCALE`; links to `SIZING_GUIDANCE_URL`;
  **renders while AI Assist is locked** (FR-035 — it must not hide with the AI feature)
- [X] T037 [US4] Create `client/src/views/ArtView/ai/PiReviewSizingCard.tsx` rendering the scale from the shared
  constant — never a second hardcoded copy (FR-033, FR-034). Make T036 green
- [X] T038 [US4] Mount the card in `client/src/views/ArtView/PiReviewTab.tsx` **outside** the unlock gate and
  independent of `canEditContent` (FR-035). Add a test asserting it is present when locked and that the values match
  the prompt's scale (SC-008)

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T039 Update `CHANGELOG.md` under `## [Unreleased]`: **Fixed** — Ctrl+Alt+Z raised up to four stacked
  passphrase prompts; now exactly one. **Added** — PI Review AI Assistance (sizes Features against the T-shirt
  scale, drafts risk/dependency/implementation notes, review row by row) and the in-app sizing scale. Say plainly
  that an accepted estimate can update Jira, and that the AI never writes the Dependency/Risks columns. Replace the
  T001 stub (Article VI)
- [X] T040 Verify the **server is untouched**: `npx jest` and `npm run build:pi-review-engine && npm run test:dom`
  (13/13) both green — proving the `appendUniqueNoteLine` export (T028) did not disturb the engine feature 015 runs
  server-side (FR-037)
- [X] T041 Verify **reconciliation is unchanged** (FR-038): the `Jira updated N fields on load` banner behaves as
  before, and `description`/`acceptanceCriteria` never appear in it — they are prompt inputs only (CW-5)
- [X] T042 Full sweep: `cd client; npx vitest run && npx eslint src && npx vite build`. Confirm no new runtime
  dependency entered `package.json`
- [X] T043 Walk the **Regression checks** section of `specs/016-pi-review-ai-assist/quickstart.md` — manual
  authoring (type, Pull Features, Save), the 015 scheduler's Run now, and that opening a PI Review page issues no
  extra Jira traffic than before (description/AC are fetched on demand only)
- [ ] T044 User acceptance: walk `specs/016-pi-review-ai-assist/quickstart.md` Scenarios A–H against a real
  Jira/Confluence PI Review page and complete the sign-off table. ⚠️ Requires a running server and live Jira —
  cannot be executed in the dev environment

---

## Dependencies & sequencing

```text
Phase 1 (Setup: T001)
   │
   ├──────────────────────────────► Phase 3: US1 (T004–T011)  ← independent; ship first
   │                                    MVP boundary ─────────────────────┐
   ▼                                                                      │
Phase 2 (Foundational: T002–T003 — the scale)                             │
   │                                                                      │
   ├──► Phase 4: US2 (T012–T024) ──► Phase 5: US3 (T025–T035)             │
   │                                                                      │
   └──► Phase 6: US4 (T036–T038)  ← independent of US1/US2/US3            │
                                                                          │
                       Phase 7 (Polish: T039–T044) ◄──────────────────────┘
```

- **US1 depends on nothing.** It can start immediately, in parallel with Phase 2, and ship alone.
- **US2 depends on Phase 2** (the scale). **US3 depends on US2** (needs parsed suggestions).
- **US4 depends on Phase 2 only** — it can be built any time after T003.
- **External dependencies: none.** No new package, no server change, no config, no migration.

## Parallel execution examples

**Within US1** — the three source files are independent:
```text
T005, T006  (test files — parallel with each other)
T008, T009  (RiskManagementSection.tsx, CreateChgTab.tsx — parallel; T007 is a third file)
```

**Within US2** — different files only:
```text
T012, T014  (prompt tests, fetch tests — different files)
T018, T020  (ReportAiPanel test, panel test — different files)
```
T013 shares `piReviewAiAssist.test.ts` with T012, so it follows T012 rather than running beside it.

**Within US3**:
```text
T025 → T026 → T027  (all three write `piReviewAiApply.test.ts` — serial, not parallel)
T030                (table tests — different file, parallel with any of the above)
```

**Across stories** — once T003 lands, three tracks run concurrently:
```text
Track A: US1 (T004 → T011)
Track B: US2 → US3 (T012 → T035)
Track C: US4 (T036 → T038)
```

## Implementation strategy

**MVP = US1 alone.** It fixes the reported defect, it is pure deletion, and it is independently shippable and
valuable on its own. If nothing else lands, the double lock screen is gone.

**Increment 2 = US1 + US2.** A read-only advisory panel: the AI suggests, the user reads, nothing is written. Safe
by construction — there is no apply path yet.

**Increment 3 = + US3.** The apply path, gated by per-row review. This is where FR-030's disclosure and the
cell-write contract earn their keep.

**Increment 4 = + US4.** The sizing card. Tiny, independent, and useful even to someone who never unlocks AI.

**The two tasks to not rush**: **T025** (the cell-write contract test — it is what makes the Q1 guarantee mechanical
rather than aspirational) and **T034** (the FR-030 disclosure — the only thing between the user and an unexpected
Jira write).

## Task summary

| Phase | Story | Tasks | Count |
|---|---|---|---|
| 1 — Setup | — | T001 | 1 |
| 2 — Foundational | — | T002–T003 | 2 |
| 3 — One unlock prompt | **US1** (P1) | T004–T011 | 8 |
| 4 — Size a PI Review page | **US2** (P2) | T012–T024 | 13 |
| 5 — Stay in control | **US3** (P3) | T025–T035 | 11 |
| 6 — Size by hand | **US4** (P4) | T036–T038 | 3 |
| 7 — Polish | — | T039–T044 | 6 |
| **Total** | | | **44** |

**Parallelisable**: 12 tasks marked `[P]`. **Test tasks**: 14 — every implementation task is preceded by a
failing test, per Article V (verified: no implementation task lacks one).
