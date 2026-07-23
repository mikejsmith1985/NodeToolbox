# Specification Quality Checklist: Personal Workflow — Auditable Markdown Report

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

**Validation iteration 1 (2026-07-22)** — one item outstanding, by design.

- **No [NEEDS CLARIFICATION] markers remain** — ❌ **FAILS deliberately.** Three markers are open, presented as Q1–Q3
  in the spec's *Open Questions* section. All three were surfaced by reading the shipped report rather than by
  guessing at the request:
  - **Q1 / FR-010, US3-5, SC-004** — the feature's central tension. Hands-on cycle time is **reconstructed from issue
    history** (ownership + status replay, working-day counting), so **no Jira search can reproduce it**. The request
    asks for "the exact query so anyone can validate the data"; for this metric that promise cannot be kept in full,
    and the three options differ in how much evidence is published instead. No default was assumed because the answer
    changes what the document *is*.
  - **Q3 / FR-019, SC-002, SC-003** — the report fetches at most 100 issues. A Jira link returns everything, so the
    document's count and the linked count can disagree — the exact defect the Hygiene work removed. Options range
    from disclosing the cap to removing it; a wrong default would silently reintroduce the mismatch this feature
    exists to prevent.
  - **Q2 / FR-020** — clipboard, direct Confluence write, or both. Scope-level, with different build cost and
    different failure modes.

- **Grounding** — the spec's Assumptions describe the existing analysis (exclusion categories, history-derived cycle
  time, fetch cap) as observed in the shipped report, so the requirements attach to what is really there rather than
  to an idealised version of it.

- **Testability check** — FR-008 (formula shown with this run's actual values) and SC-003 (100% of fetched issues
  accounted for, counts reconciling visibly) are deliberately phrased so a reviewer can check them by reading one
  generated document, without access to the implementation.

- **Consistency check** — NFR-002 concedes up front that a figure, its formula, and its link may not be mutually
  reproducible in every case, and requires the document to say so. This keeps the spec honest rather than promising
  a guarantee Q1 and Q3 may make impossible.

**Validation iteration 2 (2026-07-22)** — all items pass. User answered **Q1: B, Q2: C (clipboard first, direct write
second), Q3: B**. Markers replaced, decisions recorded in *Clarifications* and the *Decision Log*, and four
consequential additions made:

- **FR-010a/FR-010b split.** Q1's per-issue evidence is the substance of the promise, but publishing it interacts
  badly with Q3: covering the whole window means *more* issues, each now carrying its own derivation. FR-010b
  therefore requires the evidence to sit in a labelled supporting section so the headline figures stay findable, and
  SC-011 makes that testable.
- **FR-019a backstop.** Removing the cap outright would let a pathological window run unbounded, so a high ceiling
  remains — with prominent disclosure if it is ever reached, preserving the "never present a subset as complete"
  property the whole feature rests on.
- **NFR-006 added.** A longer analysis must not make the report look frozen. This is a direct consequence of Q3 and
  had no counterpart before the decision.
- **FR-020b added.** With two publish routes (Q2), the routes themselves must not become an explanation for two
  copies of a report disagreeing.

**Validation iteration 3 (2026-07-22, `/speckit-clarify`)** — five further ambiguities resolved (Q4–Q8). Pass count
held at **16/16 → 16/16**; no checkbox changed state, but two items are materially stronger and two contradictions
were repaired.

The pass was driven by one verified finding: **the derivation evidence FR-010a assumed is not retained.**
`PersonalFlowIssueMetric` (`personalFlow.ts:101`) keeps only the summed `cycleTimeDays`; stints and spans are computed
internally and discarded. The iteration-2 note flagged this as "verify before building" — it is now confirmed, and
Q5's worked-example decision is scoped in full knowledge that the engine must return more than it does today.

- **Scope corrected (Q4).** The spec was written around a single subject; the report is actually run per roster. US1,
  US2 and US5 now describe a team document. The user supplied the structural insight that keeps it readable —
  explanations **per column**, links **per row** — captured as FR-006a and FR-011a.
- **Size problem resolved rather than mitigated.** Q1+Q3 already compounded; Q4 multiplied it again by N people.
  Q5 (prove the method once, not per issue) plus FR-010d closes it, applying the same economy at each level.
- **Two contradictions repaired.** The original Q1 clarification bullet still described full per-issue detail after
  Q5 superseded it, and US2 still read as single-person. Both now match the decisions.
- **Two unquantified requirements made testable.** FR-019a's "high backstop ceiling" became two explicit ceilings
  (per person, per run) with FR-019b naming who is affected when one is hit; NFR-006's "interruptible" became
  NFR-006a's explicit cancel that yields no document.

**Validation iteration 4 (2026-07-22, `/speckit-analyze` remediation)** — cross-artifact analysis found no CRITICAL
issues; coverage was **47/52 → 52/54** after four fixes. Pass count held at **16/16**.

The significant finding was **NFR-004**, which was both uncovered and **unsatisfiable as originally written**: it
required the document not to expose data a reader could not already see in Jira, but the feature's entire purpose is
publishing named individuals' figures and issue summaries to a Confluence page whose audience is whoever can read the
*page*, not the *issues*. An absolute MUST would have been violated on the first publish.

It was split rather than diluted:
- **NFR-004** now covers what the feature genuinely controls — the document contains nothing the *generator* could
  not see, true by construction since all queries run under their credentials.
- **NFR-004a** states plainly that publishing redistributes, and requires the publish flow to say so and the document
  to carry a short statement of what it contains. Choosing the page remains the publisher's decision; the feature's
  job is to make it informed rather than accidental. Covered by T025a, verified by SC-006a.

Three verification gaps were also closed: **SC-010** (T029a — the >100-issue case that is the acceptance test for the
whole ceiling decision), **SC-006** (T030a — comparing the *published page* against the screen, since the format
conversion sits between them unverified), and **NFR-002** (T015 — asserting the three-way figure/formula/link
agreement directly rather than inferring it from the parts).

**Result: 16/16 pass.** Spec is ready for `/speckit-plan`.

**Carry into planning**:
1. **Highest risk** — the Q1+Q3 interaction. Per-issue evidence × full-window coverage is the one combination that
   could make the output unusable. Document structure is a first-class design problem here, not formatting.
2. **Sequencing** — clipboard (FR-020) ships before direct Confluence write (FR-020a); plan the phases so P1 is
   independently shippable this week.
3. ~~Verify the derivation evidence is retained~~ — **checked, and it is not.** `PersonalFlowIssueMetric` keeps only
   the summed `cycleTimeDays`; the stints and qualifying spans exist only inside the calculation and are discarded.
   FR-010a therefore requires the engine to surface data it currently throws away. Q5's worked-example decision keeps
   that change small — one issue's detail rather than every issue's — but it is a real engine change, not a
   presentation-layer one, and should be sized as such.
4. **Roster mode is the primary path**, not the single-person view. Plan the fetch, the ceilings (FR-019a) and the
   progress/cancel behaviour (NFR-006a) around a whole-team run from the outset.
