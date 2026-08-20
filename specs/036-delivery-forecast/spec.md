# Feature Specification: Delivery Forecast — points-based schedule, capacity and PI Definition of Done

**Feature Branch**: `feature/036-delivery-forecast`

**Created**: 2026-08-20

**Status**: Ready for planning

**Input**: User description: "I need to take the story points into account for how long it should actually take
something to finish so that we can build out a daily forecast as part of the 'Today' tab of 'My Issues'. In addition I
need the roll-up board to have a mechanism added to track this also. The idea is everything basically is looked at from
the window of the PI date range, then inside the release date range... We want to 'code freeze' 3 weeks prior to the
release date... There are 2 weeks dedicated to external testing... while I have to monitor and deliver work to a
production release the DoD for the PI is that the features make it to Integrated test... So I need the ability at any
moment to look at either of my teams and tell them 'If these issues don't start today we will be behind'."

## Context

The Toolbox already knows three dates for every delivery issue and writes them consistently: the date policy sets
**Due Date** = the driving fix version's release date, **Target End** = three weeks before it, and **Target Start** =
the day the issue entered `Working`, or three days after it reached `Ready to Work`.

Those dates describe a **policy**. They do not describe **whether the work fits**.

Nothing in the product currently answers the question the Scrum Master is actually asked every morning:

> *Given how big this work is, who is holding it, and how many working days are left — can it land on time?*

That gap has two distinct deadlines behind it, and conflating them is the single largest source of confusion in the
delivery model:

| Clock | Deadline | What it measures | Consequence of missing it |
|---|---|---|---|
| **Release clock** | The fix version's release date | Can this work be built, code-frozen, externally tested and shipped? | A production release slips or ships short |
| **PI clock** | The end of the Program Increment | Can this Feature reach **Integrated Test**? | A PI commitment is missed |

The two do not coincide. A Feature can satisfy the PI commitment and still miss its production release, or make the
release while the PI commitment is at risk. The team is *measured* on the PI clock and *operates* on the release clock.

**Target End already is the code freeze.** The existing three-week lead before the release date is the same date this
specification calls code freeze. This feature names it; it does not invent a second one.

The Roll-Up Board already holds everything the forecast needs about each item: its story points, its fix versions, its
assignee, its column position, and its status/sub-status pair. The Today tab already audits a Scrum Master across every
saved Dashboard Team profile. Neither surface currently does any arithmetic with those numbers.

This feature adds that arithmetic — once, in one place — and shows it on both surfaces.

## Clarifications

### Session 2026-08-20

**Capacity arithmetic**

- Q: How do story points become working days? -> A: A configurable **points-per-working-day rate, defaulting to 1.0**,
  so fourteen working days to code freeze means a person holding more than fourteen points is over capacity.
- Q: Does work already in flight burn down? -> A: **Yes.** Remaining effort = points x (1 − column credit), reusing the
  Roll-Up Board's existing column-credit rule. Counting an almost-finished story at full size makes every board look
  permanently over capacity.
- Q: What happens to unestimated issues? -> A: They are **never assigned an assumed size**. They are counted and
  reported as a named "unsized — forecast incomplete" figure printed beside every number they could have changed.
- Q: What happens to unassigned issues? -> A: Flagged separately as "no owner — cannot be forecast", and also counted
  into the team total. They never draw silently against a shared pool.
- Q: Does a person's capacity account for work outside the reported scope? -> A: **Yes.** All their assigned open work
  is counted, with the in-scope portion shown separately, so nobody looks free while drowning in another release.

**Target Start revision**

- Q: What should Target Start become? -> A: The **latest day the work can start and still finish on time** — the
  deadline minus the working days its remaining effort implies.
- Q: Which deadline drives it? -> A: **Both the code-freeze deadline and the Feature's PI DoD deadline; the earlier of
  the two wins**, because the tighter commitment is the one that bites.
- Q: Does the real `Working` entry date still win once it exists? -> A: **Yes.** A fact always beats a prediction. The
  back-calculated date then becomes the *should-have-started* comparison that produces the behind-schedule signal.
- Q: Is the revised Target Start written to Jira? -> A: **Yes**, through the existing bulk date-fix path, and stated
  plainly rather than written silently.
