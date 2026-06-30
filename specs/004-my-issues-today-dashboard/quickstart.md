# Quickstart — Validate the "Today" Scrum Master Dashboard

End-to-end validation guide. Scenarios map to the spec's acceptance scenarios and success
criteria. Run against a NodeToolbox instance connected to a Jira instance with an active
sprint/board selected in the Sprint Dashboard.

## Prerequisites

- NodeToolbox server running; Jira proxy connected (a `/myself` call succeeds).
- A board/sprint selected in the **Sprint Dashboard** (so team-scope categories have data).
- At least one of each present in your Jira data to see non-zero counts: an unaddressed
  @-mention of you, a blocked issue, a stale in-progress issue, an unassigned in-progress
  issue, an issue missing story points/AC, an overdue issue.

## Setup / run

```powershell
# Server (from repo root)
npm start

# Client dev (separate terminal)
cd client; npm run dev
```

Tests:

```powershell
# Client unit/component
cd client; npm run test

# Server (store + route)
npm test

# Type + production build must be clean
cd client; npm run build
```

## Scenarios

### S1 — Today is the landing tab (FR-001, SC-001)
1. Open **My Issues**.
2. **Expect**: the **Today** tab is active by default; category cards begin populating
   without choosing a source first.

### S2 — Mentions count matches the Mentions tab (FR-004a, SC-002)
1. Note the "Respond to mentions" count on Today.
2. Open the **Mentions** sub-tab.
3. **Expect**: the outstanding mention count is identical.

### S3 — Deep links land on the right sub-tab in one click (FR-009, SC-003)
1. Click the "Respond to mentions" card link.
2. **Expect**: you arrive directly on the **Mentions** sub-tab (URL shows `?tab=mentions`).
3. Back; click "Unblock issues".
4. **Expect**: you arrive on the Sprint Dashboard **blockers** view.

### S4 — Team scope includes unassigned work (FR-004e, FR-007, SC-008)
1. Ensure an **unassigned** in-progress issue exists in the selected sprint/board.
2. **Expect**: the "Unassigned in-progress" count includes it (it is **not** missed because
   it lacks an assignee).

### S5 — Team counts equal Hygiene (FR-003, SC-002)
1. Note "Team stale", "Unassigned", "Commitment gaps", "Due/overdue" on Today.
2. Open the **Hygiene** tab for the same sprint/board scope.
3. **Expect**: each Today count equals the corresponding Hygiene flag count.

### S6 — Zero count auto-completes (FR-006, FR-014)
1. Address all items in one category (e.g. clear all mentions).
2. Refresh Today.
3. **Expect**: that card renders **cleared/complete**, not an empty list.

### S7 — Manual check-off persists for the day and resets next business day (FR-015)
1. Manually mark a non-zero category complete.
2. Reload the app (same business day).
3. **Expect**: it is still complete.
4. (Reset proof — unit-level) `dailyChecklistStore` GET for a different `day` returns empty;
   see `dailyChecklistStore.test.js`.

### S8 — Done for today (FR-016, SC-006)
1. Bring every category to complete (auto and/or manual).
2. **Expect**: an unambiguous "done for today" confirmation is shown.

### S9 — One source failing does not blank the dashboard (FR-012, SC-005)
1. Simulate a failure for one source (e.g. block the mentions request).
2. **Expect**: that card shows an error + retry; **all other cards still show their counts**.

### S10 — Works with AI locked (FR-002, SC-004)
1. Ensure AI Assist (Ctrl+Alt+Z) is **locked**.
2. **Expect**: every count, link, and check-off works; nothing is hidden or degraded.

### S11 — Team not configured shows an explicit state (FR-008, SC-008)
1. Clear the Sprint Dashboard board/sprint selection.
2. **Expect**: team-scope cards show "team not set up — configure in Sprint Dashboard" with a
   link, **not** a zero "all clear".

### S12 — Reflects work done elsewhere (FR-011, SC-007)
1. On the Mentions tab, mark a mention addressed.
2. Return to Today (or click Refresh).
3. **Expect**: the mentions count drops accordingly.

## Definition of done

- All scenarios above pass against live Jira.
- `vitest run` (client) and `npm test` (server) green, including new pure-rule, store, route,
  hook, and component tests.
- `tsc -b && vite build` clean.
- `CHANGELOG.md` `## [Unreleased]` has the Today-dashboard entry.
