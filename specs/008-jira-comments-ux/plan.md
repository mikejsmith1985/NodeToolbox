# Implementation Plan: Consistent Jira Comment History & Themed Field Depth

**Branch**: `008-jira-comments-ux` | **Date**: 2026-07-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-jira-comments-ux/spec.md`

## Summary

Unify how Jira issue comments are shown everywhere in the client: replace the "latest comment only"
(Story Pointing, Sprint Dashboard row) and "last 3" (DSU board overlay) treatments with the same
**full, scrollable comment history** already used by `IssueDetailPanel`. To guarantee completeness
regardless of thread size, every location fetches the full thread **on demand** (Clarification Q1),
orders it **newest→oldest with the newest pinned at the top** (Clarification Q2), and renders it
through one shared presentation component so layout, ordering, and empty/loading/error states are
identical.

Technical approach: **extract** the existing `CommentHistory` presentation and the on-demand
comment-fetch effect out of `IssueDetailPanel` into a reusable component (`CommentThread`) and a
reusable hook (`useIssueComments`), then have all four sites consume them. Separately, add a subtle
**gradient/elevation depth treatment** for fields, text boxes, and the comment window by extending
the existing `tokens.css` design-token system so both light and dark themes are covered and text
keeps **WCAG 2.1 AA** contrast (Clarification Q3). This is a consolidation-on-existing-patterns
change — no new infrastructure.

## Technical Context

**Language/Version**: TypeScript ~6.0, React 19.2 (function components + hooks)

**Primary Dependencies**: React, Vite 8 (build), Zustand (theme/store), existing `services/jiraApi.ts`
relay client, existing `utils/richTextPlainText.ts` normalizer, existing `styles/tokens.css` token
system. No new runtime dependencies.

**Storage**: N/A — comments are read live from Jira via the relay (`GET /rest/api/2/issue/{key}/comment`).

**Testing**: Vitest 4 + @testing-library/react 16 + @testing-library/jest-dom (jsdom env). Unit tests
mock `jiraApi`; render tests assert presentation/ordering/empty-loading-error states.

**Target Platform**: NodeToolbox desktop/web client (single-page React app under `client/`).

**Project Type**: Web — single frontend project (`client/`). No backend changes.

**Performance Goals**: Comment window renders a large thread (100+ comments) without freezing the UI;
bounded scroll height keeps the surrounding view stable; one comment fetch per opened/expanded issue
(no per-row bulk comment payloads).

**Constraints**: WCAG 2.1 AA contrast (≥4.5:1 body, ≥3:1 large/boundary) in **both** themes; depth
treatment expressed only through theme tokens so light/dark switch automatically; no layout
regression in views that already showed the full history; presentation-only (no Jira write changes,
no comment-body parsing changes).

**Scale/Scope**: 4 comment-display locations to unify (Story Pointing, Sprint Dashboard pointing-row
expansion, DSU board issue overlay, and the shared `IssueDetailPanel` — the last already correct and
kept as the consistency target); ~8 downstream views embed `IssueDetailPanel` and inherit the change
for free.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Article | Gate | Status |
|---------|------|--------|
| III — Branching | Work on a feature branch, PR to main | ✅ `008-jira-comments-ux` feature branch; no direct main commits |
| IV — Code Quality | Self-documenting names, booleans `is/has/…`, verb-first fns, <40-line fns, file/exported doc comments, no magic numbers | ✅ Extraction follows existing panel's conventions (named constants like `ISO_DATE_LENGTH`, doc comments on component/hook); scroll height & ordering constants named |
| V — Testing (TDD) | Failing unit test first; unit tests mock I/O, <10ms | ✅ Red→green for `useIssueComments` (mock `jiraApi`) and `CommentThread` render/order/state tests before extraction; UX proof via quickstart |
| VI — Documentation | Update `CHANGELOG.md`; no ad-hoc status docs | ✅ CHANGELOG entry planned; only `specs/008-…` pipeline artifacts created |
| VII — Framework-First | Don't rebuild what the framework/codebase provides | ✅ **Core of this feature** — reuse existing `CommentHistory`, `jiraApi`, `richTextPlainText`, and the `tokens.css` gradient/shadow tokens rather than inventing new ones |
| X — Verification & Proof | Evidence, not "it compiles" | ✅ quickstart.md defines observable per-view checks in both themes; contrast checked against AA |

**Result**: PASS — no violations. No entries in Complexity Tracking.

**Framework-First drift note**: The only new artifacts are a shared presentation component and a
fetch hook, both **extracted** from existing working code to remove duplication — not new
infrastructure. Depth styling reuses existing tokens (`--color-card-bg`, `--color-field-bg`,
`--shadow-surface`, `--color-border`), adding only a small number of purpose-named tokens where a
documented gap exists (e.g. a dedicated field-elevation gradient).

## Project Structure

### Documentation (this feature)

```text
specs/008-jira-comments-ux/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── comment-thread.md
├── checklists/
│   └── requirements.md  # from /speckit-specify + /speckit-clarify
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
client/src/
├── components/
│   └── IssueDetailPanel/
│       ├── index.tsx                     # MODIFY: consume shared CommentThread + useIssueComments
│       └── IssueDetailPanel.module.css   # MODIFY: comment styles move to shared / use depth tokens
├── components/
│   └── CommentThread/                    # NEW: extracted shared comment window
│       ├── CommentThread.tsx             # NEW: presentation (author/date/body, empty/loading/error)
│       ├── CommentThread.module.css      # NEW: scrollable window + depth treatment (token-driven)
│       └── CommentThread.test.tsx        # NEW: render/order/empty/loading/error unit tests
├── hooks/
│   ├── useIssueComments.ts               # NEW: on-demand full-thread fetch, newest-first, refresh
│   └── useIssueComments.test.ts          # NEW: fetch/success/error/refresh/order unit tests
├── views/
│   ├── StoryPointing/
│   │   ├── StoryPointingView.tsx         # MODIFY: replace "Latest comment" <p> with CommentThread
│   │   └── hooks/useStoryPointingState.ts# MODIFY: drop latestComment string derivation
│   ├── SprintDashboard/
│   │   └── SprintDashboardView.tsx       # MODIFY: replace latest-comment line with CommentThread
│   └── DsuBoard/
│       └── DsuBoardView.tsx              # MODIFY: replace last-3 preview with CommentThread
└── styles/
    └── tokens.css                        # MODIFY: add field/comment depth tokens for both themes
```

**Structure Decision**: Single frontend project (`client/`). Introduce one shared component
directory (`components/CommentThread/`) and one hook (`hooks/useIssueComments.ts`), then point every
comment-display site at them. Theme depth tokens live in the one existing `tokens.css` so both themes
stay in a single source of truth.

## Complexity Tracking

No constitution violations — this section intentionally empty.
