# Feature Specification: Issue Flow Analysis — where the time actually goes

**Feature short name**: `issue-flow-analysis`
**Feature branch**: `feature/026-issue-flow-analysis`
**Created**: 2026-07-23
**Status**: Draft — clarified, ready for `/speckit-plan`
**Builds on**: the shipped Personal Workflow report and its hands-on cycle-time engine; the auditable report document
(feature 025) and its evidence-link vocabulary; the team roster.

## Summary

The Personal Workflow report answers *"how much of **my** time went where?"*. It is person-centric by construction:
at its input boundary it reduces every assignee change to a single boolean — *was this mine or not* — so the identity
of everyone else is discarded before the calculation begins.

That makes a different and more valuable question unanswerable: **for an issue that got delivered, where did its time
actually go, and who was holding it at each stage?** A delivery lead wants to see that a story spent 3 days being
worked, 11 days waiting in a review queue, and 6 days sitting with a PO for acceptance — because *that* is where flow
is lost, and no amount of per-person throughput reveals it.

A review of the existing report also found three ways it can mislead, all of which this feature resolves:

1. **Team columns cannot be summed.** One issue passing through a developer and then a PO is credited as **one issue
   to each** — so a team total counts *stints*, not issues. Story points are worse: an 8-point story touched by four
   people reads as 32 points of team output. (Hands-on *time* is partitioned correctly and does not double-count —
   only the counts and points duplicate.)
2. **"Issues" is mislabelled.** The report describes it as "issues this person moved to done". It is not: a stint
   completes when the person **hands the issue on** *or* it reaches done while they hold it. That behaviour is
   correct and deliberate — it is what makes the metric fair to people whose work is always accepted by someone else
   — but the description states something false.
3. **Work that was never finished is counted.** An issue handed on that never reaches done at all is still credited,
   with its full story points. It measures *work advanced*, not *work delivered* — a reasonable metric, wrongly named.

This feature adds the issue-centric analysis, and makes the existing report describe itself honestly. The two
coexist: they answer different questions and both are worth asking.

## Clarifications

### Session 2026-07-23

- Q: Which issues does the analysis cover? → A: **Issues that any roster member held at some point and that
  completed within the window.** Scoping follows the team, not a project or a hand-written query. Crucially the
  scope decides which issues are *analysed*, never whose stages are *shown*: once an issue is in scope, every holder
  appears — including people outside the roster. An issue that sat three weeks with an architect who is not on the
  team is exactly the delay this analysis exists to surface, and filtering those stages out would hide it.
- Q: What counts as "completed within the window"? → A: **The issue's LAST entry into a done-category status falls
  inside the window.** Done is detected by Jira's status *category*, matching how the existing engine already
  identifies completion, so the two analyses cannot disagree about which issues finished. Using the last entry rather
  than the first means work that was reopened and finished again is counted once and dated by its real completion —
  and the rework time is included rather than stranded outside the window.
- Q: Is this analysis screen-only, or shareable? → A: **It feeds the existing auditable document**, reusing the same
  copy and publish path, the same obligation to show its working, and the same warning that publishing redistributes.
  A flow finding nobody can share cannot drive change. The redistribution warning matters **more** here than for
  throughput: this names individuals against **waiting** time, which reads as judgement unless the reader understands
  that a queue is usually a system property rather than a personal failing.
- Q: What bounds the volume of this analysis? → A: **The same two-ceiling pattern the Personal Workflow report
  uses** — a per-run issue ceiling and an overall budget, whichever is reached first stops the analysis, and reaching
  either is disclosed prominently. This run is heavier than a person-scoped one (every completed issue needs its full
  history), so a bound is required; matching the existing pattern avoids a second, differently-behaving policy in a
  report that can sit beside the other on the same page.
