# Quickstart & Validation: Consistent Jira Comment History & Themed Field Depth

Proves the feature end-to-end (Article X). Assumes the Jira relay is connected so the client can read
comments.

## Prerequisites

- Node deps installed in `client/`.
- A Jira issue with **many** comments (more than fit in ~240px) — call it `DEMO-1`.
- A Jira issue with **zero** comments — call it `DEMO-0`.

## Build / test commands

```bash
cd client
npm test          # unit tests (Vitest) — must be green
npm run build     # tsc -b && vite build — must succeed
npm run dev       # launch the client to drive the UX checks below
```

## Automated checks (must pass)

- `useIssueComments.test.ts`: newest-first ordering, complete thread, error→empty, refresh re-fetch,
  issueKey change ignores stale response.
- `CommentThread.test.tsx`: renders all comments in order; empty/loading/error states; long body
  contained.

## Manual UX validation (run in BOTH light and dark theme)

Toggle theme in Settings; repeat each check under both.

| # | Location | Steps | Expected (maps to) |
|---|----------|-------|--------------------|
| 1 | Story Pointing | Open `DEMO-1`, expand context | Full comment history in a scrollable window; newest at top; NOT just "Latest comment" (US1 AS1, FR-001/004) |
| 2 | Sprint Dashboard | Expand `DEMO-1`'s pointing row | Full scrollable history; newest at top; no single latest-comment line (US1 AS2) |
| 3 | DSU Board | Open `DEMO-1` in the issue overlay | Full scrollable history; newest at top; NOT capped at 3 (US1 AS3) |
| 4 | Any panel view (My Issues / Mentions / etc.) | Open `DEMO-1` | Still shows full scrollable history — no regression (US1 AS4, SC-007) |
| 5 | Cross-view consistency | Compare `DEMO-1` in checks 1–3 side by side | Identical author/date/body layout and ordering (US2 AS1, SC-002) |
| 6 | Newest visible | Open `DEMO-1` in each location | Most recent comment is on screen with no scrolling (US2 AS2, SC-003) |
| 7 | Long comment | Open an issue with one very long comment | Body wraps and window scrolls; page layout intact (US2 AS3) |
| 8 | Empty state | Open `DEMO-0` in each location | Same friendly empty state everywhere; no blank gap / "undefined" (US1 AS5, SC-004) |
| 9 | Loading/error | Open an issue with the relay briefly unavailable | Consistent loading then a clear error (not blank/frozen) (FR-007) |
| 10 | Field depth | Look at a text box / comment window vs the window background | Field boundary clearly distinct via subtle gradient (not a heavy border) (US3 AS1/2, SC-005) |
| 11 | Theme switch | Toggle theme while a comment window/field is visible | Treatment updates; no field left in the wrong theme (US3 AS4, SC-006) |
| 12 | Contrast | Sample text vs field background with a contrast tool, both themes | Meets WCAG 2.1 AA (≥4.5:1 body) (FR-010, SC-005) |

## Done signals

- All automated checks green; `npm run build` clean.
- Checks 1–12 pass in **both** themes.
- `CHANGELOG.md` updated with the unified comment window + themed field depth entry and the measured
  contrast ratios.
