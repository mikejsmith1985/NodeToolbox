# Feature Specification: Rebuild an Existing Change From Scratch

**Feature Branch**: `feature/033-chg-rescope-rewrite`

**Created**: 2026-08-07

**Status**: Draft

**Input**: User description: "in the snow hub, I need the ability to essentially re-write an existing change. This happens when I have a scope change, I need to re-fetch and re-apply the AI enhancements based on the new scope set. Please implement this feature in the SnowHub 'Modify Existing CHG' flow. After fetching or selecting an open change there should be an additional option to 're-scope' via JQL or FixVersion or both... Sometimes its easiest to pull a fixVersion in and then add an additional story via a quick key search."

**Clarified (2026-08-07)**: "We're starting over with a template just as if we're creating a new ticket from scratch."
"We're just pulling an existing change, deleting everything and starting from a template as if it's a new change,
**BUT we aren't creating a new record — we're starting with a known CHG number.**"

## Context

A ServiceNow Change Request in this organisation is a **narrative wrapper around a set of Jira issues**. The SNow
Hub's **Create CHG** flow already builds one end to end: pull the issue set (by project + fix version, or by a
free-form query), select what belongs, generate the change's content from those issues, optionally sharpen it with
the gated assisted pass, set the planning answers, choose which environments the change covers, review, and submit.

**Scope changes are routine** — a story slips, an extra fix is pulled in, a fix version is re-cut. When it happens
the change already exists in ServiceNow, frequently already in a CAB cycle, so raising a **new** change is wrong:
the number has been circulated, referenced, and approved against.

The operator's stated remedy is deliberately blunt: **throw the change's contents away and build it again from the
template exactly as if it were new — but write the result onto the existing change number.** Not a diff. Not a
field-by-field reconciliation against what is there now. A clean rebuild that happens to land on a known record.

Today that is impossible. **Modify Existing CHG** loads a change out of ServiceNow and offers plain text boxes with
no concept of Jira scope at all; the operator hand-retypes the issue list, or runs **Create CHG** purely to harvest
generated text and pastes it across — which is slow and drifts from what the release actually contains.

The gap is therefore narrow: **the change-building flow cannot be pointed at a change that already exists.** Every
piece of machinery needed already ships — the scope query modes, the additive "add these results to what is already
loaded" behaviour, the issue selection list, the content generation, the gated assisted enhancement, the planning
and environment steps, and the review step. What is missing is a starting point that says *"build a change, and when
you are done, save it as CHG0001234 instead of raising a new one."*

Because a rebuild **discards** what the change currently says, the destructive step must be explicit, obvious, and
reversible right up until the moment the operator saves.

The feature must not bend the project's standing rules on assisted content: the enhancement stays **propose-only**
(a prompt the operator runs in their own assistant, a reply pasted back), **gated** behind the existing unlock, and
applied only on an explicit per-field accept. Nothing reaches ServiceNow until the operator saves.

## Clarifications

### Session 2026-08-07

- **Q: Which parts of the change should a rebuild re-derive?** → **A: All of them.** The rebuild starts from the
  blank template exactly as a new change would — scope, content, planning answers, environments, dates. Not a
  narrative-only refresh.
- **Q: Where should the current scope come from when a change is loaded?** → **A: Nowhere — always start empty.**
  No prior issue set is recovered from the change, and no added / unchanged / removed comparison is offered. The
  operator builds the new scope from scratch.
- **Q: Is a new ServiceNow record created?** → **A: No.** The rebuild targets the **known CHG number** that was
  loaded, and updates that record in place.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Start over on a loaded change (Priority: P1)

A release engineer loads an open change — by number, or from their list of open changes. The scope has moved on far
enough that patching it up is not worth the effort. They choose **Start Over**, confirm that the change's current
contents will be discarded, and land on a blank change-building flow that is already bound to that change's number.

**Why this priority**: This is the entry point. Without it there is no feature. It is also the destructive step, so
it carries the confirmation that makes everything downstream safe.

**Independent Test**: Load an existing open change, start over, and confirm the builder opens blank and clearly
displays the CHG number it will write to — while ServiceNow still holds the original content.

**Acceptance Scenarios**:

