# Feature Specification: Bulk Feature Re-write

**Feature Branch**: `feature/030-bulk-feature-rewrite`

**Created**: 2026-07-26

**Status**: Draft

**Input**: User description: "Now I want to build a bulk 're-write' utility in the Feature composition tool. I want to provide a list of Jira keys, then feed the prompt to AI to re-write them all in the designated format, finally I want an export to show the before and after side by side, so I can send it to the PO for review and approval. Once approved I want to be able to submit the changes to Jira. This could take days between running it and receiving approved re-writes and the re-writes may be changed. As a master UX developer design a process that is able to achieve this with nearly 0 friction and doesn't break any of the rules we have in place about how AI can or can not be leveraged within toolbox."

## Context

The Feature Composition tool can already re-document a single Feature into the standard nine-section format with the propose-only AI flow. This feature scales that to a **batch**: a Product Owner pastes a list of Jira keys, generates one AI re-write for the whole set, reviews an original-vs-proposed comparison, exports a shareable before/after document for a reviewing PO to approve, and — once approved — submits the accepted (possibly edited) re-writes back to Jira.

The defining constraint is **time and asynchrony**: days can pass between generating the re-writes and getting them approved, and the re-writes may be edited along the way. So the batch is not a one-shot wizard — it is a **persisted, resumable workspace** with a clear per-issue state (captured → proposed → reviewed/edited → approved → submitted), that a PO can leave and return to without losing a thing.

The second defining constraint is the project's **AI rules**, which this feature must not bend: AI is **propose-only** (a prompt is generated for the operator to run in their own assistant, and a structured reply is pasted back — there is **no automated or background AI channel**), it is **gated** behind the AI unlock, the re-written content uses the **nine-section format** with validation markers, and the output **never attributes itself to AI**. The multi-day gap is a **human approval loop**, not a background job — the tool simply holds state across it.

## Clarifications

### Session 2026-07-26

- Q: Where does a batch persist (so "resume days later" works)? → A: Local browser storage (matching the existing draft pattern), plus explicit **export/import of the batch** as the cross-machine backup/escape hatch.
- Q: How does the reviewer's approval + edits re-enter the tool? → A: The tool is the **single source of truth** — the operator records approval and applies the reviewer's edits in the tool; the exported document is read-only.
- Q: What form does the before/after export take? → A: **Both** — copy to clipboard as Markdown **and** download a self-contained HTML file (side-by-side, opens in any browser).
- Q: On submit, when the source issue changed in Jira since capture? → A: **Flag as changed-since-capture and hold it out of the bulk submit**; the operator chooses per item — re-capture, submit anyway (overwrite), or skip. Never a silent overwrite; never a whole-batch block.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start a batch and generate re-writes (Priority: P1)

A PO opens the bulk re-write workspace, pastes a list of Jira keys, and the tool captures each issue's current summary, description, and acceptance criteria. The PO unlocks AI, generates one re-write prompt covering the whole batch, runs it in their assistant, and pastes the structured reply back. The tool produces, per issue, a proposed re-write in the standard nine-section format (with validation markers where the source was thin) and saves the whole batch so it survives closing the tool.

**Why this priority**: This is the core value — turning a list of keys into a set of proposed, consistent re-writes in one pass. Without it nothing else exists. It is the MVP.

**Independent Test**: Paste several valid keys, confirm each issue's current content is captured, generate the prompt (covering all keys), paste a well-formed reply, and confirm each issue now has a proposed nine-section re-write and the batch persists after reload.

**Acceptance Scenarios**:

1. **Given** a list of valid Jira keys, **When** the PO starts a batch, **Then** each issue's current summary, description, and acceptance criteria are captured and shown as the "before".
2. **Given** a captured batch and unlocked AI, **When** the PO generates the prompt, **Then** the prompt contains every issue's current content and the rules for the nine-section format, and instructs a structured reply keyed by Jira key.
3. **Given** a well-formed reply, **When** the PO ingests it, **Then** each issue gets a proposed nine-section re-write (description + acceptance criteria), sections the source could not substantiate are flagged, and nothing is attributed to AI.
4. **Given** an ingested batch, **When** the PO closes and reopens the tool, **Then** the batch — keys, captured originals, and proposed re-writes — is exactly as it was left.

---

### User Story 2 - Review and edit before/after (Priority: P1)

The PO reviews each issue as an original-vs-proposed comparison, edits any proposed re-write freely, and sets a per-issue state (e.g. still reviewing, approved, or rejected). Every edit and state change is saved immediately, so the review can span days and multiple sittings.

**Why this priority**: The re-writes are proposals a human must be able to correct before anyone approves or submits them — "the re-writes may be changed" is explicit. Review + edit + durable state is what makes the batch trustworthy and resumable. It is as essential as US1.

