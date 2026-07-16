# Contract: Monthly Delivery HTTP API

**Feature**: `018-monthly-delivery-report`
Router: `createMonthlyDeliveryRouter(configuration)` in `src/routes/monthlyDelivery.js`, mounted in `server.js`
beside the PI Review router. All bodies are JSON. The Admin Hub panel is the only consumer.

## GET /api/monthly-delivery/config

Returns the current scheduler configuration (defaults when unset).

```json
{
  "isEnabled": false,
  "scheduleTime": "08:00",
  "featureLinkFieldId": "customfield_10108",
  "teams": [
    { "teamName": "Alpha", "projectKey": "ALPHA", "boardId": "42" }
  ]
}
```

## POST /api/monthly-delivery/config

Body: same shape as GET. Server sanitises before persisting:

- `scheduleTime` must match `^([01]\d|2[0-3]):[0-5]\d$` → else falls back to `"08:00"`.
- Each team: `teamName` and `projectKey` trimmed; entries with empty `projectKey` are dropped.
- `featureLinkFieldId` trimmed; empty → default `"customfield_10108"`.
- Writes `configuration.scheduler.monthlyDelivery` in place, then `saveConfigToDisk(configuration)`.
  **Requires the loader.js whitelist extension** — see plan.md; without it the save silently loses the block.

Response: `{ "ok": true, "teams": <sanitised count> }` · Errors: `400` invalid JSON body, `500` disk write failure
(message surfaced, never swallowed).

## POST /api/monthly-delivery/run-now

No body (whole-run — a single prompt covers all teams; there is no per-team run).
Triggers `runMonthlyDeliveryNow(configuration)` with `trigger: 'manual'`, prior calendar month window.
Does NOT read or write scheduler fired state.

Response `200`:

```json
{ "ok": true, "result": { "<RunResult — see data-model.md>": "..." } }
```

- `409` when a run is already in progress (overlap guard — same Set idiom as `runningTeamKeys` in
  `piReviewScheduler.js`).
- `400` when `teams` is empty: `{ "ok": false, "message": "No teams configured — snapshot teams and save first." }`
- `500` only for infrastructure failure of the run itself; per-team Jira failures are NOT an HTTP error — they are
  reported inside `result.teams[].status === 'error'` (FR-018).

## GET /api/monthly-delivery/status

Returns the persisted last `RunResult` verbatim (including `promptText`, which the panel needs for Copy Prompt),
or `{ "hasRun": false }` when no run has ever completed.

```json
{
  "hasRun": true,
  "ranAtIso": "2026-07-14T08:00:41.000Z",
  "coveredMonth": "2026-06",
  "trigger": "scheduled",
  "promptText": "…full prompt…",
  "teams": [
    { "teamName": "Alpha", "status": "ok", "productionCount": 7, "externalTestCount": 3, "message": "" },
    { "teamName": "Beta", "status": "error", "productionCount": 0, "externalTestCount": 0, "message": "Jira search failed: 401" }
  ]
}
```

## Consumer obligations (Admin Hub panel)

- Run Now button MUST be disabled while config edits are unsaved (dirty-state gating — `PiReviewSchedulerPanel`
  precedent: Run Now acts on the server's saved config).
- Copy Prompt MUST be disabled when `promptText` is empty/absent.
- The panel MUST display per-team outcomes as returned — it never re-derives or hides `error` statuses.
