# Feature Specification: Personal Workflow — Auditable Markdown Report

**Feature short name**: `personal-flow-audit`
**Feature branch**: `feature/025-personal-flow-audit`
**Created**: 2026-07-22
**Status**: Draft — clarified, ready for `/speckit-plan`
**Builds on**: the shipped Personal Workflow report (throughput, hands-on cycle time, per-issue rows, the
excluded-issue audit breakdown, role rollup and coaching); the Hygiene tiles' "open in Jira ↗" affordance and its
issue-navigator URL builder; and the existing Confluence page read/write path used by PI Review's "Save to
Confluence".

## Summary

The Personal Workflow report produces numbers that carry weight — throughput, cycle time, and per-person comparisons
that people will read as statements about how someone is performing. Right now those numbers arrive without their
working. A reader who doubts a figure has no way to check it: they cannot see which issues were counted, which were
deliberately excluded and why, what formula turned raw Jira history into "average cycle time", or how to reproduce any
of it themselves.

That is a trust problem, and for this kind of data it is the *only* problem that matters. A performance number nobody
can audit is worse than no number, because it gets quoted anyway.

This feature adds a second output to the same report run: an **extensive, highly readable Markdown document, publishable
to Confluence**, in which **every figure shows its working** — a plain-English explanation of what it measures, the
exact formula applied, the inputs that went into it, and a **one-click link that opens the underlying issues in Jira**
so a sceptical reader can go and count for themselves.

The guiding principle is the one feature 023 established for the Hygiene tiles: **a number and the query behind it must
agree, and the user must be able to reach that query in one click.** This feature extends that promise from a simple
count to a derived metric — which is where it gets genuinely hard, because some of these figures are reconstructed
from issue history and **cannot** be reproduced by any Jira search. Rather than paper over that, the document proves
the derivation with a worked example (see the Decision Log), so validation shifts from "re-run this query" to "check
this issue's history for yourself".

The report is normally run for a **whole roster**, so the document covers the team as one publishable page. What keeps
that readable is economy: a metric's explanation and formula appear **once per column**, never repeated per person,
while the Jira links are **per person row** so every individual's figures stay separately checkable.

## Clarifications

### Session 2026-07-22

- Q: Hands-on cycle time cannot be reproduced by a Jira search. What should the report do? → A: **Publish the
  derivation rather than only the result**, so validation shifts from "re-run this query" to "check this issue's
  history yourself". The issue set is still linked and the limitation still stated plainly. *(Refined later in this
  session — see the worked-example answer below — once team scope showed that full detail for every issue would bury
  the figures.)*
- Q: How does the document reach Confluence? → A: **Both routes, in sequence.** Copy-to-clipboard ships **first** and
  is the P1 path; writing directly to a named Confluence page follows shortly after as P2. Both are in scope for this
  feature.
- Q: The report analyses at most 100 issues — what happens when there is more work than that? → A: **Raise the
  ceiling so the figures cover the whole window.** The document's counts and its Jira links must agree *and* be
  complete. A much higher ceiling still exists as a backstop, and if it is ever hit the document must say so
  prominently.
- Q: Must a long roster analysis be cancellable, or is progress feedback enough? → A: **Progress plus a cancel that
  abandons the run.** The user sees how far along it is and can stop it outright, leaving the previous results on
  screen. Keeping partial results was rejected: a part-finished team report that reads as complete is precisely the
  failure this feature exists to prevent.
- Q: What happens when publishing to a Confluence page that already has content? → A: **Replace the whole page.**
  The published page is a generated artifact, so each run supersedes the last in full. The trade is accepted
  knowingly: anything hand-written on that page is lost, so the page must be one dedicated to this report and the
  user must be told clearly what will be replaced before it happens.
- Q: What bounds the analysis now the 100-issue cap is lifted, given a roster can be run over "All history"? → A:
  **Two ceilings — per person and per run.** Each person has an issue ceiling, and the whole run has an overall
  budget; whichever is reached first stops the analysis. A per-person ceiling alone does not bound a roster run, and
  the existing "All history" window makes an unbounded run one click away. Reaching either ceiling MUST be disclosed
  prominently in the document.