- Q: Is it acceptable to change the shared date-policy module in place? -> A: **Yes.** That module exists so Hygiene,
  Feature Review and the AI prompt cannot drift; a parallel rule would be the exact defect it was built to prevent.

**The two clocks**

- Q: Confirm the release clock windows? -> A: Code freeze = release minus 3 weeks; the 2 weeks after code freeze are
  external test; the final 1 week before release is deploy/cutover buffer with no testing in it.
- Q: Are the release forecast and the PI forecast shown together? -> A: **Side by side, always, each labelled.** Hiding
  either recreates the confusion this feature exists to end.
- Q: What is "ahead" or "behind" measured against? -> A: The **freshly computed forecast**. Where the stored Jira date
  disagrees with it, that disagreement is itself reported.
- Q: Are holidays modelled? -> A: **Yes**, as an ART-level holiday list defaulting to empty. Without it every December
  forecast is wrong.

**Definition of Done**

- Q: Does the PI DoD replace the ART-wide "delivered = Ready for QA" rule? -> A: **No — it sits beside it under a
  distinct name.** "Delivered" keeps its meaning for predictability, the monthly delivery report and flow metrics;
  "INT-ready" is the new PI-commitment rule. Both must come from **one shared module**, never two copies.
- Q: `Ready for Testing` with no sub-status ("Internal Test Ready") is not a board column today. -> A: The operator
  **adds that column to their own board vocabulary**. A team that has saved a vocabulary never re-consults the shipped
  defaults, so this is an operator action, not a code change; the shipped defaults gain it for fresh installs.
- Q: Are Cancelled issues in scope? -> A: **Excluded** from capacity and from DoD, but counted and named — never
  silently dropped.
- Q: Does a Feature reach DoD when all children are INT-ready? -> A: All **non-cancelled** children.

**The DEV to SL chain**

- Q: Confirm the chain? -> A: The SL story cannot start until **every** `[DEV]` story on the Feature is Internal Test
  Ready; the SL story then burns its own points; the Feature then moves to Integration Test.
- Q: How are DEV and SL work identified? -> A: The `[DEV]` / `[SL]` **summary prefix** is primary — it is the team's
  actual convention and the PI planner already writes it. The assignee's roster role capabilities are a secondary
  signal used only when no prefix is present.
- Q: A story with neither marker? -> A: **Reported as unclassified** and treated as dev for chain purposes. Guessing
  silently is how a chain forecast goes quietly wrong.
- Q: Multiple SL stories on one Feature? -> A: **Summed** (serial), which is the safe direction for a deadline; where
  they are held by different people, the per-person capacity check catches the parallelism.
- Q: Do defects and tasks gate DoD? -> A: **Yes** — every non-cancelled child of the Feature does.

**Feature sizing**

- Q: What tolerance applies to children outgrowing the Feature estimate? -> A: **Configurable, defaulting to 0%** — any
  excess flags — with the overage shown as both points and percentage.
- Q: Which children count toward the sum? -> A: **Stories, defects and tasks — not sub-tasks**, whose points would
  double-count their parent.
- Q: An unsized Feature? -> A: Flagged as "not sized", never as over-size, mirroring the existing defect-bucket rule.

**Release dates and surfaces**

- Q: Where does the release date come from? -> A: The fix version's **release-date field first**; the release date
  parsed out of the **fix version name** only when the field is empty.
- Q: What if field and name disagree? -> A: The **field wins and the disagreement is flagged** — a version name that
  lies about its own date is a real data defect worth naming.
- Q: Two-digit years? -> A: 00–79 read as 20xx, 80–99 as 19xx.
- Q: What is the Today tab's scope? -> A: **Every saved Dashboard Team profile**, matching what Today already does, so
  the Scrum Master can address either team without switching.
- Q: How does the Roll-Up Board show it? -> A: **Lane vital tiles and per-card badges** — the board's value is that the
  answer sits where the work is.
- Q: Where does the release-level report live? -> A: A **new Forecast tab on the Team space**, beside the Roll-Up
  Board. The PI Delivery Plan tab is a planning surface; this is a monitoring one.

**AI assistance**