**Independent Test**: Open an ingested batch, edit one proposed re-write, mark one issue approved and one rejected, reload the tool, and confirm the edits and states are intact.

**Acceptance Scenarios**:

1. **Given** a proposed batch, **When** the PO opens an issue, **Then** the original and the proposed re-write are shown side by side (or clearly togglable) so differences are obvious.
2. **Given** a proposed re-write, **When** the PO edits it, **Then** the edit is kept as the item's current proposed text and saved immediately.
3. **Given** any issue, **When** the PO sets its state (reviewing / approved / rejected), **Then** the state is saved and reflected in the batch summary.
4. **Given** edits and states, **When** the tool is reopened later, **Then** they are preserved without loss.

---

### User Story 3 - Export a before/after document for approval (Priority: P1)

The PO produces a single, self-contained before/after document for the whole batch (or a chosen subset) and shares it out of the tool with a reviewing PO. The document shows, per issue, the original and the proposed re-write clearly enough for someone with no access to the tool to review and respond.

**Why this priority**: The approval happens **outside** the tool, over days — the export is the artifact that makes that loop possible. Without it, the "send it to the PO for review and approval" step has nothing to send. It completes the MVP triad with US1/US2.

**Independent Test**: From an ingested batch, generate the export and confirm it contains every included issue's key, original, and proposed re-write in a readable side-by-side layout that stands alone (no tool needed to read it).

**Acceptance Scenarios**:

1. **Given** a batch, **When** the PO exports it, **Then** a self-contained before/after document is produced that can be copied or downloaded and read without the tool.
2. **Given** the export, **When** a reviewer reads it, **Then** each issue's key, original content, and proposed re-write are clearly paired and attributed to the issue.
3. **Given** a batch where some issues are excluded (e.g. rejected), **When** the PO exports, **Then** only the chosen issues appear.
4. **Given** any export, **When** it is read, **Then** it contains no statement attributing the re-writes to AI.

---

### User Story 4 - Approve and submit to Jira (Priority: P2)

After the reviewer approves (and the PO applies any requested edits), the PO submits the approved re-writes to Jira. Only approved items are written, each issue is written independently with its own outcome, and a write that fails does not block the rest. Submitted items are marked so a re-run never re-submits or duplicates them.

**Why this priority**: Submission is the payoff, but it depends on an approved, reviewed batch (US1–US3). Separating it lets the write path be built and proven on its own, and it is the step with real Jira side effects that must be safe.

**Independent Test**: With a batch where two items are approved and one rejected, submit; confirm only the two approved items are written to Jira with their current (edited) text, each reports its own result, and the rejected item is untouched.

**Acceptance Scenarios**:

1. **Given** an approved item, **When** the PO submits, **Then** its current proposed description and acceptance criteria are written to that Jira issue via the standard field mapping, and the item is marked submitted.
2. **Given** a mix of approved and non-approved items, **When** the PO submits, **Then** only the approved items are written; the rest are untouched.
3. **Given** a submit where one issue's write fails, **When** it fails, **Then** the failure is reported for that issue and the other items still submit.
4. **Given** an already-submitted item, **When** the PO submits again, **Then** it is not re-written (no duplicate/overwrite from a re-run).

---

### User Story 5 - Resume a batch days later (Priority: P2)

The PO reopens a saved batch after days away, sees at a glance where every issue stands, and continues — editing, approving, exporting again, or submitting. Because the source issue may have changed in Jira since capture, the tool can tell the PO when an issue's live content no longer matches what was captured, so they are not silently overwriting newer work.

**Why this priority**: The multi-day lifecycle is the whole point; resuming safely (including detecting upstream drift) is what makes the workflow usable in reality rather than only in a single sitting. It builds on the persisted batch from US1/US2.

**Independent Test**: Save a batch, simulate time passing and reopening, confirm the batch and every per-issue state load intact; change a source issue upstream and confirm the tool flags that issue as changed-since-capture before submit.

**Acceptance Scenarios**:

1. **Given** several saved batches, **When** the PO returns, **Then** they can find and reopen a batch and see each issue's state and a batch-level summary.
2. **Given** an open batch, **When** the PO resumes, **Then** all captured originals, proposed re-writes, edits, and states are exactly as left.
3. **Given** an issue whose live Jira content changed since capture, **When** the PO **submits it (or runs an explicit "check for changes")**, **Then** the tool flags it as changed-since-capture and holds it out of the write so the PO can decide before overwriting. (The check runs at submit time and on demand — not automatically on every open, to keep resuming friction-free.)

---

### Edge Cases