- Q: How is a status classified as waiting versus active work? → A: **A name-based default that the report shows and
  the user can override.** Jira lumps every in-flight status into one category, so the distinction cannot be derived;
  requiring configuration first would leave the headline finding unavailable until someone set it up. Names like
  *Ready for…*, *Waiting*, *Blocked* and *In Review* default to waiting, **and the report states its classification**
  so a wrong guess is visible and correctable rather than silently skewing the answer.
- Q: Where does an issue's flow clock start — creation, or first in-progress? → A: **Both, reported side by side.**
  Lead time (from creation) and cycle time (from first in-progress) are each shown, **and the gap between them is
  reported as a finding in its own right**. The user's stated need is to make *both* problems visible: a backlog that
  sits too long before anyone starts, and a delivery system that is slow once work begins. Reporting only one hides
  a real problem behind the other.
- Q: How firmly should the report stop per-person figures being summed? → A: **Label them, and show the correct
  team total alongside** — computed once per issue. Labels alone do not survive a copy into a Confluence table;
  giving the reader the number they were reaching for removes the incentive to add the column up.
- Q: How is time with no assignee treated? → A: **Attributed to an explicit "Unassigned" holder**, counted like any
  other. Queue time is expected to be one of the largest buckets, so it belongs in the main breakdown rather than a
  separate view. Charging it to whoever picked the issue up next was rejected outright: it bills a person for a queue
  they did not control, which inverts the purpose of the analysis.

## User Scenarios & Testing

### User Story 1 — I can see where a delivered issue's time went (Priority: P1)

For any issue completed in the window, the user sees its life broken into stages: how long it spent in each status,
and who was holding it during that time.

**Acceptance:**

1. Selecting a completed issue shows **both** its lead time (from creation) and its cycle time (from first
   in-progress), each labelled, plus the wait before work began as its own figure.
2. The time is broken down by **status**, so the user can see where it accumulated — including the pre-work wait.
3. Each stage also names **who held the issue** during it, including "Unassigned".
4. The parts sum to the whole: the stage durations reconcile to the issue's **lead time**, visibly, and the stages
   from first in-progress onward reconcile to its **cycle time**. Both reconciliations are shown, so neither total is
   left as an unchecked assertion.
5. An issue that passed through several people shows each of them, in order, with their own durations.

### User Story 2 — I can see where the team's flow is lost (Priority: P1)

Across all issues completed in the window, the user can see which stages consume the most time — separating time
being **worked on** from time **waiting**.

**Acceptance:**

1. The analysis reports total and typical time per status across all completed issues.
2. Statuses that represent waiting are distinguishable from those that represent active work, **and the analysis
   states how it classified each one**, so a wrong classification is visible rather than silently skewing the split.
3. A status the analysis cannot classify with confidence is shown as unclassified — its time still counts, but it is
   not forced into either bucket.
4. The user can tell which stage is the largest contributor to overall delivery time.
5. Figures are shown as both a typical case and a spread, so one extreme issue cannot masquerade as the norm.
6. Every figure can be traced back to the issues behind it.

### User Story 3 — Team totals are honest (Priority: P1)

A reader can total the team's delivery without double-counting, and can tell a person-level figure from a team-level
one.

**Acceptance:**

1. A team-level count of delivered issues counts each issue **once**, no matter how many people touched it.
2. A team-level story-point total counts each issue's points **once**.
3. Where a figure is per-person and cannot be summed, the report says so at the point of display **and shows the
   correct team total beside it**, so the reader has no reason to add the column up.
4. Person-level and team-level figures are visually distinct, so they cannot be confused for one another.

### User Story 4 — The existing report describes itself accurately (Priority: P1)

The Personal Workflow report's own descriptions match what it computes.

**Acceptance:**

1. The "Issues" metric is described as work **advanced** — completed or handed on — not as work the person moved to
   done.
2. The description states that an issue handed on and never finished is still counted.
3. Story points are described as the **issue's size**, credited in full to each person who advanced it — not as that
   person's output.
4. No metric description claims something the calculation does not do.
5. These corrections change wording only; no figure changes as a result of them.