- Q: Which AI prompts? -> A: Three — a daily who-is-behind narrative, a scope-cut recommendation for an over-capacity
  release, and a test-capacity mitigation for the external-test window. Each propose-only, gated, copy-prompt and
  paste-reply, per-item accept.
- Q: What may the AI produce? -> A: **Narrative and mitigation only.** Every date, point value, capacity figure and
  flag is rule-derived. Anything numeric in a reply is rejected on ingest.

## User Scenarios & Testing

### US1 — Tell a team, this morning, what has to start today (P1)

A Scrum Master opens the **Today** tab. Beside the existing action cards is a **daily forecast** covering every saved
Dashboard Team. For each open issue it shows the latest day work can begin and still land on time, and marks the ones
whose day has arrived or passed.

**Why this priority**: This is the sentence the user asked for verbatim — *"if these issues don't start today we will
be behind"*. Everything else in this feature supports it.

**Acceptance scenarios**

1. **Given** an issue of 5 points, unstarted, whose code-freeze deadline is 4 working days away, **When** the forecast
   runs, **Then** it is marked **behind** and names the shortfall in working days.
2. **Given** an issue of 3 points, unstarted, whose deadline is exactly 3 working days away, **When** the forecast
   runs, **Then** it is marked **start today**.
3. **Given** an issue of 3 points whose deadline is 10 working days away, **When** the forecast runs, **Then** it is
   marked **on track** and shows the latest start date.
4. **Given** an issue already in a late column with most of its credit earned, **When** the forecast runs, **Then**
   only its remaining effort is charged and it is **not** reported as behind on the strength of its original size.
5. **Given** an issue that has reached its status well ahead of what its forecast predicted, **When** the forecast
   runs, **Then** it is marked **ahead of schedule** with the number of days gained.
6. **Given** a Scrum Master with two saved team profiles, **When** the forecast runs, **Then** both teams' issues
   appear, each attributed to its team.
7. **Given** an issue with no story point estimate, **When** the forecast runs, **Then** it appears in an explicit
   **unsized** group and is excluded from the on-track / behind counts rather than guessed at.

### US2 — See whether a release can actually be built in the time left (P1)

On a new **Forecast** tab, the operator picks a fix version. The tab shows, for the window between today and that
version's code freeze: the working days available, the remaining points, the per-person load, and who is over capacity.

**Why this priority**: This is the decision that triggers scope removal, and it must be answerable before code freeze,
not at it.

**Acceptance scenarios**

1. **Given** 14 working days remain to code freeze and a person holds 18 remaining points at a rate of 1.0, **When**
   the report runs, **Then** that person is **over capacity by 4 days** and is named.
2. **Given** the release's total remaining points exceed the summed capacity of everyone assigned to it, **When** the
   report runs, **Then** a **remove scope** flag is raised with the overage in points and days.
3. **Given** issues on the release with no assignee, **When** the report runs, **Then** they appear under **no owner —
   cannot be forecast** and are also included in the release total.
4. **Given** a person also holds work on a different release, **When** the report runs, **Then** their total load and
   their in-scope load are shown separately.
5. **Given** the code freeze date has already passed, **When** the report runs, **Then** the report says so rather than
   computing a negative window.

### US3 — See whether external test can absorb what is coming (P1)

The same tab reports the **external test window** — the two weeks after code freeze — against the test effort of the
issues bound for that release.

**Why this priority**: The user named this as an explicit, separately-actionable flag: adjust scope, or add testers.

**Acceptance scenarios**

1. **Given** test effort exceeding what the assigned testers can complete in the two-week window, **When** the report
   runs, **Then** a flag is raised naming both remedies — reduce scope, or add test resource — with the shortfall.
2. **Given** the final week before release, **When** the report runs, **Then** it is shown as deploy buffer and no test
   capacity is credited to it.

### US4 — Know whether a Feature will meet the PI commitment (P1)

For every Feature on the Roll-Up Board, the operator can see whether all of its non-cancelled work can reach
`Ready for Testing` / `Integration Test` before the PI ends — the PI Definition of Done — independently of any release
date.

**Why this priority**: This is what the team is measured on, and it is the clock the current product cannot see at all.

**Acceptance scenarios**

1. **Given** a Feature whose every non-cancelled child is at `Ready for Testing` / `Integration Test`, **When** the
   forecast runs, **Then** the Feature is reported **INT-ready** and eligible to move to Integrated Test.
