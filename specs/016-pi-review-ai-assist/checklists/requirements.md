# Specification Quality Checklist: Single AI Unlock + PI Review AI Assistance

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-15
**Updated**: 2026-07-15 — clarifications resolved; `/speckit-analyze` findings C1, I1, U1, G1, G2 remediated
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — Q1, Q2, Q3 resolved 2026-07-15
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**Status: 16/16 — ready for `/speckit-plan`.**

Resolutions (2026-07-15), each traced to requirements and acceptance scenarios:

| | Decision | Requirements | Scenarios |
|---|---|---|---|
| **Q1** | Dependency/Risks columns stay pure Jira mirrors; AI narrative → Implementation Notes | FR-025…FR-028 | 13, 14 |
| **Q2** | Accepted AI estimate behaves exactly like a typed one, including the Jira write-back; panel must disclose before acceptance | FR-029, FR-030 | 15 |
| **Q3** | One run covers the whole table; acceptance is row by row | FR-031, FR-032 | 16 |

Q1 is the load-bearing one. It was reached by reading `reconcileSinglePiReviewRow` rather than by assumption: the
Dependency and Risks columns are rebuilt from Jira issue links unconditionally on every load, so AI text placed there
would be blanked and migrated into Notes. The resolution turns that constraint into the design — the AI supplies the
*explanation* Jira's links cannot carry, and the columns keep meaning exactly what they have always meant.

Q2 deserves care at implementation: it authorises a write to an external system (Jira) via an **existing** path that
fires when Jira's estimate is empty — precisely the case an AI estimate fills. The decision is "no special case",
which means the disclosure in FR-030 is the only thing standing between a user and an unexpected Jira edit. Treat it
as a first-class requirement, not UI copy.

Content-quality note carried forward: the "constraint that shapes Part 2" section names `reconcilePiReviewRowsWithJira`
in a spec that otherwise avoids implementation detail. Retained deliberately — it describes observable behaviour
("the cell is emptied on load") and is the reason the feature has the shape it does.

Naming note: this spec is `016-` per the sequential scan of `specs/`. An unrelated, already-merged branch also used
`feature/016-...`; spec numbering and branch names are independent, and that branch carried no spec.

## `/speckit-analyze` remediation (2026-07-15)

Five findings resolved; artifacts re-validated afterwards (44 tasks, sequential, every impl task paired to a red test).

| ID | Sev | Was | Now |
|---|---|---|---|
| **C1** | CRITICAL | Article V breach — T022 (mount, FR-008) and T031 (accept wiring, FR-022) implemented with no preceding failing test; **CW-4 asserted nowhere** | Two red-test tasks inserted (**T022**, **T032**), each back-referenced by its impl task (`Make T022 green` / `Make T032 green`). CW-4 now asserted twice: at the unit level in T025 (the apply function is pure) and behaviourally in T032 (accepting never writes to Confluence) |
| **I1** | HIGH | **FR-017 contradicted the reply contract**: it told the prompt to request "the corresponding points" while the contract, plan and T012 all say the model returns only a size | FR-017 rewritten: request a **size**, never a point number; a volunteered point value is ignored. Spec now agrees with contract/plan/tasks |
| **U1** | MEDIUM | `MAX_AI_NOTE_LENGTH` referenced in 4 places with **no value** | Pinned to **300** in data-model.md and cell-write-contract.md, matching the house constant `MAX_TEXT_SIGNAL_LENGTH` (`canvasAiAssist.ts:84`) so the codebase keeps one notion of a condensed AI text field |
| **G1** | MEDIUM | FR-031 (one prompt covers **every** Feature) unasserted — T012 would pass on a 1-Feature fixture | T012 now asserts N>1 Features yield one prompt containing all N, explicitly to defeat a vacuous pass |
| **G2** | MEDIUM | FR-028 (a risk with no Jira link still becomes a note; no invented key) had no explicit test | Added to T026 |

**Not remediated** (deliberately — reported as LOW, user scoped remediation to the above): I2 (plan.md's 5 technical
phases vs tasks.md's 7 story phases — a presentational difference the `/speckit-tasks` template mandates), U2 (the
plan's qualitative performance goal), A1 (FR-019 does not restate the XXL exception), D1 (FR-025/FR-028 overlap),
U3 (button label not pinned to house convention), G3 (no task asserts the prompt instructs the envelope shape),
G4 (FR-029's "no provenance" is a negative, proven by the CW tests).

Task count moved 42 → 44. All downstream ID references were renumbered mechanically and re-validated.