1. **Given** a change has been fetched by number or selected from the operator's open changes, **When** they look at
   the loaded change, **Then** a **Start Over** option is available alongside the existing edit steps.
2. **Given** the operator chooses Start Over, **When** the action is offered, **Then** they are told plainly that
   the change's current content will be discarded and rebuilt, and must confirm before anything is cleared.
3. **Given** the operator confirms, **When** the builder opens, **Then** every field starts blank as it would for a
   brand-new change, with no content carried over from the loaded change.
4. **Given** the builder is open, **When** the operator looks at any step, **Then** the target change number is
   visible throughout, so it is never ambiguous which record will be written.
5. **Given** the operator declines the confirmation, **Then** the loaded change is untouched and the existing edit
   steps continue to work as before.
6. **Given** the operator abandons the rebuild before saving, **Then** ServiceNow still holds the original content.

---

### User Story 2 — Build the new scope by fix version and by query (Priority: P1)

With the blank builder open, the engineer pulls in the release: they choose the project and the new fix version and
fetch. The matching Jira issues load into a list where each can be included or excluded.

**Why this priority**: Scope is the input everything else is derived from. This is the same fetch the Create flow
performs, now inside the rebuild.

**Independent Test**: In a rebuild, fetch a fix version and confirm the issue list matches that fix version with all
issues selected.

**Acceptance Scenarios**:

1. **Given** a blank rebuild, **When** the operator defines scope, **Then** they can choose between a project + fix
   version lookup and a free-form query.
2. **Given** a project and fix version are chosen, **When** the operator fetches, **Then** the matching issues load
   into a list where each issue can be included or excluded, all selected by default.
3. **Given** the query returns no issues, **When** the fetch completes, **Then** the operator is told the scope is
   empty rather than being left with a silent blank list.
4. **Given** Jira cannot be reached, **When** the fetch fails, **Then** the failure is reported as a Jira lookup
   problem and the rebuild in progress is preserved.

---

### User Story 3 — Add one more story to the fetched scope (Priority: P1)

The engineer realises one extra story — carried over from another release — also belongs in this change. Rather than
hand-crafting a query that captures both, they run a quick search for that one issue key and **add** it to what is
already loaded.

