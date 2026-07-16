# Quickstart: Validating the Monthly Delivery Report

**Feature**: `018-monthly-delivery-report`
Evidence-based validation per Constitution Article X — "it compiles" / "200 OK" is not proof. References:
[data-model.md](./data-model.md), [contracts/](./contracts/).

## Prerequisites

- Server configured with working Jira credentials (same config the existing schedulers use); VPN up
  (an empty result set can mean Jira-unreachable — check connectivity before suspecting the feature).
- At least one Team Dashboard team profile configured in the client (Settings → Team Dashboard).
- Prior calendar month contains at least one Story/Task that reached "Ready for QA"+ or a done status for that
  team's project (pick a team you know shipped something).

## Build & unit layers

```powershell
npm run build:monthly-delivery-engine   # engine bundle compiles (also runs via pretest/prestart)
npm test                                # server Jest — scheduler + report + route suites green
cd client; npx vitest run               # client — workflowDelivery helpers + MonthlyDeliveryPanel green
```

Expected: new suites present and green — `monthlyDeliveryScheduler.test.js`, `monthlyDeliveryReport.test.js`,
`monthlyDeliveryRoute.test.js`, `MonthlyDeliveryPanel.test.tsx`, extended `workflowDelivery.test.ts`.

## End-to-end scenario 1 — configure & snapshot

1. Start the server + client (dev flow), open **Admin Hub → 📅 Monthly Delivery** tab.
2. Click **Snapshot Teams** — the panel lists your Team Dashboard teams (name + project key).
3. Set time (leave 08:00), enable, **Save**.
4. **Proof**: `GET /api/monthly-delivery/config` returns the snapshotted teams; `%APPDATA%\NodeToolbox\toolbox-proxy.json`
   now contains `scheduler.monthlyDelivery` with those teams (whitelist worked); restart the server and GET again —
   config survived.

## End-to-end scenario 2 — Run Now & prompt correctness (the core evidence)

1. Click **Run Now**. Expect a completed status line within the SC-002 budget (<5 min for ≤10 teams).
2. The prompt appears in the readonly output area. **Copy Prompt** puts the full text on the clipboard
   (paste into an editor to confirm).
3. **Proof of month attribution (SC-003)** — pick 2 issues from the prompt:
   - One under *Delivered to Production*: open it in Jira → History tab → confirm its most recent transition into
     a done-category status is inside the covered month, **or** its fixVersion's release date is in that month.
   - One under *Delivered to External Test*: confirm its current delivered run began (entered "Ready for QA" or
     later) inside the covered month and it is not done/released.
4. **Proof of grouping**: pick a grouped issue → confirm its Feature link/parent in Jira matches the Feature
   heading (key + summary) in the prompt.
5. **Proof of coverage (SC-004)**: count `=== Team:` sections — must equal the number of snapshotted teams; a team
   that shipped nothing shows "No recorded deliveries this month.".
6. Paste the prompt into the in-house AI agent → it produces a bulleted per-team analysis without any manual
   editing of the prompt (SC-005, FR-015).

## End-to-end scenario 3 — honest failure

1. Temporarily break one team's snapshot (edit config to a nonexistent project key, save).
2. Run Now → run completes; that team's status shows `error` in the panel and the prompt shows
   `DATA UNAVAILABLE: …` for it; the other teams still have data (FR-018 — no fake clean result).
3. Restore the correct project key and re-save.

## Scheduler-trigger validation (no waiting for the real 2nd Tuesday)

Unit-level: Jest tick tests inject `today`/`currentTime` (piReview DI pattern) covering — before the 2nd Tuesday
(idle), on it before/after `scheduleTime` (idle/fire), a later day in the same month (catch-up fires once),
same month re-tick (guarded), next month (fires again).
Live smoke (optional): set `scheduleTime` to two minutes from now on a day past the current month's 2nd Tuesday,
delete the `monthlyDelivery` key from `%APPDATA%\NodeToolbox\scheduler-fired-state.json`, restart, and watch the
run fire once via the catch-up path; confirm the fired-state file gains today's date and a second restart does
NOT re-fire.

## Regression guardrails

- `npm run build:pi-review-engine` and `npm run test:dom` stay green (workflowDelivery edits ripple nowhere else).
- Existing scheduler routes (`/api/pi-review-scheduler/*`, `/api/notifications/*`) unaffected — spot-check one GET.
- Team Dashboard client behavior unchanged (snapshot flow only reads the settings store).