2. **Given** a Feature with one child still in an earlier column, **When** the forecast runs, **Then** the Feature is
   **not** INT-ready and that child is named as the thing holding it.
3. **Given** a Feature whose remaining work cannot fit in the working days left in the PI, **When** the forecast runs,
   **Then** it is flagged **at risk of missing PI DoD** with the shortfall in days.
4. **Given** a Feature that will miss its release date but can reach INT before PI end, **When** the forecast runs,
   **Then** the two verdicts are shown **side by side and differently labelled**, not merged.
5. **Given** the ART-wide "delivered" metric on other surfaces, **When** this feature ships, **Then** those surfaces'
   numbers are unchanged — INT-ready is an additional rule, not a redefinition.

### US5 — Account for the DEV to SL test chain (P1)

The Feature-level forecast understands that testing cannot begin until development finishes: the `[SL]` story's own
effort is scheduled **after** the last `[DEV]` story reaches Internal Test Ready.

**Why this priority**: The user named this as the failure that catches teams out — dev finishes on time and the Feature
still misses DoD, because the test that follows it was never in the plan.

**Acceptance scenarios**

1. **Given** a Feature with two `[DEV]` stories and one `[SL]` story, **When** the forecast runs, **Then** the SL
   effort starts after the later dev story reaches Internal Test Ready, and the Feature's DoD date reflects both.
2. **Given** dev work that fits the PI but leaves too few days for the SL story, **When** the forecast runs, **Then**
   the Feature is flagged at risk and the reason names the test squeeze, not the dev work.
3. **Given** a Feature with several `[SL]` stories, **When** the forecast runs, **Then** their effort is summed.
4. **Given** a story carrying neither marker, **When** the forecast runs, **Then** it is listed as **unclassified** and
   treated as dev work for the chain.
5. **Given** a Feature with no `[SL]` story at all, **When** the forecast runs, **Then** that absence is reported
   rather than treated as zero test effort.

### US6 — Catch a Feature that was sized wrong (P2)

Where the summed points of a Feature's stories, defects and tasks exceed the Feature's own estimate, the Feature is
flagged, with the overage in points and percent.

**Why this priority**: The user's stated reason for wanting it — stories are built out through the PI, so a mis-sized
Feature is only discoverable after the fact, and only if something is watching.

**Acceptance scenarios**

1. **Given** a Feature estimated at 20 points whose children total 34, **When** the scan runs, **Then** it is flagged
   with an overage of 14 points (70%).
2. **Given** a Feature with no estimate, **When** the scan runs, **Then** it is reported **not sized**, never
   over-size.
3. **Given** children carrying sub-tasks with their own points, **When** the scan runs, **Then** sub-task points are
   excluded from the sum.
4. **Given** a configured tolerance above zero, **When** the scan runs, **Then** only Features exceeding it flag.

### US7 — Read a release date the fix version does not state cleanly (P2)

Where a fix version has no release-date field set, the release date is read from the version **name**, which by
convention carries it. Where both exist and disagree, the field wins and the disagreement is reported.

**Why this priority**: Without it, every release whose date lives only in its name silently drops out of the forecast.

**Acceptance scenarios**

1. **Given** a version named `Release 08/20/2026` with no release-date field, **When** the date is read, **Then** it
   resolves to 2026-08-20.
2. **Given** names using `8/20/26`, `08/20/26` or `8/20/2026`, **When** the date is read, **Then** each resolves to
   2026-08-20.
3. **Given** a version whose field says 2026-09-01 and whose name says 08/20/2026, **When** the date is read, **Then**
   2026-09-01 is used and a **name disagrees with release date** flag is raised.
4. **Given** a version with neither a field nor a parseable name, **When** the date is read, **Then** it is reported as
   undated and its issues appear as unforecastable, not as on-track.

### US8 — Turn the numbers into something a team can be told (P3)

Gated AI assistance produces three propose-only narratives: a daily who-is-behind-and-who-is-ahead summary, a scope-cut
recommendation for an over-capacity release, and a test-capacity mitigation for the external-test window.

**Why this priority**: The numbers are usable without it; the narrative saves the operator writing the same message
every morning.

**Acceptance scenarios**

