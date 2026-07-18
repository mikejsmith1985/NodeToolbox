# Contract: Readiness AI Insights (gated, propose-only)

**Module**: `client/src/views/ArtView/readiness/ai/` (model: `ArtView/ai` — spec 016 precedent).

## Gating

- The panel subscribes to `useAiAssistStore.isAiAssistUnlocked` and returns `null` while locked —
  no button, hint, or placeholder exists in the locked UI (spec FR-011, SC-004).
- Unlock is the app-standard Ctrl+Alt+Z session unlock; nothing readiness-specific.

## Exchange

- One prompt per request, built from the ACTIVE lens's `ReadinessScanResult` slice: per feature —
  key, summary, state, PI, alerts, impediment reasons, estimate/target/due values.
- Exchange runs through the shared `useAiAssistExchange` hook (automatic when the server channel
  is configured; copy/paste shell otherwise) — identical to PiReviewAiPanel.

## Reply envelope

```json
{ "kind": "featureReadiness", "items": [ {
  "issueKey": "FEAT-123",
  "estimateSuggestion": "8",
  "targetEndSuggestion": "2026-08-15",
  "dueDateSuggestion": "2026-08-20",
  "ownershipSuggestion": "Suggest routing to the eligibility PO",
  "insight": "Blocked link open 21 days; risk to PI commitment."
} ] }
```

- Parsed via the shared `extractJsonPayload`; wrong `kind` ⇒ readable error; items with unknown
  issue keys are reported and ignored (016 parser conventions).

## Per-item accept (normative)

- Writable on accept: `estimateSuggestion`, `targetEndSuggestion`, `dueDateSuggestion` — each
  routed through the SAME writers as the manual fix controls (`inline-fixes.md`), then the scan
  re-runs.
- NEVER writable: `ownershipSuggestion` (the AI cannot know valid account identities — rendered
  as read-only guidance) and `insight` (narrative display only).
- Every item renders individual Accept / Decline; nothing writes without a per-item click; there
  is no bulk-accept affordance (app-wide propose-only doctrine).
- The panel states its disclosure line on screen, matching the other AI surfaces.

## Test hooks

- Parser tests: valid envelope, wrong kind, unknown keys, missing optional fields.
- Panel tests: locked ⇒ renders nothing; unlocked ⇒ prompt contains only active-lens features;
  accept writes exactly one item via the mocked writer; decline writes nothing; ownership and
  insight items expose no write affordance.
