# Contract: `POST /api/reports/deliver`

Internal endpoint (same-origin, called by the SPA). Server-mediated webhook
delivery for the three report surfaces.

## Request

`POST /api/reports/deliver`
`Content-Type: application/json`

```jsonc
{
  "surface": "standup-briefing",   // "standup-briefing" | "scope-change" | "feature-change"
  "teamId":  "team-alpha",          // resolves to stored per-team webhook config
  "report":  { /* surface-specific content, or markdown string */ }
}
```

Constraints:
- `surface` MUST be a known surface id → else `400`.
- `teamId` MUST resolve to a team with a configured `triggerUrl` → else `409`
  (`message: "No Automation webhook configured for this team."`).
- `report` MUST be non-empty → else `400`.
- Request MUST NOT include a URL or secret (ignored if present).

## Responses

**200 — delivered**
```jsonc
{
  "ok": true,
  "status": 200,
  "redactionApplied": false,
  "redactionCount": 0,
  "message": "Delivered to Automation webhook (HTTP 200)."
}
```

**200 — delivered with redaction** (FR-007)
```jsonc
{ "ok": true, "status": 200, "redactionApplied": true, "redactionCount": 2,
  "message": "Delivered. 2 value(s) redacted before sending." }
```

**400 — bad request** — unknown surface / empty report.
```jsonc
{ "ok": false, "message": "Unknown surface 'x'." }
```

**409 — not configured** — team has no webhook destination.
```jsonc
{ "ok": false, "message": "No Automation webhook configured for this team." }
```

**422 — host not permitted** (FR-005) — configured destination fails the
Atlassian allow-list; **nothing is sent**.
```jsonc
{ "ok": false, "message": "Destination host is not an allowed Atlassian host; nothing was sent." }
```

**502 — delivery failed** — webhook unreachable or returned non-2xx (FR-008).
```jsonc
{ "ok": false, "status": 401, "message": "Webhook rejected the request (HTTP 401)." }
```

## Guarantees

- The webhook **secret** is never echoed in any response or log (FR-006/FR-009).
- On any non-2xx or network error, the surrounding workflow is unaffected; the
  endpoint always returns a structured result (never a silent failure, FR-008).
- Host validation happens **before** the outbound request; a disallowed host
  yields `422` with zero bytes transmitted (FR-005).
- Logs record `surface`, team/project, and the webhook HTTP status only.
