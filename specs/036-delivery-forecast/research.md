# Phase 0 Research: Delivery Forecast

**Feature**: `specs/036-delivery-forecast` | **Date**: 2026-08-20

Every finding below was verified against the code on this branch, not inferred. File and symbol names are the
evidence; they are the input to the Framework-First gate in `plan.md`.

---

## R-1 — The in-flight workstream, and what it demands of this feature

**Decision**: New modules resolve **no** Jira field ids themselves. Every logical field arrives as a parameter, or is
resolved by the caller through `services/jiraFieldMapping.ts`.

**Rationale**: `chore/migrate-field-id-debt-2` is the active rebase the user warned about. It landed three things this
feature must not undo:

| Commit | What it centralised | Guard |
|---|---|---|
| `7ff1ab3` | Story points → `jiraFieldMapping.ts`, synchronous `resolveConfiguredFieldIds` | `services/fieldMappingBoundary.test.ts` |
| `81db974` | ART settings → `services/artSettingsStore.ts`; PI field joins the mapping | same |
| `e6b369c` | One `SharedArtWorkspacePayload` type, with a **compiler-enforced** team-field merge list | build failure |
| `c03d4da` | `featureLink` and `artFeatureScopeSettings` migrated to the mapping | same |

`fieldMappingBoundary.test.ts` is a **ratchet, not an allow-list**: its debt lists may only shrink, and it fails on
**any new file** naming a story-points, PI, Feature Link or settings-key id. A new forecast module that reads
`customfield_10236` would fail the suite on the day it is written.

**Consequence for the design**: the pure engine modules take `storyPoints: number | null` as data — they never look a
field up. The three impure edges (Today scan, board fetch, Forecast tab) already resolve those ids today and pass them
down.

**Alternatives rejected**: adding the new files to the debt list. That list only shrinks by construction, and adding to
it is the regression the test was written to catch.

---

## R-2 — Code freeze already exists; do not invent a second one

**Decision**: Code freeze **is** Target End. Name it, do not recompute it.

**Rationale**: `client/src/views/Hygiene/checks/issueDateRules.ts` holds `TARGET_END_LEAD_DAYS = 21` and derives
`targetEnd = releaseDay − 21 calendar days`. The user's "code freeze 3 weeks prior to the release date" is the same
date, already computed, already written to Jira, already shown by Hygiene and Feature Review.

**Alternatives rejected**: a `codeFreeze.ts` computing it independently. Two modules deriving the same date is exactly
the divergence class this codebase has spent four commits eliminating.

---

## R-3 — How Target Start is derived today, and the seam for revising it

**Decision**: Extend `IssueDateInput` with **optional** fields and extend `deriveIssueDates` in place. Optional keeps
every existing caller and every existing test byte-identical.

**Current rule** (`issueDateRules.ts:136-139`):

```
targetStart = workingDay ?? (readyToWorkDay + 3 calendar days) ?? null
```

**Revised rule**:

| Precedence | Source | When it applies |
|---|---|---|
| 1 | the day the issue entered `Working` | whenever it exists — a fact beats a prediction (FR-011) |
| 2 | `min(targetEnd, piDodDeadline) − (remainingWorkingDays − 1)` working days | when remaining effort is known (FR-009, FR-010) |
| 3 | `readyToWorkDay + 3` calendar days | unchanged fallback when effort is unknown |
| 4 | `null` with a stated reason | unchanged |

The new inputs are `remainingEffortWorkingDays?: number | null`, `piDodDeadlineIso?: string | null`, and
`workingCalendar?: WorkingCalendar`. All three optional; absent, precedence 2 is skipped and behaviour is today's
behaviour exactly.

**Why in place rather than beside**: the module's own header states why it exists — *"those three would otherwise each
carry their own copy and drift"*. FR-013 makes that binding.