### User Story 5 — I can attribute wait time to a person or a queue (Priority: P2)

The user can tell the difference between an issue waiting on a **named person** and an issue waiting in an
**unowned queue**.

**Acceptance:**

1. Time when the issue had an assignee is attributed to that person.
2. Time when the issue had **no** assignee appears as an explicit "Unassigned" holder in the main breakdown, counted
   like any other holder — never dropped, and never attributed to whoever picked it up next.
3. The distinction is visible in both the per-issue view and the team roll-up.

### Edge cases (all stories)

- **An issue that moves backwards** (e.g. Done → In Progress → Done) — the reopened time is accounted for, and the
  analysis does not report a negative or impossibly short duration.
- **An issue never assigned to anyone** — appears with its status timeline intact and its time reported as unowned.
- **An issue completed but with no recorded transitions** — reported honestly as having no measurable stage
  breakdown, rather than as zero time.
- **An issue reassigned many times in one day** — short stints are represented rather than rounded away to nothing.
- **A person who left the team mid-window** — their held time still appears; a departed person does not erase history.
- **A status renamed in Jira mid-window** — the analysis does not silently split one stage into two unrelated ones.
- **Weekends and non-working time** — the treatment is stated explicitly wherever a duration is shown, so a reader
  never has to guess whether a figure is calendar time or working time.
- **An issue whose flow started before the window** — the analysis is clear about whether it is measuring the whole
  life of the issue or only the part inside the window.

## Requirements

### Functional — the issue-centric analysis

- **FR-000**: The analysis MUST cover the issues that **any roster member held at some point** and that **completed
  within the reporting window** (clarified). Scope follows the team rather than a project or a hand-written query.
- **FR-000b**: "Completed within the window" MUST mean the issue's **last** entry into a **done-category** status
  falls inside the window (clarified). Done is determined by Jira's status category — the same way the existing
  engine determines it — so the two analyses can never disagree about which issues finished. An issue reopened and
  completed again is counted **once**, dated by its final completion, with the rework time included.
- **FR-000a**: Scope determines which issues are **analysed**, never whose stages are **shown**. Once an issue is in
  scope, **every** holder appears in its breakdown — including people outside the roster. Time an issue spent with
  someone off the team is a delay the team experienced, and omitting it would hide the finding this analysis exists
  to produce.
- **FR-001**: For each issue in scope, the analysis MUST produce a timeline of stages, where a stage is a contiguous
  period with one status and one holder.
- **FR-002**: Each stage MUST carry its status, its holder, its start, its end, and its duration. A stage during
  which the issue had **no assignee** MUST carry an explicit **"Unassigned"** holder (clarified) and be counted like
  any other — never dropped, and never charged to the person who picked the issue up next.
- **FR-003**: The stage durations for an issue MUST reconcile to its **lead time** in full, and the stages from
  first in-progress onward MUST reconcile to its **cycle time**. Both reconciliations MUST be visible to the reader
  rather than asserted, so a missing or double-counted stage cannot hide inside a total.
- **FR-004**: The analysis MUST measure the whole issue, across every person who held it — it MUST NOT be relative to
  a single nominated person.
- **FR-005**: Each issue MUST report **two** totals (clarified): **lead time**, measured from the issue's creation,
  and **cycle time**, measured from the moment it first entered an in-progress status. Both MUST be labelled so a
  reader can never mistake one for the other.
- **FR-005a**: The **difference between them** — the time an issue waited before work began — MUST be reported as a
  figure in its own right, per issue and in aggregate. It is the backlog-wait finding, and leaving the reader to
  subtract two numbers would bury it.
- **FR-005b**: Neither total may be presented alone anywhere the other is meaningful. Reporting only cycle time hides
  backlog delay; reporting only lead time lets backlog age mask a slow delivery system. The feature exists to make
  **both** problems visible.
- **FR-006**: Whether a duration is calendar time or working time MUST be stated wherever it is displayed, and MUST
  be consistent across the analysis.

