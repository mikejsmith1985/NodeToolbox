# Feature Specification: Guided Epic Intake — from raw notes to DENP Epics by twenty questions

**Feature Branch**: `feature/037-guided-epic-intake`

**Created**: 2026-09-18

**Status**: Ready for planning

**Input**: User description: "I need an enhanced mode for Jira issue creation … some of them are for enrollment some of
them are for fulfillment some of them bridge both and a decision needs to be made if a majority of the scope lives in
one area or the other and I need to create all of the ENROLLMENT owned features, however I also need to validate that
an open feature for the same scope doesn't already exist in jira and then produce an output table that gives the Jira
key for each enrollment record." Refined: "it is just a list … can you create a way that I can just take random data
points like this and ask AI to help, then based on what AI spits out toolbox knows what to search for and what to
create? even if it's like a 2–3 step process of back and forth … sort of the way that 20 questions is able to
accurately determine what animal you're thinking of." Source example: GH #387.

## Context

Funding asks, product calls and on-site sessions produce **notes, not tables**. GH #387 is typical: roughly twenty-five
top-level bullets, each with sub-bullets that mean different things depending on the line:

| Sub-bullet in the notes | What it actually is |
|---|---|
| `(1.2M) XL Enrollment`, `Fulfillment M`, `Infra XL` | **Sizing** of the parent item, per area |
| `BarCoding`, `Reporting`, `Automation` | **Sub-scope** of the parent item |
| `Send list to Steve Kemp (April)` | An **action for a person**, not work |
| `Mass ID Card Reissue - future conversation` | **Deferred** — explicitly not now |
| `Risks` → `Testing Capacity and proficiency` | A **risk**, not work |
| `Core Integration (denp-632)` | Work that **names an existing Jira key** |

A line-splitter cannot tell these apart, and neither can the PO at speed. Today the PO reads each line, decides whether
it is Enrollment's, searches DENP by hand for an open Epic that already covers it, creates the missing ones one at a
time, and assembles the key list for the call by hand.

**This feature makes that a guided loop.** Toolbox holds a fixed checklist of decisions for every item. Each round, it
asks — the AI or the PO — **only the decisions still open**, validates every answer against what it already knows, and
stops when nothing is open. The AI never decides what to do; it fills in blanks Toolbox defined, and Toolbox acts on
the filled blanks. Like twenty questions, every answer narrows the possibilities, and the questions are chosen by the
state of play, not improvised.

**Enrollment creates only what Enrollment owns.** Fulfillment-owned items are classified and reported, never created.

## Clarifications

### Session 2026-09-18

- Q: What issue type is created? → A: **Epic.** DENP renamed its Feature issue type to Epic this week — a rename of the
  same type, not a new one — so the type's name is discovered from the instance, never assumed.
- Q: Where are items created? → A: The **DENP** project.
- Q: Where is the duplicate check run? → A: **DENP only**, open Epics.
- Q: Is "Roadmap vs Stability" a field or a label? → A: A **label** on the created Epic.
- Q: Are the stated T-shirt sizes written to Jira? → A: **No** — they appear in the final summary table only, and are
  used to decide ownership.
- Q: Where does this live? → A: As a **mode inside PO Tool's Feature Composition tab**, not a new tab.

### Session 2026-09-22 — production feedback (GH #387)

The first release put the PO in the driver's seat: close calls, labels, unsure matches and every draft were questions,
and one run showed ~20 match dropdowns of ~20 Epics each — "more effort than doing it manually". Direction changed:

- Q: Who decides? → A: **The assistant decides; the PO reviews once.** Owner (incl. Shared), label, match and draft
  are all the assistant's answers, shown pre-filled in **one review table** the PO edits only where they disagree.
  **Supersedes** FR-015's PO close-call question, FR-020's PO-only label, and US3-6's low-confidence hand-off.
- Q: What about work both teams own (AEP)? → A: A **Shared** owner: Enrollment creates one Epic for **its part**,
  summary suffixed "(Enrollment scope)" (Epic Name keeps it); the summary flags Fulfillment's part for hand-off. A
  40–60% share or equal stated sizes **settles** Shared and is flagged ⚠ for review — never asked.
- Q: Unsure matches? → A: The assistant still picks; the row is flagged ⚠. The match choice shows the assistant's pick
  plus **up to 4 alternatives**, not every candidate.