**Write path**: `client/src/views/Hygiene/derivedDateFix.ts` already plans and applies writes through
`saveFeatureReviewSimpleField`, fetches the changelog once per issue for both status entries, and separates
`failures` from `undecided`. `planDerivedDateWrites` gains the same three optional arguments and passes them through.

---

## R-4 — Remaining effort: the credit rule already exists

**Decision**: Remaining effort = `points × (1 − readColumnCredit(columnId, orderedColumnIds))`, reusing
`rollupBoard/featureProgress.ts` unchanged.

**Rationale**: `readColumnCredit` already derives credit from the team's own column order — column 5 of 10 is halfway
through their workflow by their own definition. It returns `0` for a column outside the vocabulary (Unmapped), which
is the correct conservative answer for unplaced work.

**Signature**: `readColumnCredit(columnId: string, orderedColumnIds: readonly string[]): number`

**Where the ordered ids come from**: the team's `BoardVocabulary` columns, already sorted by `order`, already used by
`computeFeatureProgress`.

**Alternatives rejected**: a per-status weight table. It would need configuring twice, and would disagree with the
progress bar drawn immediately above it.

---

## R-5 — Both surfaces already fetch what the forecast needs; one field is missing

| Field | Roll-Up Board (`rollupBoardFetch.BASE_ISSUE_FIELDS`) | Today / Hygiene (`hygieneScan.BASE_HYGIENE_FIELDS` + config) |
|---|---|---|
| `fixVersions` | ✅ | ✅ |
| story points | ✅ (`scope.storyPointsFieldIds`) | ✅ (`resolveStoryPointsFieldIds`) |
| `status` | ✅ | ✅ |
| sub-status | ✅ (`scope.subStatusFieldId`) | ❌ **missing** |
| Target Start / Target End | — | ✅ (`fieldConfig.targetStart/EndFieldIds`) |
| `assignee` | ✅ | ✅ |

**Decision**: add `...fieldConfig.subStatusFieldIds` to `buildRequestedHygieneFields` in
`client/src/views/Hygiene/hooks/hygieneScan.ts`.

**Rationale**: `loadHygieneFieldConfig` **already discovers** `subStatusFieldIds` by name (`Sub-Status`, `Sub Status`,
`Substatus`) — it is simply never requested. Without it, Today cannot evaluate INT-ready. Requesting an extra field is
additive and harmless: Jira ignores a field id that does not exist on the instance.

**Cost**: one line. **Risk**: a marginally larger response per issue.

---

## R-6 — The two DoD rules must coexist without touching each other

**Decision**: A new `intReadiness.ts` exports the INT-ready predicate. `utils/workflowDelivery.ts` is **not modified**;
`intReadiness.ts` imports its status-name constants so the two rules share one vocabulary without sharing a verdict.

**Rationale**: `workflowDelivery.ts` declares the ART-wide rule in its own header — *"an issue is DELIVERED once its
current status is 'Ready for QA' or later"* — and drives predictability, the monthly delivery report and flow metrics.
The user's PI DoD is a **different, earlier** line: `Ready for Testing` + sub-status `Integration Test`.

`INTERNAL_TESTING_STATUS_NAME = 'Ready for Testing'` is already exported from `workflowDelivery.ts`. The sub-status
value `'Integration Test'` is already a constant of the board vocabulary (`defaultBoardColumns.ts:26`).

