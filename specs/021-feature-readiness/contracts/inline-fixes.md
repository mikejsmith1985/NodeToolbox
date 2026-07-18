# Contract: Readiness Inline Fixes

**Module**: `client/src/views/ArtView/readiness/ReadinessFixControl.tsx`. All writes delegate to
`client/src/views/SprintDashboard/featureReviewFixes.ts` — this control introduces NO new Jira
write path (Article VII: the drift is control-shape only, recorded in plan.md).

## Alert → fix mapping (normative)

| Alert | Control | Writer |
|---|---|---|
| missing-ownership | user search (`searchFeatureReviewUsers`) + target choice: Assignee / Product Owner (PO option only when the family is configured) | `saveFeatureReviewUserField(key, targetFieldId, userIdentifier)`; assignee uses the system `assignee` field id |
| missing-estimate | value entry; if the field's editmeta is option-shaped, a dropdown of allowed values | `saveFeatureReviewOptionField(...)` with `fetchFeatureReviewEditMeta`, else `saveFeatureReviewSimpleField` |
| missing-pcode | text entry run through `normalizePcodeInput` (P00012345 → 12345; non-numeric rejected with a plain reason BEFORE any write) | `saveFeatureReviewSimpleField(key, pcodeFieldId, normalizedValue)` |
| target-end-missing-or-past | date picker | `saveFeatureReviewSimpleField(key, targetEndFieldId, isoDate)` |
| due-date-missing-or-past | date picker | `saveFeatureReviewSimpleField(key, 'duedate', isoDate)` |
| status move (row action, not an alert) | transition select + shared `TransitionRequiredFields` for workflow-required screen fields; submit disabled until `areTransitionSelectionsComplete` | `saveFeatureReviewTransition(key, transitionId, buildTransitionFieldsPayload(...))` |

## Behavior rules

- Every fix input carries a visible label naming what it writes (019 FR-015 convention).
- Success: show the standard "Saved — Jira accepted the change." confirmation, clear the alert,
  and re-run the scan so lens counts update (one evaluation — never patch counts locally).
- Failure: render Jira's actual error message on the row (`role="alert"`); the alert remains.
- A family with no configured field NEVER renders a fix control — the row shows the
  "not checked" state instead; anything inline-uneditable links out to Jira with a plain reason.
- Fix controls are disabled while a write is in flight; no double submits.
- Expanded rows mount the shared `IssueDetailPanel` (`isEmbedded`) for full context — comments,
  transitions, description — identical to the hygiene workspace behavior.

## Test hooks

- `normalizePcodeInput` unit-tested for: plain digits, `P`-prefixed with zeros, whitespace,
  rejects letters/mixed/empty.
- Control tests mock `featureReviewFixes` (network fns only — pure helpers stay real, per the
  HygieneFixControl.test precedent) and assert: correct writer + args per alert kind, dual-target
  ownership choice, transition gating on required fields, error surfacing, and rescan-on-success.
