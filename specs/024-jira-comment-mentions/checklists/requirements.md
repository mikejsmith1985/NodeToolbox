# Specification Quality Checklist: Jira-Native @-Mentions in Toolbox Comments

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-22
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
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

**Validation iteration 1 (2026-07-22)** — one item failed: three `[NEEDS CLARIFICATION]` markers open (scope of
resolution, composer appearance of an inserted mention, unresolvable-mention fallback). Presented to the user as
Q1–Q3.

**Validation iteration 2 (2026-07-22)** — all items pass. User answered **Q1: A, Q2: C, Q3: B**. Markers replaced,
decisions recorded in *Clarifications* and the *Decision Log*, and three consequential edits made:

- **FR-013 split into FR-013 + FR-013a.** Q2's chosen option is conditional on the instance accepting a name-carrying
  mention form that still notifies. That condition is unverified, so the spec now states the fallback explicitly
  rather than leaving the requirement contingent on an unproven assumption. The verification is flagged in
  *Assumptions* as the highest-risk item and a **P1 research task for `/speckit-plan`**, to be settled by observing a
  real notification (Article X), not by reading documentation.
- **SC-006 restated.** As originally drafted it promised the reader would "never [see] less informative" output than
  today — which Q3's placeholder contradicts, since it deliberately discards the raw identifier. The criterion now
  names that tradeoff instead of asserting something the chosen design does not deliver.
- **Two entries added to *Out of Scope*** so the Q1 and Q3 exclusions are recorded as decisions rather than
  omissions, plus a *Known accepted inconsistency* note covering the comment-vs-description mismatch Q1 leaves behind.

- **Implementation-detail check** — the spec names existing capabilities by *behavior* ("the existing Jira user
  search", "the existing person type-ahead") and confines file-level specifics to the Assumptions section, matching the
  house style of `specs/023-issue-200-fixes/spec.md`. No file paths, function names, or framework names appear in
  Requirements or Success Criteria.

- **Success-criteria check** — SC-002 deliberately requires verification against a **real Jira instance** rather than
  a successful POST, per Constitution Article X ("'returned 200' is not proof"). SC-007 phrases responsiveness in
  user-perception terms rather than a millisecond budget.

**Validation iteration 3 (2026-07-22, `/speckit-clarify`)** — five further ambiguities resolved (Q4–Q8). No checkbox
changed state; the pass count held at **16/16 → 16/16**. Two items that were passing only marginally are now
materially stronger:

- *Success criteria are measurable* — SC-007 was the spec's last unquantified adjective ("without a delay the user
  attributes to name resolution"). It is now a 2-second target on a typical thread **plus** two network-independent
  structural guarantees, so it fails for the right reason (serialized lookups) rather than for a slow VPN.
- *Requirements are testable and unambiguous* — FR-009a now states the picker's trigger rule, which SC-008 previously
  asserted as an outcome with nothing enforcing it.

One **contradiction inherited from iteration 2 was repaired**: US1 acceptance criterion 5 still promised the reader
would never see "a result less informative than today," which the Q3 placeholder decision had already overridden in
SC-006 but not here. Both now describe the same tradeoff.

The clarification pass also caught a latent design conflict before it reached planning: bounding lookups by capping
them (a natural-looking optimization) would have rendered resolvable people with the *unresolvable* placeholder,
silently undoing Q4's loading-vs-unidentifiable distinction. FR-007b now rejects that approach explicitly.

**Result: 16/16 pass.** Spec is ready for `/speckit-plan`.

**Carry into planning**:
1. **P1 research** — verify the name-carrying mention form against the live instance (does it notify?). FR-013 vs
   FR-013a depends entirely on the answer. This is the only remaining unverified assumption in the spec.
2. **Sequencing** — feature 022-quick-issue-lookup also modifies the shared issue detail panel, one of the composer
   locations in scope. Do not implement concurrently in that file area.
3. **Permitted optimization** — per-request identifier batching (FR-007b) if the instance supports it; bounded
   concurrency is the requirement either way.
