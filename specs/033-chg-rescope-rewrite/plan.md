# Implementation Plan: Rebuild an Existing Change From Scratch

**Branch**: `feature/033-chg-rescope-rewrite` | **Date**: 2026-08-07 | **Spec**: [spec.md](./spec.md)

**Status**: ✅ **Shipped in v0.138.0** (PR #307). All 45 tasks complete; quickstart validated against live
ServiceNow on 2026-08-07, including Test 4 — the rebuild wrote to the existing change number and created no
second change.

**Input**: Feature specification from `/specs/033-chg-rescope-rewrite/spec.md`

## Summary

Give **Modify Existing CHG** a **Start Over** action that discards a loaded change's contents and rebuilds it from
the blank template exactly as a new change would be built — then writes the result to the **existing CHG number**
instead of raising a new record.

Phase 0 recon changed the shape of the work. The terminal action **already exists**: `useCrgState.updateExistingChg`
PATCHes the full create payload to a change resolved by number and verifies the write by re-reading the record. The
builder **already accepts a mode prop** (`ConfigurationTab` mounts it as `mode="configuration"`). The scope
machinery — fix-version and JQL fetch, the "+ Add to Loaded Issues" additive path, per-issue selection, content
generation, the gated assist — ships unchanged.

So the approach is: **mount the existing builder in a new `rebuild` mode, bound to the loaded change number, and
save through the existing update action.** Four things are genuinely new, and two of them are correctness fixes
rather than UI:

1. **Entry point + destructive confirmation** in ModifyChgTab (FR-001–FR-004).
2. **`mode="rebuild"` binding** — target number visible throughout, terminal button updates instead of creates
   (FR-007, FR-028–FR-031).
3. **One-environment guard** — `createChg` fans out one CHG per enabled environment, but a rebuild has exactly one
   number; today the update path silently keeps only the first (FR-029).
4. **Number-scoped draft storage** — the wizard persists to one global key, so a rebuild would both inherit and
   destroy the operator's in-progress Create draft (FR-005, FR-033).

## Technical Context

**Language/Version**: TypeScript 5 / React 19 (client), Node.js (server, untouched by this feature)

**Primary Dependencies**: React, Zustand (`aiAssistStore` only), existing SNow relay client (`snowApi.snowFetch`),
Jira client (`jiraApi.jiraGet`). **No new dependencies.**

**Storage**: `localStorage` — existing `ntbx-crg-state` (unchanged for the Create wizard) plus new number-scoped
`ntbx-crg-rebuild-state:<CHG NUMBER>` keys for rebuild drafts. `ntbx-crg-short-description-config` is shared and
unchanged (it is a reusable default a new change would apply — FR-006).

**Testing**: Vitest + Testing Library (`client/`), run via `npx vitest run src/views/SnowHub`. Existing suite:
23 files / 390 tests, all green — the regression bar for this feature.

**Target Platform**: Browser (Windows desktop app shell), ServiceNow reached through the relay bookmarklet.

**Project Type**: Web application — client-only feature. **No server changes.**

**Performance Goals**: No new network calls beyond those the Create flow already makes. The rebuild adds exactly one
read (`fetchChangeSysIdByNumber`) and one verification read, both already inside `updateExistingChg`.

**Constraints**: Nothing may be written to ServiceNow before an explicit save (FR-030). `mode="wizard"` and
`mode="configuration"` renders must stay byte-identical. The existing SNow Hub suite must stay green.

**Scale/Scope**: One operator at a time, one change at a time, scope baskets up to a few hundred Jira issues.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Article | Gate | Pre-Phase 0 | Post-Phase 1 |
|---|---|---|---|
| **III — Branching** | Work on `feature/*`, never `main` | ✅ `feature/033-chg-rescope-rewrite` | ✅ unchanged |
| **IV — Code Quality** | Self-documenting names, `is/has/can/should/was` booleans, verb-first functions <40 lines, file purpose comment, doc comment per export | ✅ planned | ✅ `hasExactlyOneEnabledEnvironment`, `buildRebuildStorageKey`, `confirmRebuildDiscard` — all conform |
| **V — Testing** | TDD red → green → refactor; a failing test precedes implementation | ✅ planned | ✅ every contract below names its failing test first |
| **VI — Documentation** | CHANGELOG.md updated; no ad-hoc status docs | ✅ planned | ✅ one CHANGELOG entry; `specs/033-*/` is the exempt pipeline artifact |
| **VII — Framework-First** | Confirm the codebase does not already provide it; drift justified at the component | ✅ **this gate drove Phase 0** | ✅ 2 justified drifts, recorded in [research.md](./research.md#drift-justifications-article-vii) |
| **VIII — Release** | `scripts/local-release.ps1` only | ✅ n/a until release | ✅ unchanged |
| **IX — Vault** | No secret in conversation, file, or log | ✅ no secrets involved | ✅ unchanged |
| **X — Verification** | Evidence, not "it returned 200" | ✅ planned | ✅ reuses `updateExistingChg`'s post-PATCH re-read + `buildSubmissionMismatchMessages`; quickstart proves behaviour against a live change |
| **XI — Output Restraint** | One dashboard artifact; no unsolicited summaries | ✅ none produced | ✅ unchanged |

**Result: PASS** — no unjustified violations. The two Article VII drifts are recorded in Complexity Tracking below
and must each carry a one-line justification comment at the component.

## Project Structure

### Documentation (this feature)

```text
specs/033-chg-rescope-rewrite/
├── plan.md                          # This file
├── spec.md                          # Feature specification
├── research.md                      # Phase 0 — Framework-First recon
├── data-model.md                    # Phase 1 — entities and state
├── quickstart.md                    # Phase 1 — validation guide
├── checklists/requirements.md       # Spec quality checklist (16/16)
├── contracts/
│   ├── rebuild-entry.md             # Entry point + destructive confirmation
│   ├── rebuild-mode.md              # CrgTabProps extension and binding
│   ├── rebuild-save.md              # Terminal action + one-environment guard
│   └── draft-isolation.md           # Number-scoped persistence
└── tasks.md                         # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
client/src/views/SnowHub/
├── tabs/
│   ├── ModifyChgTab.tsx             # MODIFY — Start Over button, confirmation, mounts the rebuild
│   ├── ModifyChgTab.test.tsx        # MODIFY — entry + confirmation tests
│   ├── CreateChgTab.tsx             # MODIFY — 'rebuild' mode, target binding, one-environment guard
│   ├── CreateChgTab.test.tsx        # MODIFY — rebuild-mode render + guard tests
│   ├── CreateChgTab.module.css      # MODIFY — target-number banner + confirmation styling (reuse classes)
│   ├── ChgTab.tsx                   # UNCHANGED
│   └── ConfigurationTab.tsx         # UNCHANGED — proves mode="configuration" stays byte-identical
├── hooks/
│   ├── useCrgState.ts               # MODIFY — optional storageKey; rebuild environment guard
│   ├── useCrgState.test.ts          # MODIFY — storage isolation + guard tests
│   ├── useAiAssist.ts               # UNCHANGED
│   └── crgStorageKeys.ts            # NEW — buildRebuildStorageKey (pure, own test file)
└── ...

CHANGELOG.md                         # MODIFY — required by the pre-commit hook
```

**Structure Decision**: Client-only, inside the existing `views/SnowHub` tree. No new view, no new tab, no server
route, no new dependency. One new source file (`crgStorageKeys.ts`, pure) plus its test — the pre-commit hook
requires a test file per new source file, so they land in the same commit.

## Design

### The four changes

**1. Entry point (ModifyChgTab)** — once `state.change` is loaded, render a **Start Over** control beside the
existing step chrome. Clicking it opens a confirmation naming the change number and stating that its current
content will be discarded and rebuilt. Declining returns to the loaded change untouched (FR-004). Confirming sets
`rebuildTargetNumber` in ModifyChgTab's local state, which swaps the rendered body for the builder. Nothing is
written to ServiceNow at any point in this transition (FR-030). See
[contracts/rebuild-entry.md](./contracts/rebuild-entry.md).

**2. Rebuild mode (CreateChgTab)** — `CrgTabProps` gains `mode?: 'wizard' | 'configuration' | 'rebuild'` and
`targetChangeNumber?: string`. In rebuild mode: wizard chrome renders as normal (`shouldShowWizardChrome` becomes
`mode !== 'configuration'`), the title states the change being rebuilt, a persistent banner shows the target number
on every step (FR-007), and the review step's primary button reads **Update CHG0001234** and calls
`actions.updateExistingChg(targetChangeNumber)` instead of `createChg`. The **Create CHG** button is not rendered at
all in rebuild mode — FR-029 is enforced by absence, not by a disabled state. See
[contracts/rebuild-mode.md](./contracts/rebuild-mode.md).

**3. One-environment guard (useCrgState)** — a rebuild is refused unless exactly one environment is enabled. Zero
reuses the shipped `NO_ENABLED_ENVIRONMENT_MESSAGE`; two or more gets a new message naming them. This closes a real
existing defect on the manual *Update Existing CHG* button, which today keeps only the first enabled environment
silently. See [contracts/rebuild-save.md](./contracts/rebuild-save.md).

**4. Draft isolation (useCrgState)** — `useCrgState(options?: { storageKey?: string })`, defaulting to
`'ntbx-crg-state'`. A rebuild passes `buildRebuildStorageKey(targetChangeNumber)`. This makes FR-033 true by
construction: a rebuild draft is unreachable from another change number rather than guarded by a runtime check, and
the operator's Create draft is untouched. See [contracts/draft-isolation.md](./contracts/draft-isolation.md).

### What is deliberately NOT changed

- `ModifyChgTab`'s existing five steps and its `PATCH /api/snow-relay/change/:changeKey` save — targeted edits stay
  the right tool for a small correction. The rebuild is an addition beside them.
- `createChg` and its multi-environment fan-out — creating one CHG per environment is correct for creation.
- `useAiAssist`, `aiAssistStore`, and the prompt modal — the assist works in rebuild mode because it reads the same
  selected issues.
- `ConfigurationTab` and `ChgTab` — no edits, which is the regression proof that `mode` stayed additive.
- Any server route.

### Test strategy (Article V — failing test first)

| Layer | What it proves |
|---|---|
| **Unit — `crgStorageKeys.test.ts`** | Key derivation: normalised (trim/upper), distinct per change number, never equal to `'ntbx-crg-state'` |
| **Unit — `useCrgState.test.ts`** | A rebuild-keyed hook does not hydrate from `ntbx-crg-state` and does not write to it; the environment guard refuses 0 and ≥2 and permits exactly 1; `updateExistingChg` is called with the target number |
| **Component — `CreateChgTab.test.tsx`** | Rebuild mode renders the target banner and the Update button, does **not** render Create CHG; `mode="wizard"` and `mode="configuration"` renders unchanged (existing tests must pass **unmodified** — if one needs editing, the prop stopped being additive) |
| **Component — `ModifyChgTab.test.tsx`** | Start Over is absent before a change loads and present after; declining leaves the loaded change; confirming mounts the builder blank with the number bound |
| **Manual — [quickstart.md](./quickstart.md)** | End-to-end against a live change: rebuild, save, confirm same number, confirm no second change (Article X) |

**Regression bar**: `npx vitest run src/views/SnowHub` must finish at **≥ 390 passing**, with no existing test
modified.

## Complexity Tracking

> Two Article VII drifts. Each must carry a one-line justification comment at the component.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New `storageKey` option on `useCrgState` | The hook hard-codes one global `localStorage` key. Without scoping, a rebuild hydrates the operator's in-progress Create draft (breaking FR-005 "blank") **and** overwrites it on first render (destroying unsaved work), and FR-033 cannot be expressed at all. | *Session-only rebuild drafts* — rejected: the SNow relay navigates the tab away and back, which is the entire reason persistence exists; removing it for the longest, most destructive flow is backwards. *One key plus a target-number field checked on hydrate* — rejected: still clobbers the Create draft, and turns FR-033 from a structural property into a runtime check that can be forgotten. |
| New one-environment guard for the rebuild path | `updateExistingChg` calls `readPrimaryChangeSubmissionTarget`, which takes `targets[0]` and silently discards the rest. For a manual field-patch that ambiguity is tolerable; for a full rebuild it silently loses an environment from the saved change. | *Reuse the existing tolerance* — rejected: silent data loss on the feature's only write. *Fan out to extra CHGs* — rejected: violates FR-029 outright. *Ask the operator which one wins* — rejected: an extra decision on a destructive path, and the excluded environments still vanish silently. |

## Risks

| Risk | Mitigation |
|---|---|
| The `mode` prop stops being additive and Configuration/Create regress | `ConfigurationTab.tsx` and `ChgTab.tsx` are edited by **zero** tasks; their existing tests must pass **unmodified** — an edit to one is the signal to revert, not to adjust the test |
| A rebuild draft leaks onto the wrong change | Solved structurally by the number-scoped key, not by a check (FR-033) |
| The operator loses a rebuild to a relay reconnect | Persistence retained, scoped rather than removed |
| Editable-state field name is instance-specific | Unrecognised state ⇒ treat as editable and stay silent; the save still fails loudly if SNow refuses. Open item flagged in [research.md](./research.md#finding-7--editable-state-warning-fr-008) for `/speckit-tasks` |
| Operator expects CTASKs to be cleared too | Recorded as an Assumption and in Out of Scope; `updateExistingChg` creates none. Confirm before implementation if the operator disagrees |