- Q: Draft acceptance? → A: **Clicking Create is the single confirmation** — no per-draft Accept (supersedes FR-022's
  per-draft accept; nothing is still written before the PO clicks Create). Items without a written draft get the
  plain template at Create.
- Q: How many exchanges? → A: **Two** — sort the notes, then one combined match + draft request (split into parts
  when long). FR-007 stands: a decision the assistant fails twice becomes the PO's.

## User Scenarios & Testing

### US1 — Turn raw notes into a list of classified items (P1)

As a **PO holding meeting notes**, I want to paste them in and get back a clean list of items — each marked as work,
sizing, sub-scope, risk, action-for-a-person, deferred or noise — so that I am never deciding from a wall of bullets.

**Why this priority**: Every later step acts on this list. If a sizing line becomes an Epic, or a real item is lost,
everything downstream is wrong.

**Independent Test**: Paste the GH #387 notes, run the classification round, and confirm every source line is either
part of an item or explicitly set aside with a reason — and that no line appears in two places.

**Acceptance scenarios**

1. **Given** raw notes, **when** the PO starts the intake, **then** Toolbox produces a classification prompt the PO can
   copy, containing the notes verbatim with each line numbered.
2. **Given** the AI's reply, **when** it is pasted back, **then** Toolbox shows each item with its kind, its source
   lines, and — for work items — its sizing and sub-scope folded underneath it, not listed as separate items.
3. **Given** a reply that leaves any source line unaccounted for, **when** it is ingested, **then** Toolbox names the
   missing lines and does not let the intake proceed as if they were handled.
4. **Given** a reply that assigns the same line to two items, **when** it is ingested, **then** Toolbox names the
   conflict and treats the line as unresolved.
5. **Given** `Core Integration (denp-632)`, **when** it is classified, **then** `DENP-632` is recorded as a key the
   notes named explicitly, regardless of the key's casing in the notes.

### US2 — Decide who owns each item, deterministically where possible (P1)

As a **PO**, I want each work item's owner — Enrollment or Fulfillment — decided by a stated rule, so that the decision
is repeatable and I only weigh in on genuine close calls.

**Why this priority**: Ownership is the gate on creation. A wrong call either creates another team's work in DENP or
silently drops Enrollment's.

**Independent Test**: Run the ownership step on items with stated sizes, items without, and items that bridge both;
confirm stated sizes decide without AI, clear AI estimates decide without the PO, and only the close band reaches the PO.

**Acceptance scenarios**

1. **Given** an item whose notes state sizes for both areas (Core Integration: `XL Enrollment`, `Fulfillment M`),
   **when** ownership is decided, **then** Enrollment owns it because its stated size is larger, and the reason shown
   is "stated sizes", not an AI estimate.
2. **Given** an item whose notes state sizes for **only one** of the two areas, **when** ownership is decided, **then**
   that area owns it, reason "stated sizes".
3. **Given** an item whose two stated sizes are **equal**, **when** ownership is decided, **then** it becomes a
   question for the PO.
4. **Given** an item with no stated area sizes, **when** the AI estimates Enrollment's share of the scope at **60% or
   more**, **then** Enrollment owns it; at **40% or less**, Fulfillment owns it; **in between**, it becomes a question
   for the PO.
5. **Given** a question for the PO, **when** it is shown, **then** it is a closed choice (Enrollment / Fulfillment /
   Not actionable), with the AI's stated reason beside it — never a text box.
6. **Given** sizes for areas other than Enrollment and Fulfillment (Infra, Facets, Vendor, Testing), **when** ownership
   is decided, **then** those sizes are **reported** in the summary but do not vote on ownership.

### US3 — Never create an Epic that already exists (P1)

As a **PO**, I want Toolbox to find open DENP Epics that may already cover each Enrollment item before anything is
created, so that the funding ask points at existing work instead of duplicating it.

**Why this priority**: A duplicate Epic splits history, confuses the funding ask, and is the exact mistake a hurried
manual pass makes.

**Independent Test**: Seed DENP with an open Epic matching one item and a Done Epic matching another; confirm the open
one is offered as a match and the Done one is not.

**Acceptance scenarios**

1. **Given** Enrollment-owned items, **when** the search step runs, **then** Toolbox — with no AI involvement — searches
   DENP's **open** Epics using the search terms the AI proposed for each item, and separately fetches every key the
   notes named explicitly.
2. **Given** search candidates, **when** the matching prompt is generated, **then** it lists, for each item, only the
   candidates Toolbox actually found — key, summary, status and a description excerpt.
