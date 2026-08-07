# Contract: Rebuild Save & One-Environment Guard

**Feature**: `033-chg-rescope-rewrite` | **Surface**: `client/src/views/SnowHub/hooks/useCrgState.ts`
**Serves**: FR-028, FR-029, FR-030, FR-031, FR-032, SC-003, SC-004

## Terminal action

The rebuild's save is the **existing** `actions.updateExistingChg(targetChangeNumber)` — reused unmodified
(`useCrgState.ts:1984`).

```text
fetchChangeSysIdByNumber(number)                        → sys_id, or a "not found" error
buildChangeRequestPayload(state, primaryTarget)          → the SAME payload builder createChg uses
resolveChangeManagerSubmissionValue(...)                 → change_manager + u_change_manager aliases
PATCH /api/now/table/change_request/{sys_id}
fetchChangeRecordByNumber(number)                        → verification read
buildSubmissionMismatchMessages(state, verifiedRecord)   → field-by-field mismatch report
```

**Why this is reused rather than rewritten** (Article VII, [research.md](../research.md#finding-1--the-write-path-already-exists-updateexistingchg)):

- **FR-028** — PATCHes the record resolved from the number; updates in place.
- **FR-029 / SC-003** — no POST to the collection exists anywhere in this path. It cannot create a record.
- **SC-004** — shares `buildChangeRequestPayload` with `createChg`, so field parity with a new change is
  **structural**, not maintained by hand. Every field the create flow writes, the rebuild writes.
- **Article X** — re-reads the record after the write and reports mismatches, rather than trusting a 200.
- **Out of Scope: CTASKs** — this path creates none, unlike `createChg`.

The relay endpoint `PATCH /api/snow-relay/change/:changeKey` MUST NOT be used for the rebuild save. Its server-side
payload map (`src/routes/api.js:1052`) omits `requested_by`, `assigned_to`, `u_tester`, `u_service_manager`,
`u_expedited`, `change_manager`, custom SNow fields, and the dynamic planning aliases — a rebuild saved through it
would silently drop fields the operator filled in. It remains correct for ModifyChgTab's existing targeted edits.

## One-environment guard (NEW — FR-029)

A rebuild targets exactly one change number, so exactly one environment may be enabled.

| Enabled environments | Result |
|---|---|
| 0 | **Refused.** Reuse the shipped `NO_ENABLED_ENVIRONMENT_MESSAGE` (`useCrgState.ts:137`). |
| 1 | **Permitted.** That environment's value, config item, impacted-persons answer, and dates are written. |
| 2 or more | **Refused** with a new message naming the enabled environments and stating that a rebuild writes to one change number. |

**Why this is new work**: `createChg` fans out — one POST per enabled environment (`useCrgState.ts:2141`). But
`updateExistingChg` calls `readPrimaryChangeSubmissionTarget` (`:1449`), which silently takes `targets[0]`. So today,
enabling REL + PRD and pressing *Update Existing CHG* writes only REL and discards PRD without a word. For a manual
field-patch that ambiguity was tolerable; for a rebuild — where the saved change is supposed to describe the release
accurately — it is silent data loss.

**Enforcement points** (both required):

1. The update button is disabled while the guard fails, with the reason rendered beside it.
2. `updateExistingChg` itself refuses when called in rebuild context with a failing guard — the button state is a
   convenience, not the guarantee.

The **existing** end-before-start date check (`listEnvironmentDateOrderErrors`, GH #282) applies unchanged.

## Failure handling (FR-032)

| Failure | Behaviour |
|---|---|
| Change number not found | Reported as such; draft preserved |
| PATCH rejected by ServiceNow | Error surfaced; **draft preserved** so the operator can retry without rebuilding |
| Verification read fails | Reported as "unable to verify" — the write is not claimed as clean |
| Verification finds mismatches | Save reported as completed **with warnings**, count included — never as a clean success |

A rebuild draft is cleared **only** on a successful save, or when the operator explicitly resets.

## Concurrent edits

Out of scope by decision. A rebuild overwrites whatever is in ServiceNow — that is the stated intent of "delete
everything and start from a template". No merge, no conflict detection, no revision token.

## Tests (failing first — Article V)

| Test | Asserts |
|---|---|
| `refuses a rebuild with no enabled environment` | `NO_ENABLED_ENVIRONMENT_MESSAGE`; no PATCH issued |
| `refuses a rebuild with two enabled environments` | Message names both; no PATCH issued |
| `permits a rebuild with exactly one enabled environment` | PATCH issued once |
| `never issues a POST to change_request` | No create call in any rebuild path (SC-003) |
| `PATCHes the sys_id resolved from the target number` | Correct URL |
| `preserves the draft when the PATCH fails` | Draft intact for retry (FR-032) |
| `reports verification mismatches rather than a clean success` | Warning count surfaced |
