# Contract: Rovo Classification (prompt + parking-page response)

Reuses the existing dispatch-and-poll exchange (`dispatchPrompt` / `fetchResult`).
This contract fixes the **text format** Toolbox sends and the deterministic format
Rovo must write back to the Confluence parking page, so Toolbox can parse verdicts
reliably (mirrors how the CHG flow parses `SHORT_DESCRIPTION:`-style lines).

## Request (Toolbox → Rovo webhook)
`POST` to the configured Atlassian Automation webhook with body:

```json
{ "correlationId": "<uuid>", "prompt": "<classification prompt>" }
```

The prompt batches a team's violations and instructs Rovo to emit one block per
violation. Prompt skeleton:

```
You are a Jira data-quality assistant. For EACH violation below, decide whether you
can produce the correct field value (FIXABLE) or whether a human must act (UNFIXABLE).
Respond with one block per violation, in this EXACT line format, and nothing else:

correlationId: <uuid>
---
ISSUE: <issueKey>
CHECK: <checkId>
VERDICT: FIXABLE | UNFIXABLE
VALUE: <corrected value, only when FIXABLE>
GUIDANCE: <one-sentence owner instruction, only when UNFIXABLE>
---
(repeat per violation)

Violations:
- ISSUE <key> / CHECK <checkId> / TYPE <issueType> / SUMMARY <…> / FIELD <fieldId>=<currentValue>
…
```

## Response (Rovo → Confluence parking page → Toolbox)
The Automation rule writes the response to the parking page, stamped with the
`correlationId` marker line (existing freshness mechanism). Toolbox reads it with
`fetchResult` (envelope-unwrapped, view-fallback, current-block isolation — already
hardened) and parses each block.

Parsed per block → `RovoClassification`:

| Line | Maps to | Rule |
|---|---|---|
| `ISSUE:` | `issueKey` | must match a dispatched violation |
| `CHECK:` | `checkId` | must match a dispatched violation |
| `VERDICT:` | `verdict` | `FIXABLE` or `UNFIXABLE`; anything else ⇒ treat block as malformed → skip |
| `VALUE:` | `correctedValue` | required when `FIXABLE`; missing ⇒ skip that violation |
| `GUIDANCE:` | `ownerGuidance` | required when `UNFIXABLE`; missing ⇒ post a generic comment |

## Failure handling (edge cases from spec)
- Empty/malformed page or missing block for a violation ⇒ that violation is
  **skipped** (logged, no Jira write, no comment); the scan continues.
- A `FIXABLE` verdict whose Jira field update is rejected ⇒ re-classified
  `UNFIXABLE` for this run; comment posted instead; failure added to the digest.
- Verdict/value parsing is a **pure function** (`parseRovoClassifications(text)`),
  unit-tested independently of any I/O.
