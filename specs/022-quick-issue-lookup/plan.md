# Implementation Plan: Quick Issue Lookup — F2 to find, view, and fix any issue without leaving the tool

**Branch**: `feature/022-quick-issue-lookup` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/022-quick-issue-lookup/spec.md`

## Summary

Give every screen a global **F2** shortcut that opens a modal popup: a persistent search bar (Enter or Search button),
a recents list of the last ~5 issues viewed, and — once a key resolves — the issue rendered in the **existing**
`IssueDetailPanel` (shipped by feature 019: semantic chips, structure-preserving description, links-with-statuses,
labels, comments). The key is a link into Jira (the escape hatch). Fields Toolbox can safely write become editable in
place; the description and anything without a safe writer stay read-only.

The design is reuse-first with exactly **one net-new data path** and **one recorded Framework-First drift**:

1. **New data path — fetch one full issue by key.** No such helper exists today; callers build the GET inline. This
   feature adds a single `useIssueByKey` hook + path builder, modeled on the closest precedent
   (`AgileHub/search/useSimpleSearchState.ts` `buildIssueDetailPath`).
2. **New feature shell** — a root-mounted `QuickIssueLookupGate` (F2 hotkey + modal), cloning the proven
   `TodoQuickAdd`/`AiAssistUnlockGate` pattern in `App.tsx`. F2 is unbound today.
3. **New recents store** — a tiny zustand store cloning the app's existing recents precedent
   (`settingsStore.recentViews`: dedupe + `slice(0, 5)`, hand-rolled localStorage mirror).
4. **Recorded drift — inline field-editor controls.** The field *writers* already exist
   (`featureReviewFixes.ts`), but their *editor UI* is trapped inside a non-importable bespoke panel
   (`FeatureReviewQuickFixPanel` in `FeatureReviewTab.tsx`) and `IssueDetailPanel` exposes no edit-enable flag. Rather
   than refactor a shipped, heavily-used surface (regression risk), this feature builds a small reusable
   `IssueFieldEditors` control family whose **shape is new but whose every WRITE delegates to the existing
   `featureReviewFixes.ts` writers** — the exact pattern feature 021's `ReadinessFixControl` established.
   `IssueDetailPanel` gains an **optional, default-off** editing capability so those editors render in place; when the
   capability is omitted the panel is byte-identical to today (hygiene/AgileHub/other callers unaffected — the 017
   optional-prop precedent).

## Technical Context

**Language/Version**: TypeScript + React (client SPA); CSS Modules on the existing token system

**Primary Dependencies**: zero new dependencies. Reuse: `IssueDetailPanel` + `IssueMeta/*` (feature 019, shipped);
`featureReviewFixes.ts` writers + editmeta readers + `TransitionRequiredFields`; `buildJiraBrowseUrl`
(`utils/jiraBrowseUrl.ts`); `jiraGet`/`useJiraFetch` (`services/jiraApi.ts`, `hooks/useJiraFetch.ts`); the
`TodoQuickAdd`/`AiAssistUnlockGate` root-gate pattern in `App.tsx`; zustand recents precedent
(`store/settingsStore.ts` `buildRecentViews`, `store/todoStore.ts` localStorage mirror); `JiraIssue` type
(`types/jira.ts`); `ToastProvider` for confirmations

**Storage**: `localStorage` key `tbxRecentIssueKeys` for the recents list (client-only, never server-synced — the
spec's "ephemeral, not synced"), capped at 5, hand-rolled mirror per house convention (no zustand `persist`
middleware anywhere in this app). No other persistence; the loaded issue is transient view state.

**Testing**: vitest + @testing-library (unit — pure key-normalizer, recents dedupe/cap, fetch-path builder, each
editor's value→payload mapping red-first); Playwright e2e (`test/e2e/`) for the F2 flow, escape-hatch, honest states,
and the A/A+/A++ + light/dark + narrow-width gates (Article X: UX claims proven in a real browser)

**Target Platform**: NodeToolbox SPA (browser + exe-embedded client); light and dark themes

**Project Type**: web application, client-only feature

**Performance Goals**: popup opens perceptually instant on F2 (state-only, no fetch until search); one issue GET per
lookup; edits save individually with immediate optimistic reflection then refetch; recents render is pure

**Constraints**: F2 must `preventDefault` (browser rename shortcut) and must not fire while focus is in an input
(keyboard-guard rule, NFR-005); standardized-CSS-zoom rules — never `calc(100%/zoom)`, fixed floors not vw clamps
(GH #160); color never the sole signal (NFR-004); every field block omits itself when empty (no placeholder boxes);
the new `IssueDetailPanel` capability is additive and default-off (no regression to shipped callers)

**Scale/Scope**: single issue at a time; recents ≤ 5; ~4 reusable editor controls (Text, Select, Assignee/user-search,
Labels) plus the panel's existing status/comment/story-point editors

## Constitution Check

*GATE — evaluated pre-Phase-0 and re-checked post-design: PASS (no violations; one recorded Art VII drift).*

- **Art I (Best route)**: reuse-first; the only new pieces are ones no existing module provides (issue-by-key fetch,
  F2 shell, recents store) plus a control-shape editor family. The *theoretically* best architecture — hoisting
  FeatureReview's trapped editors into a shared module and retrofitting both surfaces — is explicitly deferred because
  refactoring a shipped, heavily-used tab (`FeatureReviewTab`) carries regression risk that outweighs the reuse gain
  now; the delegation pattern keeps writes single-sourced regardless (see Complexity Tracking + research §4). ✅
- **Art III (Branching)**: work proceeds on `feature/022-quick-issue-lookup`; merge via PR. ✅
- **Art IV (Code quality)**: verb-first functions, `is/has/can`-prefixed booleans, ≤40-line functions, file purpose +
  exported-function doc comments; enforced by the pre-commit gates. ✅
- **Art V (Testing)**: red-first unit tests for every pure function (key normalizer, recents reducer, path builder,
  editor value→payload mappers); Playwright for the flow + responsive/theme/text-size verification. No
  real-infrastructure integration layer applies (client-only; Jira stubbed in the e2e harness). ✅
- **Art VI (Docs)**: CHANGELOG entry in the implementation PR; no auxiliary status docs (this `specs/` tree is
  pipeline-exempt). ✅
- **Art VII (Framework-first)**: fetch reuses `jiraGet`/`useJiraFetch` and the `buildIssueDetailPath` precedent;
  rendering reuses `IssueDetailPanel` + `IssueMeta/*`; deep-link reuses `buildJiraBrowseUrl`; hotkey+modal reuses the
  root-gate pattern; recents reuses the `settingsStore` recents logic; **all field writes delegate to
  `featureReviewFixes.ts`**. **Recorded drift**: the inline field-editor *controls* are new (control-shape only)
  because the existing editors are not importable and `IssueDetailPanel` has no edit hook — justification repeated at
  the `IssueFieldEditors` module head, mirroring 021's `ReadinessFixControl`. ✅
- **Art X (Verification)**: instant-open, keyboard-only, honest-state, and layout claims are proven with Playwright
  evidence, not asserted. ✅
- **Art XI (Output restraint)**: no new dashboard artifact; no internal phase narration. ✅

## Project Structure

### Documentation (this feature)

```text
specs/022-quick-issue-lookup/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions + rationale
├── data-model.md        # Phase 1 — query, loaded issue, editable field set, recents
├── quickstart.md        # Phase 1 — validation guide (maps to SC-001..006)
├── contracts/
│   ├── lookup-and-fetch.md      # F2 shell + search-bar normalize + fetch-one-issue-by-key + honest states
│   ├── inline-field-editing.md  # editable set, editor→writer delegation, panel's optional edit capability
│   └── recents-store.md         # recents shape, cap 5, dedupe/move-to-top, persistence, ephemerality
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
client/src/
├── components/
│   ├── QuickIssueLookup/                 # NEW — the F2 feature
│   │   ├── QuickIssueLookupGate.tsx      #   root-mounted F2 keydown + modal shell (TodoQuickAdd pattern)
│   │   ├── QuickIssueLookup.tsx          #   popup body: search bar + recents + IssueDetailPanel host + states
│   │   ├── IssueSearchBar.tsx            #   persistent key input + Search; Enter/click parity; swap-in-place
│   │   ├── RecentIssuesList.tsx          #   recents (key + summary), click / arrow-key re-open
│   │   ├── normalizeIssueKey.ts          #   PURE — trim, upper-case, extract key from pasted URL, shape-validate
│   │   └── QuickIssueLookup.module.css
│   ├── IssueFieldEditors/                # NEW — reusable inline editors; ALL writes delegate to featureReviewFixes.ts
│   │   ├── TextFieldEditor.tsx           #   summary + issue-link key  → saveFeatureReviewSimpleField / …IssueLinkField
│   │   ├── SelectFieldEditor.tsx         #   priority + other single-selects + fixVersion (editmeta options)
│   │   ├── AssigneeFieldEditor.tsx       #   user search → saveFeatureReviewUserField
│   │   ├── LabelsFieldEditor.tsx         #   labels multi-value (editmeta set) — read-only fallback if unsupported
│   │   ├── fieldEditorPayloads.ts        #   PURE — value → Jira write payload per field (red-first tested)
│   │   └── IssueFieldEditors.module.css
│   └── IssueDetailPanel/
│       └── index.tsx                     # EXTENDED (additive) — optional `fieldEditing` capability renders the above
│                                         #   beside currently-read-only fields; omitted ⇒ byte-identical (default off)
├── hooks/
│   └── useIssueByKey.ts                  # NEW — the single data-path gap: fetch one full JiraIssue by key + refetch
├── services/
│   └── issueLookup.ts                    # NEW — buildIssueLookupPath (fields= list) + fetchIssueByKey via jiraGet
├── store/
│   └── recentIssuesStore.ts             # NEW — useRecentIssuesStore (clone settingsStore recents; tbxRecentIssueKeys)
└── App.tsx                               # EXTENDED — mount <QuickIssueLookupGate/> beside <TodoQuickAddGate/>

test/e2e/
└── quick-issue-lookup.spec.js            # NEW — F2 open, search, edit, escape-hatch, states, a11y/theme/text-size
```

**Structure Decision**: The feature lives under `components/QuickIssueLookup/` because it is a global overlay, not a
route (spec: transient overlay, no URL change). The editors live in a **separate** `components/IssueFieldEditors/`
module — not inside QuickIssueLookup — precisely so they are the reusable, importable component the codebase lacks
today, consumed by `IssueDetailPanel`'s new optional capability and available to future callers (the eventual home for
a FeatureReview retrofit). The fetch gap is a hook + a thin service, mirroring `useSimpleSearchState`'s
`buildIssueDetailPath`.

## Complexity Tracking

| Violation / Drift | Why Needed | Simpler Alternative Rejected Because |
|-------------------|------------|--------------------------------------|
| New inline field-editor controls (Art VII control-shape drift) | FR-008 requires editing assignee/priority/summary/fixVersions/links inline; the writers exist but their editor UI is trapped in the non-importable `FeatureReviewQuickFixPanel`, and `IssueDetailPanel` has no edit hook. | (a) Reusing FeatureReview's editors requires refactoring a shipped, heavily-used tab → regression risk on a merged surface (017 lesson). (b) Rendering QuickLookup's own full panel instead of reusing `IssueDetailPanel` would duplicate links/labels/description/comments — a far larger Art VII violation. The chosen path adds only control shape; every write delegates to the single existing writer set. |
| Additive `fieldEditing` capability on shipped `IssueDetailPanel` | The panel *is* the detail view (spec vision); editing must render in place. | A wrapper that re-implements the panel body duplicates 019's work. The capability is optional and default-off, so all current callers stay byte-identical (017 optional-prop precedent). |

No constitution violations remain unjustified. The single recorded drift is bounded to control shape with all writes
single-sourced.
