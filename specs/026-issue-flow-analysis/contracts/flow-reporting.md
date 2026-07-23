# Contract: Flow Reporting

**Modules**: `issueFlowRollup.ts` (new, pure) + changes to `flowAuditMetrics.ts` / `flowAuditDocument.ts`
**Feature**: `026-issue-flow-analysis` | **Satisfies**: FR-007..FR-020, NFR-002

---

## `summariseStageRollups(issueFlows): StageRollup[]`

Aggregates stages across issues into the "where is flow lost" answer.

### Guarantees

| # | Guarantee | Requirement |
|---|---|---|
| R1 | One roll-up per distinct status, carrying total, median, p85 and issue count | FR-007, FR-010 |
| R2 | Each roll-up carries its `flowClass`, so waiting and active are never conflated in one figure | FR-008 |
| R3 | Roll-ups **partition** the stage set — summing their totals returns the overall total | FR-003 |
| R4 | Each roll-up carries the issue keys behind it, for the evidence link | FR-011 |
| R5 | The largest contributor is identifiable, and reported with its class | FR-009 |

**R1 reports median and p85, not a mean.** One issue stuck in review for three months would drag a mean far enough
to describe a team's review stage as broken when the typical case is fine. A typical value plus a spread lets a
reader see both the norm and the tail — and the tail is often the real finding.

---

## `computeDeliveryTotals(issueFlows): DeliveryTotals`

The honest team figures, and the direct fix for the double-count found in review.

### Guarantees

| # | Guarantee | Requirement |
|---|---|---|
| D1 | Counts **distinct issues** — an issue held by four people counts once | FR-012 |
| D2 | Counts each issue's points once | FR-013 |
| D3 | Computed over the issue set, **never** by summing per-person figures | FR-012, FR-013 |

**D3 is the whole point.** Review confirmed the existing per-person columns credit 1 issue and full points to *each*
holder, so summing them counts stints, not issues. This total is computed from a different direction entirely.

---

## Document integration

### Correcting the existing report's descriptions (FR-016..FR-020)

Three metric descriptions in `flowAuditMetrics.ts` state things the calculation does not do. **Wording only — no
figure changes** (FR-019):

| Metric | Currently says | Must say |
|---|---|---|
| Issues | "How many issues this person moved to done" | Issues this person **advanced** — completed **or handed on**. An issue handed on and never finished is still counted |
| Points | "The story points on those credited issues" | The **issue's size**, credited in full to **each** person who advanced it — not that person's output |
| *(both)* | — | These columns **cannot be summed** across the team; the team total is shown separately |

Because the document derives from the same definitions the screen uses, correcting them once fixes both (FR-020).

### New flow sections

Added to `flowAuditDocument.ts`, in the established pattern — meaning, formula, worked example, evidence link:

1. **Flow summary** — lead time, cycle time and pre-work wait, each with typical and spread.
2. **Where time goes** — the stage roll-ups, waiting separated from active, largest contributor called out.
3. **How statuses were classified** — the classification actually used (FR-008b), including anything unclassified.
4. **Per-issue flow** — one row per issue with its three totals, and a worked stage breakdown for one issue.

### Guarantees

| # | Guarantee | Requirement |
|---|---|---|
| P1 | Every flow figure carries meaning, formula and evidence link, like every other metric | FR-011a |
| P2 | Both totals always appear together; neither is shown alone where the other is meaningful | FR-005b |
| P3 | The pre-work wait appears as its own figure, not left as a subtraction | FR-005a |
| P4 | Non-summable per-person columns are labelled **and** the correct team total sits beside them | FR-014a |
| P5 | Every duration states that it is in **working days** | FR-006, NFR-002 |
| P6 | The published document carries the **waiting-time** redistribution notice | FR-011b |

**P6 needs its own wording, not feature 025's.** That notice covers throughput. Naming individuals against *waiting*
time reads as blame unless the reader is told a queue is usually a property of the system, not of the person holding
the issue. Reusing the throughput wording would leave the more sensitive figures less well explained than the less
sensitive ones.

---

## Required tests (red first — Article V)

**Roll-ups**
- Per-status totals, median and p85 over a multi-issue fixture.
- An outlier moves p85 but not the median (R1) — the property that makes the pair worth reporting.
- Roll-up totals sum to the overall stage total (R3).
- Waiting and active never appear in one combined figure (R2).
- The largest contributor is identified with its class (R5).

**Delivery totals**
- An issue held by four people counts **once**, with its points counted once (D1, D2).
- Totals computed from the issue set do **not** equal the sum of per-person columns for the same fixture — the test
  that pins the defect this feature fixes (D3).

**Corrected descriptions**
- The Issues description says "advanced" and does **not** claim "moved to done" (FR-016).
- It states that work handed on and never finished is counted (FR-017).
- The Points description frames points as issue size, not personal output (FR-018).
- **No computed figure changes** when the descriptions change — a fixture's numbers are byte-identical before and
  after (FR-019).

**Document**
- Lead time and cycle time always appear together (P2); pre-work wait appears as its own figure (P3).
- Every non-summable column is labelled and has a team total beside it (P4).
- Every duration is marked as working days (P5).
- The classification section lists each status and its class, including unclassified ones (FR-008b).
- The waiting-time redistribution notice is present and distinct from the throughput one (P6).
