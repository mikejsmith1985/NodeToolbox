# Implementation Plan: Guided Epic Intake

**Branch**: `feature/037-guided-epic-intake` | **Date**: 2026-09-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/037-guided-epic-intake/spec.md`

## Summary

Meeting notes (GH #387) go in. A table of DENP Epic keys comes out: one row per Enrollment-owned item, each either
**existing** or **created**, and every other item accounted for with a reason. In between is a loop of copy-prompt /
paste-reply exchanges and closed-choice PO questions. The loop is driven by **a checklist Toolbox owns**, not by the
AI.

The design idea in one line: **the next question is a pure function of which answers are missing.**

```
notes ──► numbered lines ──► outline baseline (rule) ──► size-based owners (rule)
                                   │
          ┌────────────────────────┴───────────── open decisions? ─────────────┐
          ▼                                                                    │
   AI turn (only open slots) ── ingest validates ──► settle / reject ──────────┤
   Toolbox turn (Check DENP) ── named keys + JQL ──► candidates / auto-settle ─┤
   PO turn (selects)          ── pick, don't type ──► settle (immutable) ──────┘
                                   │
                          nothing open ──► create accepted drafts ──► summary table
```

Four properties make it deterministic:

1. **Rules outrank the AI.**
   - Stated sizes decide the owner (`Enrollment XL vs Fulfillment M` → Enrollment) before the AI is asked.
   - An open Epic named in the notes (`DENP-632`) is the match.
   - Zero search hits means create-new.
2. **The AI can only fill blanks.**
   - It cannot mint items: every item comes from the baseline.
   - It cannot cite an Epic Toolbox didn't find: match keys are allowlisted per item.
   - It cannot overwrite the PO.
   - Two failures on a slot and the slot goes to the PO.
3. **Coverage is proven.** Every source line ends up in exactly one item or is set aside with a reason, and the loop
   will not advance otherwise.
4. **"Not checked" is never "no duplicate."** A failed search blocks creation for that item.

What is new, and why none of it exists today:

| New | Kind | Why it does not exist |
|---|---|---|
| `intakeChecklist.ts` — open decisions, turn, next step | pure | The feature itself. It follows the model of `rewriteJourney.ts`'s derived-flow pattern. |
| `notesOutline.ts` — numbering, baseline, coverage, chunking | pure | Nothing parses bullet outlines. |
| `ownershipRule.ts` — area sizes + owner rule | pure | Sizes exist (`piReviewSizing.ts`); nothing reads them from prose. |
| `namedKeys.ts`, `deferralEvidence.ts` | pure | There are only private per-module key regexes. |
| `ai/intake{Classify,Match,Draft}Round.ts` | pure | Three new reply kinds. |
| `duplicateSearch.ts`, `epicCreate.ts` | orchestration over reused primitives | No search-before-create exists; `runCompositionCommit` writes no labels and handles one draft. |
| `intakeSummary.ts`, `epicIntakeStore.ts` | pure / storage | — |
| `EpicIntakeWorkspace.tsx` + 7 children | UI | — |

**Reuse — 17 of 26 capabilities** (research R-013):

- **Sources**: every source reader, plus rich paste.
- **AI**: `PoAiPanel` and its gate, `extractJsonPayload`, `MAX_CHARS_PER_PROMPT`.
- **Descriptions and sizing**: `featureDocSections`, the T-shirt order.
- **Jira**: `getProjectIssueTypes`, `getIssueTypeFields`, `TransitionRequiredFields`, `createIssue`,
  `readFailureReason`, `fetchIssueByKey`.
- **Storage and presentation**: team-scoped storage, the journey-strip CSS, the rich-clipboard pattern.

## Technical Context

**Language/Version**: TypeScript 5 / React 18 (client). The Node/Express server is **untouched**.

**Primary Dependencies**: all existing — zustand (`useAiAssistStore`), SheetJS / pdf / .msg readers already in
`PoTool/sources`, and Jira REST v2 via `services/jiraApi.ts`. **No new packages.**

**Storage**: `window.localStorage`, key `tbxPoEpicIntake:<intakeId>:<teamProfileId>` (team-scoped), with a versioned,
normalised record.

**Testing**: Vitest + Testing Library (with `user-event` real events). Unit tests are fully mocked, per the
three-layer rule.

**Target Platform**: PO Tool → Feature Composition tab (a mode, not a tab).

**Project Type**: Web application, client-only change.

**Performance Goals**:

- Check DENP for ~15 Enrollment items in under 30 s: sequential, ≤ 2 requests per item.
- Every pure step (baseline, coverage, next-step) runs in under 5 ms for 200 lines.

**Constraints**:

- Propose-only AI with a manual exchange; no automated channel.
- No Jira write without a per-draft accept.
- No `customfield_*` id in any new file (the ratchet).
- No hard-coded issue-type name in any query.
- `FeatureCompositionTab.test.tsx` and `HygieneFixControl.test.tsx` pass **unmodified**.

**Scale/Scope**: ~25 items and ~60 lines per intake (GH #387). The design tolerates 200 lines through chunking.

## Constitution Check

| Article | Status | Note |
|---|---|---|
| I — Prime Directive | ✅ | A pure engine with contract tests, not UI-driven state. Rules come before AI, so behaviour is repeatable. |
| II — Process Protection | ✅ | No process management. |
| III — Branching | ✅ | `feature/037-guided-epic-intake` from `main`; PR to main. |
| IV — Code Quality | ✅ | Named constants for every threshold (60/40, 2 attempts, 20 results, 400-char excerpt, 9000-char part). Functions under 40 lines. Each round is split into build / parse / apply. |
| V — Testing | ✅ | Contract invariants (INV-1…6, the coverage proof, the action table) are written as failing tests first. Unit tests are mocked. The component flow uses real events. |
| VI — Documentation | ✅ | CHANGELOG in the PR. Artefacts stay under `specs/037-…`. |
| VII — Framework-First | ✅ with **one recorded drift** | Hygiene's reserved-character term builder **moves** to `utils/jqlTextTerms.ts` so intake can use it. It cannot be exported in place, because a second non-component export from a `.tsx` trips fast-refresh (`HygieneFixControl.tsx:769`). **Proof of behaviour preservation**: `HygieneFixControl.test.tsx` passes unmodified, or the move is reverted. Everything else is reuse (R-013). |
| VIII — Release | ✅ | Local pipeline only. |
| IX — Vault | ✅ | No secrets. |
| X — Verification | ✅ | Quickstart V-01…V-14 are behavioural. V-13 proves the AI-locked path end to end. |
| XI — Output restraint | ✅ | No dashboards and no ad-hoc docs. |

**Standing project rules also checked**:

| Rule | How it is met |
|---|---|
| AI propose-only | Manual exchange only; a per-item accept comes before any write (FR-026/027). |
| Pick, don't type | Every PO decision is a select (`composition-mode.md` §3). Only draft text is free text. |
| No-AI copy scan | Mode copy avoids AI/assistant/unlock/prompt/reply, plus an additive locked-mode test case. |
| Surfaces agree by construction | Open count, step and summary all derive from `listOpenDecisions`/`buildSummaryRows`; nothing parallel. |
| UI styling | Reuses `FeatureCompositionTab.module.css` and `rewrite.module.css`. New classes live in one prefixed module. |
| Field-mapping ratchet | Epic Name is discovered by **name** from createmeta. No field ids in source. |
| Jira re-instance readiness | The project key is stored per intake (default `DENP`). The Epic type is resolved live. |

**Initial check: PASS. Post-design check: PASS.** The design added one move (recorded above) and no infrastructure that
the codebase already provides.

## Project Structure

### Documentation (this feature)

```text
specs/037-guided-epic-intake/
├── spec.md
├── plan.md                      # this file
├── research.md                  # R-001 … R-014
├── data-model.md
├── quickstart.md                # V-01 … V-14
├── contracts/
│   ├── decision-engine.md       # the twenty-questions core
│   ├── deterministic-rules.md   # outline, keys, deferral, sizes → owner
│   ├── ai-rounds.md             # classify / match / draft envelopes
│   ├── duplicate-search.md      # Check DENP
│   ├── epic-create.md           # pre-flight, payload, loop, recovery
│   ├── summary-and-store.md     # table, clipboard, persistence
│   └── composition-mode.md      # toggle + workspace UI
├── checklists/requirements.md
└── tasks.md                     # /speckit-tasks (not yet created)
```

### Source Code

```text
client/src/
├── utils/
│   ├── jqlTextTerms.ts                 # MOVED from HygieneFixControl.tsx (reserved-char strip + term builder)
│   └── jqlTextTerms.test.ts
├── views/Hygiene/HygieneFixControl.tsx # import from utils — behaviour unchanged, test unmodified
├── views/PoTool/
│   ├── FeatureCompositionTab.tsx       # ADDITIVE: mode toggle + conditional render
│   ├── poToolWithoutAi.test.tsx        # ADDITIVE: one intake-mode case
│   ├── jira/runCommit.ts               # ADDITIVE: export readFailureReason
│   └── intake/
│       ├── epicIntakeModel.ts          # types + constants (data-model.md)
│       ├── intakeChecklist.ts          # + .test.ts
│       ├── notesOutline.ts             # + .test.ts
│       ├── namedKeys.ts                # + .test.ts
│       ├── deferralEvidence.ts         # + .test.ts
│       ├── ownershipRule.ts            # + .test.ts
│       ├── duplicateSearch.ts          # + .test.ts
│       ├── epicCreate.ts               # + .test.ts
│       ├── intakeSummary.ts            # + .test.ts
│       ├── epicIntakeStore.ts          # + .test.ts
│       ├── ai/
│       │   ├── intakeClassifyRound.ts  # + .test.ts
│       │   ├── intakeMatchRound.ts     # + .test.ts
│       │   └── intakeDraftRound.ts     # + .test.ts
│       ├── EpicIntakeWorkspace.tsx     # + .test.tsx
│       ├── EpicIntakeWorkspace.module.css
│       └── components/
│           ├── IntakeResumeBar.tsx
│           ├── IntakeNotesPanel.tsx
│           ├── IntakeJourneyStrip.tsx
│           ├── IntakeItemsTable.tsx
│           ├── IntakeTurnPanel.tsx
│           ├── IntakeQuestionList.tsx
│           ├── IntakeDraftReview.tsx
│           ├── IntakeCreatePanel.tsx
│           └── IntakeSummaryTable.tsx  # each with a .test.tsx (pre-commit hook: test per new source file)
│       └── gh387Notes.fixture.ts       # the GH #387 body — drives the SC-001/SC-004 assertions
```

**Structure Decision**: The feature is a self-contained `intake/` folder under `PoTool`, beside `rewrite/`, which is
the precedent for a multi-step PO workspace. It touches the shipped code in four additive places: the toggle, one test
case, one export, and one import.

## Delivery order (for `/speckit-tasks`)

1. **Pure foundation**: model → outline/keys/deferral/ownership → checklist. This is testable with the GH #387 fixture
   and no UI or Jira. Ownership for Core Integration is provable here.
2. **AI rounds**: classify, then match, then draft. The parsers are tested against hand-written good and bad replies.
3. **Jira**: the `jqlTextTerms` move (with a HygieneFixControl regression run), duplicate search, epic create.
4. **Store + summary.**
5. **UI**: workspace and components, then the toggle in Feature Composition, then the locked-mode scan case.
6. **CHANGELOG**, the full suites, and `tsc -b`.

The steps in 1 and 2 are independent per module, so they can run on parallel agents. Step 3's move must land before
`duplicateSearch.ts`.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| Moving `buildIssueTextMatchTerms` to `utils/` | Intake needs the same reserved-character sanitising, or its queries 400 on keys and colons | Exporting in place trips fast-refresh; copying it would create two sanitisers that drift |
| `creating` state + recovery search (R-009) | Idempotency across a crash between a 201 and the save | Without it, a retry after a browser crash creates a duplicate Epic, the exact thing the feature exists to prevent |
| Chunked classify prompts | Notes longer than one paste limit | GH #387 fits in one part, but a two-page Outlook thread will not |

## Risks

| Risk | Mitigation |
|---|---|
| DENP's Epic create screen requires fields beyond Epic Name | Pre-flight asks them once per batch (epic-create §2). V-10 confirms live. |
| Outlook paste loses `•`/`o` markers | The no-marker fallback (one item per line) plus AI regrouping. V-01 confirms with a real paste. |
| An AI returns search terms too broad (e.g. "enrollment") | Candidates are capped at 20. The match round and PO still decide; a broad term cannot cause a create, only a longer list. |
| Adjacent `issuetype = Feature` surfaces break after the rename | Out of scope; recorded in R-014 for a separate `fix/` branch. |
