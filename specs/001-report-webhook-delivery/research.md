# Phase 0 Research: Report Webhook Delivery

All four spec clarifications (2026-06-15) are resolved; the open *technical*
decisions below are settled here so Phase 1 has no NEEDS CLARIFICATION items.

## D1 — Delivery topology: server-mediated vs browser-direct

- **Decision**: **Server-mediated.** The browser POSTs the report content + the
  target surface + team identifier to a new internal endpoint
  (`POST /api/reports/deliver`); the server resolves the team's `triggerUrl` /
  `triggerSecret`, validates the host, redacts, and calls `triggerWebhook`.
- **Rationale**: Keeps the webhook **secret server-side** (FR-006) — the browser
  never sees it. Host allow-list (FR-005) and redaction (FR-007) are enforced in
  one trusted place that a client cannot bypass. Avoids browser CORS issues with
  Atlassian endpoints. Reuses the existing `triggerWebhook` helper unchanged.
- **Alternatives considered**: *Browser calls the Atlassian webhook directly* —
  rejected: would expose the team secret to client code and move the security
  boundary into untrusted client JS. *New standalone CLI script* — rejected: the
  trigger is a UI action on already-rendered reports.

## D2 — Host allow-list definition (the trust boundary)

- **Decision**: Allow only hosts whose lowercased hostname **equals
  `automation.atlassian.com`** or **ends with `.atlassian.net`** (and the
  Atlassian automation webhook host), over **HTTPS only**. Anything else is
  refused before any bytes are sent.
- **Rationale**: Matches the spec's "Atlassian hosts only" clarification and the
  stated destination (Atlassian Automation). Suffix match on `.atlassian.net`
  must guard against look-alikes (e.g. `evil-atlassian.net.attacker.com`) — the
  check is on the parsed `URL.hostname`, exact-suffix with a leading dot, never a
  substring `includes()`.
- **Alternatives considered**: *User-managed allow-list* — rejected per
  clarification (Atlassian-only chosen). *Any HTTPS host* — rejected (weakest
  guardrail, the exact exfiltration risk this feature must avoid). A constant
  array of allowed matchers keeps it auditable and easy to extend later if the
  product decides to support self-hosted Atlassian.

## D3 — Secret redaction strategy

- **Decision**: A pure `redactSecrets(text)` (and an object-walking variant)
  that replaces values matching credential patterns with a fixed marker
  (`«redacted»`) and returns `{ value, redactionCount }`. Delivery proceeds with
  the redacted payload; if `redactionCount > 0` the API response carries a
  `redactionApplied: true` flag the UI surfaces to the user (FR-007). Detection
  is **non-blocking**.
- **Patterns** (named constants, extensible): bearer/authorization tokens,
  `password=`/`pwd=` assignments, Atlassian API tokens, generic long
  high-entropy `key`/`token`/`secret=` assignments, and email-style basic-auth in
  URLs (`https://user:pass@`). Patterns are conservative to limit false positives;
  a false positive only over-redacts (safe), never leaks.
- **Rationale**: Report content is Jira text and should rarely contain secrets,
  but defense-in-depth is cheap. Redact-then-send-with-notice (vs block) avoids
  interrupting the flow on false positives while still protecting credentials.
- **Alternatives considered**: *Block on detection* — rejected per clarification
  (notify, don't block). *Silent redaction* — rejected (spec requires user
  notice). *No redaction* — rejected (FR-007).

## D4 — Outbound envelope shape & naming

- **Decision**: Wrap the report in a top-level **`payloadContext`** object (honors
  the original request's field name) with a stable, documented shape: `source`,
  `team {name, projectKey}`, `generatedAt`, `report` (surface-specific content),
  and `meta {redactionApplied, nodeToolboxVersion}`. See data-model.md.
- **Rationale**: A consistent envelope lets each Atlassian Automation rule address
  fields via smart values (`{{webhookData.payloadContext.source}}`,
  `{{webhookData.payloadContext.report....}}`), which the generated
  `docs/automation-mappings.md` documents per surface (FR-011). Reusing the name
  `payloadContext` keeps continuity with the original intent.
- **Alternatives considered**: Flat top-level fields — rejected: a named envelope
  is clearer for smart-value templating and future surfaces.

## D5 — Reuse vs change of `triggerWebhook`

- **Decision**: **Reuse `triggerWebhook` unchanged.** Host validation and
  redaction happen in the new `reportWebhookDelivery` service *before* calling it,
  so the existing helper and its scheduler callers are untouched.
- **Rationale**: Framework-First — the helper already does native POST + token
  header + status logging + non-fatal semantics. Adding policy upstream avoids
  changing a function the schedulers depend on.
- **Follow-up note**: The same `webhookHostPolicy` validator *could* later be
  adopted by the scheduler call sites for consistency; out of scope here but
  recorded as a hardening opportunity.

## D6 — Docs generation

- **Decision**: A `scripts/generate-automation-mappings.js` reads a single
  source-of-truth surface registry (the same one the delivery service uses to
  build envelopes) and emits `docs/automation-mappings.md`: per surface, the JSON
  field shape + an example + a ready-to-paste Rovo System Prompt template using
  `{{webhookData.payloadContext.*}}` smart values.
- **Rationale**: Keeps docs in lockstep with the actual envelope (single source),
  satisfying FR-011 without hand-maintained drift.
