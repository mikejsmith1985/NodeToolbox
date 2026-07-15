# Feature Specification: Single AI Unlock + PI Review AI Assistance

**Feature short name**: `pi-review-ai-assist`
**Created**: 2026-07-15
**Status**: Draft — clarifications resolved (2026-07-15: risks/dependencies = Jira keys stay in the columns
untouched, AI narrative goes to Notes; AI estimates behave exactly like typed ones including the existing Jira
write-back; one run covers the whole table with row-by-row acceptance) — ready for `/speckit-plan`
**Builds on**: the app-wide AI Assist unlock gate (`AiAssistUnlockGate`, added in `f840779`), the established AI
Assist prompt→dispatch→parking-page→parse pattern (SnowHub Create CHG, Sprint Dashboard Pointing/Release Notes/Risk
Management, Feature Canvas, Reports Hub), and the PI Review tab's Jira reconciliation (`reconcilePiReviewRowsWithJira`).

## Summary

Two related changes to how AI Assistance works in NodeToolbox.

**Part 1 — one unlock prompt, not several.** Pressing **Ctrl+Alt+Z** is meant to reveal one passphrase prompt that
unlocks AI Assist for the session. Today it can raise **several stacked prompts at once**, because the app-level gate
added later never replaced the per-view gates that predate it — they were left in place. On the PI Review tab the
user sees two; on other Sprint Dashboard tabs it can be worse. This part deletes the leftover gates so exactly one
prompt appears, everywhere.

**Part 2 — an AI Assistance button on the PI Review tab.** Filling in a PI Review row by hand means reading each
Feature in Jira and forming a judgement: how big is it, what could go wrong, what does the ART/RTE need to know.
This part adds an AI Assist affordance to the PI Review tab that builds a prompt from the Features already on the
page — priority, description, acceptance criteria, linked issues — and returns, per Feature:

- a **point estimate**, derived from the organisation's **T-shirt sizing** scale,
- the **detail behind the risks and dependencies** Jira already links — what the risk actually is, why the dependency
  bites — written as notes rather than into the Jira-mirrored columns,
- **implementation notes** worth sharing with the ART/RTE.

It follows the existing AI Assist pattern exactly: the button is hidden until unlocked, the prompt is visible and
copyable, an automatic path dispatches and polls for the result, and **nothing lands in the table until the user
accepts it**.

The T-shirt sizing scale is also surfaced **in the app** as a reminder for manual sizing, alongside a link to the
authoritative Confluence guidance.

## The sizing scale (source of truth)

