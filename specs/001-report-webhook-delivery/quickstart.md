# Quickstart / Validation: Report Webhook Delivery

Proves the feature end-to-end. References [contracts/](./contracts/) and
[data-model.md](./data-model.md) rather than duplicating shapes.

## Prerequisites

- Node.js 18+ (native `fetch`/`http` available).
- A team configured with an Atlassian Automation `triggerUrl` + `triggerSecret`
  (existing Admin Hub → Reports Config / Notifications surface).
- For a live end-to-end check: an Atlassian Automation rule with an incoming
  webhook trigger (any `*.atlassian.net` / `automation.atlassian.com` URL).

## Run

```bash
# server
npm start
# client (dev) — separate terminal
cd client && npm run dev
```

## Scenario 1 — Happy path (SC-001)

1. Open Sprint Dashboard → Standup → generate a Briefing.
2. Click **Send to Automation**.
3. **Expect**: success toast "Delivered to Automation webhook (HTTP 200)." and a
   matching `[Webhook] ← HTTP 200` server log line. The Atlassian rule receives a
   body validating against `contracts/payload-envelope.schema.json`.

## Scenario 2 — No destination configured (acceptance #2)

1. Select a team with no `triggerUrl`.
2. **Expect**: the action is disabled, or returns `409` with
   "No Automation webhook configured for this team." Nothing is sent.

## Scenario 3 — Disallowed host blocked (SC-002, FR-005)

1. Temporarily configure a team `triggerUrl` to a non-Atlassian host
   (e.g. `https://example.com/hook`).
2. Click **Send to Automation**.
3. **Expect**: `422` "Destination host is not an allowed Atlassian host; nothing
   was sent." No outbound request appears in server logs.

## Scenario 4 — Redaction notice (SC-004, FR-007)

1. Generate a report whose text contains a token-like value
   (e.g. paste `Authorization: Bearer abc.def.ghi` into a description).
2. Click **Send to Automation**.
3. **Expect**: success with "N value(s) redacted before sending."; the delivered
   payload contains `«redacted»` in place of the token; no token in any log line.

## Scenario 5 — Failure is reported, not silent (SC-003, FR-008)

1. Point a team `triggerUrl` at a valid Atlassian host path that returns 401
   (wrong/missing secret).
2. **Expect**: `502` "Webhook rejected the request (HTTP 401)."; the UI stays
   usable; the briefing remains on screen; clipboard copy still works (SC-006).

## Scenario 6 — Manual copy still works (SC-006, FR-012)

1. On each of the three surfaces, confirm the original **Copy** action still
   copies the report to the clipboard unchanged.

## Automated tests

```bash
npm test                       # server jest — host policy, redactor, delivery service, route
cd client && npm test          # client vitest — SendToAutomationButton + api
node scripts/generate-automation-mappings.js   # regenerates docs/automation-mappings.md
```

**Expect**: all unit tests green (<10ms each, mocked), `docs/automation-mappings.md`
contains an entry per surface with payload shape + Rovo System Prompt template
(SC-005).
