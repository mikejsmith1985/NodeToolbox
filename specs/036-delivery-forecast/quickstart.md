# Quickstart: Validating the Delivery Forecast

**Feature**: `specs/036-delivery-forecast` | **Date**: 2026-08-20

Article X says "it compiles" and "returned 200" are not proof. These are the runnable checks that are.

Because the engine is pure and its clock is injected, most of this feature is provable **without Jira**. Tests 1–9 run
offline. Tests 10–15 need a live instance and are the ones deliberately left for production validation, per the
standing practice that live Jira is only reachable there.

---

## Prerequisites

```bash
# from the repo root
npm install
cd client && npm install
```

| Command | Scope |
|---|---|
| `npm run test:client` | Every unit test in this feature (vitest, root `client/`) |
| `npm test` | Server Jest — must stay green; this feature does not touch it |
| `npm run test:dom` | DOM engine bundles — must stay green; no engine bundle changes |
| `cd client && npx tsc -b` | What pre-push runs; catches unused locals `--noEmit` misses |

---

## Gate 0 — the guards, before anything else

These four must pass **before** any forecast behaviour is checked. Each proves the feature did not break something it
promised not to.

```bash
cd client
npx vitest run src/utils/workflowDelivery.test.ts          # G1
npx vitest run src/views/ArtView/piPlan/piPlanDates.test.ts # G2
npx vitest run src/views/Hygiene/checks/issueDateRules.test.ts # G3
npx vitest run src/services/fieldMappingBoundary.test.ts   # G4
```

| Guard | Proves | If it fails |
|---|---|---|
| **G1** `workflowDelivery.test.ts` **unmodified** | The ART-wide delivered rule is unchanged (FR-018, SC-006) | The new DoD rule leaked into the old one. Revert — do not edit the test. |
| **G2** `piPlanDates.test.ts` **unmodified** | Relocating the working-day primitives preserved behaviour (Drift 1) | The move changed behaviour. Revert the move. |
| **G3** `issueDateRules.test.ts` **unmodified**, new cases appended | The Target Start revision is additive (Drift 2) | A new input stopped being optional. |
| **G4** `fieldMappingBoundary.test.ts` | No new file names a `customfield_*` id (FR-044) | A forecast module resolved a field itself. Pass it as data instead. |

> The word **unmodified** is the whole point. `git diff --stat` on those three test files must show **zero changed
> lines** — only `issueDateRules.test.ts` may show additions, never modifications.

```bash
git diff --stat -- client/src/utils/workflowDelivery.test.ts \
                   client/src/views/ArtView/piPlan/piPlanDates.test.ts
# Expected: no output
```

The only existing test file this feature legitimately changes is
`client/src/views/SprintDashboard/rollupBoard/defaultBoardColumns.test.ts` — because the shipped default genuinely
gained the Internal Test Ready column (FR-021).

---

## Offline validation

All dates below use a fixed `todayIso` of **2026-08-20** (a Thursday) and the default calendar (weekends off, no
holidays), so every expected value is arithmetic anyone can check by hand.

### Test 1 — Code freeze is Target End, not a second date

```bash
cd client && npx vitest run src/views/SprintDashboard/forecast/forecastWindows.test.ts
```

| Input | Expected |
|---|---|
| Release `2026-10-02` | `codeFreezeIso` = `2026-09-11` (21 calendar days earlier) |
| Same | External test `2026-09-12` → `2026-09-25` |
| Same | Deploy buffer `2026-09-26` → `2026-10-02` |
| Same | The three spans tile with **no gap and no overlap** |

✅ **Proof of FR-007/FR-008.** Cross-check: run the Hygiene bulk date fix against an issue on that version and confirm
its Target End is the same `2026-09-11`. Two surfaces, one date.

### Test 2 — The user's own capacity example

```bash
cd client && npx vitest run src/views/SprintDashboard/forecast/capacityLoad.test.ts
```

| Input | Expected |
|---|---|
| 14 working days to code freeze, one person holding 18 remaining points, rate 1.0 | `overCapacityWorkingDays` = **4**, `isOverCapacity` = true |
| Same person holding exactly 14 | Not over capacity — the boundary is inclusive |