- Q: How much per-issue derivation evidence should be published, given team scope multiplies it? → A: **A worked
  example plus per-issue totals.** One representative issue is shown in full span-level detail — stints, qualifying
  spans, working days — to prove the method concretely; every other credited issue is listed with its total and its
  Jira link. This applies the same economy as the per-column rule: prove the method once rather than restating it for
  every issue, while leaving any issue open to being checked against the demonstrated method.
- Q: Does the document cover one person or the team? → A: **The team, as one combined document.** The report is
  normally run for a whole roster, not for individuals, so the document covers the team comparison in a single
  publishable page. Two structural consequences follow, and they are what keep it readable: the **explanation and
  formula for a metric appear once per column**, not repeated for every person; and the **Jira link is per person
  row**, so each individual's figure is separately checkable rather than everyone being folded into one query.

## User Scenarios & Testing

### User Story 1 — I can publish the report with its working shown (Priority: P1)

A user generates the Personal Workflow report for a **whole roster** as they do today, then produces one accompanying
written report covering the entire team and puts it on a Confluence page where the team, their manager, or a sceptic
can read it.

**Acceptance:**

1. Generating the report makes an accompanying written document available without re-running the analysis or
   re-querying Jira.
2. The document covers every figure the on-screen report shows.
3. The document is readable as prose by someone who has never opened Toolbox — headings, tables, and explanations,
   not a data dump.
4. The document can be copied in one action and pasted onto a Confluence page, where it renders as formatted content
   rather than raw markup.
5. The user can also publish it straight to a named Confluence page without the copy-and-paste step.
6. Producing the document never changes the numbers, the on-screen report, or anything in Jira.

### User Story 2 — Every number shows how it was calculated (Priority: P1)

Reading any figure, the user can see — without leaving the document — what it means, exactly how it was derived, and
what went into it.

**Acceptance:**

1. Every reported metric is accompanied by a plain-English statement of what it measures.
2. Every reported metric shows the **exact formula** used, in terms a reader can apply by hand.
3. The formula is shown with **actual values substituted in**, naming whose figures the worked example uses, so the
   arithmetic can be followed end to end.
4. Each explanation appears **once for the metric**, not repeated for every person in the team.
5. The window, the roster reported on, and any other parameters that shaped the run are stated explicitly.
6. Where a figure is undefined for someone (no qualifying issues), the document says so plainly for that person
   rather than showing a zero.

### User Story 3 — I can open the exact issues in Jira and count them myself (Priority: P1)

For any figure derived from a set of issues, the user clicks once and Jira opens showing exactly that set.

**Acceptance:**

1. Every figure derived from a set of issues carries a link that opens those issues in Jira in a new tab.
2. The link resolves to the **same issues** the figure was computed from — not a broadly similar search.
3. The exact query text is visible in the document as well as being linked, so a reader can inspect, modify, or
   re-run it manually.
4. Links work for a reader who has Toolbox closed — the document stands alone once published.
5. Where a figure cannot be reproduced by a Jira search, the document says so explicitly **and proves the method with
   a worked example** — one named issue shown as stints, qualifying spans and working days counted — with every other
   credited issue listed by total and link, so any of them can be checked the same way.

### User Story 4 — I can see what was left out, and why (Priority: P2)

The user can tell the difference between "this work does not exist" and "this work was deliberately not counted."

**Acceptance:**

1. The document reports how many issues were fetched, how many were credited, and how many were excluded.
2. Every exclusion category is named, explained in plain English, and counted.
3. The excluded issues are reachable in Jira the same way credited ones are, so a reader can confirm each exclusion
   was correct.
4. The credited and excluded counts reconcile to the fetched count, visibly, so nothing can go missing unexplained.
5. The analysis covers the whole reporting window, so the document's counts and its Jira links agree. If the
   backstop ceiling is ever reached, that is disclosed prominently at the top of the document, not buried.

### User Story 5 — A sceptic can validate the report without me (Priority: P2)

Someone who did not run the report, and does not use Toolbox, can take the published page and check the work
independently.

**Acceptance:**

1. The document states when it was generated, which roster it covers, over what window, and by which tool version.
2. A reader can follow it end-to-end without access to Toolbox or to the person who generated it.
3. Every claim is either checkable via a link, derivable from a stated formula, or explicitly flagged as neither.