1. **Given** a computed forecast, **When** the operator copies the prompt, **Then** it contains every figure verbatim
   and instructs the model to invent none.
2. **Given** a pasted reply containing a date or a point value the engine did not supply, **When** it is ingested,
   **Then** that item is **rejected** and named.
3. **Given** a valid reply, **When** it is ingested, **Then** each narrative is accepted or declined individually.
4. **Given** the AI gate is locked, **When** the tab renders, **Then** no AI affordance appears at all.

### Edge cases

- A release whose code freeze is in the past: reported as passed, never computed as a negative window.
- A PI end date that is unset: the PI clock is reported as **not configured** and only the release clock computes.
- An issue assigned to somebody absent from the roster: counted, and the person named as **not on the roster**.
- An issue with several fix versions: the earliest unreleased dated one drives it, matching the existing date policy.
- A Feature with no children at all: reported as a gap, not as 100% complete.
- An issue whose points exceed the whole window: flagged as **cannot fit regardless of start date**.
- A holiday falling inside a window: excluded from the working-day count on both clocks.
- Zero people assigned to a release: the release total is still computed and reported as unassignable.
- A points-per-working-day rate of zero or below: rejected at configuration, never used as a divisor.

## Requirements

### Functional Requirements

**Effort and capacity**

- **FR-001**: The system MUST convert story points to working days using a configurable points-per-working-day rate
  that defaults to 1.0, and MUST reject a rate of zero or below.
- **FR-002**: Remaining effort for an in-flight issue MUST be its points reduced by the credit its current board column
  has already earned, using the Roll-Up Board's existing column-credit rule.
- **FR-003**: The system MUST NOT assign an assumed size to an unestimated issue. Unestimated issues MUST be counted
  and reported as a named unsized figure printed beside every total they could have changed.
- **FR-004**: Issues with no assignee MUST be reported under a distinct no-owner heading and MUST also be included in
  the scope's total remaining effort.
- **FR-005**: A person's capacity MUST be assessed against all of their assigned open work, with the portion inside the
  reported scope shown separately from their total.
- **FR-006**: Working days MUST exclude weekends and any date on the configured ART holiday list, which defaults to
  empty.

**Dates and the two clocks**

- **FR-007**: The system MUST name the code freeze date as the existing Target End — three weeks before the driving fix
  version's release date — and MUST NOT introduce a second definition of it.
- **FR-008**: The external test window MUST be the two weeks immediately following code freeze; the final week before
  the release date MUST be treated as deploy buffer carrying no test capacity.
- **FR-009**: Target Start MUST be revised to the latest working day on which the issue can begin and still complete on
  time, computed as its deadline minus the working days its remaining effort implies.
- **FR-010**: Where an issue is subject to both a code-freeze deadline and a PI DoD deadline, the **earlier** MUST
  drive its Target Start.
- **FR-011**: Where an issue has actually entered `Working`, that date MUST remain its Target Start; the computed
  latest-start date is then reported as a should-have-started comparison.
- **FR-012**: The revised Target Start MUST be writable to Jira through the existing bulk date-fix path, and the write
  MUST state what it changed.
- **FR-013**: The revised rule MUST live in the single existing date-policy module so that Hygiene, Feature Review and
  the date AI prompt cannot disagree about what a date should be.
- **FR-014**: Release and PI verdicts MUST be presented side by side and separately labelled on every surface that
  shows both. Neither may be omitted or merged into a single figure.
- **FR-015**: Ahead / on-track / behind MUST be determined against the computed forecast; where a stored Jira date
  disagrees with the forecast, that disagreement MUST itself be reported.
- **FR-015a** *(corrected during implementation)*: "Behind" and "cannot fit" MUST differ in **kind**, not in degree.
  The originally-drafted rule — remaining effort greater than the days remaining — is arithmetically identical to a
  latest start date in the past, which would have left one of the two states unreachable and told a reader nothing
  the other did not. **Behind** therefore means the runway is gone while the deadline is still ahead: start it now
  and it lands late by the slack figure. **Cannot fit** means the deadline itself has passed, so "start it" is not
  even advice. Oversized work with a future deadline is reported as behind with the shortfall in the slack, which is
  more actionable than a flat refusal.
