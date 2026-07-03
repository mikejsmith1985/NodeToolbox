# Quickstart & Validation Guide: Feature Canvas

This guide proves the feature works end-to-end and maps each check to a Success Criterion
(SC) and requirement (FR) in [spec.md](./spec.md). It is a **validation/run guide**, not an
implementation guide — implementation detail lives in `tasks.md` and the code.

## Prerequisites

- NodeToolbox client running locally: `cd client && npm install && npm run dev`
  (installs the one new dependency, `@xyflow/react`).
- A configured **ART team** matched to a Jira board with a selected **Program Increment**
  (same setup the Feature Review tab requires). Without it, the canvas shows a "configure ART
  settings" empty state — that is expected behavior, not a failure.
- The connected Jira instance reachable through the existing `/jira-proxy` (already true in
  normal use).

## Build & test gates

```powershell
cd client
npm run test          # Vitest: all pure-logic + component tests must pass
npm run lint          # ESLint clean
npm run build         # tsc -b && vite build must succeed
```

Article V (TDD): the pure-logic units below are written **before** their implementation and
must be red first, then green.

- `logic/wip.ts` — WIP count from status categories (SC via WipSnapshot)
- `logic/capacity.ts` — Σ effectivePoints vs budget → under/at/over
- `logic/sizing.ts` — S/M/L/XL ↔ points mapping
- `logic/commitDiff.ts` — overlay vs live → ordered `CommitDiffItem[]` with `dependsOn`
- `overlay/overlayStorage.ts` — serialize/deserialize + legacy→scoped migration + self-heal
- `ai/canvasAiAssist.ts` — `extractJsonPayload` + strict schema validation (accept/reject)

## Behavioral validation scenarios

Drive these in the running app. Each states the expected observable outcome.

### V1 — Surface the backlog (Stage 1) · SC-1, FR-1
1. Open **Feature Canvas** from the Home "agile" section.
2. Confirm the active team + PI shown in the header, then run Stage 1 (Surface).
- **Expect**: every scoped feature appears as a node; the node count equals the Feature
  Review count for the same team+PI; time-to-first-render < 60s for ~150 features.

### V2 — Stabilize WIP + Parking Lot (Stage 2) · SC-3, FR-3
1. Set a WIP limit (e.g. 5).
2. Drag features above the limit into the Parking Lot.
- **Expect**: the overflow count (current In-Progress − limit) is shown; the Parking Lot
  shows an exact, at-a-glance count and list of paused items with no manual tallying.

### V3 — Prioritize (Stage 3) · FR-4
1. Drag nodes into Must / Should / Could / Wont.
- **Expect**: each node visibly carries its bucket; each bucket shows a live count; nothing is
  written to Jira (verify V7).

### V4 — Size (Stage 4) · SC-4, FR-5
1. Assign S/M/L/XL to unsized nodes; leave already-pointed nodes as-is.
- **Expect**: after Stage 4, 100% of Must/Should/Could nodes carry both a bucket and a size;
  sized nodes contribute `sizeMapping[size]` to capacity; pointed nodes contribute their
  points.

### V5 — Box within capacity (Stage 5) · SC-5, FR-6
1. Create a sprint box with a capacity budget; drag sized nodes in until it exceeds the budget.
2. Create a **provisional** "Sprint 25" box (Q3=A) that does not exist in Jira.
- **Expect**: the box shows a running total and flips to an **over-capacity** warning with the
  amount over; the provisional box is visually distinguished from real ones.

### V6 — Resume mid-journey · SC-10, FR-2.3, FR-7.1
1. Complete Stages 1–2, close the canvas (or reload), reopen it.
- **Expect**: 100% of node positions, sizes, priorities, container assignments, and the
  Parking Lot are restored; the coach resumes at Stage 3.

### V7 — Sandbox isolation (zero accidental writes) · SC-6, FR-7.2
1. After V2–V5 (no commit), inspect the affected Jira issues' history.
- **Expect**: **zero** Jira field changes. All arrangement lived in the overlay only.

### V8 — Review & Commit with diff · SC-7, FR-7.3/7.4/7.5
1. Open **Review & Commit**.
- **Expect**: an itemized diff of every proposed change (node→sprint, node→fixVersion,
  size→points, any priority mapping, and each provisional-container creation), each toggleable.
2. Confirm; for the provisional "Sprint 25", choose *create* (or map to existing).
- **Expect**: create-container writes run **first**; only then member assignments; each item
  reports success/failure; deselected items are not written; the real Jira issues now reflect
  exactly the committed items (and nothing else).

### V9 — Manual-only integrity (AI locked) · SC-9, FR-9.4
1. In a session that has **not** unlocked AI Assist, run V1–V8 end to end.
- **Expect**: every stage, control, and output is available; **no** AI instruction, control,
  or blocker appears anywhere in the coach.

### V10 — AI accelerator is additive (AI unlocked) · FR-9.1/9.2
1. Unlock AI Assist (Ctrl+Alt+Z). At Stage 3, open the (now-visible) accelerator panel, copy
   the generated prompt, paste a valid `priorityOrder` JSON reply back.
- **Expect**: suggestions appear as accept/reject proposals; accepting applies to the overlay
  only; rejecting all leaves you exactly where the manual path would; a malformed reply shows a
  descriptive error and changes nothing.

### V11 — Hygiene / health overlays are consistent · FR-8
1. Pick a feature with known hygiene violations.
- **Expect**: its node badge count matches what the Hygiene tab reports for the same issue;
  health/completion match the Feature Review card.

## Done (feature-level acceptance)

All of V1–V11 pass, the three build/test/lint gates are green, and `CHANGELOG.md` has an entry
describing the Feature Canvas (Article VI).