**How FR-018 is proved**: `workflowDelivery.test.ts` must pass **unmodified**. If one assertion needs editing, the
delivered rule changed and the change must be reverted, not the test adjusted. This is the 026 precedent
(`personalFlow.test.ts`'s 35 tests) applied here.

**Alternatives rejected**: a `deliveredAt` parameter on the existing rule. It would make every current caller pass an
argument choosing between two meanings, which is how a metric silently changes.

---

## R-7 — "Internal Test Ready" is currently unmapped

**Finding**: `defaultBoardColumns.ts` maps `Ready for Testing` **only** with a sub-status — `Testing` (SL),
`Integration Test` (INT), `Ready for UAT` (BT). `Ready for Testing` with a **null** sub-status matches no column and
lands in `UNMAPPED_COLUMN_ID`.

This is the state the DEV→SL chain depends on: dev complete, deployed to the Dev environment, awaiting SL test.

**Decision**: add `['Internal Test Ready', 'Ready for Testing', null]` to `DEFAULT_COLUMN_DEFINITIONS`, positioned
after Code Review and before SL Testing.

**Critical nuance** (spec FR-021): the file's own header states *"once a team has saved its own set this file is never
consulted again for them."* So this change helps **fresh installs only**. The operator adds the column to their saved
vocabulary through the existing `ColumnVocabularyEditor` — which they have confirmed they will do.

**Consequence**: the chain logic must **not** depend on that column existing. It reads status + sub-status directly, so
a team without the column still gets a correct forecast; they simply see the card in Unmapped.

---

## R-8 — Feature over-size: half of it already exists

**Finding**: `piPlan/piPlanCapacityFlags.ts` exports `detectDefectUndersize`, which already compares a Feature's own
points against its children's summed points — but only for Features whose summary matches `/\bdefects?\b/i`.

**Decision**: write `featureSizing.ts` as the general rule and leave `detectDefectUndersize` alone. The defect-bucket
rule has a different **meaning** (a budget bucket overrunning), a different surface (PI Delivery Plan), and a
different consumer. Generalising it in place would change the PI planner's output.

**Alternatives rejected**: extracting a shared core. The two differ in which children they count (FR-029 excludes
sub-tasks; the defect rule does not) and in tolerance. A shared core with two behaviour flags is harder to read than
two small rules.

---

## R-9 — No fix-version name parsing exists anywhere

**Finding**: `grep releaseDate` across `client/src` returns 30 hits, every one reading the `releaseDate`
**field**. Nothing reads a date out of a version **name**.

**Decision**: new pure module `releaseDateResolve.ts`.

**Accepted name formats** (FR-032): `M/D/YY`, `M/D/YYYY`, `MM/DD/YY`, `MM/DD/YYYY`, appearing anywhere in the name.

| Rule | Value |
|---|---|
| Century window | `00`–`79` → `20xx`; `80`–`99` → `19xx` |
| Order | Always month/day/year (US), per the stated convention |
| Multiple matches in one name | The **first** match wins, and the ambiguity is reported |
| Field present | Field wins; a disagreement is reported (FR-033) |
| Neither yields a date | `undated`, and its issues are unforecastable (FR-034) |
| Invalid calendar date (`13/45/2026`) | Not a match; treated as no date in the name |

**Existing precedent to follow**: `utils/calendarDate.ts` (`readCalendarDay`, `toCalendarDay`) already owns
day-not-instant reading, and `issueDateRules.ts` documents the Jira UTC-midnight trap. The new parser returns a
`YYYY-MM-DD` day string, never a `Date`.

**Reuse for the version list**: `piPlan/piPlanReleaseSchedule.ts` exports
`fetchPiWindowFixVersions(projectKey)` → `/rest/api/2/project/{key}/versions`. The Forecast tab's version picker uses
it, satisfying the standing "pick, don't type" rule with Jira's own list.

---

## R-10 — Working-day arithmetic already exists, in the wrong place

**Finding**: `piPlan/piPlanDates.ts` exports `isWorkingDay`, `rollToWorkingDay`, `addWorkingDays` and
`workingDaysBetween`, all pure, all UTC string-in/string-out, all calendar-injected. `WorkingCalendar`
(`piPlanTypes.ts`) is `{ weekendDays: number[]; holidayIsoDates: string[] }`.

**Problem**: it lives under `views/ArtView/piPlan/`, and this feature's consumers are `views/Hygiene`,
`views/MyIssues` and `views/SprintDashboard`. A cross-view import from Hygiene into ArtView/piPlan would couple the
date policy to the PI planner.

**Decision**: **move** the four primitives and the `WorkingCalendar` type to `client/src/utils/workingDays.ts` and
have `piPlanDates.ts` re-export from there. `piPlanDates.test.ts` must pass **unmodified** — if it needs editing, the
move changed behaviour and must be reverted.

**Alternatives rejected**: (a) duplicating the arithmetic — four copies of a weekend rule is precisely R-1's failure
mode in a different dress; (b) importing from `piPlan` — a layering inversion that makes Hygiene depend on the PI
planner.

**Holiday list today**: every caller passes `holidayIsoDates: []`. Three separate files declare their own
`DEFAULT_WORKING_CALENDAR`. FR-006 gives them one source.

---

## R-11 — Where the three new settings live

**Decision**: all three go in `tbxARTSettings` via `services/artSettingsStore.ts`. **Nothing** is added to
`SharedArtWorkspaceSettingsRecord`.

| Setting | Default | Validation |
|---|---|---|
| `pointsPerWorkingDay` | `1` | rejected at `<= 0` (FR-001) |
| `holidayIsoDates` | `[]` | each entry a `YYYY-MM-DD` day |
| `featureSizingTolerancePercent` | `0` | rejected below 0 |

**Rationale**: `artSettingsStore.ts` is the module the active workstream just created to be the one reader, with a
stated defaulting policy (shipped defaults for things "this machine has not been told", empty for things a guess
would corrupt). These three are the former.

**Why NOT the shared workspace**: spec 034 recorded the hazard directly — bumping the workspace schema makes
`loadSharedArtWorkspace` **hard-reject the whole workspace** on older clients (`confluenceApi.ts:375`). No requirement
asks for these to be shared. Keeping them local costs nothing and avoids the failure entirely.

---

## R-12 — PI window: end is available, start is not (client-side)

**Finding**: `ArtSettings.piEndDate` is in `tbxARTSettings` and readable synchronously. `piStartDate` exists **only**
in the server-side `ArtSettingsConfig` (`AdminHub/hooks/useAdminHubState.ts:90`, surfaced at `AdminHubView.tsx:422`),
not in the localStorage store.

**Decision**: the PI clock needs only **PI end** — the DoD deadline is the PI's last day. PI start is used for
display ("N of M working days elapsed") and is therefore **optional**: read it from the Admin config where already
loaded, omit the elapsed figure where not.

**Blank `piEndDate`** → the PI clock reports **not configured** (spec edge case) and only the release clock computes.
It never falls back to a guess.

---

## R-13 — Where the forecast is shown, and what must not be touched

| Surface | File | Insertion | Size guard |
|---|---|---|---|
| Today | `MyIssues/Today/TodayDashboard.tsx` + `hooks/useTodayDashboard.ts` | new `ForecastSection` beneath the category cards; hook returns one new field | hook already scans every saved profile — no new fetch loop |
| Board lane | `rollupBoard/laneVitals.ts` `buildLaneVitalTiles(vitals, counts)` | **optional third parameter** appends 2 tiles | existing tests unchanged |
| Board card | `rollupBoard/components/ChildCard.tsx` | **optional** `forecast?: IssueForecast \| null` prop | omitted ⇒ byte-identical (022/017 precedent) |
| Forecast tab | new `SprintDashboard/forecast/ForecastTab.tsx` | new `TAB_OPTIONS` entry + `DashboardTab` union member | own file, mounted like `RollupBoardTab` |

**Hard rule**: `RollupBoardTab.tsx` is **2,694 lines** and `SprintDashboardView.tsx` is **~6,800**. Neither is
refactored by this feature. The board tab receives a computed forecast and passes it down; the dashboard view gains a
tab entry and a mount. `ReleasesTab` (an inline function at `SprintDashboardView.tsx:5608`) is **not** touched — it is
a release-radar and AI-release-notes surface with no capacity concern.

---

## R-14 — The AI shell is already generic and already gated

**Decision**: reuse `views/ReportsHub/ReportAiPanel.tsx` for all three narratives.

**Rationale**: its props are exactly the contract this feature needs — `title`, `prompt`, `ingestLabel`, `onIngest`,
`error`, `hint`, `children` — and it renders **nothing at all** when AI Assist is locked, satisfying US8 scenario 4 by
construction. `utils/extractJsonPayload.ts` already tolerates fenced and prose-wrapped replies.

**The `{kind, items[]}` envelope** is the established shape across `piPlan`, `piReview`, `hygiene`, `composition` and
`readiness`. Three new kinds: `forecastDaily`, `forecastScopeCut`, `forecastTestCapacity`.

**FR-040 (numeric rejection)** is enforced on ingest: each item carries `issueKeys: string[]` and a prose `narrative`,
and **no numeric field at all**. A reply is rejected when it names a key the prompt did not supply. The AI is
structurally unable to change a number because there is nowhere in the schema to put one.

**Standing constraint from memory**: `poToolWithoutAi.test` scans PO Tool copy for AI words — the PO Tool is not a
surface this feature touches, so it is unaffected, but no AI copy may leak into shared components either.

---

## R-15 — DEV / SL classification signals

| Signal | Evidence it is real | Precedence |
|---|---|---|
| `[SL]` summary prefix | `piPlanJira.ts:21` and `piDeliveryJira.ts:16` both **write** `'[SL] SL Test'`; `piReviewDeliveryDates.ts` already reads `[SL]`/`[INT]` sub-task stubs | 1 |
| `[DEV]` summary prefix | `Hygiene/featureLinkInheritance.ts:3` documents the convention: *"the team splits one piece of work into a [DEV] story and an [SL] test story and links them"* | 1 |
| assignee `roleCapabilities.canInternalTest` | `StandupRosterMember.roleCapabilities`; `carryoverEstimateFetch.ts:68` already classifies by it | 2 (only when no prefix) |
| neither | — | reported `unclassified`, scheduled as dev (FR-023) |

**Matching rule**: case-insensitive, anchored at the start of the trimmed summary, bracket-delimited — so
`[SL] Verify enrolment` matches and `Add SLA banner` does not.

---

## R-16 — Test layers and the commit gate

| Layer | Command | Applies to |
|---|---|---|
| Client unit | `npm run test:client` (vitest, root = `client/`) | every new pure module |
| Server unit | `npm test` (jest) | untouched by this feature |
| DOM | `npm run test:dom` | untouched — no engine bundle changes |

**Boundary suite**: `client/src/services/fieldMappingBoundary.test.ts` runs inside the client vitest suite and sweeps
`client/src`. It is the gate R-1 describes.

**Pre-commit hook** (recorded practice): blocks a commit that adds a source file without a matching test file, or that
changes behaviour without a `CHANGELOG.md` entry in the same commit. Every task that creates `X.ts` creates
`X.test.ts`; the CHANGELOG entry lands in the same commit, not an amend.

**Pre-push**: `tsc -b`, which catches unused locals that `--noEmit` misses.

---

## Resolved unknowns

| Unknown from Technical Context | Resolution |
|---|---|
| Does the codebase already convert points to duration? | Yes — `piPlanDates.effortToWorkingDays`, but private and PI-planner-scoped. The forecast needs its own public form (R-10). |
| Is there an existing per-person capacity check? | `FeatureCanvas/planner/capacityPlanner.buildCapacityPlan` plans **future** sprints from velocity. It does not assess **current** assigned load against a deadline. Different question; not reusable here. |
| Does anything already compute "days remaining"? | `ArtView.tsx:1353 computeDaysRemainingInPi` — **calendar** days, for release urgency colouring. Not working days. Not reusable. |
| Where do ordered column ids come from outside the board? | Only from the board's saved `BoardVocabulary`. Today and the Forecast tab must load it via `boardVocabularyStore` for the same team, or fall back to zero credit — stated, never guessed. |
| Is `piEndDate` reachable client-side? | Yes, `artSettingsStore.readArtSettings().piEndDate` (R-12). |
