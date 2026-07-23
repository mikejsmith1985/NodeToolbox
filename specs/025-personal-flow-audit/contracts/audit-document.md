# Contract: Audit Document Generator

**Modules**: `client/src/views/ReportsHub/flowAuditMetrics.ts` + `flowAuditDocument.ts` (new, pure)
**Feature**: `025-personal-flow-audit` | **Satisfies**: FR-001..FR-010d, FR-016..FR-019b, NFR-001, NFR-003, SC-001, SC-003..SC-011

---

## Shape

```ts
/** Renders the complete audit document. Pure: same inputs → same string, always. */
export function buildFlowAuditDocument(input: FlowAuditInput): string;

interface FlowAuditInput {
  envelope: RunEnvelope;        // roster, window, timestamp, ceilings, base URL
  rows: PersonAuditRow[];       // one per person, INCLUDING those whose analysis failed
  workedExamples: WorkedExample[]; // one per history-derived metric
}
```

**Purity is a requirement, not a style choice** (R8). `generatedAtIso` is supplied by the caller and the clock is
never read — so the entire document, every formula and every link, is assertable in a unit test. For the one feature
whose value is being trustworthy, its output being exhaustively testable is the point.

---

## Section order

The order encodes the readability rule: **explanations once per column, figures once per row.**

| # | Section | Content |
|---|---|---|
| 1 | **Header** | Roster, window (with explicit start/end dates), generation time, tool version |
| 2 | **Completeness notice** | Only when a ceiling was reached — names the ceiling and the affected people (FR-019b) |
| 3 | **Team figures** | The comparison table: one row per person, with per-person Jira links |
| 4 | **How these numbers are calculated** | One block **per metric**: meaning, formula, worked value (FR-006a) |
| 5 | **Worked example** | One issue in full span-level detail, per history-derived metric (FR-010a) |
| 6 | **What was counted and what was not** | Per person: `fetched = credited + excluded`, each row linked (FR-016) |
| 7 | **Per-issue detail** | Every credited issue with its total and link (FR-010b), in a labelled section (FR-010d) |

**Sections 4 and 5 appear once for the whole document, not once per person.** That is what makes a roster document
readable, and it is the user's own stated principle applied throughout.

**Section 7 sits last deliberately** (FR-010d): it is the longest and least-read part, and putting it earlier would
bury the figures it exists to support.

---

## Metric definitions (`flowAuditMetrics.ts`)

Each figure the team table shows carries exactly one `MetricDefinition`. Example shape:

| Metric | Meaning | Formula | Link kind | History-derived |
|---|---|---|---|---|
| Issues | Issues this person moved to done within the window | count of credited issues | credited | no |
| Issues / Week | Rate of completion | `credited issues ÷ (window days ÷ 7)` | credited | no |
| Points / Week | Rate in story points | `Σ story points ÷ (window days ÷ 7)` | credited | no |
| Avg Cycle Time | Mean hands-on working days per issue | `Σ hands-on days ÷ issues with measurable time` | credited | **yes** |
| Median Cycle Time | Middle hands-on duration | middle value of sorted hands-on days | credited | **yes** |

**Rules**:
- A metric with `isHistoryDerived: true` MUST state plainly that no Jira search reproduces it, and MUST have a worked
  example (FR-010a).
- The formula MUST be shown **with values substituted**, naming whose figures were used (FR-008) — e.g.
  *"For Jane Smith: 12 ÷ (90 ÷ 7) = 0.93 issues/week."*
- A metric undefined for a person (no qualifying issues) renders as an explicit "not applicable, because…", never `0`
  (FR-009). Zero would read as "instant delivery" — a false statement about a real person.

---

## Guarantees

| # | Guarantee | Requirement |
|---|---|---|
| D1 | Every figure in the team table has a matching explanation in section 4 | FR-006, SC-001 |
| D2 | Each explanation appears **once**, regardless of roster size | FR-006a, SC-011 |
| D3 | Each person's figures carry that person's own links | FR-011a, SC-009a |
| D4 | `credited + Σ excluded === fetched`, shown per person | FR-016, SC-003 |
| D5 | A person whose analysis failed still appears, with the reason | R9 |
| D6 | A reached ceiling is disclosed at the top, naming affected people | FR-019b |
| D7 | The document is legible as plain text before rendering | NFR-003 |
| D8 | Generation neither mutates inputs nor performs I/O | FR-004, NFR-001 |
| D9 | An undefined metric never renders as `0` | FR-009 |

---

## Required unit tests (red first — Article V)

**Structure**
- All seven sections present, in order, for a populated fixture.
- Section 4 appears exactly once for a 10-person roster — **not** ten times (D2). *This is the readability rule under
  test; without it, per-person duplication would creep back.*
- Section 7 comes after sections 3–6 (D8/FR-010d).

**Explanations and formulas**
- Every column heading in the team table has a matching explanation block (D1).
- A formula renders with substituted values and names the person used (FR-008).
- A history-derived metric states that Jira cannot reproduce it and has a worked example.

**Reconciliation**
- Fixture with 20 fetched / 12 credited / 8 excluded across two reasons: all rows render and the arithmetic balances.
- An imbalance renders a visible warning rather than silently printing rows that disagree.

**Honest states**
- A person with zero credited issues renders "not applicable, because…" and never `0` (D9).
- A person whose analysis failed appears with their error message (D5).
- A ceiling-reached envelope produces the top-of-document notice naming the ceiling and the people (D6).
- No base URL → query text everywhere, document still complete.

**Purity**
- Two calls with identical inputs produce byte-identical output.
- Inputs are not mutated.
- No output differs across two runs at different wall-clock times (proves the clock is not read).

**Worked example**
- Its spans sum to its stated total, and that total equals the same issue's entry in section 7.