### Edge cases (all stories)

- **No qualifying work** — a person with no credited issues in the window produces a document that says so clearly,
  with the exclusion breakdown explaining where the fetched work went; it is not an empty page or a wall of zeroes.
- **A metric that is undefined** — cycle time with no qualifying issues renders as "not applicable, because…" rather
  than `0`, which would read as "instant delivery".
- **Jira base URL not configured** — the document still generates, with the query text present and a clear note that
  the links could not be built.
- **A very large issue set** — with the analysis now covering the whole window (FR-019) *and* publishing per-issue
  derivation evidence (FR-010a), a busy person's document could become very long. The headline figures and their
  explanations must remain the primary content and stay readable, with the evidence in a clearly-labelled supporting
  section (FR-010b) — never an undifferentiated dump the reader has to wade through to find the numbers.
- **A window that reaches the backstop ceiling** — the document opens with a prominent statement that the figures
  describe a subset, so no reader can mistake truncated figures for complete ones.
- **Special characters in names or values** — a person's display name or a status name containing characters with
  meaning in the output format must not corrupt the document or break a link.
- **Publishing to a page that already has content** — the whole page is replaced, so the user is warned by name
  which page is about to be overwritten and can abandon; a page carrying a previous run of this report is recognised
  as the routine case and not alarmed about identically.
- **Regenerating** — running the report again produces a document that supersedes the previous one predictably, rather
  than accumulating duplicates.
- **Team comparison view** — when several people are reported together, each person's figures carry their own
  explanations and links; the reader can tell whose numbers are whose.

## Requirements

### Functional — the document

- **FR-001**: Generating the Personal Workflow report MUST also make available a written report covering every figure
  shown on screen, without re-running the analysis.
- **FR-002**: The document MUST be structured for reading — titled sections, headings, and tables — and MUST render as
  formatted content on a Confluence page rather than as raw markup.
- **FR-003**: The document MUST state the run's parameters: the subject person, the reporting window (with explicit
  start and end dates), the generation timestamp, and the tool version that produced it.
- **FR-004**: Producing or publishing the document MUST NOT alter the computed figures, the on-screen report, or any
  Jira data.
- **FR-005**: The document MUST be generated from the **same computation the on-screen report displays** — never a
  second, independently derived calculation — so the page and the screen can never disagree.

### Functional — showing the working

- **FR-006**: Every reported **metric** MUST carry a plain-English description of what it measures, understandable by
  a reader who does not use the tool.
- **FR-006a**: A metric's description and formula MUST appear **once per metric**, not repeated for each person
  (clarified). The derivation is identical for everyone in the team, so restating it per row would bury the figures
  it is meant to explain.
- **FR-007**: Every reported metric MUST show the exact formula used to derive it.
- **FR-008**: Each formula MUST also be shown **with actual values substituted in**, so a reader can follow the
  arithmetic to a stated result. Because the formula is documented once per metric, the worked example MUST name
  whose figures it uses.
- **FR-009**: Any figure that is undefined for this run MUST be reported as explicitly undefined, with the reason,
  and MUST NOT be rendered as zero.
- **FR-010**: Where a figure is derived from issue history rather than from a queryable field, the document MUST state
  that plainly and describe what the derivation does.
- **FR-010a**: For each history-derived metric, the document MUST publish a **worked example** for one representative
  credited issue (clarified): its ownership stints, the qualifying in-progress spans within them, the working days
  counted, and the resulting contribution — enough that a reader can open that issue's history in Jira and confirm
  the derivation by hand.
- **FR-010b**: Every other credited issue MUST be listed with its **total contribution** and its Jira link, so any
  issue can be checked against the method the worked example demonstrates. Full span-level detail for every issue is
  deliberately NOT published — with a whole team over a full window it would bury the figures it exists to support.
- **FR-010c**: The worked example MUST identify which issue and which person it uses, and MUST be chosen so it
  actually demonstrates the method (an issue with measurable hands-on time), not a degenerate case.
- **FR-010d**: The per-issue listings MUST sit in a clearly-labelled supporting section, so the team figures and
  their explanations remain the document's primary content.