**Why this priority**: The operator named this as the normal working pattern ("easiest to pull a fixVersion in and
then add an additional story via a quick key search"). A rebuild that can only ever replace the whole basket sends
them straight back to hand-editing.

**Independent Test**: Fetch a fix version, then add a single issue by key, and confirm the basket holds the fix
version's issues plus the added one, with no duplicates.

**Acceptance Scenarios**:

1. **Given** issues are already loaded, **When** the operator runs a second search and chooses to add rather than
   replace, **Then** the new results join the existing basket instead of clearing it.
2. **Given** an issue is already in the basket, **When** a second search returns that same issue, **Then** it
   appears once, and the operator is told how many were added versus already present.
3. **Given** the operator wants a single issue, **When** they search by issue key, **Then** that issue can be added
   without composing a full query by hand.
4. **Given** an issue was added by mistake, **When** the operator excludes it, **Then** it stops contributing to the
   generated content.

---

### User Story 4 — Generate the change's content from the new scope (Priority: P1)

With the scope settled, the change's content is built from the selected issues exactly as it would be for a new
change — summary, description, justification, risk and impact — and the engineer edits anything they want by hand.

**Why this priority**: This is the payoff: the change now describes what the release actually contains, without a
single line retyped.

**Independent Test**: Build a scope, confirm the content fields populate from those issues, and confirm hand edits
survive to the review step.

**Acceptance Scenarios**:

1. **Given** a scope basket with at least one selected issue, **When** the content is generated, **Then** it is
   derived from the selected issues only, and excluded issues do not appear in it.
2. **Given** generated content exists, **When** the operator edits it, **Then** their edits are kept.
3. **Given** the operator changes the basket and regenerates, **Then** the content is rebuilt from the current
   selection rather than accumulating text from earlier selections.
4. **Given** no issues are selected, **When** the operator tries to proceed, **Then** they are stopped with an
   explanation rather than producing content that claims a release contains nothing.

---

### User Story 5 — Complete the planning and environment steps (Priority: P1)

The engineer works through the rest of the change exactly as they would for a new one: the planning answers,
implementation and backout plans, which environments the change covers, and their schedules.

**Why this priority**: "As if it's a new change" is only true if the whole template is rebuilt. Leaving these on the
old change's values would reintroduce exactly the stale data the rebuild exists to remove.

**Independent Test**: Complete a rebuild's planning and environment steps and confirm none of the loaded change's
original planning answers or environment selections were pre-filled.

**Acceptance Scenarios**:

1. **Given** a confirmed rebuild, **When** the operator reaches the planning step, **Then** every planning answer
   starts blank rather than pre-filled from the loaded change.
2. **Given** a confirmed rebuild, **When** the operator reaches the environments step, **Then** no environment is
   pre-selected and no schedule is pre-filled.
3. **Given** the operator has saved reusable defaults for these steps, **When** the rebuild opens, **Then** those
   defaults apply exactly as they would for a new change.
4. **Given** required answers are missing, **When** the operator tries to save, **Then** they are told which ones,
   in the same terms a new change would use.

---

### User Story 6 — Re-apply the assisted enhancement to the new scope (Priority: P2)

For a substantial rebuild the generated text is not enough — the engineer wants the assisted pass, now driven by the
new issue set. With the assist unlocked they copy the prompt, run it in their own assistant, paste the reply back,
and accept the fields they want.

**Why this priority**: This is the "re-apply the AI enhancements" half of the request, but it depends on a settled
scope and is unavailable to anyone who has not unlocked the assist — so the rebuild must be fully usable without it.

**Independent Test**: With the assist unlocked, rebuild a change, copy the prompt, paste a well-formed reply, and
confirm the parsed fields are offered for per-field accept.

**Acceptance Scenarios**:

1. **Given** the assist is locked, **When** the operator rebuilds, **Then** the whole flow works and the assisted
   option is simply not offered.
2. **Given** the assist is unlocked and a scope basket exists, **When** the operator requests the prompt, **Then**
   the prompt is built from the **currently selected** issues, including their summaries and supporting detail.
3. **Given** a reply is pasted, **When** it is well-formed, **Then** each recognised field is offered for accept.
4. **Given** a reply is malformed or empty, **When** it is pasted, **Then** the operator is told nothing could be
   read and no field is altered.
5. **Given** assisted content is accepted, **Then** the saved change carries no marker attributing it to an
   assistant.

---

### User Story 7 — Save the rebuild onto the existing change number (Priority: P1)

Satisfied with the rebuilt change, the engineer reviews it and saves. The **same change record** is updated. No new
change is raised, and the number they have already circulated still refers to this work.

**Why this priority**: The entire premise. A rebuild that produced a second change number would be worse than doing
nothing.

**Independent Test**: Rebuild a change, save, and confirm the same change number now carries the rebuilt content and
that no additional change was created.

**Acceptance Scenarios**:

1. **Given** a completed rebuild, **When** the operator reviews it, **Then** they see the target change number and
   the full content that will be written before committing.
2. **Given** the operator saves, **When** the write succeeds, **Then** the existing change record is updated in
   place and its number is unchanged.
3. **Given** the operator saves, **When** the write succeeds, **Then** no new change record has been created.
4. **Given** the save fails, **When** the error is returned, **Then** the operator is told what failed and the
   rebuilt content is preserved so they can retry without rebuilding.
5. **Given** the change is no longer in an editable state, **When** the operator attempts the rebuild or the save,
   **Then** they are warned before investing the effort.

---

### Edge Cases

- **The operator starts over by mistake.** The confirmation is the only guard, so it must state plainly what is
  being discarded — and because nothing is written until save, backing out must leave ServiceNow untouched.
- **The change is not open.** A closed, cancelled, or implemented change must not be silently rebuilt; the operator
  needs to know before they invest the effort, not at the save.
- **Scope reduced to nothing.** Every issue excluded, or a query returning no results — the flow must refuse to
  produce a change that claims a release contains nothing.
- **A very large scope.** A fix version with a few hundred issues must not produce an unusable selection list or a
  prompt too large to paste; the operator needs to see the size before generating.
- **Jira unreachable mid-rebuild.** A failed fetch must preserve the rebuild in progress and be attributed to the
  issue lookup, not to ServiceNow.
- **Duplicate issues across searches.** Fetching a fix version and then adding an overlapping query must not
  double-count issues in the generated content.
- **The operator navigates away mid-rebuild.** Because the rebuild is bound to a specific change number, returning
  must not silently apply an abandoned rebuild to a different change loaded later.
- **A second person edits the change in ServiceNow during the rebuild.** Their edits are overwritten by the save —
  which is the explicit intent of "delete everything and start over", but the operator should not be surprised by it.

## Requirements *(mandatory)*

### Functional Requirements

**Entering the rebuild**

- **FR-001**: The Modify Existing CHG flow MUST offer a **Start Over** option once a change has been loaded, whether
  it was fetched by number or selected from the operator's open changes.
- **FR-002**: The Start Over option MUST NOT be available before a change is loaded.
- **FR-003**: Start Over MUST require an explicit confirmation that states the loaded change's current content will
  be discarded and rebuilt.
- **FR-004**: Declining the confirmation MUST leave the loaded change and the existing edit steps completely
  unaffected.
- **FR-005**: On confirmation, the rebuild MUST open with every field blank — content, planning answers, environment
  selections, and schedules — exactly as a new change would, carrying nothing over from the loaded change.
- **FR-006**: Reusable defaults that a new change would apply (saved templates and pinned values) MUST apply to a
  rebuild in the same way.
- **FR-007**: The target change number MUST be visible throughout the rebuild so the destination record is never
  ambiguous.
- **FR-008**: The operator MUST be warned when the loaded change is not in an editable state, before they invest
  effort in a rebuild.

**Building the new scope**

- **FR-009**: The operator MUST be able to define scope by project and fix version.
- **FR-010**: The operator MUST be able to define scope by a free-form query.
- **FR-011**: The operator MUST be able to combine sources by running one search and then **adding** a second
  search's results to what is already loaded, rather than replacing them.
- **FR-012**: The operator MUST be able to add a single issue by its key without composing a full query.
- **FR-013**: Adding results MUST NOT create duplicates, and the operator MUST be told how many issues were added
  and how many were already present.
- **FR-014**: Every issue in the basket MUST be individually includable and excludable, and all fetched issues MUST
  start included.
- **FR-015**: A failed issue lookup MUST preserve the rebuild in progress and MUST report the failure as a Jira
  lookup problem, distinct from a ServiceNow failure.
- **FR-016**: The rebuild MUST NOT attempt to recover, infer, or display the change's previous issue set.

**Building the content**

- **FR-017**: The change's content MUST be generated from the currently selected issues, by the same rules a new
  change uses.
- **FR-018**: Excluded issues MUST NOT contribute to generated content.
- **FR-019**: Generated content MUST remain editable by hand, and hand edits MUST survive to the review step.
- **FR-020**: Regenerating after a basket change MUST rebuild content from the current selection rather than
  accumulating text from earlier selections.
- **FR-021**: The flow MUST refuse to proceed, with an explanation, when no issues are selected.

**Assisted enhancement**

- **FR-022**: The assisted enhancement MUST be gated behind the existing unlock; the rebuild MUST work fully without
  it.
- **FR-023**: The assisted flow MUST remain propose-only: a prompt the operator copies out, and a reply they paste
  back. No content may be requested or applied automatically or in the background.
- **FR-024**: The prompt MUST be built from the currently selected issues and MUST reflect exclusions made in the
  basket.
- **FR-025**: A pasted reply MUST be applied per field on explicit accept, never wholesale.
- **FR-026**: A malformed or empty reply MUST alter nothing and MUST say plainly that nothing could be read.
- **FR-027**: Saved content MUST NOT be attributed to an assistant in any field written to ServiceNow.

**Saving**

- **FR-028**: Saving MUST update the change record identified by the loaded change number, in place.
- **FR-029**: The feature MUST NOT create a new change record under any circumstance.
- **FR-030**: Nothing MUST be written to ServiceNow until the operator explicitly saves.
- **FR-031**: The review step MUST show the target change number together with the full content that will be
  written, before the operator commits.
- **FR-032**: A save failure MUST preserve the rebuilt content so the operator can retry without rebuilding.
- **FR-033**: A rebuild MUST be bound to the change number it was started from; it MUST NOT be applied to a
  different change loaded later in the session.

### Key Entities

- **Target Change** — the ServiceNow change the rebuild will be written to: its number, its editable state, and the
  fact that it already exists. The only thing carried forward from the loaded change.
- **Rebuild Draft** — the blank-slate change under construction: scope, content, planning answers, environments,
  and schedules. Identical in shape to a new change, plus its binding to the Target Change's number. Transient until
  saved.
- **Scope Basket** — the working set of Jira issues assembled for this rebuild, built from one or more searches,
  with each issue individually included or excluded.
- **Scope Source** — one contribution to the basket: a project + fix version lookup, a free-form query, or a single
  issue key. A basket may have several.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can take an existing open change from "the scope changed" to a saved, fully rebuilt change
  in under five minutes, without leaving the Modify Existing CHG flow and without retyping any issue detail.
- **SC-002**: Rebuilding to a fix version plus one extra issue takes no more than two searches.
- **SC-003**: 100% of rebuilds reuse the original change record — the feature never produces a second change number
  for the same work.
- **SC-004**: No stale value from the discarded change survives into a saved rebuild in any field.
- **SC-005**: Abandoning a rebuild at any point before saving leaves the change in ServiceNow byte-identical to how
  it was found.
- **SC-006**: The destructive step is never reached without an explicit confirmation, and no operator can discard a
  change's content by a single mis-click.
- **SC-007**: The rebuild is fully usable by an operator who has never unlocked the assisted enhancement.
- **SC-008**: An operator can state, at every step of the rebuild, which change number they are about to overwrite.

## Assumptions

- **Same tab, additional option.** The rebuild is an addition to the existing Modify Existing CHG flow, not a new
  tab. The change's existing edit steps continue to work exactly as they do today for operators who never start over
  — targeted edits remain the right tool for a small correction.
- **The existing change-building flow is reused, not rebuilt.** The scope query modes, the additive add-to-loaded
  behaviour, the issue selection list, content generation, the gated assisted enhancement, and the planning,
  environment, and review steps all exist for change creation. The rebuild points them at an existing change; only
  the terminal action differs — update a known record rather than raise a new one.
- **"JQL or FixVersion or both" means additive, not a union query.** Consistent with the operator's own description
  of the workflow, "both" is achieved by fetching one source and then adding another.
- **A quick key search is a search like any other.** Adding one issue by key is the same add-to-basket action with a
  narrower search, not a separate mechanism.
- **Blank means blank.** "As if it's a new change" is taken literally: nothing from the loaded change pre-fills any
  step. Saved templates and pinned values still apply, because those are what a new change would start from too.
- **Overwrite is the intent, not a hazard to design around.** Concurrent edits made by others in ServiceNow are
  overwritten by the save. This follows directly from "delete everything and start from a template"; no merge or
  conflict-detection behaviour is implied.
- **Change tasks are not part of the rebuild** — see Out of Scope. The operator did not mention them, and silently
  deleting change tasks that may already be assigned or approved would be destructive beyond what was asked. Worth
  confirming at plan time if the operator expects a rebuild to clear them too.
- **Approval state is not managed here.** Whether a rebuilt change must return through approval is a process
  question outside the tool; the tool only warns when a change is not in an editable state.

## Dependencies

- **Jira issue search** must be reachable to build a scope. An empty result set must be distinguishable from an
  unreachable Jira (FR-015).
- **The ServiceNow connection** used by the Modify Existing CHG flow to load changes and to save the rebuild.
- **The existing assist unlock**, shared app-wide, gates the assisted enhancement only.

## Out of Scope

- **Creating a new change** — the rebuild always writes to the change number it was started from.
- **Adding, removing, or re-writing the change's change tasks (CTASKs)** as part of the rebuild.
- **Recovering or displaying the change's previous scope**, and any added / unchanged / removed comparison.
- **Merging or reconciling** the rebuild against the change's current content — the rebuild replaces it wholesale.
- **Detecting or resolving concurrent edits** made by other people in ServiceNow.
- **Rebuilding more than one change at a time.**
- **Anything that writes to Jira** — this feature reads issues only.
- **Managing approval or CAB state** after a rebuild.
- **Automated or background assisted content of any kind.**
