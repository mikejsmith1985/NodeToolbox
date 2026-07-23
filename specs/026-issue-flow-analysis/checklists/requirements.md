# Specification Quality Checklist: Issue Flow Analysis — where the time actually goes

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-07-23
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

**Validation iteration 1 (2026-07-23)** — one item outstanding, by design.

- **No [NEEDS CLARIFICATION] markers remain** — ❌ **FAILS deliberately.** Three markers are open, presented as
  Q1–Q3. Each was surfaced by an evidence-based review of the shipped engine rather than by guessing:
  - **Q1 / FR-005** — where the flow clock starts (creation vs first in-progress). Every total depends on it, and the
    two choices measure genuinely different things: customer wait versus delivery-system wait. No default was assumed
    because picking wrong makes the whole analysis answer the wrong question.
  - **Q2 / FR-014** — how firmly to prevent summing per-person figures. Ranges from labelling to removing the figure;
    the options differ in whether a reader can still reach a wrong total.
  - **Q3 / FR-002** — how unassigned time is treated. One option (attributing queue time to the next holder) is
    actively misleading and is flagged as such, but the choice between the other two is a real scope decision.

- **Grounded in verified behaviour, not assumption.** The Summary's three defects were each confirmed empirically
  against the shipped engine before being written down:
  - A developer who handed an issue to a PO **is** credited (1 issue, 5 points, 5 days) — so the user's original
    concern about hand-offs is already handled, and the spec says so rather than "fixing" a non-problem.
  - That same issue is **also** credited in full to the PO — proving the double-count.
  - An issue handed on that **never reaches done** is still credited with full points — proving "advanced, not
    delivered".
  - Hands-on **time** partitions correctly across holders and does not double-count — so FR-012/FR-013 are scoped to
    counts and points only, not to time.

- **Architectural constraint recorded** — the Assumptions state that the existing engine reduces the assignee
  timeline to a boolean relative to one person, discarding all other identities at the input boundary. This is why
  the feature is a second computation rather than a reshaping of existing output, and it is the single biggest
  sizing factor for `/speckit-plan`.

- **Framing check** — the Out of Scope section explicitly excludes ranking and individual performance assessment.
  Given this analysis names individuals against durations, that boundary is load-bearing rather than decorative.

**Validation iteration 2 (2026-07-23)** — all items pass. User answered **Q1: C, Q2: B, Q3: A**, with the added
intent that *both* problems must be visible: a backlog that sits before work starts, and a slow delivery system once
it does. That intent produced three requirements the bare option-C answer would not have:

- **FR-005a** promotes the gap between lead and cycle time to a reported figure. Left as two numbers for the reader
  to subtract, the backlog-wait finding would be present but not surfaced — and it is one of the two problems the
  user explicitly needs shown.
- **FR-005b** forbids showing either total alone anywhere the other is meaningful, so the feature cannot drift back
  into hiding one problem behind the other.
- **FR-003 / US1 acceptance 4** now require **two** reconciliations — stages to lead time, and post-start stages to
  cycle time — because with two totals a single reconciliation would leave one of them unchecked.

Also tightened: US1 acceptance 2 and 4 still assumed a single total after Q1 introduced two.

**Result: 16/16 pass.** Spec is ready for `/speckit-plan`.

**Carry into planning**:
1. **Sizing driver** — the existing engine flattens the assignee timeline to a boolean at its input boundary, so
   identity is gone before the calculation starts. This analysis needs a reconstruction that retains it. Size it as a
   second computation, not a reshaping of existing output.
2. **NFR-001 is the integrity constraint** — a person's hands-on time must match between the two analyses, which
   means they must share one reconstruction of an issue's history rather than deriving it twice.
3. **Status classification (active vs waiting) needs configuration** and cannot be inferred from Jira's categories,
   which lump every in-flight status together. The default must under-claim rather than invent findings.

**Validation iteration 3 (2026-07-23, `/speckit-clarify`)** — five further ambiguities resolved (Q4–Q8). Pass count
held at **16/16 → 16/16**; no checkbox changed state, but three categories that were Partial or Missing are now
covered, and one assumption was superseded rather than left to contradict the decision made against it.

The scan found the spec's largest hole was **scope**: FR-001 said "each issue completed within the reporting window"
without ever saying *which* issues. Everything downstream — what is fetched, how much, and whose flow is being
measured — rested on it. Now FR-000.

- **FR-000a is the part worth keeping.** Q4 separates *which issues are analysed* from *whose stages are shown*. An
  issue that sat for weeks with someone outside the roster is a delay the team genuinely experienced; filtering that
  stage out would have removed the finding while looking like tidier reporting.
- **FR-000b closes a definition nobody had written down.** "Completed" was used eleven times and defined nowhere.
  Anchoring it to the *last* entry into a done-category status also settles the reopen case the edge-case list had
  already raised without resolving.
- **NFR-006/006a/007 added.** The spec had no volume bound at all, for a run heavier than the person-scoped one that
  needed two ceilings. Progress and cancellation (NFR-007) were **inferred** from the same pattern rather than asked
  — recorded here so that inference is visible rather than assumed.
- **FR-008a–c replaced an assumption.** The old assumption said classification would default to treating everything
  as active work, which would have left US2's headline finding unavailable out of the box. It has been deleted, not
  merely overridden, so nothing in the spec still argues for the rejected default.
- **FR-011b sharpens the privacy framing.** Publishing was previously unaddressed; now that it feeds the shared
  document, the redistribution notice must speak to **waiting** time specifically. Naming individuals against queue
  time reads as judgement unless the reader is told a queue is usually a property of the system.

**Result: 16/16 pass.** Spec is ready for `/speckit-plan`.

**Carry into planning**:
1. **Sizing driver, unchanged** — the existing engine discards assignee identity at its input boundary. This is a
   second computation sharing one history reconstruction (NFR-001), not a reshaping of existing output.
2. **Two analyses, one reconstruction** — NFR-001 requires a person's hands-on time to match between them. Deriving
   it twice would eventually produce two different answers to the same question.
3. **The classification default is a judgement call with teeth** — FR-008b (state the classification) and FR-008c
   (report genuine uncertainty as unclassified) are what stop a wrong guess inverting the headline finding.