- **Invalid, duplicate, or unreachable keys** at intake: each is reported per key; the valid ones still form the batch (never a whole-batch failure for one bad key).
- **AI reply is missing an issue, or includes a key not in the batch**: the missing issue keeps no proposal (and is clearly "not yet re-written"); an unknown key is rejected with a reason; the rest ingest.
- **AI reply omits or reorders sections**: the re-write is normalized to the full nine sections in order (missing ones flagged), same as single-issue composition.
- **Re-writes edited after approval**: the item's current (edited) text is always what exports and submits — approval never freezes stale text; any edit after approval reopens that item's review state.
- **Very large batch** that will not fit one prompt: the tool splits the work into a few prompts the PO runs in sequence, and never silently drops issues from the set.
- **Source issue changed in Jira between capture and submit**: flagged as changed-since-capture; the PO decides to re-capture, submit anyway, or skip — never a silent overwrite of newer content.
- **A write that partially succeeds** (e.g. description saved, acceptance criteria rejected): reported per field for that issue; the successful part is not lost.
- **AI is locked**: the prompt-generation and ingest steps are unavailable; capture, review of already-proposed text, export, and submit of already-approved items remain usable.

## Requirements *(mandatory)*

### Functional Requirements — Batch intake & capture

- **FR-001**: The tool MUST accept a pasted list of Jira issue keys (newline- and/or comma-separated), de-duplicated, and MUST report any invalid or unreachable key per key without failing the whole batch.
- **FR-002**: For each key, the tool MUST capture the issue's current summary, description, and acceptance criteria as the immutable "before" (captured at a recorded point in time).
- **FR-003**: A batch MUST be given an identity (name/date) so multiple batches can coexist and be told apart.

### Functional Requirements — AI re-write (propose-only)

- **FR-010**: The tool MUST generate a single prompt (or, when the batch is too large, an ordered set of prompts) that contains every issue's current content and instructs a **structured reply keyed by Jira key**, following the project's propose-only AI pattern — a prompt the operator runs in their own assistant and pastes back; there MUST be **no automated or background AI channel**.
- **FR-011**: AI prompt-generation and reply-ingest MUST be **gated behind the existing AI unlock**.
- **FR-012**: On ingest, each issue's proposed re-write MUST be produced in the **standard nine-section format** (Description, Benefit Hypothesis, Acceptance Criteria, Assumptions, Dependencies, In Scope, Out of Scope, Risks, NFR), with under-supported sections **flagged for validation**, and MUST **never attribute the content to AI** — identical rules to single-issue composition.
- **FR-013**: The ingest MUST map each proposed re-write to its issue by key; a reply entry whose key is not in the batch MUST be rejected with a reason, and a batch issue with no matching reply entry MUST remain clearly "not yet re-written".

### Functional Requirements — Review, edit & state

- **FR-020**: For each issue, the tool MUST present the original and the proposed re-write as an at-a-glance before/after comparison.
- **FR-021**: The PO MUST be able to edit any proposed re-write; the edited text becomes the item's current proposal.
- **FR-022**: Each issue MUST carry a state the PO controls — at minimum: captured, proposed, reviewing, approved, rejected, submitted, and (on failure) failed — surfaced in a batch-level summary.
- **FR-023**: **Any** edit to an already-approved item's proposal MUST return that item to the `reviewing` state so stale approval is never carried into submission.

### Functional Requirements — Export for approval

- **FR-030**: The tool MUST produce a self-contained before/after document for the batch (or a chosen subset), in **two forms**: **copy-to-clipboard as Markdown** (pastes into email/Teams/Confluence) and **download as a self-contained HTML file** (renders the side-by-side comparison, opens in any browser with nothing installed). Both are readable without the tool.
- **FR-031**: The export MUST pair each included issue's key, original content, and current proposed re-write unambiguously, and MUST **never attribute the re-writes to AI**.
- **FR-032**: The export MUST let the PO exclude issues (e.g. rejected ones) so only the intended set is shared.

### Functional Requirements — Approve & submit

- **FR-040**: Submission MUST write **only approved items**, each issue independently, using the standard field mapping (description and acceptance criteria to the instance's configured fields, resolved by the app's field ids — never a hardcoded field name).
- **FR-041**: The item's **current (edited) proposed text** MUST be what is submitted; approval MUST NOT freeze an earlier version.
- **FR-042**: A per-issue write failure MUST NOT block the other items; each issue's outcome (and any per-field failure) MUST be reported, and successful writes MUST NOT be lost.
- **FR-043**: A submitted item MUST be marked so a re-run never re-writes or duplicates it (idempotent submission).
- **FR-044**: Nothing MUST be written to Jira without an explicit per-issue approval and an explicit submit action — the tool never writes on its own.
- **FR-045**: An approved item whose proposed content already equals the issue's current live content MUST be treated as a **successful no-op** — marked submitted with nothing written — never reported as a failure.

### Functional Requirements — Persistence, resume & drift