From the Feature template guidance (GitHub issue #147, and the linked
[Feature Sizing Guidance](https://zilverton.atlassian.net/wiki/spaces/MAGrowthDelivery/pages/222039893/Feature+Template+for+Jira+Feature+Sizing+Guidance)):

| T-Shirt Size | User Story Points |
|---|---|
| XS | 10 |
| S | 20 |
| M | 40 |
| L | 60 |
| XL | 80 |
| XXL | 100+ |

## The constraint that shapes Part 2 (read this first)

The PI Review table's columns are **not** all equal. `reconcilePiReviewRowsWithJira` runs on **every page load** and
on every Feature pull, and it treats them differently:

| Column | Who owns it | What happens on every load |
|---|---|---|
| Carry-Over, Committed to PI?, Implementation Notes | **Human** | Untouched |
| Priority | Jira | Overwritten from the Jira issue; blanked if Jira has none |
| **Dependency**, **Risks** | Jira | **Rebuilt from the Jira issue's links, unconditionally.** If Jira has no such links the cell is **emptied** and the previous text is migrated into Implementation Notes |
| **Point Estimate** | Jira, *with a gap* | Overwritten when Jira has an estimate. When **Jira's estimate is empty the table's value is kept** — and an existing write-back path pushes that value **into Jira** |

This has two direct consequences for the AI feature, and they pull in opposite directions:

- An AI-suggested **point estimate** works *with* the grain. Jira's estimate is exactly what's missing at PI planning
  time, so the AI fills a real gap, the value survives reload, and the existing write-back path can carry it to Jira.
- AI-identified **risks and dependencies** cut *against* the grain. Those two columns mirror Jira issue links. Free
  text written there is wiped on the next load and migrated into Notes — so writing them there would look like the
  feature silently lost the user's data.

This decided the shape of the feature rather than being an implementation detail: **the AI never writes to the
Dependency or Risks columns**, which continue to carry the Jira keys Jira's links identify. What the AI adds is the
*explanation* those columns cannot hold, written to Implementation Notes. See Clarification Q1 below.

## Clarifications

### Session 2026-07-15

**Q1 — Where do AI-identified risks and dependencies land?**
**A: The columns stay pure Jira mirrors; the AI's narrative goes to Notes.** Where a risk or dependency is already
identified in Jira as a linked issue, its **key** is populated in the Dependency/Risks column **directly from Jira**,
exactly as today — the AI never writes to those two columns. The AI's contribution is the **informational and
explanatory detail** about those risks and dependencies, which is written to **Implementation Notes**.

This keeps the invariant the whole PI Review pipeline already depends on ("Dependency and Risks say what Jira's links
say") while giving the AI a home for the part Jira cannot express: *why* this dependency bites, *what* the risk
actually is. It also means an AI run and a page reload can never disagree.

**Q2 — Does an AI-suggested point estimate flow through to Jira?**
**A: Yes — an accepted AI estimate behaves exactly like a typed one.** Once the user accepts a suggestion it is
simply the cell's value, and the existing write-back (which fires when Jira's estimate is empty) applies unchanged.
No special case, no provenance tracking. Because this reaches an external system, the panel must **say so plainly**
before the user accepts.

**Q3 — What is the scope of one AI Assist run?**
**A: Whole table, one run.** A single prompt covers every Feature on the page; results come back per Feature and the
user accepts or rejects them **row by row**. This matches how a PO actually fills the page — in one sitting — and a
partial or malformed reply still yields the suggestions that did parse (FR-024).

## Why this shape (product rationale)

**Part 1** is a defect, not a preference. The app-level gate was introduced precisely to centralise the unlock, and
the Admin Hub's copy was removed at that time; the four view-level copies were simply missed. Every one of them
already writes to the same shared unlocked state, so the extra prompts are pure redundant UI — entering the
passphrase in any one of them satisfies all. Removing them changes no behaviour beyond removing the duplicates.

**Part 2** targets the most expensive part of PI Review prep: not typing, but judging. The Features are already on
the page and already linked to Jira, so the raw material for that judgement is in hand. The value is in applying a
consistent sizing rubric and surfacing what the ART/RTE needs to hear — both things a human does inconsistently
under time pressure at PI planning.

Surfacing the sizing table in-app is deliberately in scope even though the AI can apply it: **manual sizing is still
the norm**, and a rubric nobody can find is a rubric nobody applies.

## Scope Boundary (explicit non-goals)

- **Not** changing what the Ctrl+Alt+Z passphrase is, how it is verified, or where the unlocked state is stored
  (session-scoped, shared store) — only how many prompts appear.
- **Not** changing the app-level `AiAssistUnlockGate` itself; it is the survivor.
- **Not** removing or altering the AI Assist affordances those views already have — only their duplicate *unlock
  prompts*. A view keeps its "⚡ Run via AI Assist" button and keeps reading the shared unlocked state.
- **Not** auto-applying AI output. Nothing reaches the table without the user accepting it.
- **Not** auto-saving to Confluence. Accepted suggestions become unsaved edits; **Save to Confluence** stays a
  deliberate act.
- **Not** wiring AI Assistance into the **scheduled** PI Review refresh (feature 015). The schedule stays a faithful
  Jira mirror; AI is a human-in-the-loop authoring aid only.
- **Not** changing the T-shirt scale itself, or making it user-editable in this feature.
- **Not** replacing the Confluence sizing guidance page — the app points at it, it remains the source of truth.

## User Scenarios & Testing *(mandatory)*

### Primary user stories

**US-1 — One prompt.** As a NodeToolbox user on the PI Review tab, when I press Ctrl+Alt+Z I see exactly one
passphrase prompt, so I can unlock AI Assist without dismissing a stack of identical dialogs.

**US-2 — Size a PI Review page.** As a Product Owner preparing PI Review, I click AI Assistance and get, for each
Feature already on my page, a point estimate grounded in the T-shirt scale plus the risks, dependencies and notes
worth telling the ART — so I start from a considered draft instead of a blank row.

**US-3 — Stay in control.** As that Product Owner, I can read the prompt before it is sent, read every suggestion
before it lands, accept the ones I agree with, and reject the rest — so the AI never puts words on my PI Review page
that I did not approve.

**US-4 — Size by hand.** As a Product Owner sizing a Feature manually, I can see the T-shirt scale without leaving
the tab, and reach the authoritative Confluence guidance in one click.

### Acceptance scenarios

1. **Given** I am on the PI Review tab with AI Assist locked, **when** I press Ctrl+Alt+Z, **then** exactly one
   passphrase prompt appears.
2. **Given** the same, **when** I press Ctrl+Alt+Z on the Sprint Dashboard Pointing tab, the Release Notes tab, the
   Risk Management panel, or SnowHub Create CHG, **then** exactly one passphrase prompt appears in each.
3. **Given** I enter the correct passphrase in that one prompt, **when** it closes, **then** AI Assist is unlocked
   across every view for the session, exactly as before.
4. **Given** AI Assist is locked, **when** I view the PI Review tab, **then** the AI Assistance button is not
   visible.
5. **Given** AI Assist is unlocked and my page has Features, **when** I open AI Assistance, **then** I can read the
   full prompt before anything is sent, and it contains each Feature's key, summary, priority, description,
   acceptance criteria and linked issues, plus the T-shirt scale.
6. **Given** the AI returns suggestions, **when** I review them, **then** each is shown against its Feature with its
   suggested size and the resulting points, and **nothing has changed in the table yet**.
7. **Given** I accept a suggestion, **when** it is applied, **then** the table shows it as an **unsaved change**, and
   the page is written only when I click Save to Confluence.
8. **Given** I reject a suggestion, **when** it is dismissed, **then** the row is untouched.
9. **Given** a Feature already has a human-entered estimate or notes, **when** suggestions are applied, **then** my
   existing content is not silently replaced — the conflict is visible and mine wins unless I choose otherwise.
10. **Given** I am on the PI Review tab, **when** I look for sizing guidance, **then** the T-shirt scale is visible
    in-app and links to the Confluence guidance page.
11. **Given** the AI Assist automation is not configured or unreachable, **when** I use the automatic path, **then**
    I get a clear failure message and the manual copy/paste path still works.
12. **Given** a reply is malformed or covers only some Features, **when** it is parsed, **then** the valid
    suggestions are offered and the rest reported as unparsed — no row is corrupted.
13. **Given** the AI identifies a risk and a dependency for a Feature, **when** I accept the suggestion, **then** the
    **Dependency and Risks columns are untouched** — they still show only the keys Jira's links identify — and the
    AI's explanation of that risk/dependency appears in **Implementation Notes**. *(Q1)*
14. **Given** I accept a suggestion and then reload the page, **when** reconciliation runs, **then** the AI's notes
    are still there and nothing has moved between columns — an AI run and a reload never disagree. *(Q1)*
15. **Given** the AI suggests an estimate for a Feature whose Jira estimate is empty, **when** I accept it and save,
    **then** it reaches Jira exactly as a typed estimate would — and the panel told me that would happen **before** I
    accepted. *(Q2)*
16. **Given** my page has 11 Features, **when** I run AI Assistance, **then** one prompt covers all 11, and I accept
    or reject each Feature's suggestion independently — accepting one leaves the other ten pending. *(Q3)*

### Edge cases

- **No Features on the page** — AI Assistance explains there is nothing to size and does not dispatch.
- **A Feature with no description or acceptance criteria** — the AI is told the field is absent rather than being
  given an empty string; a suggestion with no basis should say so rather than guess silently.
- **AI returns a size outside the scale** (e.g. "XXXL", "M/L") — treated as unparsed, not coerced.
- **AI returns points that contradict the scale** (e.g. `M` with 45) — the scale wins, or the row is reported as
  unparsed; the feature never invents a mapping.
- **XXL** maps to "100+", which is not a single number — the suggestion must resolve to a concrete value or be
  surfaced for the user to set.
- **A reply arrives after the user navigated away** — no crash, no write to a stale table.
- **Reply references a Feature not on the page** — ignored and reported, never appended as a new row.
- **Reconcile runs between suggestion and acceptance** (e.g. an auto-reload) — accepted values are applied to the
  current rows, not to a stale snapshot.
- **The page is in read-only/view mode** — AI Assistance is unavailable, consistent with the other edit tools.

## Functional Requirements

### Area 1 — Single unlock (Part 1)

- **FR-001**: Exactly one AI Assist passphrase prompt MUST appear in response to Ctrl+Alt+Z, in every view.
- **FR-002**: The app-level unlock gate MUST be the only component that listens for the shortcut and renders the
  prompt.
- **FR-003**: The per-view unlock gates (Sprint Dashboard Pointing, Sprint Dashboard Release Notes, Risk Management,
  SnowHub Create CHG) MUST no longer listen for the shortcut or render a prompt.
- **FR-004**: Those views MUST continue to read the shared unlocked state and MUST keep their existing AI Assist
  affordances, unchanged.
- **FR-005**: The passphrase, its verification, and the session-scoped storage of the unlocked state MUST be
  unchanged.
- **FR-006**: Unlocking once MUST unlock every view for the session, as today.

### Area 2 — The PI Review AI Assistance affordance (Part 2)

- **FR-007**: The PI Review tab MUST offer an AI Assistance affordance that is **hidden while AI Assist is locked**,
  consistent with every other AI Assist surface.
- **FR-008**: It MUST be available only in edit mode, consistent with the tab's other authoring tools.
- **FR-009**: It MUST be unavailable, with an explanation, when the page has no Features.
- **FR-010**: The generated prompt MUST be displayed in full and be copyable before anything is sent.
- **FR-011**: It MUST offer both the manual (copy prompt / paste reply) and automatic (dispatch and poll) paths, per
  the existing pattern.
- **FR-012**: An automation failure MUST produce a clear message and MUST NOT block the manual path.

### Area 3 — The prompt

- **FR-013**: The prompt MUST include, for each Feature on the page: issue key, summary, priority, description,
  acceptance criteria, and linked issues (dependency and risk links).
- **FR-014**: The prompt MUST include the T-shirt sizing scale and instruct the AI to size against it.
- **FR-015**: Absent fields MUST be conveyed as absent, not as empty values.
- **FR-016**: The prompt MUST request a deterministic, parseable reply keyed by Feature.
- **FR-017**: The prompt MUST request, per Feature: a **T-shirt size**, plus the risk, dependency and implementation
  detail worth telling the ART/RTE. It MUST **not** ask the model for a point number — points are derived from the
  scale by the app (FR-020), so the model has no channel through which to contradict the rubric. A point value
  volunteered by the model is ignored.

### Area 4 — Applying results

- **FR-018**: Suggestions MUST be presented for review; **no** suggestion may reach the table before the user accepts
  it.
- **FR-019**: Each suggestion MUST be attributed to its Feature and show both the T-shirt size and the derived
  points.
- **FR-020**: A size outside the scale, or points contradicting the scale, MUST be reported as unparsed rather than
  coerced.
- **FR-021**: A suggestion for a Feature not on the page MUST be reported and ignored — never appended.
- **FR-022**: Accepting a suggestion MUST mark the page as having unsaved changes; the feature MUST NOT write to
  Confluence on its own.
- **FR-023**: Where a suggestion would overwrite human-entered content, the conflict MUST be visible and the human's
  content MUST be preserved unless the user chooses otherwise.
- **FR-024**: A partial or malformed reply MUST yield the valid suggestions plus a clear report of the rest.
- **FR-025**: The feature MUST NOT write to the **Dependency** or **Risks** columns. Those columns continue to carry
  the Jira issue keys that Jira's links identify, populated by the existing reconciliation. *(Q1)*
- **FR-026**: AI-identified risk and dependency **detail** — the explanation of what the risk is or why the
  dependency matters — MUST be written to **Implementation Notes**, and only on acceptance. *(Q1)*
- **FR-027**: AI notes MUST use the same labelled-line convention the reconciliation already writes when it migrates
  text into Notes, so AI-authored and migrated notes coexist legibly and are not duplicated on repeat runs. *(Q1)*
- **FR-028**: A risk or dependency the AI identifies that has **no** corresponding Jira link MUST still be recorded
  as a note — the feature MUST NOT invent a key, and MUST NOT write to the Dependency/Risks columns to accommodate
  it. *(Q1)*
- **FR-029**: An accepted AI point estimate MUST behave **identically to a typed estimate** in every respect,
  including the existing write-back that carries the value into Jira when Jira's estimate is empty. No AI-specific
  provenance or suppression. *(Q2)*
- **FR-030**: Because FR-029 can write to Jira, the panel MUST state plainly — **before** the user accepts — that an
  accepted estimate can update the Jira issue. *(Q2)*
- **FR-031**: One run MUST cover **every Feature on the page** in a single prompt. *(Q3)*
- **FR-032**: Results MUST be returned and reviewed **per Feature**, accepted or rejected **row by row** — accepting
  one suggestion MUST NOT accept any other. *(Q3)*

### Area 5 — Sizing guidance in-app

- **FR-033**: The T-shirt scale MUST be viewable from the PI Review tab without navigating away.
- **FR-034**: It MUST link to the authoritative Confluence guidance page.
- **FR-035**: It MUST be visible regardless of whether AI Assist is unlocked — it serves manual sizing.

### Area 6 — Coexistence

- **FR-036**: The manual authoring flow (typing into cells, Pull Features from Jira, Save to Confluence) MUST be
  unchanged.
- **FR-037**: The scheduled PI Review refresh (feature 015) MUST be unaffected — it neither invokes nor depends on
  AI Assistance.
- **FR-038**: Jira reconciliation on load MUST continue to behave exactly as it does today.

## Key Entities

- **AI Assist unlocked state** — a single session-scoped flag, shared across views. Unchanged; only the number of
  prompts that can set it changes.
- **Feature sizing scale** — the fixed T-shirt→points mapping (XS 10 · S 20 · M 40 · L 60 · XL 80 · XXL 100+).
- **PI Review AI prompt** — generated from the Features on the page plus the scale.
- **Feature suggestion** — one AI result for one Feature: T-shirt size, the derived points, and note text (covering
  risk/dependency detail and implementation notes for the ART/RTE); plus a state of pending / accepted / rejected /
  unparsed. On acceptance it can touch only four cells: **Point Estimate**, **Implementation Notes**, and the
  **Dev Work** / **Test Support** boxes.
- **PI Review row** — existing. Its columns divide into human-owned (Carry-Over, Committed, Notes), Jira-mirrored
  (Priority, Dependency, Risks) and gap-filling (Point Estimate). See the constraint table above.

## Success Criteria

- **SC-001**: Ctrl+Alt+Z raises exactly one prompt in every view — measured across all five affected surfaces.
- **SC-002**: Unlocking once grants access everywhere for the session, with no regression.
- **SC-003**: A Product Owner can go from an unsized PI Review page to a reviewed, accepted draft of estimates,
  risks and notes **without leaving the tab** and without hand-copying Jira content.
- **SC-004**: Every accepted suggestion is one the user explicitly approved — zero content reaches the page
  otherwise.
- **SC-005**: No human-entered content is lost or silently replaced by an AI run.
- **SC-006**: Every AI-suggested estimate corresponds to a size on the scale — no invented values.
- **SC-007**: A malformed or partial reply never corrupts a row.
- **SC-008**: The sizing scale is reachable from the PI Review tab in one action, unlocked or not.
- **SC-009**: The manual and scheduled PI Review flows behave identically to before.

## Assumptions

- **A-1**: "Double lock screen" describes the leftover per-view gates. The app-level gate is correct and is kept; the
  four per-view gates are the defect. *(Verified in code: five independent listeners for the same chord, all writing
  the same shared state.)*
- **A-2**: The user's "back to just a single popup" means one prompt, not a return to any older prompt design. The
  surviving prompt is the current app-level one.
- **A-3**: The T-shirt scale from issue #147 is authoritative and fixed for this feature.
- **A-4**: Surfacing the scale in-app (phrased by the user as "could be a good idea") is **in scope**, as a small
  addition: the scale rendered inline plus a link to the Confluence page. Cheap, and it serves manual sizing whether
  or not AI is used.
- **A-5**: "Manual fields" in the request means the fields a human fills at PI Review time — which the code divides
  into human-owned and Jira-mirrored columns. That division, not the phrase, governs the design (resolved by Q1: the
  AI writes only Point Estimate and Implementation Notes).
- **A-6**: Review-before-apply is the default and is not treated as an open question — it matches every existing AI
  Assist surface and the user's own framing of AI as an aid.
- **A-7**: Description and acceptance criteria are not among the fields the PI Review tab fetches from Jira today;
  the fetch will need extending. *(Implementation concern, noted for `/speckit-plan`.)*
- **A-8**: Acceptance criteria live in a Jira field whose id is environment-specific and will need to be configurable
  or discovered, like the other custom fields this app already handles.
- **A-9**: The AI Assist automation (webhook + parking page) is already configured for the user's environment; this
  feature adds a surface, not new infrastructure.
- **A-10**: "XXL = 100+" resolves to a concrete number chosen by the user rather than the AI inventing one.

## Dependencies

- The app-level `AiAssistUnlockGate` and the shared AI Assist store (session-scoped unlocked flag).
- The AI Assist exchange pipeline: dispatch endpoint, Atlassian Automation webhook, Confluence parking page, result
  polling — including the frozen `rovo-result-<correlationId>` title contract.
- The PI Review tab's existing Jira integration and `reconcilePiReviewRowsWithJira` semantics.
- Jira fields for description and acceptance criteria (see A-7, A-8).
- The Confluence Feature Sizing Guidance page (link target).
- Existing tests that assert on the duplicate prompts (`SprintDashboardView.test.tsx`) — they encode the behaviour
  being removed and must be updated as part of Part 1.
