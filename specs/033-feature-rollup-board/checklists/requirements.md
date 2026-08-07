# Specification Quality Checklist: Feature Roll-Up Board

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-07
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

## Validation Notes

**Iteration 3 — post-`/speckit-analyze` remediation (2026-08-07)**: 10 findings raised, 0 CRITICAL, all remediated.
All 16 items still pass. Spec changes made:

1. **I1 (HIGH) — FR-022 conflicted with the plan and tasks.** FR-022 now scopes to a failure **as a unit**;
   **FR-022a** adds the two-step partial-success carve-out (do not revert — re-read and state what applied);
   **FR-022b** requires preferring the single-step write so FR-022a's case stays rare. The plan's Open Item and the
   contract's "why this departs from FR-022" note are closed.
2. **C1 (HIGH) — FR-054 had zero coverage.** The requirement is real (the checklist clarification promises a
   read-only indicator), so it gained task T032, a `checklistCompletion` field with invariant INV-8a, and quickstart
   V17 — rather than being deleted.
3. **C2 (HIGH) — SC-012's 5-second target was unmeasured.** Added invariant L-10, task T068, and a recorded timing
   step in quickstart V16.
4. **D1/D2 (LOW) — near-duplicates.** FR-006 now states only what is *additional* for defects beyond FR-036;
   FR-035 is now a definition feeding FR-031's grouping rather than a restatement of it.
5. **U2 (LOW) — the `other` type bucket.** Added an edge case and INV-8's note: no quick filter selects `other`
   (FR-039 names exactly three), so any active type filter hides them, and the lane's `n of N` count is what keeps
   that visible.

Non-spec remediations: the plan's Article IV gate is now backed by an instruction (`boardLayout.ts` splits into four
named helpers, T025), and three modules missing from the plan's file tree were added (`rollupBoardTypes.ts`,
`masterCards.ts`, `columnOptionSources.ts`).

**Iteration 2 — post-`/speckit-clarify` (2026-08-07)**: re-validated against the updated spec. All 16 items still
pass; no regressions. Five clarifications were integrated, and each closed a category that had been Partial:

1. **Layout topology** (was Partial: Interaction & UX Flow) — swimlanes with one shared column header row.
   FR-000a–d, Key Entities.
2. **Nesting vs. columns** (was a latent *contradiction*, not merely a gap) — the pre-clarify spec asserted both
   "children render nested inside their parent's card" and "every card sits in its own status column", which cannot
   both hold. Resolved to the per-column parent container pattern from GH #306. FR-030–038 replaced the old
   FR-030–033; User Story 3 rewritten; FR-002 amended so a container header is explicitly not a second card;
   downstream requirements renumbered to FR-057.
3. **Configuration ownership** (was a second latent contradiction) — the spec claimed the vocabulary was "shared by
   everyone viewing that team's board" while the Assumptions implied product-local storage. Resolved by carrying the
   vocabulary in the existing Shared ART Workspace record (FR-019a–e) and making the card order explicitly personal
   (FR-045).
4. **Scale** (was Missing: Non-Functional) — ~300 issues, all pages, no truncation ever. FR-055–057, SC-012.
5. **Lane collapse and default state** (was Missing: Interaction & UX Flow) — collapsible, opens collapsed, state
   remembered per person. FR-000e–j, SC-013.

**Iteration 1 (2026-08-07)** — issues found and corrected before this checklist was first marked complete:

1. *"No implementation details"* — the first draft named the product's internal modules and stores when describing
   reuse. Rewritten at the domain level; the framework-first reuse findings were moved out of the spec and are
   carried into `/speckit-plan` instead, where they belong.
2. *"Requirements are testable"* — the original "% complete" requirement did not state how the number is derived,
   making it untestable. Split into FR-012 (basis must be displayed) plus a stated calculation rule in Assumptions.
3. *"Success criteria are technology-agnostic"* — an early criterion referenced fetch/page counts. Replaced by
   SC-001, which states the same guarantee as an issue-count equality a reader can verify.
4. *"Scope is clearly bounded"* — three genuinely ambiguous decisions were resolved as clarifications (defect
   precedence, vocabulary ownership, checklist items) rather than left as open markers, since each had a defensible
   answer that materially bounds scope.

**Deliberate design constraints recorded for the planning phase** (not spec defects):

- FR-014 and FR-036 exist to prevent a filtered view from misreporting a Feature's health — a filter must never
  change a Master Card's numbers. This mirrors the project's standing rule that two surfaces showing one metric must
  agree by construction.
- FR-024 and FR-008 both exist so the board can never hide work. Anything unmappable or unattributable is surfaced,
  never silently absorbed.
- FR-046 is load-bearing: the board's ordering is a presentation artefact and must never touch Jira ranking.
- FR-002 is load-bearing against the per-column container model: a parent may head containers in many columns but is
  rendered as a *card* exactly once. Any implementation that draws the parent card per column breaks SC-001.
- FR-019e guards a live dependency: the Shared ART Workspace payload is versioned and read by clients that predate
  this feature. The vocabulary must be additive in both directions.

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`