### Functional — reaching the data in Jira

- **FR-011**: Every figure derived from a set of issues MUST carry a one-click link that opens exactly that set of
  issues in Jira, in a new tab.
- **FR-011a**: Links MUST be **per person**, not one query spanning the whole team (clarified). Each individual's
  figures must be separately checkable; a single all-team query would let one person's number hide inside an
  aggregate and could not be used to validate any individual row.
- **FR-012**: The linked set MUST be the **same issues the figure was computed from**, so the count a reader sees in
  Jira matches the count in the document.
- **FR-013**: The query text behind each link MUST also be shown in the document, so a reader can inspect or adapt it
  without reverse-engineering a URL.
- **FR-014**: Links MUST remain usable from the published page with Toolbox closed.
- **FR-015**: When no Jira base URL is configured, the document MUST still generate, showing query text with an honest
  note that links could not be built — never a broken or misleading link.

### Functional — accounting for what was excluded

- **FR-016**: The document MUST report the number of issues fetched, credited, and excluded, and these MUST visibly
  reconcile.
- **FR-017**: Every exclusion category MUST be named, explained in plain English, and counted.
- **FR-018**: Excluded issues MUST be reachable in Jira on the same terms as credited issues.
- **FR-019**: The analysis behind this document MUST cover the **whole reporting window**, so its counts and its Jira
  links agree (clarified). The previous low fetch limit MUST NOT silently truncate the figures.
- **FR-019a**: Two backstop ceilings MUST bound the analysis (clarified): a **per-person issue ceiling**, and an
  **overall run budget** across everyone in the roster. Whichever is reached first stops the analysis. A per-person
  ceiling alone does not bound a roster run, and the existing "All history" window option makes an effectively
  unbounded run one click away.
- **FR-019b**: If either ceiling is reached, the document MUST disclose it prominently at the top — naming which
  ceiling, and which people are consequently reported on incomplete data — rather than presenting truncated figures
  as complete. Any person whose figures are affected MUST be identifiable, so a reader is never misled about a
  specific individual.

### Functional — publishing

- **FR-020**: The user MUST be able to **copy the document to the clipboard** in one action, ready to paste into a
  Confluence page (or anywhere else). This is the **P1** path and MUST ship first (clarified).
- **FR-020a**: The user MUST also be able to **publish the document directly to a named Confluence page**. This is
  **P2** and follows shortly after; it is in scope for this feature, not a later one.
- **FR-020b**: Both routes MUST emit the **same document from the same run** — the pasted content and the published
  page MUST never differ, so which route was used can never explain a discrepancy.
- **FR-021**: Publishing (FR-020a) **replaces the entire target page's content** (clarified). Because that discards
  anything already on the page, the user MUST be told — before the write happens, and identifying the target page by
  name — that its current content will be replaced, and MUST be able to abandon the publish at that point.
- **FR-021a**: The warning MUST distinguish a page that already carries a previous run of this report (the expected,
  routine case) from one carrying unrelated content (where replacing it is likely a mistake), so a routine
  re-publish is not buried under the same alarm as an accidental one.
- **FR-022**: A failed publish MUST leave the document recoverable to the user — at minimum still copyable via
  FR-020's path — rather than lost.

### Non-functional

- **NFR-001**: The document and the on-screen report MUST agree by construction — both derived from one computation,
  never re-specified independently.
- **NFR-002**: A figure's stated value, its formula-with-values, and the count returned by its link MUST be mutually
  consistent; any known reason they cannot be (see the Decision Log) MUST be stated in the document itself. This
  three-way agreement MUST be asserted directly, not merely implied by the parts being individually correct.
- **NFR-003**: The document MUST be legible as plain text before rendering, so a reader who receives it as a file or a
  paste can still follow it.
- **NFR-004**: The document MUST NOT contain any data the **person generating it** could not already see in Jira
  under their own access. This holds by construction — every query runs under that user's own credentials — and MUST
  NOT be circumvented by any elevated or service-account path.
