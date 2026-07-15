# Quickstart & Validation: PO Tool — Feature Splitter & Feature Composition

**Feature**: `017-po-feature-tools` | **Date**: 2026-07-15 | **Plan**: [plan.md](./plan.md)

How to run this feature and **prove** it works. Per Article X, "it compiles" and "the API returned 200" are **not**
proof — each scenario below states the **observable evidence** that settles it.

---

## Prerequisites

- Jira reachable through the configured proxy. **If the VPN is down, Jira reads return empty** — that is a
  connectivity failure, not a bug, and the tool must say so (spec A11). Confirm connectivity before diagnosing.
- Confluence configured on the server (for the fetch-by-URL path).
- At least one Team Dashboard team profile configured (the PO Tool reads that catalog).
- A test Feature key you may safely split, and a scratch project you may safely create issues in.
- A `.xlsx` and a `.csv` file, and a Confluence page URL the configured account can read.

## Setup

```powershell
cd C:\ProjectsWin\NodeToolbox
npm install                 # no new dependencies — SheetJS already ships
.\scripts\run-dev-clean.ps1 # launch dev (per Article V; never test against a built binary)
```

## Test commands

```powershell
cd client
npx vitest run                                   # all client unit tests
npx vitest run src/views/PoTool                  # this feature only
npx vite build                                   # must be clean
cd ..; npm test                                  # server tests — must stay green (no server change)
```

---

## Invariants (unit-level — prove these first)

| ID | Invariant | Where proven |
|----|-----------|--------------|
| **INV-1** | A draft load **never throws** — absent/corrupt/older-version → empty or migrated draft | `drafts/*.test.ts` |
| **INV-2** | A draft save **no-ops** when storage is blocked, and the tab is **told** so it can warn | `drafts/*.test.ts` |
| **INV-3** | A wrong-`kind` AI payload is rejected **whole**; a bad **item** only fails that item | `ai/*.test.ts` |
| **INV-4** | The commit diff is built **purely**; a non-empty `blockingIssues` disables commit | `jira/buildSplitCommit.test.ts` |
| **INV-5** | A link failure is **reported, never thrown**, and never undoes a create | `jira/runCommit.test.ts` |
| **INV-6** | Coaching content resolves with **no** network call and **no** gate | `coaching/*.test.ts` |

---

## Scenario A — Reuse & zero regression *(Layer 1 — the premise)*

**This is the scenario that validates the feature's core claim. Run it first.**

1. Open **Team Dashboard**. Select team **Alpha**. Note Feature Review's and PI Review's contents.
2. Open the **PO Tool**. Select team **Beta** (its own picker).
3. View the PO Tool's Feature Review and PI Review.
4. Return to Team Dashboard.

**Evidence**:

- ✅ PO Tool shows **Beta's** data; Team Dashboard still shows **Alpha's** — neither selection moved. *(SC-015,
  FR-005a)*
- ✅ Team Dashboard's tabs render exactly as before the feature. *(SC-002, FR-004)*
- ✅ The PO Tool's tabs are the **same components** — confirmed structurally: no `FeatureReviewTab` or `PiReviewTab`
  copy exists under `views/PoTool/`. *(SC-003, FR-003, INV-T1)*
- ✅ Grep proof for INV-T3: `views/PoTool/` contains **zero** calls to `setSprintDashboardActiveTeamProfileId`.

> **Regression watch**: Layer 1 touches `FeatureReviewTab.tsx`. Existing Team Dashboard tests must be green
> **unchanged** — if a test needed editing, the prop was not backward-compatible (FR-005b).

---

## Scenario B — Split a Feature, gate **locked** *(proves FR-022/SC-005)*

Do **not** unlock AI Assist.

1. PO Tool → **Feature Splitter**. Enter a Feature key. Load.
2. Confirm coaching is visible; confirm **no AI control is anywhere on screen**.
3. Copy text from the original into 3 increments; edit each by hand.
4. Open **Review**.

**Evidence**:

- ✅ Summary, description, AC, and hygiene fields displayed and copyable. *(FR-007, FR-008)*
- ✅ Split heuristics visible with the gate locked and **no network call** (check the Dev Panel / network tab).
  *(FR-010, SC-013, INV-6)*
- ✅ Zero AI affordances. *(SC-005)*
- ✅ Review itemizes **every** issue to be created and **every** link to be made, before any write. *(FR-013)*
- ✅ **No Jira write has occurred** — verify via the Dev Panel's API log: zero POST/PUT. *(FR-014, SC-006)*

---

## Scenario C — Resume across sessions *(FR-042/FR-043, SC-004)*

1. With Scenario B's draft open, hard-refresh the browser. Reopen the PO Tool → Feature Splitter.
2. Re-enter the same Feature key.

**Evidence**:

- ✅ All 3 increments restored **exactly**, including hand edits. *(SC-004)*
- ✅ The original Feature in Jira is **untouched** — no writes happened. *(FR-044)*
- ✅ Re-entering the same key resumes the **same** draft; a second draft is not created. *(FR-043)*
- ✅ *(Private-browsing variant)* With storage blocked, the tab still works and **warns** that drafts won't survive a
  reload — it does not silently discard. *(FR-047, INV-2)*

---

## Scenario D — Commit a split *(FR-015/FR-016, SC-016)*

1. From Scenario C's restored draft, open Review, confirm the diff, **Commit**.
2. Inspect the original Feature and each new increment in Jira.

**Evidence**:

- ✅ Increments created as **peer Features of the original's own issue type** — not children, not a hard-coded
  "Feature". *(FR-016, INV-J5, A17)*