- **FR-050**: The entire batch — keys, captured originals, proposed re-writes, edits, per-issue states, and submission outcomes — MUST persist in **local browser storage** across sessions so a batch can be left and resumed days later without loss (consistent with the existing draft persistence).
- **FR-051**: The PO MUST be able to find, reopen, and continue any saved batch, seeing each issue's state and a batch summary.
- **FR-052**: The tool MUST let the PO **export a batch to a file and import it back**, so a batch can be backed up or moved to another machine (local storage alone is per-machine).
- **FR-053**: On submit, the tool MUST re-read each approved item's live Jira content and, when it differs from the captured snapshot, **flag the item as changed-since-capture and hold it out of the bulk submit**; the PO then chooses per item — **re-capture**, **submit anyway** (overwrite), or **skip**. The tool MUST NOT silently overwrite newer content, and a changed item MUST NOT block the rest of the batch.

### Key Entities

- **Rewrite Batch**: the persisted workspace — id/name, created timestamp, the set of Rewrite Items, and a roll-up of their states.
- **Rewrite Item**: one issue in the batch — Jira key, the captured original (summary, description, acceptance criteria, capture timestamp), the proposed re-write (nine-section description + acceptance criteria), whether it has been edited, its state, a changed-since-capture flag, and its submission outcome.
- **Batch Re-write Reply**: the ingested AI output — entries keyed by Jira key, each carrying the proposed description and acceptance criteria; unmatched keys are rejected.
- **Before/After Export**: the shareable, self-contained document pairing each included issue's original and current proposal for out-of-tool approval.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A PO can turn a list of keys into a set of proposed nine-section re-writes in a single generate-and-paste pass, with no per-issue manual prompting.
- **SC-002**: 100% of a batch's state (originals, proposals, edits, per-issue states, submission outcomes) survives closing and reopening the tool, including across days.
- **SC-003**: A reviewer with no access to the tool can review the whole batch from the exported document alone.
- **SC-004**: On submit, only approved items are written, each with its own reported outcome, and no already-submitted item is ever re-written on a re-run.
- **SC-005**: 0 re-writes or exports contain any statement attributing the content to AI, and every under-supported section is flagged for validation.
- **SC-006**: No Jira write ever occurs without an explicit per-issue approval and submit; AI generation/ingest is unavailable while AI is locked.
- **SC-007**: An issue whose Jira content changed since capture is flagged before it can be overwritten, in 100% of such cases.

## Assumptions

- **Surface**: the batch re-write lives within the Feature Composition tool as its own mode/section, reusing the existing propose-only AI unlock, the nine-section re-write format, the field-id resolution, and the single-issue write path applied per item.
- **Designated format**: "the designated format" is the standard nine-section description plus acceptance criteria (the single-issue composition format); re-write scope is description + acceptance criteria. Structured fields (PI, PO, etc.) are out of scope for the re-write itself.
- **Approval loop is human and off-tool**: the tool is the source of truth; the exported document is shared for review, and the PO records approval and applies the reviewer's edits back in the tool. There is no automated round-trip and no background AI — the multi-day delay is entirely the human review, which the persisted batch spans.
- **Persistence & portability** (resolved in Clarifications): the batch lives in local browser storage like the existing drafts; an explicit batch export/import file is the cross-machine backup path. Server-side storage is out of scope.
- **Export format** (resolved in Clarifications): copy-to-clipboard Markdown **and** a downloadable self-contained HTML file; publishing to another system (e.g. Confluence) is a possible later addition, not required here.
- **Drift detection** (resolved in Clarifications): "changed-since-capture" compares the live issue's current description/acceptance-criteria against the captured snapshot at submit time; the item is held out and the PO chooses re-capture / submit-anyway / skip — it never auto-resolves and never overwrites silently.
- **Prompt sizing**: one prompt is used when the batch fits; when it does not, the tool splits into an ordered set of prompts the PO runs in sequence, and states plainly how the batch is split.
- **Issue scope**: keys refer to existing issues (Features and similar) that are updated in place; the tool never creates issues and never changes issue type.
- **Reuse & agree-by-construction**: the re-write format, validation flags, no-AI-attribution, and field-id-correct writes are the same mechanisms single-issue composition uses, applied per item — so the batch cannot drift from the single-issue behavior.

## Out of Scope

- Any automated, scheduled, or background AI — all AI use is on-demand, gated, manual prompt-out/reply-in, and propose-only.
- Creating new Jira issues, changing issue type, or re-writing fields other than description and acceptance criteria.
- An automated approval round-trip (e.g. the reviewer editing inside a live shared surface that syncs back); approval is recorded by the tool operator.
- Re-writing issues outside a batch, or single-issue re-write (that is the existing Feature Composition flow).
- Publishing the export to Confluence or emailing it from the tool (the operator shares the produced document themselves).
- Bulk changes to non-text structured fields, links, or workflow status.
