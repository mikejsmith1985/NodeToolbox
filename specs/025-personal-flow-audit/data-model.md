# Phase 1 Data Model: Personal Workflow — Auditable Markdown Report

**Feature**: `025-personal-flow-audit` | **Date**: 2026-07-22 | **Plan**: [plan.md](./plan.md)

Five entities. All client-side and transient — the document is generated on demand and never persisted.

---

## 1. `MetricDefinition`

What a column *means*, stated once for the whole team (FR-006a). This is the entity that makes a roster document
readable: the derivation is identical for everyone, so it is described once and never repeated per row.

```ts
interface MetricDefinition {
  /** Column heading as it appears in the team table, e.g. 'Issues / Week'. */
  label: string;
  /** Plain-English statement of what it measures, for a reader who has never used the tool. */
  meaning: string;
  /** The formula in terms a reader can apply by hand, e.g. 'credited issues ÷ (window days ÷ 7)'. */
  formula: string;
  /** How this metric's issue set is reached in Jira — which of the three link kinds applies. */
  linkKind: 'credited' | 'fetched' | 'excluded' | 'none';
  /** True when the value is reconstructed from issue history and NO Jira search can reproduce it. */
  isHistoryDerived: boolean;
}
```

**Validation rules**:
- Every figure rendered in the team table MUST have exactly one `MetricDefinition`. A column with no definition is a
  number with no explanation — the defect this feature exists to remove.
- `isHistoryDerived: true` REQUIRES the document to carry a `WorkedExample` for that metric (FR-010a).
- `linkKind: 'none'` is only valid for figures not derived from an issue set (e.g. the window length itself).

**Why `linkKind` lives here rather than being inferred**: R2 established that fetched ≠ credited. Choosing the wrong
link for a metric silently produces a link whose count contradicts the number beside it, and nothing would fail — the
link works, it just answers a different question. Making it an explicit, tested property of each metric is what stops
that.

---

## 2. `PersonAuditRow`

One person's row in the team table, plus everything needed to check it independently (FR-011a).

```ts
interface PersonAuditRow {
  personDisplayName: string;
  roleLabels: string;
  /** Null when this person's analysis failed — rendered honestly, never omitted (R9). */
  figures: PersonalFlowResult | null;
  /** Why this person has no figures, when figures is null. */
  errorMessage: string | null;
  /** The exact JQL that fetched this person's issues — the same string that ran (R3). */
  fetchJql: string;
  /** Links for this person: credited set, fetched set, and one per exclusion category. */
  links: PersonAuditLinks;
  /** Set when this person's analysis stopped at a ceiling, so their figures are incomplete (FR-019b). */
  ceilingReached: 'per-person' | 'run-budget' | null;
}
```

**Validation rules**:
- A row with `figures: null` MUST still appear in the document with its `errorMessage`. Omitting the person would
  silently shrink the roster and let a failure look like an absence.
- `ceilingReached` non-null MUST cause a visible marker on that person's row **and** an entry in the run-level
  disclosure (FR-019b) — a reader must not have to cross-reference to learn a specific person's figures are partial.
- `fetchJql` MUST be the string `buildSearchJql` produced for this run, never a reconstruction.

---

## 3. `ReconciliationRow`

One line of the `fetched = credited + excluded` accounting (FR-016), each with a link that returns exactly its own
count.

```ts
interface ReconciliationRow {
  /** 'Fetched', 'Credited', or the exclusion reason's human label. */
  label: string;
  count: number;
  /** Plain-English explanation — for exclusions, why these were not counted (FR-017). */
  explanation: string;
  /** Opens exactly these issues in Jira; raw JQL text when no base URL is configured. */
  jiraLink: string;
  /** The query text, shown alongside the link so it can be inspected or adapted (FR-013). */
  queryText: string;
}
```

**Validation rules**:
- `credited + Σ(excluded) === fetched` MUST hold and MUST be shown, per person. If it ever fails to add up, the
  document must say so rather than printing rows that silently disagree — an audit report that cannot balance its own
  arithmetic has failed at the one job it has.
- Exclusion labels come from the engine's existing three reasons — `not-owned`, `wip-open`,
  `completed-out-of-window` — with no new classification introduced.

---

## 4. `WorkedExample`

The one issue shown in full span-level detail, proving how a history-derived figure is produced (FR-010a, Q5).

```ts
interface WorkedExample {
  issueKey: string;
  issueSummary: string;
  /** Whose figures this example belongs to — required so the reader can locate it (FR-010c). */
  personDisplayName: string;
  /** Each period the person held the issue. */
  ownershipStints: Array<{ fromIso: string; toIso: string }>;
  /** The in-progress spans within those stints that actually counted. */
  qualifyingSpans: Array<{ fromIso: string; toIso: string; statusName: string; workingDays: number }>;
  /** The sum of the spans — must equal this issue's reported cycleTimeDays. */
  totalWorkingDays: number;
  jiraLink: string;
}
```

**Validation rules**:
- `Σ qualifyingSpans.workingDays === totalWorkingDays`. If the example does not add up, it teaches the reader the
  wrong method.
- `totalWorkingDays` MUST equal the `cycleTimeDays` reported for that issue in the per-issue listing. The example and
  the listing are two views of one number and cannot be allowed to disagree.
- The chosen issue MUST have `cycleTimeDays > 0` and at least one qualifying span (FR-010c) — an issue that
  contributed nothing demonstrates nothing.
- Timestamps are ISO strings so a reader can match them against Jira's history view directly.

**Where it is chosen**: inside the engine, while the spans are still in scope (R1). Selecting it afterwards would
mean re-deriving the evidence, and a second derivation could disagree with the first.

---

## 5. `RunEnvelope`

The facts about the run itself, which make the document stand alone (FR-003, US5).

```ts
interface RunEnvelope {
  rosterLabel: string;
  windowDays: number;
  /** Explicit boundaries, so 'last 90 days' is never ambiguous to a later reader. */
  windowStartIso: string;
  windowEndIso: string;
  /** Passed in, never read from the clock — keeps the generator pure (R8). */
  generatedAtIso: string;
  toolVersion: string;
  /** Null when the whole run completed within both ceilings. */
  ceilingReached: { kind: 'per-person' | 'run-budget'; affectedPeople: string[] } | null;
  /** Null when no Jira base URL is configured — links degrade to query text (FR-015). */
  jiraBaseUrl: string | null;
}
```

**Validation rules**:
- `generatedAtIso` MUST be supplied by the caller. A generator that reads the clock is not deterministic and its
  output cannot be asserted in a test — unacceptable for the one feature whose value is trustworthiness.
- `ceilingReached` non-null MUST produce a disclosure at the **top** of the document naming the ceiling and listing
  the affected people (FR-019b).
- `jiraBaseUrl: null` MUST NOT suppress the document; every link position renders its query text instead (FR-015),
  which `buildJiraIssueNavigatorUrl` already does by returning raw JQL in that case.

---

## Entity relationships

```
RunEnvelope ──────────────────────────────► document header + ceiling disclosure
     │
MetricDefinition[] ───(once per column)───► "How these numbers are calculated" section
     │                                              │
     │                                        WorkedExample  (for each history-derived metric)
     ▼
PersonAuditRow[] ─────(one per person)────► team table
     │
     ├── links ────────────────────────────► one-click Jira, per person
     └── ReconciliationRow[] ──────────────► fetched = credited + excluded, per person
```

The shape encodes the readability rule: **`MetricDefinition` is per column and appears once; `PersonAuditRow` is per
row and repeats.** Explanations cannot accidentally be emitted per person, because they do not live on the person.
