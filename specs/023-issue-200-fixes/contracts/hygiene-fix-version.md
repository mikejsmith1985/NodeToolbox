# Contract: US1 — Fix-Version Check Correctness

Covers FR-001..004, SC-001.

## Predicate scope

- A new constant `FIX_VERSION_ISSUE_TYPE_NAMES = {Story, Task, Defect, Feature, Epic}` (case-insensitive) in
  `client/src/views/Hygiene/checks/hygieneChecks.ts`.
- `checkMissingFixVersion(issue)` MUST:
  1. Return `null` (skip) when `issue.fields.issuetype.name` is NOT in `FIX_VERSION_ISSUE_TYPE_NAMES` (so Sub-tasks and
     other non-delivery types are never flagged) — replacing the current `isFeatureLikeIssue` gate.
  2. Otherwise flag when `issue.fields.fixVersions` is empty/absent (native field, already fetched).
- The other feature-only checks (missing-pi, target dates) are UNCHANGED — the broaden applies to fix-version only.

## Agree-by-construction

- `FIX_VERSION_ISSUE_TYPE_NAMES` is the SINGLE source consumed by both this predicate and US2's `jqlClause` for
  `missing-fix-version`. Neither restates the type list.

## Server parity

- If `src/services/hygieneRules.js` runs an equivalent fix-version check, mirror the same type set there; the server
  Jest suite MUST stay green.

## Tests (red-first)

| Case | Expectation |
|------|-------------|
| Story with no fixVersions | flagged |
| Task/Defect with no fixVersions | flagged |
| Feature/Epic with no fixVersions | flagged (unchanged) |
| Sub-task with no fixVersions | NOT flagged |
| Any type WITH a fixVersion | NOT flagged |
| PI with 72 mixed-type issues missing fixVersion | count = 72 (was 0) — SC-001 |