### Functional — the team roll-up

- **FR-007**: The analysis MUST report, across all completed issues, the total and typical time spent in each status.
- **FR-008**: It MUST distinguish time spent in **active work** statuses from time spent **waiting**, so the two are
  never conflated in a single figure.
- **FR-008a**: Statuses MUST be classified by a **name-based default that the user can override** (clarified).
  Jira's own categories cannot supply this — every in-flight status shares one category — and requiring configuration
  before the feature works would leave its headline finding unavailable out of the box.
- **FR-008b**: The report MUST **state how it classified each status**, so a wrong guess is visible and correctable.
  A misclassification that silently moves real work into the waiting bucket would invert the finding, which for a
  report whose purpose is locating delay is the worst failure available to it.
- **FR-008c**: Where a status cannot be classified with confidence, it MUST be reported as unclassified rather than
  guessed into either bucket, and its time MUST still appear in the totals.
- **FR-009**: It MUST identify which stage contributes most to overall delivery time.
- **FR-010**: Aggregate durations MUST be reported with both a typical value and a measure of spread, so a single
  outlier cannot be read as the norm.
- **FR-011**: Every aggregate figure MUST be traceable to the issues behind it, reachable in Jira in one action.
- **FR-011a**: The analysis MUST be publishable through the **existing auditable document** (clarified) — the same
  copy and publish routes, carrying its meanings, formulas and evidence links exactly as the other metrics do.
- **FR-011b**: The published output MUST carry the redistribution notice, **stated for waiting time specifically**:
  it names individuals against time work spent waiting, and a reader must be told that queue time is usually a
  property of the system rather than of the person holding the issue. Without that framing the same figures read as
  an accusation.

### Functional — honest totals

- **FR-012**: A team-level count of delivered issues MUST count each issue exactly once, regardless of how many
  people held it.
- **FR-013**: A team-level story-point total MUST count each issue's points exactly once.
- **FR-014**: Person-level figures that cannot legitimately be summed MUST be identified as such where they are
  displayed, so a reader is never invited to add them up.
- **FR-014a**: Wherever such a column appears, the **correct team total MUST be shown alongside it** (clarified),
  counting each issue once. A label alone does not survive being pasted into a document and totalled there; supplying
  the number the reader was reaching for removes the reason to add the column up at all.
- **FR-015**: Person-level and team-level figures MUST be visually distinguishable.

### Functional — correcting the existing report's descriptions

- **FR-016**: The Personal Workflow "Issues" metric MUST be described as work **advanced** — completed by the person
  or handed on to someone else — and MUST NOT claim the person moved it to done.
- **FR-017**: The description MUST state that an issue handed on and never completed is still counted.
- **FR-018**: Story points MUST be described as the issue's size credited in full to each person who advanced it, and
  MUST NOT be presented as that person's personal output.
- **FR-019**: These corrections MUST NOT change any computed figure — wording only.
- **FR-020**: The auditable report document (feature 025) MUST carry the same corrected descriptions, so the screen
  and the published page cannot disagree.

### Non-functional

- **NFR-001**: The issue-centric analysis and the existing person-centric report MUST agree where they overlap: a
  person's hands-on time for an issue MUST match between the two, because both derive from one reconstruction of that
  issue's history rather than two independent ones.
- **NFR-002**: No figure may be presented without its unit and its basis (calendar vs working time; whole-issue vs
  in-window) being discoverable at the point of display.
- **NFR-003**: The analysis MUST NOT expose issue data the person running it could not already see in Jira.
- **NFR-004**: Any in-app controls added MUST honour the standing responsive rules — light/dark themes, the A/A+/A++
  text sizes, narrow widths reflowing rather than clipping — and MUST NOT carry meaning by colour alone.
- **NFR-005**: The existing Personal Workflow report MUST continue to work unchanged apart from its corrected
  descriptions; this feature adds an analysis, it does not replace one.