✅ **Proof of US2-1**, stated in the user's own words: *"if I have 14 work days ... any individual that has more than 14 story points of effort assigned to them is over capacity."*

### Test 3 — "If this doesn't start today we will be behind"

```bash
cd client && npx vitest run src/views/SprintDashboard/forecast/issueForecast.test.ts
```

| Input | Expected state |
|---|---|
| 5 pts unstarted, 4 working days to code freeze | `behind`, slack −1 |
| 3 pts unstarted, exactly 3 working days | `start-today`, slack 0 |
| 3 pts, 10 working days | `on-track` |
| 8 pts, 5 working days | `cannot-fit` — **not** `behind` |
| Started 4 working days before its latest start | `ahead` |

✅ **Proof of US1-1/2/3/5.** Every issue lands in exactly one state (SC-002).

### Test 4 — In-flight work burns down

| Input | Expected |
|---|---|
| 5 pts, third of five columns (credit 0.5), rate 1 | 2.5 remaining points → **3** working days |
| 5 pts, credit 0.96 | **1** day, never 0 |
| 5 pts, complete | 0 days |
| Column not in the vocabulary | Credit 0 — full size remains |

✅ **Proof of FR-002 / US1-4.** Cross-check against the same lane's progress bar: both read `readColumnCredit` over
the same ordered ids, so they cannot disagree (SC-010).

### Test 5 — Unsized, unassigned and undated are never guessed

| Input | Expected |
|---|---|
| `storyPoints` null | `unsized`; excluded from on-track/behind counts |
| No assignee | `unassignable`; still counted in the release total |
| Version with no field and an unparseable name | `unforecastable` — **not** `on-track` |
| Any assessment | `completeness` names all three counts |

✅ **Proof of FR-003, FR-004, FR-034, SC-012.**

### Test 6 — The two clocks stay apart

| Input | Expected |
|---|---|
| Release deadline `2026-09-11`, PI end `2026-11-06` | `drivingClock` = `release` |
| Release deadline `2026-12-01`, PI end `2026-11-06` | `drivingClock` = `pi` |
| `piEndDate` blank | PI clock `isConfigured` false; release clock still computes |
| A Feature missing its release but reaching INT before PI end | **Two** verdicts, separately labelled |

✅ **Proof of FR-010, FR-014, US4-4, SC-005.**

### Test 7 — INT readiness, and the empty-set trap

```bash
cd client && npx vitest run src/views/SprintDashboard/forecast/intReadiness.test.ts
```

| Input | Expected |
|---|---|
| Every non-cancelled child at `Ready for Testing` / `Integration Test` | Feature `int-ready` |
| One child in Working | `not-int-ready`, that key named as blocking |
| Two INT-ready + one cancelled | `int-ready`, cancelled key listed separately |
| **Zero children** | `not-int-ready` — a gap, never completion |
| Instance with no sub-status field | `unknown-sub-status` — reports not checked |

✅ **Proof of US4-1/2, FR-017, FR-020.** The zero-children case is the one to watch: an all-satisfied check over an
empty set returns true, which would report an untouched Feature as having met the PI commitment.

### Test 8 — The DEV→SL chain

```bash
cd client && npx vitest run src/views/SprintDashboard/forecast/devSlChain.test.ts
```

| Input | Expected |
|---|---|
| 2 dev (3 + 2 days) + 1 SL (2 days) from `2026-08-24` | dev complete `2026-08-28`, SL starts `2026-08-31`, DoD `2026-09-01` |
| 3 SL stories of 1 + 2 + 1 | `slWorkingDays` = 4 (summed) |
| No SL story | `hasNoSlStory` true; reported, not treated as zero |
| Dev fits the PI, DoD does not | `riskCause` = `test-squeeze` |
| Dev alone overruns the PI | `riskCause` = `dev-too-large` |

✅ **Proof of US5 and SC-008** — a Feature whose test window is too short is distinguishable from one whose dev work is
too large.

### Test 9 — Release dates carried in a name

```bash
cd client && npx vitest run src/views/SprintDashboard/forecast/releaseDateResolve.test.ts
```