- **FR-015b** *(corrected during implementation)*: An issue with no remaining effort MUST be reported as on track,
  whatever its deadline. Without this, finished work whose deadline has since passed appears at the top of a list
  headed "start these today".

**Definition of Done**

- **FR-016**: The system MUST recognise a new **INT-ready** state: an issue whose status is `Ready for Testing` and
  whose sub-status is `Integration Test`.
- **FR-017**: A Feature MUST be reported INT-ready when every one of its non-cancelled contributing issues is
  INT-ready, and MUST NOT be otherwise.
- **FR-018**: INT-ready MUST be an additional rule alongside the existing ART-wide delivered rule. The existing rule's
  meaning and every metric derived from it MUST be unchanged.
- **FR-019**: Both rules MUST be served from one shared module so that no two surfaces can hold different copies.
- **FR-020**: Cancelled issues MUST be excluded from capacity and from the DoD assessment, and MUST be counted and
  named rather than silently dropped.
- **FR-021**: The shipped default board columns MUST include the Internal Test Ready state — `Ready for Testing` with
  no sub-status — so a fresh install can express the workflow. A team that has already saved its own vocabulary adds it
  there; the defaults are not re-applied over saved vocabularies.

**The DEV to SL chain**

- **FR-022**: Dev work and SL test work MUST be distinguished by the `[DEV]` and `[SL]` summary prefix as the primary
  signal, with the assignee's roster role capabilities used only when no prefix is present.
- **FR-023**: A contributing story matching neither signal MUST be reported as unclassified and treated as dev work for
  scheduling purposes.
- **FR-024**: SL effort MUST be scheduled to begin only after the last `[DEV]` story on the Feature reaches Internal
  Test Ready.
- **FR-025**: Where a Feature carries several SL stories, their effort MUST be summed.
- **FR-026**: Where a Feature carries no SL story at all, that absence MUST be reported rather than treated as zero
  test effort.
- **FR-027**: Where a Feature's dev work fits but its SL work does not, the risk MUST name the test squeeze
  specifically, not the dev work.

**Feature sizing**

- **FR-028**: Where the summed points of a Feature's stories, defects and tasks exceed the Feature's own estimate by
  more than a configurable tolerance defaulting to zero, the Feature MUST be flagged with the overage in both points
  and percent.
- **FR-029**: Sub-task points MUST be excluded from that sum.
- **FR-030**: A Feature with no estimate MUST be reported as not sized, never as over-size.

**Release dates**

- **FR-031**: A fix version's release date MUST be read from its release-date field when present, and parsed from its
  name only when that field is empty.
- **FR-032**: Name parsing MUST accept one- or two-digit months and days and two- or four-digit years, reading a
  two-digit year 00–79 as 20xx and 80–99 as 19xx.
- **FR-033**: Where the field and the name both yield a date and they disagree, the field MUST be used and the
  disagreement MUST be reported.
- **FR-034**: A version yielding no date from either source MUST be reported as undated, and its issues MUST appear as
  unforecastable rather than on track.

**Surfaces**

- **FR-035**: The Today tab MUST show a daily forecast covering every saved Dashboard Team profile, attributing each
  issue to its team.
- **FR-036**: The Roll-Up Board MUST show the forecast as swimlane vital tiles and per-card badges, so the verdict sits
  beside the work it describes.
- **FR-037**: A new Forecast tab on the Team space MUST carry the release-level capacity report, the external-test
  window report, and the Feature-level PI DoD report.
- **FR-038**: Every reported figure MUST be traceable to the issues behind it, so a disputed number can be checked.

**AI assistance**

- **FR-039**: The system MUST offer three propose-only AI narratives — daily behind/ahead summary, release scope-cut
  recommendation, and external-test mitigation — each gated behind the existing AI unlock.
- **FR-040**: Every date, point value, capacity figure and flag MUST be rule-derived. A reply containing a numeric
  value the engine did not supply MUST be rejected on ingest and the rejection named.
- **FR-041**: Suggestions MUST be accepted or declined individually; nothing may be applied automatically.
- **FR-042**: No automated or background AI channel may be introduced.

**Correctness by construction**

- **FR-043**: The Today forecast, the Roll-Up Board badges and the Forecast tab MUST consume one shared computation. No
  surface may re-derive a verdict for itself.