3. **Given** the AI's matching reply, **when** it names a key that was not among that item's candidates, **then**
   Toolbox rejects that verdict, says why, and treats the item's match as still open.
4. **Given** an explicitly named key (`DENP-632`), **when** it is fetched and is **open**, **then** it is the item's
   match without needing an AI verdict.
5. **Given** an explicitly named key that is **Done, missing, or not an Epic in DENP**, **when** it is fetched,
   **then** the PO is asked what to do (use it anyway / create new / not actionable), with the reason shown.
6. **Given** an item the AI could not match with confidence, **when** the step completes, **then** the PO chooses from
   that item's candidates or "none of these — create new".
7. **Given** a search that could not run (Jira unreachable, query rejected), **when** the step completes, **then** the
   affected items are marked **"not checked"** and cannot be created until the check succeeds — an unchecked item is
   never treated as "no duplicate found".

### US4 — Create the missing Enrollment Epics, reviewed first (P1)

As a **PO**, I want Toolbox to draft each missing Enrollment Epic, let me review and edit it, and create only what I
accept, so that nothing reaches Jira I have not seen.

**Why this priority**: This is the outcome the product call needs.

**Independent Test**: With three items marked "create", accept two and decline one; confirm exactly two Epics appear
in DENP with the correct label and that the declined item is reported as declined.

**Acceptance scenarios**

1. **Given** items marked "create", **when** the composition prompt is generated, **then** it asks for each Epic's
   summary and a description in the standard nine-section document format, from that item's own source lines only.
2. **Given** the reply, **when** it is ingested, **then** each draft shows its summary, description, and Roadmap or
   Stability label, all editable, with under-supported sections flagged for validation as the standard format requires.
3. **Given** drafts, **when** the PO has not accepted a draft, **then** nothing about that item is written to Jira.
4. **Given** accepted drafts, **when** the PO creates them, **then** each becomes an Epic in DENP carrying exactly one of
   the **Roadmap** or **Stability** labels, and the new key is recorded against its item.
5. **Given** one creation fails, **when** the batch runs, **then** the others still complete, the failure is shown
   with Jira's reason, and the item can be retried without re-running earlier rounds.
6. **Given** an item already created in an earlier session, **when** creation runs again, **then** it is not created
   a second time.

### US5 — Get the table for the call (P1)

As a **PO preparing for the product call**, I want one table listing every source item with its owner, what happened
and its Jira key, so that I can paste it straight into the call notes or the idea-card submission.

**Independent Test**: At the end of a GH #387 run, copy the table and confirm every top-level work item appears once
with a key or an explicit reason it has none.

**Acceptance scenarios**

1. **Given** a finished intake, **when** the PO views the summary, **then** each item shows: item name, owner, action
   (**existing** / **created** / **skipped — Fulfillment-owned** / **not actionable** / **declined** / **failed**),
   Jira key (linked), Roadmap/Stability label, and every area size stated in the notes (e.g. `Enrollment XL ·
   Fulfillment M · Infra XL · Facets M`).
2. **Given** the summary, **when** the PO copies it, **then** it pastes as a table into email, Teams or Confluence.
3. **Given** an intake that is **not** finished, **when** the PO views the summary, **then** open items are shown as
   open with the decision still pending — the table never implies an item is handled when it is not.

### US6 — Pick up where I left off (P2)

As a **PO whose intake spans a meeting and the next morning**, I want the intake saved as I go, so that closing the
browser does not lose the rounds already answered.

**Acceptance scenarios**

1. **Given** an intake mid-way, **when** the PO returns to Feature Composition's intake mode, **then** the intake
   resumes at the round it was on, with every answer so far intact.
2. **Given** an intake, **when** the PO discards it, **then** it is removed after a confirmation; Epics already created
   in Jira are unaffected.

### Edge cases

- **The AI reply is not valid JSON, or is for a different round.** Rejected with a plain reason; the same prompt can be
  copied again. The round's state is unchanged.
- **The AI invents an item that is not in the notes.** Rejected: every item must cite at least one source line.
- **The AI answers a question it was not asked** (e.g. changes an already-settled owner). The answer is ignored for any
  decision already settled; only open decisions are filled.
- **The AI fails the same decision twice** (invalid, missing or rejected). That decision becomes a question for the PO
  instead of a third AI round.