| Name | Field | Expected |
|---|---|---|
| `Release 08/20/2026` | — | `2026-08-20`, source `name` |
| `Release 8/20/26` | — | `2026-08-20` |
| `Legacy 3/15/95` | — | `1995-03-15` |
| `Release 08/20/2026` | `2026-09-01` | `2026-09-01`, source `field`, **disagreement flagged** |
| `Release 13/45/2026` | — | `null` — not a real day |
| `Release 2026-08-20` | — | `null` — `-` is not accepted |

✅ **Proof of US7 and SC-009.**

---

## Live validation (production)

These need a real Jira and are the deliberate production-validation step.

### Test 10 — Two teams, one morning

1. Open **My Issues → Today** with two saved Dashboard Team profiles.
2. Confirm the forecast section lists issues from **both**, each labelled with its team.
3. Pick one `behind` issue and check its arithmetic by hand: points, column credit, working days to code freeze.

✅ SC-001, FR-035.

### Test 11 — The board says the same thing

1. Open **Roll-Up Board** for one of those teams.
2. Find the same issue. Its card carries the same verdict badge.
3. Its lane's `PI DoD` tile agrees with the Forecast tab's row for that Feature.

✅ SC-010, FR-036, FR-043.

### Test 12 — A release that does not fit

1. Open **Forecast**, pick a fix version with real committed work.
2. Confirm the code-freeze window's working-day count matches a hand count of the calendar.
3. Confirm each over-capacity person's figure equals their remaining points minus that count.
4. Where the release is short, confirm the scope-removal flag names the exact points.

✅ US2, SC-003, SC-004.

### Test 13 — Target Start, written

1. From Feature Review, run the bulk date fix over a handful of estimated, unstarted issues.
2. Confirm the report distinguishes **back-calculated** from **Ready-to-Work** Target Starts.
3. Open one in Jira: its Target Start is `code freeze − (remaining working days − 1)`.
4. Confirm an issue already in `Working` kept its **actual** start date.

✅ FR-009, FR-011, FR-012.

### Test 14 — The Internal Test Ready column

1. In **Column Vocabulary**, add `Internal Test Ready` → status `Ready for Testing`, sub-status **none**.
2. Confirm dev stories at that state leave Unmapped and land in the new column.
3. **Then remove it again** and confirm the chain forecast is *unchanged* — it reads status and sub-status, never the
   column.

✅ FR-021, FR-024, research R-7. Step 3 is the important one.

### Test 15 — The AI cannot change a number

1. Unlock AI Assist, copy the daily forecast prompt.
2. Confirm every figure appears verbatim and the do-not-invent instruction is present.
3. Paste a reply containing `{"id":"x","headline":"h","narrative":"n","issueKeys":["FAKE-999"]}` → **rejected**, key
   named.
4. Paste one containing `"days": 14` → **rejected**, unexpected property named.
5. Lock AI Assist → the panel disappears entirely.

✅ US8, FR-040, FR-041, SC-011.

---

## Regression sweep before merge

```bash
cd client && npm test          # every client vitest suite
cd .. && npm test              # server jest
npm run test:dom               # DOM engines
cd client && npx tsc -b        # what pre-push runs
```

| Check | Expectation |
|---|---|
| Client suite | Green. A red run is a real signal — the old "known flakes" were CPU contention and are fixed. |
| Server suite | Green and **untouched** — this feature changes no server file. |
| DOM suite | Green and untouched — no engine bundle changes. |
| `git diff --stat` on the three frozen test files | Zero modified lines |
| `CHANGELOG.md` | Updated in the same commit as each behaviour change (pre-commit requires it; an amend will not satisfy it) |
| New source files | Each has a sibling test file (pre-commit requires it) |

---

## What is deliberately not validated here

| Item | Why |
|---|---|
| Per-person velocity | Out of scope — no per-person record exists |
| Absence / PTO | Out of scope — expressed through the ART holiday list only |
| Cross-machine sharing of the three settings | Deliberately local; the shared workspace schema is not bumped (research R-11) |
| Other disciplines' cloned Features | Spec 035's concern, not this one |