- **FR-044**: No new module may name a Jira custom field id directly; every logical field MUST be resolved through the
  central field mapping.

### Key Entities

- **Forecast Window** — a start day, an end day, and the working days between them, for one clock (release or PI).
- **Effort Estimate** — an issue's points, the credit already earned, and the remaining working days that implies.
- **Person Load** — one assignee, their total remaining effort, the portion inside scope, their available working days,
  and their over/under figure.
- **Issue Verdict** — one issue's latest start date, its state (ahead, on track, start today, behind, unsized,
  unassignable), and the reason behind it.
- **Feature DoD Assessment** — one Feature's INT-ready status, the children holding it back, its dev-then-SL chain
  dates, and its PI verdict.
- **Release Assessment** — one fix version, its release and code-freeze dates, its total and remaining effort, its
  person loads, its external-test verdict, and any scope-removal flag.
- **Sizing Flag** — one Feature, its own estimate, its children's summed estimate, and the overage.
- **Release Date Resolution** — one fix version, the date from its field, the date parsed from its name, which was
  used, and whether they disagreed.

## Success Criteria

- **SC-001**: A Scrum Master can name, in under one minute and without leaving the Today tab, every issue across both
  their teams that must start today.
- **SC-002**: Every issue in the forecast falls into exactly one state, and no issue is silently absent.
- **SC-003**: Over-capacity people are identified before code freeze, with the overage stated in working days.
- **SC-004**: A release whose committed work cannot fit is flagged with the exact points that must be removed.
- **SC-005**: A Feature's PI verdict and its release verdict are always visible together and never merged.
- **SC-006**: Every metric derived from the existing delivered rule reports the same number after this feature ships as
  before it.
- **SC-007**: A Feature blocked from DoD names the specific issues holding it, not just a percentage.
- **SC-008**: A Feature whose test window is too short is distinguishable from one whose dev work is too large.
- **SC-009**: A release date carried only in a version name is forecast correctly across every accepted name format.
- **SC-010**: Two surfaces showing the same forecast figure can never disagree, because both read one computation.
- **SC-011**: No AI reply can change a number; a reply that tries is rejected and the rejection is visible.
- **SC-012**: Every reported total states how many of its inputs were unsized, unassigned or undated.

## Assumptions

- The organisation's working week is Monday to Friday; anything else is expressed through the holiday list.
- Story points are the only sizing signal in use; no time-based estimate field is consulted.
- The points-per-working-day rate is one number per ART rather than per person, because per-person velocity is not
  recorded anywhere today.
- A person's availability is full unless the holiday list says otherwise; there is no per-person absence record to read.
- Sub-tasks carry no independent schedule; their parent's dates govern them.
- The PI end date comes from the existing ART setting; where it is blank the PI clock reports as unconfigured.
- The team's `[DEV]` and `[SL]` summary convention is applied consistently enough to be the primary signal, which is
  why the unclassified case is reported rather than hidden.

## Dependencies

- The existing date policy module, which already owns Due Date, Target End and Target Start.
- The Roll-Up Board's issue model, which already carries points, fix versions, assignee, column and sub-status.
- The Roll-Up Board's column-credit rule, which already expresses how far through the workflow a column sits.
- The Today tab's multi-team audit, which already scans every saved Dashboard Team profile.
- The ART settings store and the central Jira field mapping, which together own every configured value and field id.
- The team roster, which supplies role capabilities and the assignee identity forms.
- The existing AI unlock gate and propose-only prompt/ingest pattern.
- The in-flight field-id centralisation workstream, whose boundary rule this feature must satisfy rather than bypass.

## Out of Scope

- Changing how any team works, or how work is broken down.
- Per-person velocity, absence tracking, or individual capacity percentages.
- Automatic scope removal, re-assignment, or any write that is not a date the operator asked for.
- Redefining the ART-wide delivered rule or any metric built on it.
- Sprint-level burndown, which the Metrics surface already covers.
- Any automated or scheduled AI channel.
- Forecasting other disciplines' cloned Features; this feature forecasts the dev team's own commitment.

## Resolved Questions

Every question raised during specification was answered in the Clarifications section above. No `[NEEDS CLARIFICATION]`
markers remain.
