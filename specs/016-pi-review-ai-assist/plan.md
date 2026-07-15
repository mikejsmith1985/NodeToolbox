# Implementation Plan: Single AI Unlock + PI Review AI Assistance

**Branch**: `feature/016-pi-review-ai-assist` | **Date**: 2026-07-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/016-pi-review-ai-assist/spec.md`

## Summary

Two changes, sequenced so the first de-risks the second.

**Part 1 — one unlock prompt.** Four per-view Ctrl+Alt+Z gates are functional twins of the app-level
`AiAssistUnlockGate` that superseded them; they were never removed. Delete their listener, passphrase state, submit
handler and modal. Each view keeps reading the shared `aiAssistStore` and keeps its AI affordance. Pure deletion —
research verified there is no behaviour in the duplicates that the survivor lacks, including the re-lock toggle.

**Part 2 — a PI Review AI panel.** A new `ArtView/ai/` module (mirroring the existing `FeatureCanvas/ai/`) builds one
prompt covering every Feature on the page, dispatches it through the existing AI Assist exchange, and presents
per-Feature suggestions the user accepts row by row. An accepted suggestion may touch **exactly two cells**: Point
Estimate (replace) and Implementation Notes (append). Nothing else — Dependency, Risks and Priority are Jira mirrors
rebuilt on every load, so the AI supplies the *explanation* they cannot hold, as a labelled note line.

The approach is overwhelmingly **reuse**: AC field resolution, rich-text flattening, JSON extraction, the exchange
hook, the copy/paste shell, the note-line convention and the clipboard helper all already exist. One component is
genuinely new — a per-row review table — and that gap was verified rather than assumed (research R-6).

## Technical Context

**Language/Version**: TypeScript 5.x, React 19 (client). This feature is **client-only** — no server changes.

**Primary Dependencies**: React, zustand (`aiAssistStore`), existing AI Assist exchange pipeline. **No new runtime
dependencies.**

**Storage**: `sessionStorage` (`tbxAiAssistUnlocked`, unchanged); Confluence page storage (via the existing PI Review
save path). No new persistence — suggestions are ephemeral component state until accepted.

**Testing**: vitest + @testing-library/react (client unit/component). TDD per Article V.

**Target Platform**: Desktop web app (browser + packaged exe).

**Project Type**: Web application — `client/` (React frontend) + `src/` (Node server). Only `client/` is touched.

**Performance Goals**: Prompt build for a 40-Feature page must not block interaction. The AI fetch is on-demand
(button click), never on page load — page-load cost is unchanged (research R-2).

**Constraints**:
- MUST NOT alter `reconcilePiReviewRowsWithJira` semantics (FR-038) — description/AC stay out of `PiReviewRow`.
- MUST NOT touch `DEFAULT_LINK_FIELDS` or the server's `RECONCILE_FIELDS` — the AI panel fetches its own fields.
- MUST NOT change the notes storage format — the shared engine is also run server-side by feature 015.
- MUST NOT auto-apply or auto-save.

**Scale/Scope**: PI Review pages carry ~10–40 Features. Part 1 touches 5 files + 2 test files; Part 2 adds ~5 new
files and touches 3.

## Constitution Check

*GATE: evaluated before Phase 0, re-evaluated after Phase 1 design. Result: **PASS**.*

| Article | Status | Evidence |
|---|---|---|
| **III — Branching** | ✅ | On `feature/016-pi-review-ai-assist`; no commits to `main` |
| **IV — Code Quality** | ✅ | Verb-first functions under 40 lines; `is/has/can/should` booleans; the sizing scale and the AI note length cap are **named constants**, not magic numbers; purpose comment per new file; doc comment per export |
| **V — Testing** | ✅ | TDD red→green throughout. Prompt builder, parser, sizing map and note application are **pure functions** — unit-testable with no I/O. Panel/table tested with @testing-library. Part 1 is test-first too: the removal is proven by asserting exactly one prompt renders |
| **VI — Documentation** | ✅ | `CHANGELOG.md` updated for both parts; no ad-hoc status docs; `specs/016-*/` is the exempt pipeline artifact |
| **VII — Framework-First** | ✅ | **The governing gate for this feature.** Eight existing capabilities reused (research R-6 table). Two documented gaps only: (a) no per-row accept/reject component exists — verified against `AiSuggestionPanel`, `AgingTriageActionTable`, `RiskManagementSection`; (b) no PI-Review-specific prompt/parser exists. `ReportAiPanel` is **extended additively**, not forked. Justifications recorded in research R-6 and at each new component |
| **VIII — Release** | ✅ | N/A this phase; local pipeline when released |
| **IX — Vault Zero-Knowledge** | ✅ | No secret enters the prompt, a file or a log. The webhook secret stays in server config, untouched. See the disclosure note below |
| **X — Verification & Proof** | ✅ | Behaviour proven by tests, not by "it builds". Part 1's proof is a rendered-prompt count; Part 2's is that no cell outside Point Estimate/Notes ever changes |
| **XI — Output Restraint** | ✅ | No dashboard artifact; no phase-name narration |

**Article IX note (not a violation, worth stating).** The prompt carries Jira Feature descriptions and acceptance
criteria to the user's configured Atlassian Automation webhook. That is **business data, not secrets**, and it is the
pre-existing behaviour of every AI Assist surface (`dispatchPrompt` deliberately does not redact —
`src/services/aiAssistExchange.js:9-11`). No credential is included. FR-010 makes the full prompt visible before
sending, so the user can see exactly what leaves the app.

**Not a constitution gate, but the sharpest risk in the feature**: FR-030's disclosure. Q2 authorises an accepted AI
estimate to reach **Jira** through an existing write-back that fires precisely when Jira's estimate is empty — the
state an AI estimate creates. With no special case by design, that disclosure copy is the only thing between the user
and an unexpected Jira edit. It is treated as a first-class requirement with its own test, not as UI decoration.

## Project Structure

### Documentation (this feature)

```text
specs/016-pi-review-ai-assist/
├── spec.md              # Feature spec (clarifications resolved)
├── plan.md              # This file
├── research.md          # Phase 0 — R-1..R-8, deferred work, resolved assumptions
├── data-model.md        # Phase 1 — entities, states, invariants
├── quickstart.md        # Phase 1 — runnable validation scenarios
├── contracts/
│   ├── ai-reply-contract.md      # The {kind, items[]} envelope + parse strictness
│   └── cell-write-contract.md    # Which cells an accepted suggestion may touch
└── checklists/
    └── requirements.md  # 16/16
