# Quickstart & Validation: Issue Flow Analysis

**Feature**: `026-issue-flow-analysis` | **Plan**: [plan.md](./plan.md)

This analysis claims to know where an issue's time went. The only validation that means anything is **opening one
issue in Jira and checking**. Tests 1 and 2 are the definition of done; everything else supports them.

---

## Prerequisites

- Repo on `feature/026-issue-flow-analysis`.
- Jira reachable. **If results come back empty, check VPN first** — an unreachable Jira looks exactly like a
  topology bug from inside the app.
- A roster with real completed work in the window, including at least one issue that **changed hands**.

```powershell
cd C:\ProjectsWin\NodeToolbox
.\scripts\run-dev-clean.ps1        # never validate against a built exe
```

---

## Test 0 — The extraction changed nothing ⚠️ RUN FIRST

The riskiest change in this feature is refactoring shipped code.

```powershell
cd C:\ProjectsWin\NodeToolbox\client
npx vitest run src/views/ReportsHub/personalFlow.test.ts
```

**Expected**: 35 passing, with **no edits to that file**.

Then open Personal Workflow, run it for a roster, and compare against a run from before the change.

**Expected**: every figure identical. If any moved, the extraction changed behaviour — revert it. Do **not** adjust
the tests to fit.

---

## Test 1 — Check one issue's stages against Jira 🎯

The core promise.

1. Reports Hub → **Flow Analysis** → select a roster and a 90-day window → run.
2. Pick an issue that **changed hands** and open its stage breakdown.
3. Open the same issue in Jira → **History**.

**Expected**: each stage's status, holder and dates match Jira's history. Where the issue changed hands mid-status,
the analysis shows **two stages** — same status, different people. That is the detail the Personal Workflow report
structurally cannot produce.

---

## Test 2 — The parts add up 🎯

1. On that same issue, note lead time, cycle time, and the pre-work wait.
2. Add up the stage durations yourself.

**Expected**:
- Stage durations sum **exactly** to lead time.
- Stages from the first started stage sum **exactly** to cycle time.
- `lead − cycle` equals the pre-work wait.
- Every figure is labelled **working days**.

If any of these is off by even a fraction, a total is being computed on a second path — which is precisely what the
design forbids.

---

## Test 3 — Both problems are visible (FR-005b)

1. Look at the flow summary.

**Expected**: lead time and cycle time **both** shown, never one alone, with the pre-work wait as its own figure.

**Why it matters**: cycle time alone hides a backlog that sits for weeks; lead time alone lets backlog age mask a
slow delivery system. You asked to see both problems — this is where that promise is kept.

---

## Test 4 — Where the flow is lost (US2)

1. Look at the per-status roll-ups.

**Expected**: waiting time separated from active work; the largest contributor named with its class; each status
showing a typical value **and** a spread; every row linking to its issues.

2. Click one roll-up's link.

**Expected**: Jira returns exactly the issues that row counted.

---

## Test 5 — The classification is visible and correctable (FR-008b/c)

1. Find the "How statuses were classified" section.

**Expected**: every status listed with its class. Statuses named like *Ready for QA* or *Blocked* default to
**waiting**; anything genuinely ambiguous is **unclassified** with its time still counted.

2. Override one, and re-run.

**Expected**: the time moves buckets; **the duration does not change**. Classification changes meaning, never
arithmetic.

---

## Test 6 — Unassigned time is visible (FR-002)

1. Find an issue that sat unassigned between hand-offs.

**Expected**: an explicit **Unassigned** stage with its own duration — not dropped, and **not** charged to whoever
picked it up next.

Queue time is often the largest single bucket. If it is missing, the analysis is hiding its most useful finding.

---

## Test 7 — Team totals are honest (US3) 🎯

The defect that started this.

1. Find an issue that passed through **two or more** people.
2. Add up the per-person Issues column in the Personal Workflow table.
3. Compare with the team delivered-issue total.

**Expected**: the per-person column sums **higher** — it counts stints. The team total counts each issue **once**,
sits beside the column, and the column is labelled as non-summable. Same for points.

---

## Test 8 — The existing report describes itself accurately (US4)

**Expected**:
- "Issues" says work **advanced** — completed or handed on — and does **not** say "moved to done".
- It states that work handed on and never finished is still counted.
- Points are framed as the **issue's size**, credited in full to each person who advanced it.
- **Figures are unchanged** — same window, same numbers as before this feature.

---

## Test 9 — Honest states and limits

| Situation | Expected |
|---|---|
| Issue with no transitions | Reported as having no measurable breakdown — never "0 days" |
| Issue reopened and re-completed | Counted once, dated by final completion, rework included |
| Issue never started | Cycle time 0, whole lead time as pre-work wait, stated plainly |
| A ceiling reached | Notice at the top naming the ceiling and what is incomplete |
| Long run | Progress shows how far through; cancel stops it and produces no document |

---

## Test 10 — Nothing else moved

| Check | Expected |
|---|---|
| Personal Workflow figures | Identical for the same window (Test 0) |
| Its audit document | Same figures; only the three descriptions changed |
| Issue Aging, hygiene, PI Review | Unchanged |
| Reports Hub team filter | Scopes both tabs consistently |

---

## Automated suites

```powershell
cd C:\ProjectsWin\NodeToolbox\client
npm test                      # vitest — timeline, stages, classification, roll-ups, document

cd C:\ProjectsWin\NodeToolbox
npm test                      # jest — server; must stay green (nothing server-side changed)
npm run test:dom              # engine bundles; must stay green
```

**All green, plus Tests 0, 1, 2 and 7 done by hand**, is the definition of done. The suites prove the analysis is
internally consistent; only checking a real issue against its real history proves it is **true**.
