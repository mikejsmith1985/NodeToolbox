# Implementation Plan: Hygiene Fix Workspace — an issue view worth working in

**Branch**: `feature/019-hygiene-fix-ux` | **Date**: 2026-07-17 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/019-hygiene-fix-ux/spec.md`

## Summary

Close the "Jira is more inviting" gap (GH #177 closing comment) with three coordinated pieces, all client-side and
overwhelmingly reused: (1) a **semantic chip vocabulary** — shared components that render status, priority, issue
type, assignee, and age with color + icon + text everywhere those facts appear; (2) **full decision context in the
issue detail panel** — linked issues with their statuses (already present in the `issuelinks` field the codebase
types and fetches elsewhere — no new request), labels, fix versions, sprint, feature link, a distinct AC block, and
structure-preserving description rendering; (3) a **guided cleanup session** over the filtered hygiene findings —
explicit Skip semantics per the clarification, "N of M" cursor, keyboard flow, and an honest four-bucket summary
(fixed / commented / skipped / untouched).

## Technical Context

**Language/Version**: TypeScript + React (client SPA), CSS Modules with the existing token system

**Primary Dependencies**: zero new dependencies. Reuse: `JiraIssueLink` type + `issuelinks` field
(`client/src/types/jira.ts`), `richTextPlainText.ts` (normalization base), `IssueDetailPanel`, `HygieneView` +
`useHygieneState`/`hygieneScan`, editmeta-aware writers (`featureReviewFixes.ts`), design tokens (`tokens.css`)

**Storage**: none — the cleanup session is ephemeral component state (per clarification); no server, no localStorage

**Testing**: vitest + @testing-library (unit), Playwright e2e (`test/e2e/`, port 5556 harness) for the session flow
and the A/A+/A++ + narrow-width layout gates (Article X: visual claims verified in a real browser)

**Target Platform**: NodeToolbox SPA (browser + exe-embedded client); light and dark themes

**Project Type**: web application, client-only feature

**Performance Goals**: no additional Jira requests on panel open (links ride the existing issue payload); chip
rendering is pure and memo-friendly; session navigation is instant (state-only)

**Constraints**: standardized-CSS-zoom rules (never `calc(100%/zoom)`; fixed floors, not vw clamps — GH #160
lessons); color never the sole signal (NFR-002); every block omits itself when empty

**Scale/Scope**: hygiene lists up to the scan cap (200 issues); typical session 20–60 findings

## Constitution Check

*GATE — evaluated pre-Phase-0 and re-checked post-design: PASS (no violations, one recorded drift justification).*

- **Art I (Best route)**: reuse-first design; the only new abstractions are ones no existing module provides. ✅
- **Art III (Branching)**: work proceeds on `feature/019-hygiene-fix-ux`; merge via PR. ✅
- **Art IV (Code quality)**: verb-first functions, `is/has`-prefixed booleans, ≤40-line functions, "why" comments —
  enforced as usual by the pre-commit gates. ✅
- **Art V (Testing)**: red-first unit tests for every pure vocabulary/parser function and component; Playwright for
  the session flow and responsive/text-size verification. No real-infrastructure integration layer is applicable
  (client-only; Jira is stubbed in e2e per existing harness). ✅
- **Art VI (Docs)**: CHANGELOG entry in the implementation PR; no auxiliary status docs (this `specs/` tree is
  pipeline-exempt). ✅
- **Art VII (Framework-first)**: linked issues reuse `JiraIssueLink` + `parseIssueLinks` precedents (ImpactAnalysis /
  BusinessHelper); text normalization reuses `richTextPlainText`. **Recorded drift**: a small structured-text
  formatter is custom-built because nothing in the dependency tree renders Jira wiki-style structure, and adding a
  markdown library would still not parse Jira's syntax (justification to be repeated at the module head). ✅
- **Art X (Verification)**: layout and glance-test claims are proven with Playwright screenshots/measurements, not
  asserted. ✅

## Project Structure

### Documentation (this feature)

```text
specs/019-hygiene-fix-ux/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions + rationale
├── data-model.md        # Phase 1 — vocabulary, session, context models
├── quickstart.md        # Phase 1 — validation guide
├── contracts/
│   ├── issue-meta-chips.md     # Semantic chip vocabulary contract
│   ├── issue-context-panel.md  # Detail-panel blocks contract
│   └── cleanup-session.md      # Session state machine + keyboard contract
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
client/src/
├── components/
│   ├── IssueMeta/                      # NEW — shared semantic chip vocabulary
│   │   ├── issueMetaVocabulary.ts      #   pure fact → {tone, icon, label} mappings
│   │   ├── StatusChip.tsx              #   status name + category → colored chip
│   │   ├── PriorityBadge.tsx           #   priority name → direction/color badge
│   │   ├── IssueTypeIcon.tsx           #   type name → colored icon + name
│   │   ├── AssigneeAvatar.tsx          #   display name → initials avatar + full name
│   │   ├── AgeBadge.tsx                #   age days + stale threshold → graded badge
│   │   └── IssueMeta.module.css
│   └── IssueDetailPanel/               # EXTENDED — context blocks + structured description
│       ├── index.tsx                   #   header uses IssueMeta; adds links/labels/sprint/
│       │                               #   fixVersions blocks (omit-when-empty); AC block kept
│       └── StructuredText.tsx          # NEW — renders StructuredBlock[] (see utils)
├── utils/
│   ├── richTextPlainText.ts            # unchanged (normalization base)
│   └── richTextStructured.ts           # NEW — parseStructuredText(): paragraphs, bold
│                                       #   run-in headings, simple lists (drift-justified)
└── views/Hygiene/
    ├── HygieneView.tsx                 # EXTENDED — session entry, settled marking, fix copy
    ├── hooks/useHygieneSession.ts      # NEW — cursor + outcomes state machine + keyboard map
    └── HygieneView.module.css          # session bar, settled row styles

test/e2e/
└── hygiene-session.spec.js             # NEW — session flow + A++/narrow layout gates
```

**Structure Decision**: chips live under `client/src/components/IssueMeta/` because they are an app-wide vocabulary
(spec assumption: shared panel + hygiene first, other views adopt opportunistically). The session hook lives inside
`views/Hygiene/` because the session is hygiene-workspace behavior, available on all three surfaces that render
`HygieneView` (clarification #2) — one component, zero per-surface code.

## Complexity Tracking

No constitution violations. Single recorded drift (custom structured-text formatter) is justified under Art VII in
the Constitution Check above and in `research.md` §3.