- **NFR-006**: The analysis MUST be bounded by **two ceilings** (clarified) — a per-run issue ceiling and an overall
  budget — whichever is reached first stopping it. Reaching either MUST be disclosed prominently, stating that the
  findings describe a subset. This run is heavier than a person-scoped one because every completed issue needs its
  full history.
- **NFR-006a**: The ceilings MUST behave the same way as the Personal Workflow report's, so two analyses that can be
  published side by side cannot bound themselves by different and separately-explained rules.
- **NFR-007**: A run long enough to be noticeable MUST show meaningful progress and be cancellable; a cancelled run
  MUST leave any previous results intact and produce no document, so a partial analysis can never be mistaken for a
  complete one.

## Key Entities

- **Issue flow** — one delivered issue's complete life as an ordered set of stages, plus its total measured time.
- **Stage** — a contiguous period during which one status and one holder both held constant. The atomic unit of the
  whole analysis; every figure is a sum over stages.
- **Holder** — who had the issue during a stage: a named person, or the explicit **"Unassigned"** holder. Unassigned
  is a first-class holder, not an absence, because queue time is expected to be one of the largest buckets and the
  analysis exists to surface exactly that.
- **Flow clock** — the two measured spans for an issue: lead time from creation, cycle time from first in-progress,
  and the wait between them. All three are reported; none stands alone.
- **Status class** — whether a status represents active work or waiting. What makes "where is flow lost?" answerable
  rather than merely "where does time go?".
- **Stage roll-up** — the aggregate across issues for one status: total time, typical time, spread, and the issues
  behind it.
- **Delivery total** — a team-level count of issues and points where each issue contributes exactly once.

## Success Criteria

- **SC-001**: For any delivered issue, a reader can state how long it spent in each status and who held it during
  each, using only the analysis.
- **SC-002**: The stage durations for an issue reconcile to its total — verifiably, not by assertion.
- **SC-003**: A delivery lead can identify the single largest contributor to delivery time across the window, and say
  whether it is work or waiting.
- **SC-003a**: A reader can state, for the window, both how long work waited before starting and how long it took
  once started — and therefore say which of the two is the bigger problem.
- **SC-004**: A team-level delivered-issue count matches the number of distinct issues completed — it does not grow
  when an issue passes through more people.
- **SC-004a**: Beside every non-summable per-person column, the correct team total is visible, so a reader never has
  to add the column up to get it.
- **SC-004b**: Time spent unassigned is visible as its own holder in the breakdown and contributes to the totals —
  it is neither dropped nor charged to a person.
- **SC-005**: A reader cannot mistake a per-person figure for a team total, because non-summable figures say so where
  they appear.
- **SC-006**: Every description in the Personal Workflow report matches what that metric actually computes — verified
  by reading each description against its calculation.
- **SC-007**: A person's hands-on time for a given issue is identical in the person-centric report and the
  issue-centric analysis.
- **SC-008**: Every aggregate figure can be traced to its underlying issues in one action.
- **SC-009**: An issue with unusual history — reopened, never assigned, or with no transitions — appears with an
  honest account of what could and could not be measured, rather than being silently dropped.

## Assumptions

- **The existing engine cannot answer this, by design.** The Personal Workflow calculation reduces the assignee
  timeline to a boolean relative to one nominated person, discarding everyone else's identity before the calculation
  starts. It can answer *"was this mine?"* but never *"whose was it?"*. This analysis therefore requires the
  assignee's identity to be retained through the reconstruction — it is a second computation, not a reshaping of the
  existing output.
- **The two analyses coexist.** "How much of my time went where" and "where did this issue's time go" are different
  questions and both are legitimate. This feature does not replace the Personal Workflow report.
- **Reconstruction from issue history remains the source.** Stages are derived by replaying each issue's status and
  assignee history, exactly as the existing engine already does — no new data source is introduced, and no Jira
  search can reproduce these figures, so the same evidence obligations as feature 025 apply.
