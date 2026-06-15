# Feature Specification: Report Webhook Delivery

**Feature short name**: `report-webhook-delivery`
**Created**: 2026-06-15
**Status**: Draft — ready for `/speckit-clarify` or `/speckit-plan`
**Feature directory**: `specs/001-report-webhook-delivery/`

## Summary

Today, several NodeToolbox surfaces let a user generate a report or briefing and
**copy it to the clipboard** to paste manually into Slack, Teams, or a Confluence
page (for example the Standup tab's "Copy Briefing" button). This feature lets a
user instead **send that same already-generated report content to their own
Atlassian Automation webhook** with one action, so a downstream cloud Automation
rule (optionally an inline Rovo step) can process it — removing the manual
copy-paste step from the loop.

This is a delivery-channel change only. The payload is the **same report content
the user already produces and can already see**. It does **not** collect any new
local system context (no git state, no application logs, no error dumps, no
filesystem scraping). The destination is **not** an arbitrary address — it is a
user-configured Atlassian Automation webhook, validated against an allowed-host
list, matching the webhook-delivery pattern the product already uses for its
scheduled reports.

## Scope Boundary (explicit non-goals)

The originating request described harvesting "git states, logs, error dumps" and
POSTing them to a freely configurable URL. That is **out of scope and will not be
built.** This specification is deliberately bounded to:

- **In scope**: sending the *existing* user-facing report/briefing payloads
  (the same text/data currently offered via clipboard copy) to a *validated*
  Atlassian Automation webhook destination.
- **Out of scope**: collecting git status/diffs, reading log files, capturing
  error dumps, scanning the local filesystem, or sending to an unvalidated
  arbitrary endpoint. None of the existing clipboard surfaces produce that data,
  and the reporting use case does not require it.

## Clarifications

### Session 2026-06-15

- Q: Which clipboard/console surfaces should the webhook delivery cover? → A: The three report/briefing surfaces only — Standup Briefing, Scope Change report, Feature Change report (non-report clipboard uses are excluded).
- Q: How is the webhook destination configured? → A: Reuse the existing per-team Automation webhook config (the `AutomationTriggerURL` + token already used by the scheduled reports); no new destination config surface.
- Q: What hosts may the webhook send to (trust boundary)? → A: Atlassian Automation hosts only (e.g. `*.atlassian.net` / `automation.atlassian.com`); non-Atlassian hosts are refused.
- Q: What happens if report content matches secret patterns (tokens, passwords)? → A: Redact the detected values, send the cleaned payload, and notify the user that redaction occurred (non-blocking).

## User Scenarios & Testing *(mandatory)*

### Primary user story

As a Release Train Engineer using NodeToolbox, after generating a standup
briefing or a scope/feature-change report, I want to push that report to my
team's Atlassian Automation webhook with a single action, so a cloud Automation
rule can fan it out (Teams message, email, Rovo summarisation) without me copying
text and pasting it somewhere by hand.

### Acceptance scenarios

1. **Given** a generated briefing/report is on screen with a "Copy" action,
   **When** the user clicks the new "Send to Automation" action **and** a webhook
   destination is configured, **Then** the same report content is delivered to
   that destination and the user sees a clear success confirmation including the
   response status.
2. **Given** no webhook destination is configured, **When** the user opens a
   surface that offers "Send to Automation", **Then** the action is disabled or
   prompts the user to configure a destination first, and never sends anywhere.
3. **Given** a configured destination whose host is **not** on the allowed-host
   list, **When** the user attempts to send, **Then** delivery is blocked with a
   message explaining the host is not permitted, and nothing is transmitted.
4. **Given** the webhook endpoint returns a non-success status (e.g. 4xx/5xx) or
   is unreachable, **When** the user sends, **Then** the failure is reported with
   the status code/reason, the surrounding workflow is not interrupted, and no
   partial/silent failure occurs.
5. **Given** a successful or failed send, **When** the result is logged, **Then**
   the log records the HTTP status and outcome **without** logging the webhook
   secret or full sensitive payload bodies.

### Edge cases

- Destination configured but secret/token missing → block send with a clear
  "authentication not configured" message (the existing pattern authenticates via
  a token request header).
- Report content is empty (nothing generated yet) → action unavailable; no empty
  payload is sent.
- Report content contains values that look like secrets (tokens, passwords) →
  redaction is applied before transmission (see FR-007).
- Very large report payload → handled gracefully (clear error if the endpoint
  rejects oversize bodies), no crash.
- Network timeout → bounded wait, reported as a failure, workflow continues.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST add a "send to Automation webhook" action alongside
  exactly these three existing report surfaces: the **Standup Briefing**, the
  **Scope Change report**, and the **Feature Change report**. Non-report clipboard
  surfaces (bookmarklets, image export, ServiceNow/text tools) are out of scope.
- **FR-002**: The action MUST transmit the **same report content** the user
  already generates for that surface — no additional local context is collected.
- **FR-003**: The report payload MUST be wrapped in a consistent, documented
  envelope object so downstream Automation rules can reference named fields.
- **FR-004**: The destination MUST be the **existing per-team Automation webhook
  configuration** (the `AutomationTriggerURL` + token already used by the
  scheduled reports). The feature MUST NOT introduce a new destination-config
  surface or a separate global webhook URL; it reuses each team's configured
  endpoint so a report is delivered to the same place that team's scheduled
  reports already go.
- **FR-005**: The system MUST validate the destination host against an
  **Atlassian-hosts allow-list** (e.g. `*.atlassian.net`,
  `automation.atlassian.com`) and refuse to send to any non-Atlassian host.
  Sending to an arbitrary, unvalidated URL MUST NOT be possible.
- **FR-006**: The system MUST authenticate to the webhook using the established
  token request-header mechanism, and MUST NOT place the secret in a URL query
  string or in logs.
- **FR-007**: Before transmission, the system MUST redact values that match
  common secret patterns (tokens, passwords, bearer credentials, API keys) from
  the report content, send the cleaned payload, and **notify the user that
  redaction occurred**. Redaction MUST NOT silently alter content without notice,
  and a detected secret MUST NOT block the (redacted) send.
- **FR-008**: All delivery attempts MUST be wrapped in error handling so a
  failure (network, auth, non-2xx) is surfaced to the user and never silently
  swallowed, and never interrupts the surrounding workflow.
- **FR-009**: The system MUST log the HTTP response status and outcome of each
  delivery in a clean, consistent form, **without** logging the secret or full
  sensitive payload.
- **FR-010**: The feature MUST be implemented with the project's existing
  dependency policy (no new unapproved third-party packages; use the runtime's
  native HTTP capability), consistent with the existing webhook delivery code.
- **FR-011**: The system MUST auto-generate documentation at
  `docs/automation-mappings.md` describing, for each migrated report surface: the
  envelope's field shape and an example, and a ready-to-use System Prompt
  template for the Atlassian "Use Rovo agent" block referencing the payload's
  named fields via Atlassian smart-value syntax.
- **FR-012**: Existing clipboard-copy behaviour MUST remain available
  (the webhook action is additive, not a removal of the manual fallback) unless
  the user explicitly opts to replace it.

### Key Entities

- **Report payload envelope**: the consistent wrapper around an existing report's
  content, carrying the report content plus identifying metadata (which surface,
  team/project context, generation timestamp) so Automation rules can route it.
- **Webhook destination config**: the **existing per-team** Atlassian Automation
  webhook endpoint and its authentication token, drawn from the team's current
  `AutomationTriggerURL` configuration (no new config surface); subject to
  Atlassian-hosts allow-list validation.
- **Automation mapping doc entry**: per-surface documentation pairing the
  payload field shape with the corresponding Rovo System Prompt template.

## Success Criteria *(mandatory)*

- **SC-001**: A user can deliver a generated report to their configured
  Automation webhook in a single action, with no manual copy-paste step.
- **SC-002**: 100% of delivery attempts to a non-allowed host are blocked before
  any data leaves the machine.
- **SC-003**: 100% of delivery outcomes (success and failure) produce a clear
  user-facing result and a status-coded log entry; zero silent failures.
- **SC-004**: No webhook secret and no credential-pattern value appears in any
  transmitted payload or log line in delivery testing.
- **SC-005**: For every migrated report surface, `docs/automation-mappings.md`
  contains both the payload field shape and a usable Rovo System Prompt template.
- **SC-006**: The manual clipboard-copy path still works for every surface that
  had it before.

## Assumptions

- The "same report content" refers to the existing user-facing report/briefing
  text/data already produced by NodeToolbox surfaces — **not** git state, logs,
  or error dumps, which these surfaces do not produce.
- The destination is the user's own Atlassian Automation webhook; the user is
  authorised to send their report data there. The allowed-host list defaults to
  Atlassian Automation hosts and is the trust boundary.
- The existing `triggerWebhook`-style delivery helper and its token-header
  authentication are the reference implementation to extend, not replace.
- Documentation generation targets `docs/automation-mappings.md` as specified.

## Dependencies

- Existing webhook configuration surface and delivery helper (the
  `AutomationTriggerURL` / `triggerWebhook` pattern already shipped for scheduled
  reports).
- Existing report/briefing generators that currently feed clipboard-copy actions.
