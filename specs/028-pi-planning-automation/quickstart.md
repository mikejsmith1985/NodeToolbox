# Quickstart & Validation: PI Planning Automation

Runnable validation that the planner works end-to-end. Unit scenarios prove the pure engine; the live scenario proves the Jira writes. References the contracts rather than duplicating them.

## Prerequisites

- Repo on `feature/028-pi-planning-automation`; `npm install` done.
- A team configured in PI Review with: a roster (members with `roleCapabilities`), a capacity profile, and a selected PI whose name embeds a date window (e.g. `PI 26.3 (05/21/26 - 07/29/26)`).
- At least one **Feature** targeted at the PI with a point size (and, ideally, one existing child Story to prove idempotency).
- Jira reachable through the app's server proxy (VPN up — an empty result can be a VPN issue, not a bug).
- AI assist unlockable (Ctrl+Alt+Z) for the AI-driven breakdown.

## Unit validation (no Jira, no clock) — run first (TDD)

```bash
cd client && npx vitest run src/views/ArtView/piPlan src/views/ArtView/ai/piPlan
# plus regression: the reused planner must stay green
cd client && npx vitest run src/views/FeatureCanvas/planner
```

Expected: all new suites green; **all pre-existing `FeatureCanvas/planner` tests green (unmodified)**. Covers the contract test obligations:
- planning-engine: 70/30 split, determinism (SC-003), capacity-map == schedule (SC-004), 13-pt/over-capacity warnings, idempotency match.
- date-cadence: working-day math, REL = INT + 5 working days across weekend/holiday, INT ≤ 24h roll, PROD release selection, Due may exceed PI end.
- ai-assist: envelope parse, unknown-featureKey rejection, missing-size drop, AI dates ignored, locked-gate renders nothing.
- jira-writes: `dryRun` payload shapes (Story feature-link; Sub-task `parent.key`), internal-test omitted when not testable, existing item ⇒ no create.

## Component validation (mocked proxy — unit layer)

> Per Constitution Article V, these are **unit** tests (all I/O mocked); "integration" is reserved for real-infrastructure tests. End-to-end UX (Cypress real events) for the new panel is **deferred** — the spec did not request it and prior PI Review surfaces ship vitest-only; add a Cypress spec later if the panel's interaction risk warrants it.

```bash
cd client && npx vitest run src/views/ArtView/piPlan/piPlanJira.test.ts
```
Expected: with the Jira proxy mocked, `applyPlanItem` issues the correct create/date/sprint calls in order; `status='existing'` items issue none; a mid-sequence failure returns a partial `ApplyResult` (no silent orphan).

## Live end-to-end (manual — the acceptance evidence, Article X)

1. Open PI Review for the team/PI; open the **Planner** panel; unlock AI (Ctrl+Alt+Z).
2. **Generate prompt** → confirm it contains the full input set (PI window, sprint calendar, roster+capabilities, per-sprint capacity, each Feature+size, release schedule, the rule constants). *(SC-001, FR-001–011)*
3. Paste a well-formed `{kind:'piPlan'}` reply (or use ⚡ auto). Confirm the proposal renders: Stories per Feature, sub-tasks (internal-test only where testable + INT/REL/PROD), each with assignee, sprint, and **Target Start / Target End / Due**, each date showing its derivation. *(US1, US3)*
4. **Capacity map**: confirm per-person/per-sprint committed-vs-available, an over-allocation flagged, and that totals equal the assigned work. Reassign one Story → map updates. *(US2, SC-004)*
5. **Dates**: pick a Story and verify against the rules — Target End (code in INT) ≤ PI end; REL = INT + 5 working days; Due = a release date (may be after PI end). *(SC-005)*
6. **Accept** one Story + its sub-tasks → confirm in Jira: Story created under the Feature, sub-tasks created with `parent`, dates/fixVersion/assignee/sprint set. *(SC-002)*
7. **Idempotency**: re-run the planner → the Feature's already-created Story shows as `existing` and is not proposed for creation again. *(SC-006, US6)*
8. **Propose-only**: confirm nothing was written before step 6's accept, and that the panel is inert while AI is locked. *(SC-007)*

## Honest-state checks (FR-056)

- Deselect all sized Features → "nothing to plan" (not an empty success).
- A Feature with no size → surfaced as unplannable-until-sized.
- Remove the only internal tester's capability → capability-gap flag, no testing work assigned.
- No fixVersions in the PI window → empty release schedule reported + monthly cadence suggested.
- Over-commit the team → PI over-commitment flagged with the overflow.

## Done when

All unit + integration suites green (incl. unchanged planner regression), and the live steps 2–8 pass with Jira evidence (created keys + populated dates).