- **Status classification cannot come from Jira.** Jira's three categories lump every in-flight status together as
  `indeterminate`, so "waiting versus active work" has to be decided outside it. Per the clarified decision this is a
  **name-based default the report states and the user can override** (FR-008a–c) — useful on day one, visibly wrong
  when it is wrong, and never guessing silently.
- **Counts and points duplicate today; time does not.** The review confirmed hands-on time is partitioned correctly
  across holders and does not double-count. Only issue counts and story points duplicate, which is what FR-012 and
  FR-013 address.
- **The corrections are wording-only.** FR-016 to FR-019 change descriptions, not calculations. The underlying
  behaviour — crediting a person who advanced an issue and handed it on — is correct and deliberately kept.

## Out of Scope

- **Changing what the Personal Workflow report computes.** Its behaviour is correct; only its descriptions are wrong.
- **Predicting or forecasting** delivery dates, and any statistical modelling beyond typical values and spread.
- **Comparing people against one another**, ranking, or any presentation that frames the analysis as individual
  performance assessment.
- **Changing how issues are fetched from Jira**, beyond retaining the assignee identity the reconstruction needs.
- **Server-side or scheduled analysis** — this is an in-app, on-demand report.
- **Writing anything back to Jira.**
- **A general-purpose cumulative-flow or control-chart visualisation** — this feature answers the stated questions,
  not every flow question.

## Decision Log

| # | Question | Decision | Consequence carried into the spec |
|---|----------|----------|-----------------------------------|
| Q1 | Where the flow clock starts | **Both lead and cycle time, plus the gap** | FR-005, FR-005a, FR-005b; US1 acceptance 1; SC-003a |
| Q2 | Preventing per-person figures being summed | **Label them AND show the correct team total alongside** | FR-014a; US3 acceptance 3; SC-004a |
| Q3 | Time with no assignee | **An explicit "Unassigned" holder, counted like any other** | FR-002; US5 acceptance 2; SC-004b; *Holder* entity |
| Q4 | Which issues are analysed | **Issues any roster member held, completed in the window** | FR-000; FR-000a keeps non-roster holders visible in the breakdown |
| Q5 | What "completed" means | **Last entry into a done-category status, inside the window** | FR-000b; reopened work counted once, dated by final completion, rework included |
| Q6 | Screen-only or shareable | **Feeds the existing auditable document** | FR-011a; FR-011b requires the redistribution notice to address waiting time specifically |
| Q7 | Volume bound | **Same two-ceiling pattern as the Personal Workflow report** | NFR-006, NFR-006a; NFR-007 (progress + cancel) follows from the same pattern |
| Q8 | Waiting versus active work | **Name-based default, shown and overridable** | FR-008a, FR-008b, FR-008c |

**Why Q1 took the widest option.** The user's stated need is to make **both** problems visible — a backlog that sits
before anyone starts, and a delivery system that is slow once work begins. Reporting either total alone hides one
behind the other, which is why FR-005b forbids showing one without the other and FR-005a promotes the gap between
them to a finding rather than an inference the reader has to make.

**Why Q3's rejected option matters.** Attributing queue time to whoever picked the issue up next would have produced
a tidier timeline in which every stage has a person. It was rejected because it bills an individual for a queue they
did not control — the exact inversion of what this analysis is for, and precisely the kind of quiet unfairness that
makes a report about people untrustworthy.

**Why Q4 separates scope from visibility.** Scope decides which issues are analysed; it must never decide whose
stages are shown. An issue that sat for weeks with someone outside the roster is a delay the team genuinely
experienced, and filtering that stage out would remove the finding while appearing to tidy the report.

**Why Q8 refuses to guess silently.** A status wrongly classified as waiting moves real work into the queue bucket
and inverts the conclusion — the worst failure available to a report whose purpose is locating delay. Hence the
classification is stated in the output (FR-008b) and genuine uncertainty is reported as unclassified rather than
forced into a bucket (FR-008c).
