# Quickstart & Validation: Personal Workflow — Auditable Markdown Report

**Feature**: `025-personal-flow-audit` | **Plan**: [plan.md](./plan.md)

Validation here is unusual, and deliberately so: **the document is checked by using it.** Follow its own links, count
what Jira returns, and confirm it matches what the document claims. If that works, the feature works — because that is
precisely what it promises a sceptic will be able to do.

---

## Prerequisites

- Repo on `feature/025-personal-flow-audit`.
- Jira reachable. **If results come back empty, check VPN first** — an unreachable Jira looks exactly like a
  topology bug from inside the app.
- A configured roster with several people who have real completed work.
- A Confluence page you may overwrite (Test 7 replaces its entire contents).

```powershell
cd C:\ProjectsWin\NodeToolbox
.\scripts\run-dev-clean.ps1        # never validate against a built exe
```

---

## Test 1 — Generate the document for a roster (US1)

1. Reports Hub → Personal Workflow → select a roster and a 90-day window → run.
2. Produce the document.

**Expected**: it covers the whole team in one document; header states roster, window with explicit start/end dates,
generation time, and tool version; it reads as prose with headings and tables, not a data dump.

---

## Test 2 — Explanations appear once, not per person (FR-006a, SC-011) 🎯

The readability rule, and the easiest thing to regress.

1. Run for a roster of **at least 5 people**.
2. Search the document for a metric's explanation — e.g. "Avg Cycle Time".

**Expected**: the explanation and formula appear **once**, in "How these numbers are calculated" — **not once per
person**. Each person's row carries only their figures and links.

**Also check**: you can find any headline figure without scrolling through per-issue detail. Per-issue listings are
last, in their own labelled section.

---

## Test 3 — Follow a link and count for yourself (SC-002) 🎯

The feature's core promise.

1. Pick any person. Note their **credited issue count**.
2. Click that row's credited-issues link.

**Expected**: Jira opens showing exactly that many issues. **The counts match.**

**The trap this catches**: if the link was built from the fetch JQL rather than the credited keys, Jira returns
*more* issues than the document claims — the fetch query is a deliberate superset (research R2). Same count is the
pass condition; a larger count means the link kinds were conflated.

Repeat for a second person and confirm the two links return **disjoint** sets.

---

## Test 4 — The accounting balances (SC-003)

1. Find "What was counted and what was not" for one person.

**Expected**: fetched, credited, and each exclusion category, each with its own working link; the numbers add up
visibly (`credited + Σ excluded = fetched`).

2. Click an **exclusion** link and inspect two or three issues.

**Expected**: they genuinely match the stated reason — e.g. `wip-open` issues really are still open and still assigned
to that person.

---

## Test 5 — Check the worked example by hand (SC-009) 🎯

The only way a history-derived number can be validated at all.

1. Find the worked example. Note the issue key, the ownership stints, the qualifying spans, and the working days.
2. Open that issue in Jira → **History**.

**Expected**: the assignee changes and status transitions match the stints and spans the document lists; counting
Monday–Friday days across the qualifying spans reaches the stated total; that total equals the same issue's entry in
the per-issue section.

3. Now take a **different** issue from the per-issue list and apply the same method to its Jira history.

**Expected**: you reach the total the document reports for it. That is SC-009 — the example taught you the method well
enough to check anything.

---

## Test 6 — Copy to Confluence (US1, P1)

1. Copy the document. Paste into a Confluence page. Publish.

**Expected**: renders as formatted content — headings, tables, working links — not raw markup. Clicking a link from
the **published page** opens Jira correctly (Toolbox closed is fine: SC-005, FR-014).

---

## Test 7 — Publish directly, with the overwrite warning (P2, FR-021) ⚠️

**This replaces the entire target page. Use a page you own and do not mind losing.**

1. Point the publish control at a page that already has unrelated content.

**Expected**: a warning **naming the page** says its contents will be replaced, and presents this as a likely mistake.
You can abandon — and abandoning writes nothing (verify the page is untouched).

2. Publish to a dedicated page. Then publish again to the same page.

**Expected**: the second time is recognised as a **routine re-publish** — the warning distinguishes it from step 1 —
and the page ends up carrying only the newest run.

---

## Test 8 — Progress and cancel (NFR-006, NFR-006a)

1. Run a roster over **"All history"**.

**Expected**: progress shows *which person* and *how many of how many* — not a bare spinner.

2. Cancel mid-run.

**Expected**: it stops promptly; the previously displayed results remain; and **no document is produced**. A partial
team report that reads as complete is the failure this feature exists to prevent.

---

## Test 9 — Honest states

| Situation | Expected |
|---|---|
| Person with no credited work | "Not applicable, because…" — **never `0`** |
| Person whose analysis failed | Still listed, with the reason; the roster does not silently shrink |
| Jira base URL not configured | Document still generates; every link position shows query text instead |
| A ceiling is reached | Notice at the **top**, naming the ceiling and which people have partial figures |

---

## Test 10 — Nothing else moved

| Check | Expected |
|---|---|
| Personal Workflow on-screen report | Same figures as before, for the same window |
| Screen vs document | Identical figures for the same run (NFR-001) |
| Issue Aging, hygiene, PI Review | Unchanged |
| Existing per-person **Copy JQL** button | Still works |

---

## Automated suites

```powershell
cd C:\ProjectsWin\NodeToolbox\client
npm test                      # vitest — generator, metrics, links, publish renderer

cd C:\ProjectsWin\NodeToolbox
npm test                      # jest — server; must stay green (nothing server-side changed)
npm run test:dom              # engine bundles; must stay green
```

**All green plus Tests 3 and 5 confirmed by hand** is the definition of done. The unit tests prove the document is
internally consistent; only clicking a link and counting what Jira returns proves it is *true*.
