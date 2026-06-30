# Contract — Daily Checklist State API

New Express endpoints backing the dashboard's per-user, per-business-day check-off state.
A 1:1 mirror of the existing `/api/mention-state` contract (`src/routes/mentionState.js`),
backed by `dailyChecklistStore.js`. Values are stored server-side so completion follows the
Scrum Master across devices and survives restarts.

Storage file: `sm-checklist-state.json` in the AppData config dir (`CONFIG_DIR_PATH`),
separate from `toolbox-proxy.json` and `mention-state.json`.

---

## GET /api/sm-checklist-state

Returns the categories the user has manually marked complete **for the given business day**.

**Query params**

| Param | Required | Notes |
|-------|----------|-------|
| `user` | yes | Stable Jira user key (accountId / name / key). |
| `day` | yes | Business-day key `YYYY-MM-DD` (client computes via `mostRecentBusinessDayKey(now)` — today on a weekday, the preceding Friday on Sat/Sun). |

**Responses**

- `200` →
  ```json
  { "completed": { "<categoryId>": { "completedAt": "2026-06-30T13:01:22.000Z" } } }
  ```
  Empty object when nothing is complete for that day.
- `400` → `{ "error": "Query param \"user\" is required." }` (or `\"day\"`).

Only the requested day's bucket is returned. Older buckets are not returned and are pruned on
the next write (the daily-reset mechanism).

---

## POST /api/sm-checklist-state

Marks one category complete for a business day, or undoes it.

**Body**
```json
{ "userKey": "<id>", "day": "2026-06-30", "categoryId": "team-stale", "isComplete": true }
```

| Field | Required | Notes |
|-------|----------|-------|
| `userKey` | yes | |
| `day` | yes | `YYYY-MM-DD` business-day key. |
| `categoryId` | yes | One of the `CategoryId` enum values. |
| `isComplete` | yes | Boolean. `true` records completion; `false` removes it. |

**Responses**

- `200` → `{ "completed": { …updated map for that day… } }`
- `400` → `{ "error": "\"userKey\", \"day\", \"categoryId\", and boolean \"isComplete\" are required." }`

**Behaviour**

- `isComplete: true` → `completed[categoryId] = { completedAt: <now ISO> }`.
- `isComplete: false` → delete `completed[categoryId]`.
- Unknown `categoryId` values are accepted as opaque strings (forward-compatible) but the
  client only sends catalog ids.
- Corrupt/missing store file is treated as empty; a failed write logs a warning and does not
  throw (matches mention-state behaviour).

---

## Notes

- **No authentication header** beyond what the app already uses; this store holds no secrets
  (only which checklist items a user ticked).
- Auto-complete on a zero count is **not** persisted — it is derived in the client. Only
  deliberate manual completions are written here.