- ✅ Each increment is **linked** to the original. *(FR-016a)*
- ✅ **The original's status, workflow state, and content are unchanged.** *(SC-016, FR-016b, INV-J2)* — the single
  most important check in this scenario.
- ✅ Per-item outcomes reported with resulting keys. *(FR-015, SC-011)*
- ✅ Draft cleared on full success. *(FR-045)*
- ✅ *(Partial-failure variant)* Force one create to fail (e.g. blank a required field): successes are retained,
  failures keep the draft alive, and a retry does **not** double-create the already-created ones. *(SC-011)*
- ✅ *(Pre-flight variant)* Target a project whose type requires an unset field: commit is **blocked**, each missing
  field is **named**, and **no issue is created**. *(FR-034, SC-008, INV-J3)*

---

## Scenario E — Split AI assist, gate **unlocked** *(FR-017…FR-022, SC-006/SC-009/SC-010)*

Unlock AI Assist (Ctrl+Alt+Z at the app root).

1. Reopen Feature Splitter. Generate the split prompt; copy it.
2. Run it in an external assistant. Paste the reply back; **Ingest**.
3. Accept 2 proposals, reject 1, **edit** another. Commit only the accepted subset.
4. Paste garbage; paste valid JSON with `"kind":"sizeEstimate"`; paste a proposal referencing an unknown key.
5. Re-lock the gate mid-draft.

**Evidence**:

- ✅ The prompt contains **no credential**. *(Article IX, INV-J7)*
- ✅ Ingested items land **unaccepted**, each individually acceptable/rejectable/**editable**. *(FR-020, SC-010)*
- ✅ **Zero Jira writes across the entire ingest-and-accept cycle** — Dev Panel API log shows no POST/PUT until
  Commit. *(SC-006, FR-021, INV-J1)* — the decisive check.
- ✅ Garbage → descriptive error, draft **untouched**. Wrong `kind` → **whole payload rejected**. Unknown key →
  that item skipped **and reported**, valid items still ingest. *(SC-009, INV-3)*
- ✅ Re-locking removes AI controls; the manual draft stays **fully intact and committable**. *(spec edge case)*

---

## Scenario F — Compose from all four source types *(FR-023a–d, SC-017)*

1. PO Tool → **Feature Composition** (no Jira key — a from-scratch Feature).
2. Add a Confluence page **by URL**; drop a `.xlsx`; paste a note; reference two Jira keys.

**Evidence**:

- ✅ All four appear as referenced sources **alongside** the draft, in one view, without leaving the tab. *(SC-017,
  FR-023)*
- ✅ Each shows its **origin** (page URL / file name / issue key / "pasted"). *(FR-024)*
- ✅ A multi-sheet workbook makes clear **which sheet** is referenced. *(spec edge case)*
- ✅ DoR coaching + a **live** hygiene checklist that updates as you type. *(FR-026, FR-027)*
- ✅ Checks whose field isn't configured on this instance are **absent**, not reported missing. *(FR-028)*
- ✅ **SC-019 bundle check**: `npx vite build`, then confirm SheetJS is **not** in the main chunk (it must be a lazy
  chunk) — proving no initial-load regression and that the dynamic-import pattern held.

---

## Scenario G — Confluence failure taxonomy *(FR-023b, SC-018)*

Attempt to add, in turn: a page id that doesn't exist; a page the configured account can't see; any page with the
VPN **down**; a malformed URL.

**Evidence** — four **distinct, accurate** messages:

- ✅ not found ≠ ✅ no permission ≠ ✅ unreachable/VPN ≠ ✅ malformed.
- ✅ **None** is presented as an empty page or silently swallowed. *(SC-018, INV-J6)*
- ✅ An unreadable/corrupt file (e.g. a PDF renamed `.xlsx`) → clear non-technical message; **draft untouched**.
  *(FR-023a)*

---

## Scenario H — Create vs update *(FR-035/FR-036, SC-012)*

1. From Scenario F's draft (no key), choose a target project and **Commit**.
2. Separately, load an **existing** Feature by key into Composition, enrich it, **Commit**.

**Evidence**:

- ✅ Path 1 **creates** in the chosen project; the resulting key is reported. *(FR-035)*
- ✅ Path 2 **updates that issue** — **no duplicate is created**. *(FR-036, SC-012)*
- ✅ Only instance-reported projects/types were offered. *(FR-037)*
- ✅ **SC-007**: a Feature composed here reaches **zero** hygiene flags at creation — verify by opening it in the
  Hygiene tool immediately after. *(FR-039)*

---

## Definition of done

- [ ] Scenarios A–H pass.
- [ ] INV-1…INV-6 green; `npx vitest run` clean.
- [ ] `npx vite build` clean; SheetJS confirmed out of the main chunk (SC-019).
- [ ] `npm test` (server) still green — this feature changes no server code.
- [ ] Team Dashboard parity re-checked with its **existing tests unedited** (SC-002).
- [ ] `CHANGELOG.md` updated (Article VI).
- [ ] Branch is `feature/017-po-feature-tools` off an up-to-date `main` — **not** the stale `forge/wt-*` worktree
      branch, which the pre-commit hook rejects.

---

## Known non-blocking risk

The team-scoped storage helper's **one-time legacy migration** fires only before any scoped key exists. A PO Tool
reading a *different* profile first could theoretically win that race. Requires a **never-migrated** user opening the
**PO Tool before Team Dashboard**. Accepted (research R1); if it ever surfaces, the fix is to run the migration at
app start rather than first read.