- **A decision the PO has made** is never overwritten by a later AI reply.
- **Notes that name a key in another project** (e.g. `ENCUC-12`). Reported as named, not used as a DENP duplicate, and
  the PO decides whether the item is still actionable.
- **The same scope appears twice in the notes** (e.g. "Core Integration" and "Environment for … Core Integration
  Testing"). They stay separate items unless the PO merges them; the AI may suggest a merge, never perform one.
- **Items explicitly marked in the notes as "no funding ask", "future conversation" or "rejected"** are classified as
  not actionable by default, with the phrase shown as the reason; the PO can override.
- **Tagging rule for Roadmap vs Stability is not stated in the notes.** The AI proposes one per item with a reason;
  the PO confirms each before creation (see FR-020).
- **Very long notes.** The classification prompt covers all of them in one round; if it exceeds a practical size the
  notes are split into consecutive chunks whose results are merged, and coverage is proven across all chunks.
- **The Epic issue type cannot be discovered** (instance unreachable at start). Creation is blocked with a plain
  message; classification and ownership can still proceed.

## Requirements

### Functional Requirements

**Mode and input**

- **FR-001**: Feature Composition MUST offer an **Epic Intake** mode alongside its existing create/update behaviour.
  Switching modes MUST NOT alter or clear the existing composition workspace or its drafts.
- **FR-002**: The intake MUST accept notes from the sources Feature Composition already accepts (pasted text, pasted
  rich text, uploaded files, fetched pages), reduced to plain text lines.
- **FR-003**: Toolbox MUST number every non-blank source line and keep that numbering fixed for the life of the intake.

**The decision checklist (the "twenty questions" core)**

- **FR-004**: Every item MUST carry a fixed set of decisions — **kind**, **owner**, **search terms**, **duplicate
  verdict**, **Roadmap/Stability label**, **draft**, **outcome** — each of which is either open or settled, and each
  settled decision MUST record **who settled it** (rule, AI, or PO) and **why**.
- **FR-005**: Each round, Toolbox MUST generate a prompt that asks **only** the open decisions it is the AI's turn to
  answer, and MUST state the exact reply shape expected.
- **FR-006**: On ingest, Toolbox MUST validate every answer against the round's shape, the source lines, and the facts
  Toolbox already holds, and MUST settle only open decisions. Invalid answers leave the decision open with a stated
  reason.
- **FR-007**: A decision that the AI has failed to settle **twice** MUST become a closed-choice question for the PO.
- **FR-008**: Decisions settled by the PO MUST NOT be changed by any later AI reply.
- **FR-009**: The intake MUST show, at all times, how many decisions are open and whose turn each is (AI prompt,
  Toolbox search, PO question), and MUST name the next action.
- **FR-010**: The intake is complete when no item has an open decision; the PO MUST be able to see this state
  explicitly.

**Classification**

- **FR-011**: Every source line MUST end up in exactly one item or be explicitly set aside with a reason. Toolbox MUST
  prove this and block the next round until it holds.
- **FR-012**: Item kinds MUST be one of: **work**, **risk**, **action for a person**, **deferred**, **noise**. Sizing
  and sub-scope lines MUST be attached to their parent work item, not become items.
- **FR-013**: Any Jira-key-shaped text in the notes MUST be recorded against its item as an explicitly named key,
  normalised to upper case, by Toolbox itself — independent of whether the AI noticed it.

**Ownership**

- **FR-014**: Stated area sizes MUST decide ownership without AI when Enrollment and Fulfillment sizes are both stated
  and differ, or when only one of the two is stated. Size order: XS < S < M < L < XL < XXL.
- **FR-015**: Without a deciding stated size, the AI's estimated Enrollment share MUST decide: **≥ 60%** Enrollment,
  **≤ 40%** Fulfillment, otherwise a PO question. These thresholds MUST be named constants shown to the PO.
- **FR-016**: Only **Enrollment-owned work items** proceed to duplicate search and creation. All other items MUST still
  appear in the summary with their outcome.

**Duplicate check**

- **FR-017**: For each Enrollment item Toolbox MUST search DENP for **open** Epics (not in a Done status category)
  matching the item's search terms, fetch each explicitly named key directly, and present only real results to the
  matching round. The issue type name MUST be discovered from the connected instance, never hard-coded.
- **FR-018**: A matching verdict naming a key outside that item's candidate set MUST be rejected. A match is settled by
  an open explicitly named DENP Epic, a confident AI verdict among candidates, or the PO's choice.
- **FR-019**: An item whose search failed MUST be marked "not checked" and MUST NOT be created until a check succeeds.

**Labels and creation**

- **FR-020**: Each Enrollment item to be created MUST carry exactly one of the labels **Roadmap** or **Stability**,
  proposed by the AI with a reason and confirmed by the PO from a closed choice. Existing Epics are **not** relabelled.
- **FR-021**: Drafts MUST use the standard nine-section description format, flag under-supported sections, and never
  attribute themselves to AI.
- **FR-022**: Nothing MUST be written to Jira until the PO accepts that specific draft. Creation MUST be per item,
  failure-isolated, retryable, and idempotent across sessions.
- **FR-023**: Stated sizes MUST NOT be written to any Jira field.

**Output and persistence**

- **FR-024**: The summary table MUST list every work item exactly once with owner, action, linked key, label and
  stated sizes, and MUST be copyable as a table.
- **FR-025**: The intake MUST persist across browser sessions and be resumable, discardable with confirmation, and
  scoped so one PO's intake does not overwrite another's.

**AI governance (standing project rules)**

- **FR-026**: The AI step MUST be the manual copy-prompt / paste-reply exchange, gated by the existing AI unlock. With
  AI locked, the intake MUST remain usable with the PO answering every decision the AI would have answered, from the
  same closed choices and fields.
- **FR-027**: No AI reply MUST cause a Jira write; the only writes are PO-accepted creations.

### Key Entities

- **Intake**: one run from notes to summary — source lines, items, round history, current round, created keys.
- **Source line**: a numbered line of the notes; belongs to one item or is set aside with a reason.
- **Intake item**: one candidate piece of work — kind, source lines, attached sizes and sub-scope, named keys, and its
  decisions.
- **Decision**: one checklist slot on an item — open or settled, value, settled-by (rule/AI/PO), reason, AI attempt
  count.
- **Area size**: an area (Enrollment, Fulfillment, Infra, Facets, Vendor, Testing, …) with a T-shirt size and optional
  cost as stated in the notes.
- **Duplicate candidate**: an open DENP Epic found by Toolbox for an item — key, summary, status, excerpt.
- **Epic draft**: summary, nine-section description, label — editable, accepted or declined.
- **Summary row**: the item's line in the final table.

## Success Criteria

- **SC-001**: For the GH #387 notes, the PO reaches a complete summary in **no more than four AI exchanges** plus PO
  questions, with **100%** of source lines accounted for.
- **SC-002**: **Zero** Epics are created for items that the check found to have an open DENP Epic covering them.
- **SC-003**: **Zero** Fulfillment-owned, deferred, risk or noise items are created in DENP.
- **SC-004**: The PO answers questions only for genuine close calls — on GH #387, **no more than one PO question per
  five work items** beyond the label confirmations.
- **SC-005**: Producing the summary table for a 25-item set takes the PO **under 20 minutes** end to end, versus the
  current manual pass.
- **SC-006**: Every created key in the summary opens the correct Epic; every non-created item states why.

## Assumptions

- "Enrollment" and "Fulfillment" are the only two owning areas; other named areas (Infra, Facets, Vendor, Testing,
  Billing) are contributors that are reported, not owners.
- T-shirt sizes follow XS–XXL; a stated dollar figure (`1.2M`) is reported alongside the size, not used to decide.
- The labels are literally `Roadmap` and `Stability`.
- The PO creating Epics has create permission in DENP, as they do for Features today.
- The intake belongs to the PO Tool's selected team scope, like other PO Tool drafts.
- Created Epics carry the fields a DENP Epic requires on create; any required field the create screen demands is
  asked of the PO rather than guessed.

## Dependencies

- Feature Composition's existing source intake, AI unlock gate, nine-section description format and creation path.
- The instance issue-type discovery used by the Feature-link search.
- DENP's Epic issue type being creatable by the PO.

## Out of Scope

- Creating Fulfillment-owned Epics, or Epics in any project other than DENP.
- Relabelling, editing or linking existing Epics.
- Creating Stories or Sub-tasks under the new Epics.
- Writing sizes, costs or funding amounts to Jira.
- Submitting idea cards.
- Any automated or background AI call.
- Repairing the existing surfaces that query `issuetype = Feature` (PI Review, Readiness, PO Feature Review, PI remap)
  after the DENP rename — tracked separately.

## Resolved Questions

All clarifications were answered in the session of 2026-09-18 (see Clarifications). No open markers remain.
