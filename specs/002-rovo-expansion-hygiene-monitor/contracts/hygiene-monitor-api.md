# Contract: Hygiene Monitor API (server)

New Express routes under `src/routes/hygieneMonitor.js`, mounted on the existing
proxy. All config lives in the Admin Hub (FR-014); these endpoints back that panel
and the gated Hygiene Monitor panel. Secrets are never returned in plaintext.

## GET /api/hygiene-monitor/config
Returns the current monitor configuration for the Admin Hub form.

- **200** →
  ```json
  {
    "isEnabled": false,
    "teams": [
      {
        "id": "uuid",
        "name": "Transformers",
        "projectKeys": ["TFM"],
        "scheduleTime": "06:00",
        "weekdays": [1,2,3,4,5],
        "teamsWebhookUrl": "https://…webhook.office.com/…",
        "teamsWebhookSecret": "",            // never echoed; empty string placeholder
        "fieldMappings": { "…": "customfield_10001" },
        "enabledCheckIds": ["missing-target-end","missing-assignee"]
      }
    ]
  }
  ```

## POST /api/hygiene-monitor/config
Saves the configuration (sanitised, trimmed) to memory + disk via `loader.js`.

- **Body**: the same shape as GET (secret optional; blank ⇒ keep existing).
- **200** → `{ "ok": true }`
- **400** → `{ "ok": false, "message": "<validation error>" }` (e.g. empty projectKeys on an enabled team, malformed `scheduleTime`).

## POST /api/hygiene-monitor/scan
Triggers an immediate scan ("Scan Now", FR-013). Does **not** reset the daily run guard.

- **Body**: `{ "teamId": "uuid" }` (omit ⇒ scan all enabled teams).
- **202** → `{ "ok": true, "startedAt": "<ISO>" }` (scan runs async; poll status).
- **409** → `{ "ok": false, "message": "A scan is already running." }`

## GET /api/hygiene-monitor/status
Backs the Hygiene Monitor panel (FR-013, SC-009).

- **200** →
  ```json
  {
    "isRunning": false,
    "teams": [
      {
        "teamId": "uuid",
        "name": "Transformers",
        "lastScanAt": "2026-06-16T06:00:11Z",
        "nextScanAt": "2026-06-17T06:00:00Z",
        "violationsFound": 4,
        "trend": "down"                       // up | down | flat | n/a
      }
    ]
  }
  ```

## Behavioural contract
- All four endpoints are inert (return empty/zero state) until configured — no errors.
- Dispatch to Rovo and delivery to Teams happen inside the scan, not in the request
  cycle; `scan` returns immediately and the panel polls `status`.
- Outbound calls obey the Atlassian-host allow-list; the configured Teams host is the
  one explicit, config-scoped exception (validated to be a known Teams webhook host).
