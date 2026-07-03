# Contract: AI Assist JSON Round-Trip (Hidden Accelerator)

This contract governs the **optional, passphrase-gated** accelerator only. It is invisible
and inert unless the session has unlocked AI Assist (`aiAssistStore`, Ctrl+Alt+Z, session key
`tbxAiAssistUnlocked`). It mirrors the hardened pattern in
`client/src/views/SprintDashboard/hooks/releaseAiAssistNotes.ts`. **No stage depends on it**
(FR-9.4, SC-9): every suggestion is an editable proposal the user accepts or rejects, and
rejecting all leaves the manual outcome unchanged.

The workflow is deterministic on both ends: Toolbox **generates a prompt** (the user pastes
it into their external assistant) and **ingests a strict JSON reply** (the user pastes it
back). Toolbox never calls an AI service directly for this path.

---

## Direction 1 — Prompt generation (Toolbox → user's assistant)

`buildCanvasAiPrompt(kind, context)` produces plain text. The prompt embeds only
already-visible, non-secret work data (keys, summaries, statuses, points, current
priority/size) and instructs the assistant to **"Respond ONLY with valid JSON"** matching the
schema for `kind`. No credentials or tokens are ever included (Article IX).

Supported `kind` values: `priorityOrder`, `staleCandidates`, `duplicateCandidates`,
`sprintGrouping`.

## Direction 2 — Reply ingestion (user's assistant → Toolbox)

`parseCanvasAiResponse(kind, responseText)`:
1. `extractJsonPayload(responseText)` — strip assistant chatter and ```` ```json ```` fences,
   narrow to the outermost `{...}` (reuse the `releaseAiAssistNotes.ts:215` approach).
2. `JSON.parse`.
3. **Strict validation** per schema below — throw a descriptive error naming the missing/
   malformed field (mirrors `readRequiredString`/`readReleaseRow`). Unknown issue keys (not on
   the canvas) are ignored with a surfaced count, never applied silently.
4. Return an `AiSuggestionSet` with every item defaulting to `accepted: false`.

---

## Reply schemas (per `kind`)

### `priorityOrder`
```json
{
  "kind": "priorityOrder",
  "items": [
    { "issueKey": "DENP-12", "bucket": "Must",   "rationale": "Blocks 3 downstream features" },
    { "issueKey": "DENP-47", "bucket": "Should", "rationale": "High value, no dependency" }
  ]
}
```
- `bucket` ∈ `Must|Should|Could|Wont` (else item rejected with error). Applying an accepted
  item sets `CanvasNodeState.priority`.

### `staleCandidates`
```json
{
  "kind": "staleCandidates",
  "items": [ { "issueKey": "DENP-9", "reason": "No update 62 days; likely abandoned" } ]
}
```
- Applying an accepted item suggests moving the node to the ParkingLot (`isParked=true`); the
  user still confirms per node.

### `duplicateCandidates`
```json
{
  "kind": "duplicateCandidates",
  "items": [ { "issueKey": "DENP-30", "duplicateOfKey": "DENP-14", "confidence": "high" } ]
}
```
- Advisory only — surfaces a visual link/badge between the pair. **Never** merges or edits
  Jira. `confidence` ∈ `high|medium|low`.

### `sprintGrouping`
```json
{
  "kind": "sprintGrouping",
  "groups": [
    { "containerTitle": "Sprint 25", "issueKeys": ["DENP-12", "DENP-47"] }
  ]
}
```
- Applying an accepted group drops the named issues into the matching (or a new provisional)
  container on the canvas. Reconciliation to real Jira sprints still happens only at commit
  (per `jira-writes.md`).

---

## Invariants

- **Gate**: all of the above is unreachable when `tbxAiAssistUnlocked` is not set.
- **Suggestion-only**: ingestion mutates *nothing* until the user accepts specific items.
- **Overlay-only**: accepted suggestions change the **overlay**, never Jira directly; Jira
  changes still route through Review & Commit.
- **No AI in guidance**: stage copy never references AI. This accelerator is a separate,
  gated panel — the coach text is identical whether AI is locked or unlocked.
- **Validation is strict and loud**: malformed replies produce a clear error and change
  nothing (no partial application).