```

### Source Code (repository root)

```text
client/src/
├── components/AiAssistUnlockGate/
│   ├── index.tsx                     # UNCHANGED — the surviving gate
│   └── index.test.tsx                # UNCHANGED — already covers open/verify/error/re-lock
├── store/aiAssistStore.ts            # UNCHANGED — already centralised
├── utils/
│   ├── acceptanceCriteria.ts         # REUSED as-is
│   ├── richTextPlainText.ts          # REUSED as-is
│   └── extractJsonPayload.ts         # REUSED as-is
├── views/
│   ├── SprintDashboard/
│   │   ├── SprintDashboardView.tsx        # PART 1 — remove gates B and C
│   │   ├── SprintDashboardView.test.tsx   # PART 1 — rewrite 4 duplicate-prompt assertions
│   │   └── RiskManagementSection.tsx      # PART 1 — remove gate D
│   ├── SnowHub/tabs/CreateChgTab.tsx      # PART 1 — remove gate E
│   ├── ReportsHub/ReportAiPanel.tsx       # PART 2 — additive: optional onRunAuto/isRunning
│   └── ArtView/
│       ├── PiReviewTab.tsx                # PART 2 — mount panel + sizing card
│       ├── piReviewJira.ts                # PART 2 — export appendUniqueNoteLine
│       └── ai/                            # PART 2 — NEW module (mirrors FeatureCanvas/ai/)
│           ├── piReviewSizing.ts          #   the T-shirt scale (single definition)
│           ├── piReviewAiAssist.ts        #   prompt builder + reply parser (pure)
│           ├── piReviewAiApply.ts         #   suggestion → row (pure)
│           ├── piReviewAiFetch.ts         #   on-demand description/AC fetch
│           ├── PiReviewAiPanel.tsx        #   the panel (shell + both paths)
│           ├── PiReviewSuggestionTable.tsx#   NEW component — the verified gap
│           └── PiReviewSizingCard.tsx     #   the in-app scale + Confluence link
```

**Structure Decision**: A new `client/src/views/ArtView/ai/` module, directly mirroring the established
`client/src/views/FeatureCanvas/ai/` precedent (which holds `canvasAiAssist.ts` + `AiSuggestionPanel.tsx` +
`clipboard.ts` alongside their tests). This keeps the pure logic — prompt, parse, sizing, apply — in files with no
React and no I/O, which is what makes Article V's fast unit tests achievable. `PiReviewTab.tsx` is already 2,600
lines; nothing new lands in it beyond mounting.

**Server**: untouched. `src/services/piReviewRefresh.js` and `RECONCILE_FIELDS` are deliberately not modified
(research R-2) — feature 015's scheduled refresh stays a faithful Jira mirror with no AI in the loop (FR-037).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New component `PiReviewSuggestionTable` | FR-018/FR-032 need per-row accept/reject with current-vs-proposed for two cells. No such component exists — verified against all three candidates (research R-6) | `AiSuggestionPanel`'s list is 15 lines of inline JSX with FeatureCanvas-local styles, not exported or parameterised, and carries a single `proposedValue`. `AgingTriageActionTable` has no accept/reject. `RiskManagementSection` applies with no review at all |
| New module `ArtView/ai/` | The prompt, the sizing map and the parser are PI-Review-specific and must be pure to be unit-testable | Inlining into `PiReviewTab.tsx` (already 2,600 lines) would make the logic untestable without rendering, breaking Article V's fast-unit-test rule |
| Extending `ReportAiPanel` with `onRunAuto`/`isRunning` | FR-011 needs both manual and automatic paths; the shell is manual-only today | Forking it would create a third copy of a shell that exists twice already — the exact duplication Article VII forbids, and the same mistake that produced the four unlock gates Part 1 is deleting |

## Phasing & checkpoints

Part 1 ships first and independently: it is a defect fix, it is pure deletion, and Part 2's button appears behind the
very gate Part 1 repairs. Shipping it first means Part 2 is developed against one prompt, not five.

| Phase | Scope | Checkpoint |
|---|---|---|
| **1 — Single unlock** | Remove gates B–E; rewrite the 4 duplicate-prompt assertions to drive the app-level gate | Ctrl+Alt+Z raises exactly one prompt on all five surfaces; unlocking once still unlocks everywhere; every AI affordance still appears (SC-001, SC-002) |
| **2 — Pure core** | `piReviewSizing.ts`, `piReviewAiAssist.ts` (prompt + parse), `piReviewAiApply.ts` | Unit tests only, no React. Scale is exact; parser is lenient per-field, strict per-key; XXL yields no number; unknown keys reported not applied (SC-006, SC-007) |
| **3 — Fetch + panel** | `piReviewAiFetch.ts`, `ReportAiPanel` extension, `PiReviewAiPanel.tsx` | Prompt visible before send; both paths reach one apply function; automation failure leaves manual working (FR-010, FR-011, FR-012) |
| **4 — Review table** | `PiReviewSuggestionTable.tsx` | Nothing reaches the table before accept; accept marks unsaved; reject leaves the row untouched; XXL blocked until a number is set (FR-018, FR-022, R-7) |
| **5 — Wiring + sizing card** | Mount in `PiReviewTab.tsx`; `PiReviewSizingCard.tsx`; CHANGELOG | Panel hidden when locked and outside edit mode; sizing card visible regardless of unlock; manual + scheduled flows unchanged (FR-007, FR-008, FR-035, FR-036, FR-037) |

## Dependencies & sequencing

- **Phase 1 is independent** and could ship alone. Everything else depends on it only for a clean manual test.
- **Phase 2 depends on nothing** — pure functions; can be written in parallel with Phase 1.
- **Phase 3 depends on Phase 2** (needs the prompt builder) and on the `ReportAiPanel` extension.
- **Phase 4 depends on Phase 2** (needs the parsed suggestion model).
- **Phase 5 depends on 3 and 4.**
- **External**: none. No new dependency, no server change, no config, no migration. The AI Assist automation
  (webhook + parking page) is assumed already configured (spec A-9) — and if it is not, FR-012 keeps the manual
  copy/paste path working.

## Key risks

| Risk | Mitigation |
|---|---|
| Removing gates B–E silently removes an AI affordance | The affordances read `isUnlocked` from the shared store and are **not** part of the removal. Phase 1's checkpoint explicitly asserts every affordance still appears |
| An accepted AI estimate reaches Jira unexpectedly | By design (Q2), so the defence is disclosure: FR-030 gets its own test asserting the warning renders **before** acceptance is possible |
| AI notes become an unbounded wall of text on one Confluence line | Confluence flattens `\n` to a space (pre-existing, research R-4). Mitigated by a named length cap on AI note text — the column's first — and by keeping note lines few and short |
| A malformed reply discards every good suggestion | Per-field leniency: an invalid field drops to `null`, the row survives; only a missing/unknown `issueKey` discards an item (research R-3, FR-024) |
| The model invents a Feature not on the page | Items are filtered to known keys before display — the `AiSuggestionPanel.tsx:197` guard, which is exactly FR-021 |
| Description/AC leak into `PiReviewRow` and become Jira-owned columns | They are prompt inputs only, read from the issue map and never written to a row (research R-2). Enforced by the cell-write contract and its test |