- **NFR-004a**: **Publishing redistributes.** The document names individuals, states figures about their work, and
  quotes issue keys and summaries. A Confluence page's audience is whoever can read that **page**, which may be wider
  than who can read those **issues**. This feature therefore cannot guarantee the reader's access matches the
  generator's, and MUST NOT claim to. Instead:
  - the publish flow MUST state, at the point of publishing, that the report will be visible to everyone who can read
    the target page, and that it contains named individuals' figures and issue summaries; and
  - the published document itself MUST carry a short statement of what it contains and whose figures they are, so a
    reader who encounters it later understands what they are looking at.

  Choosing an appropriate page is the publisher's decision. The feature's obligation is to make that decision an
  informed one rather than an accidental one.
- **NFR-005**: In-app controls added for this feature MUST honour the standing responsive rules — light/dark themes,
  the A/A+/A++ text sizes, narrow widths reflowing rather than clipping — and MUST NOT carry meaning by colour alone.
- **NFR-006**: Raising the analysis to cover the whole window (FR-019) MUST NOT make the on-screen report feel broken
  while it runs. The user MUST see meaningful progress — how far through the roster the run is, not merely that
  something is happening.
- **NFR-006a**: A running analysis MUST be **cancellable**, abandoning the run and leaving the previously displayed
  results intact (clarified). A cancelled run MUST NOT produce a document: partial team results that read as complete
  are the exact failure this feature exists to prevent.

## Key Entities

- **Report run** — one execution of the Personal Workflow analysis: its subject, window, timestamp, parameters, and
  results. The document is a rendering of exactly this.
- **Reported figure** — one number the report states, together with what it measures, its formula, the values that
  formula consumed, and the issue set behind it.
- **Issue set reference** — the identification of the issues behind a figure, expressed both as human-readable query
  text and as a link that opens them in Jira.
- **Exclusion category** — a named, explained reason issues were fetched but not credited, with its count and its own
  issue set reference.
- **Derivation note** — the explanation attached to a figure that is reconstructed from issue history rather than read
  from a queryable field, describing what the reconstruction does and what a reader can independently check.
- **Publication target** — where the document is written, and what happens to whatever is already there.

## Success Criteria

- **SC-001**: A reader who did not run the report can, for any figure, state what it measures and how it was
  calculated using only the document.
- **SC-002**: A reader can reach the issues behind any issue-derived figure in **one click**, and the number of issues
  Jira returns matches the number the document claims.
- **SC-003**: A reader can account for **100%** of the fetched issues — every one is either credited or falls into a
  named, explained exclusion category, and the counts reconcile visibly.
- **SC-004**: Any figure that cannot be independently reproduced from Jira is **explicitly identified as such** in the
  document; a reader is never left believing a number is checkable when it is not.
- **SC-005**: The published page renders as formatted, readable content — headings, tables and working links — not raw
  markup.
- **SC-006**: The figures on the **published Confluence page** — after format conversion — match the figures on
  screen for the same run, every time. Verified on the page itself, not only on the generated document.
- **SC-006a**: Before any publish, the user is told the report will be visible to everyone who can read the target
  page and that it names individuals; and the published page itself says what it contains.
- **SC-007**: A user can go from a generated report to a published Confluence page without manually reformatting
  anything.
- **SC-008**: A person with no credited work in the window still receives a document that explains where their fetched
  work went, rather than an empty or all-zero page.
- **SC-009**: Using the worked example alone, a reader can state the derivation method well enough to apply it to a
  different issue — and, applying it to that issue's Jira history, reach the total the document reports for it.
- **SC-009a**: Every person in the team document can be checked independently: each row's figures reach that person's
  own issues in one click, with no need to disentangle them from anyone else's.
- **SC-010**: For a window containing more work than the old limit allowed, the document's issue count matches the
  count its Jira link returns — the figures are complete, not a subset.
- **SC-011**: Even at large issue counts, a reader can find any headline figure and its explanation without first
  scrolling through per-issue evidence.

## Assumptions

- **One computation, two renderings.** The document is a second presentation of the run already on screen — never a
  recomputation. This is what makes NFR-001 true by construction rather than by discipline, and it follows the
  precedent set by the Hygiene tiles, where the count and its Jira link derive from one source.
- **The existing exclusion vocabulary is the audit trail.** The report already classifies fetched-but-not-credited
  issues by reason. Those categories, their counts, and their issues are the raw material for the "what was left out"
  section; no new classification is introduced.
