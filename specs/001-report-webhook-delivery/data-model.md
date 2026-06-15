# Phase 1 Data Model: Report Webhook Delivery

No database entities — this feature moves transient report content through a
delivery pipeline. The "models" are in-memory shapes and the validation rules
attached to them.

## Surface registry (source of truth)

A constant list describing each deliverable surface. Drives both the delivery
service and the docs generator (single source — D6).

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | `standup-briefing` \| `scope-change` \| `feature-change` |
| `label` | string | Human label for UI/docs |
| `configResolver` | fn | Returns `{ triggerUrl, triggerSecret, teamName, projectKey }` for a given team id, from existing server config |
| `reportShape` | object | Documents the surface-specific `report` fields (for docs + schema) |

## Delivery request (client → `POST /api/reports/deliver`)

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `surface` | string | yes | MUST be a known surface `id`; else 400 |
| `teamId` | string | yes | MUST resolve to a team with a configured `triggerUrl`; else 400/409 |
| `report` | object \| string | yes | The already-generated report content; non-empty (FR-002, edge case) |

The request MUST NOT contain a destination URL or secret — those are resolved
server-side from stored config (FR-004/FR-006).

**`teamId` resolution**: `teamId` is the team identifier (team name / project key)
that each surface's registry resolver uses to look up that surface's stored
per-team config record — the standup-briefing config (`src/routes/standupBriefing.js`)
for `standup-briefing`, and the notifications scope/feature config
(`src/routes/notifications.js`) for `scope-change` / `feature-change` — each of
which already carries `triggerUrl` + `triggerSecret`. If no matching record (or no
`triggerUrl`) is found, the endpoint returns `409` and sends nothing.

## `payloadContext` envelope (server → Atlassian webhook)

```jsonc
{
  "payloadContext": {
    "source": "standup-briefing",          // surface id
    "team": { "name": "Team Alpha", "projectKey": "DENP" },
    "generatedAt": "2026-06-15T11:00:00.000Z",
    "report": { /* surface-specific, see contracts/payload-envelope.schema.json */ },
    "meta": {
      "redactionApplied": false,            // true if any value was redacted
      "nodeToolboxVersion": "0.16.20"
    }
  }
}
```

**Rules**:
- `source` ∈ surface registry ids.
- `generatedAt` is ISO-8601 UTC, set server-side at delivery time.
- `report` content is the **redacted** form when `meta.redactionApplied` is true.
- Envelope is stable across surfaces; only `report` varies (so smart-value
  templates stay predictable).

## Delivery result (server → client)

| Field | Type | Notes |
|-------|------|-------|
| `ok` | boolean | true when webhook returned 2xx |
| `status` | number | HTTP status from the webhook |
| `redactionApplied` | boolean | surfaced to user (FR-007) |
| `redactionCount` | number | count of redacted values |
| `message` | string | user-facing summary (success or failure reason) |

## Validation & policy rules (attached behaviors)

- **Host policy** (`webhookHostPolicy.isAllowed(url)`): parse URL; require
  `https:`; hostname === `automation.atlassian.com` OR ends with `.atlassian.net`.
  Reject everything else → delivery aborts with a clear message, **nothing sent**
  (FR-005, acceptance scenario 3).
- **Redaction** (`secretRedactor.redact(value)`): returns
  `{ value, redactionCount }`; applied to `report` before envelope build (FR-007).
- **Auth**: `triggerSecret` passed only as the `X-Automation-Webhook-Token`
  header via `triggerWebhook`; never in URL/query, never logged (FR-006/FR-009).
- **Error handling**: all delivery wrapped in try/catch; network/non-2xx returns
  a failure result, never throws past the route, never silent (FR-008).
- **Empty content guard**: empty/whitespace `report` → 400, no send (edge case).

## State transitions

```text
[user clicks Send]
   → validate request (surface, teamId, non-empty report)
   → resolve team config (triggerUrl, triggerSecret)
   → host policy check ──fail──► abort: "host not permitted", nothing sent
   → redact report (count)
   → build payloadContext envelope
   → triggerWebhook(url, envelope, tls, secret)
        → 2xx ► result { ok:true, status, redactionApplied }
        → non-2xx / error ► result { ok:false, status?, message }
```