- **Some figures are reconstructed from issue history, not read from fields.** Hands-on cycle time is derived by
  replaying an issue's ownership and status history and counting working days within the qualifying spans. **No Jira
  search can reproduce that number** — a query can return the issue set, but not the derivation. The spec does not
  pretend otherwise: per the Q1 decision it publishes the derivation evidence instead, shifting validation from
  "re-run this query" to "check this issue's history yourself". The evidence is already computed by the existing
  analysis; this feature surfaces it rather than deriving anything new.
- **Raising the fetch ceiling changes cost, not correctness.** The Q3 decision means more Jira querying per run. The
  figures and the exclusion accounting are unaffected — the analysis simply sees everything in the window instead of
  the first hundred issues. NFR-006 covers keeping the report usable while that runs.
- **The two publish routes are one document.** Clipboard (P1) and direct Confluence write (P2) render the same content
  from the same run, so the route can never be the explanation for a difference between two copies of a report.
- **The Jira link is the same affordance the Hygiene tiles use**, so the two features behave consistently and a user
  who has learned one already understands the other.
- **Publishing reuses the app's existing Confluence page path**; no new integration, credential, or permission model
  is introduced.
- **Scope is the Personal Workflow report only.** Other reports may want the same treatment later; this feature does
  not generalise ahead of that need.
- **The document is generated on demand, by a person.** No scheduled or automated publication is introduced.

## Out of Scope

- **Changing any figure, formula, or exclusion rule.** This feature explains and exposes the existing analysis; it
  does not alter what the analysis computes. A disagreement discovered by publishing is a separate fix.
- **Applying the same treatment to other reports** (Issue Aging, hygiene, PI Review, and so on).
- **Scheduled or automated publication**, and any AI-generated commentary on the figures.
- **A Confluence page template, macro, or app** — the output is content written to an ordinary page.
- **Changing how Personal Workflow fetches from Jira**, beyond raising the issue ceiling as FR-019 requires.
- **Changing the on-screen report's layout or content.** The document is an additional output; the existing report
  is unchanged apart from the control that produces the document and the wider issue coverage.
- **Editing the published page from within Toolbox** after it is written.
- **Exporting to formats other than the one published** (PDF, spreadsheet, etc.).

## Decision Log

| # | Question | Decision | Consequence carried into the spec |
|---|----------|----------|-----------------------------------|
| Q1 | Cycle time is not query-reproducible | **Publish the derivation** | Refined by Q5 into a worked example — see below |
| Q2 | Route to Confluence | **Both — clipboard first (P1), direct page write second (P2)** | FR-020 / FR-020a / FR-020b; FR-022 falls back to clipboard |
| Q3 | The 100-issue analysis cap | **Raise it so the window is covered in full** | FR-019; refined by Q6 into two ceilings |
| Q4 | Scope: one person or the team | **The team, one combined document** — explanations **per column**, links **per row** | US1; FR-006a (explain once per metric); FR-011a (per-person links); SC-009a |
| Q5 | How much derivation evidence | **Worked example + per-issue totals** | FR-010a (one issue in full), FR-010b (others by total + link), FR-010c (example must be representative), FR-010d (supporting section); SC-009 |
| Q6 | What bounds the analysis | **Per-person ceiling AND overall run budget** | FR-019a (whichever hits first stops it), FR-019b (disclose which ceiling, and who is affected) |
| Q7 | Publishing over existing page content | **Replace the whole page** | FR-021 (named warning, abandonable), FR-021a (routine re-publish distinguished from accidental overwrite) |
| Q8 | Long roster runs | **Progress + cancel that abandons** | NFR-006 (meaningful progress), NFR-006a (cancel yields no document) |

**How the size problem was solved.** Q1 + Q3 originally compounded — per-issue evidence across a full window — and
Q4 multiplied it again by making the document team-wide. Three decisions resolve it, all applying the same economy:
explanations appear **once per metric** (Q4), the derivation is **proved once** rather than per issue (Q5), and the
per-issue listings sit in a supporting section (FR-010d). What remains per-person is only what must be: each row's
figures and its own Jira links.
