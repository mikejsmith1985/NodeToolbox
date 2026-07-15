# Feature Specification: PO Tool — Feature Splitter & Feature Composition

**Feature short name**: `po-feature-tools`
**Created**: 2026-07-15
**Status**: Draft — clarifications resolved (2026-07-15: independent team/PI selection; split yields smaller
**Features** with the original kept and linked; artifact ingestion = **file upload + Confluence fetch + paste**);
ready for `/speckit-plan`
**Builds on**: the existing **Feature Review** and **PI Review** tabs (Team Dashboard), the **hygiene check engine**
(`hygieneChecks.ts`), the **AI Assist passphrase gate** and its **copy-paste JSON round-trip** (Feature Canvas
`planIngest` / `canvasAiAssist` pattern), the **Feature Review field-write helpers** (`featureReviewFixes.ts`), the
**Jira Template Maker** create path (project-by-key + issuetype-by-id + required-field pre-flight), and the
**Feature Canvas overlay** localStorage draft pattern.

## Summary

Product Owners currently do their two hardest authoring jobs — **breaking a too-large Feature into smaller
increments of value**, and **composing a well-formed Feature from scattered source material** — outside NodeToolbox,
in a mix of Jira, Confluence, spreadsheets, and chat. The tool that already knows the most about a Feature's quality
(the hygiene engine) is not present at the moment the Feature is written, so hygiene becomes an after-the-fact audit
rather than a guardrail.

This feature introduces a **PO Tool**: a dedicated home for Feature-level product-owner work. It **reuses the
existing Feature Review and PI Review tabs as-is** (the same components, not copies), and adds two new authoring
tabs:

- **Feature Splitter** — enter a Feature key, see its content, and cut/paste/edit it into several **smaller peer
  Features**, with **deterministic coaching** on how to split. The original is kept and linked, never closed or
  destroyed. Nothing reaches Jira until the PO reviews and commits.
- **Feature Composition** — gather Confluence pages (fetched by URL), spreadsheets (uploaded), existing Jira keys,
  and pasted notes into **one referenced workspace**, so a Feature can be composed without context-switching, with
  **deterministic coaching on Definition of Ready**. The result is written to Jira either as an **update to an
  existing Feature** or as a **brand-new Feature in a PO-selected project**.

Both tabs offer an **optional, passphrase-gated AI assist** that only ever *proposes* — the PO validates, edits, and
accepts before anything is written. Both tabs **persist work-in-progress across sessions** until it is committed.

The organising principle: **hygiene moves from audit to authoring aid.** Every field the hygiene engine checks on a
Feature is surfaced and satisfiable *inside* the compose/split flow, so a Feature leaves these tabs already clean.

## Clarifications

### Session 2026-07-15

- Q: Does the PO Tool get its own team/PI selection, or share Team Dashboard's? → A: **Independent selection.** The
  PO Tool owns its own team/PI picker; changing it MUST NOT affect Team Dashboard or any other tool. This requires
  making the reused tabs' team/PI context an **explicit input** rather than an implicit read of the app-wide active
  team value — a small, backward-compatible change that leaves Team Dashboard's behavior identical (FR-005, A2).
- Q: What issue type are split increments, and what happens to the original Feature? → A: **Smaller Features**, each
  a peer carrying Feature-level fields and hygiene. The original is **kept** and **linked** to its increments as
  related; it is **never** auto-closed, auto-transitioned, or deleted — the PO closes it manually if they choose.
  This keeps the tool conservative: it adds and links, it never destroys history or touches workflow state (FR-016).
- Q: How does source material get into the Composition workspace? → A: **All three** — **file upload** (`.xlsx` /
  `.xls` / `.csv`), **Confluence fetch by URL**, and **paste** (text/rich-text/tabular), plus **live Jira keys**.
  Discovered during specification: this is substantially cheaper than it appears, because the spreadsheet parser and
  a drag-and-drop file dropzone **already exist and ship in the client** (A14) — the work is reuse plus a Confluence
  read, not a new file-handling subsystem (FR-023, FR-023a–d).

## Why this shape (product rationale)

- **The PO's job is not the team's job.** Team Dashboard is an execution hub scoped to a sprint. Feature authoring is
  a different cadence (PI-level, pre-sprint) and a different audience. Mixing them adds tabs to an already very large
  tool; separating them gives PO work a home without disturbing the team's.
- **Reuse, don't mirror.** Feature Review and PI Review are already the PO's reference surfaces. Copying them would
  create two divergent implementations of the same table — the exact drift already visible between the client and
  server hygiene rules. The tabs must be **the same components**, mounted twice.
- **Splitting is a craft, and coaching beats a blank box.** POs split badly not from carelessness but because the
  good heuristics (by workflow step, by business rule, by data variation, by happy-path-first) aren't in front of
  them. Deterministic, always-on coaching costs nothing and needs no AI.
- **Context-switching is the tax on composition.** A PO writing a Feature has a Confluence page, a spreadsheet, a
  Teams thread, and two Jira tickets open. Pulling those into one referenced workspace is most of the value —
  *before* any AI is involved.
- **Hygiene as a guardrail, not a report.** The hygiene engine already encodes what "complete" means for a Feature.
  Applying that at authoring time is strictly better than flagging it a week later.
- **AI proposes; the human disposes.** The established pattern (Feature Canvas) is: gated, copy-paste round-trip,
  strictly-validated JSON, every item individually accept/reject, and **local overlay only** — Jira writes happen in
  a separate explicit commit. This feature follows it exactly. Removing the AI entirely must leave both tabs fully
  usable.
- **PO work spans days, not minutes.** A split or a composition is interrupted by meetings. Losing the draft on
  refresh would make the tool unusable for its actual users, so drafts persist until committed.

## Scope Boundary (explicit non-goals)

- **Out of scope — changing Feature Review or PI Review behavior.** They are mounted, not modified. Any change is
  limited to making their inputs explicit (props) rather than implicit; behavior in Team Dashboard must be identical
  before and after.
- **Out of scope — replacing the Hygiene tool.** The PO Tool *applies* hygiene rules at authoring time; it does not
  redefine them, and the Hygiene Monitor remains the reporting surface.
- **Out of scope — reconciling the known client/server hygiene rule drift.** Real, documented (see Assumptions A7),
  and deliberately not fixed here; this feature consumes the **client** rules, which are the source of truth.
- **Out of scope — a new AI channel or new gate.** No new always-on outbound AI path, no new passphrase, no direct
  LLM API integration. The existing gate and round-trip are reused as-is.
- **Out of scope — hardening the AI Assist gate's server endpoints.** The gate is client-side only and the
  `/api/ai-assist/*` endpoints are unauthenticated (Assumptions A8). That is a pre-existing condition this feature
  neither worsens nor repairs; it is flagged for a separate security effort.
- **Out of scope — bulk/multi-Feature splitting.** One Feature at a time.
- **Out of scope — live multi-user co-authoring.** Drafts are single-operator and local, matching the canvas overlay.
- **Out of scope — any destructive or workflow-changing Jira write.** The tool creates, updates, and links. It
  **never** deletes an issue, and (per Q2=A) never closes or transitions the original Feature after a split — that
  stays a deliberate human act in Jira.
- **Out of scope — importing a whole spreadsheet as structured data.** An uploaded workbook is *reference material*
  for composing a Feature. This is not a bulk-create importer (that is Jira Intake's job) — no row becomes an issue.
- **Out of scope — inventing Jira projects, issue types, or fields.** The tool only offers what the instance reports.
- **Out of scope — automatic writes.** No scheduler, no background commit. Every Jira write is a deliberate,
  reviewed, human-initiated action.

## User Scenarios & Testing *(mandatory)*

### Primary user stories

**US1 — One home for PO work.** As a Product Owner, I open the PO Tool and find Feature Review and PI Review exactly
as I know them from Team Dashboard, alongside my authoring tabs — so I stop hopping between tools.

**US2 — Split a monster Feature (the core value).** As a PO holding a Feature that is far too big for a PI, I enter
its key, see its full content, and use guided coaching to carve it into 3–5 smaller increments, each of which
delivers value on its own. I edit every increment's text by hand until I'm satisfied, then review a diff of exactly
what will be created and commit it to Jira in one step.

**US3 — Resume a split next week.** As a PO interrupted mid-split, I close the tab, return two days later, and find
my in-progress split exactly as I left it — nothing was written to Jira, and nothing was lost.

**US4 — Compose a Feature from scattered sources.** As a PO with a Confluence brief, a spreadsheet of volumes, and
two related Jira tickets, I bring them all into one workspace, see them side-by-side with my draft, and write the
Feature without ever leaving the tool.

**US5 — Know when a Feature is actually ready.** As a PO, deterministic DoR coaching and a live hygiene panel tell me
which required fields are still missing *while I compose*, so the Feature I create is already clean.

**US6 — Create a Feature that doesn't exist yet.** As a PO composing from scratch with no Jira key, I choose the
target project, satisfy the required fields the instance demands, and create the Feature directly from the tool.

**US7 — Update a Feature I already drafted.** As a PO who stubbed a Feature in Jira last week, I load it by key,
enrich it here, and commit the changes back to that same issue.

**US8 — Optional AI acceleration.** As a PO who has unlocked AI Assist, I can generate a prompt describing my Feature
in my own words plus the gathered material, paste the assistant's reply back in, and review its proposal item by
item — accepting some, rejecting others, editing freely — before anything is written.

**US9 — The tool works without AI.** As a PO who has never unlocked the gate, every tab is fully functional; I see no
AI controls at all and am never blocked.

### Acceptance scenarios

1. **Given** a PO Tool exists in the app catalog, **When** the PO opens it, **Then** it presents Feature Review, PI
   Review, Feature Splitter, and Feature Composition tabs.
2. **Given** the PO Tool's Feature Review tab, **When** compared against Team Dashboard's Feature Review, **Then**
   behavior is identical (same data, same controls, same writes) because it is the same component.
3. **Given** Team Dashboard, **When** the PO Tool ships, **Then** Team Dashboard's Feature Review and PI Review tabs
   behave exactly as before — zero regression.
4. **Given** a valid Feature key in Feature Splitter, **When** the PO loads it, **Then** the Feature's summary,
   description, acceptance criteria, and hygiene-relevant fields are displayed and available to copy from.
5. **Given** a loaded Feature, **When** the PO views the coaching panel, **Then** deterministic split heuristics are
   shown without any AI unlock and without any network call.
6. **Given** a split draft with 3 proposed increments, **When** the PO reloads the browser, **Then** the draft is
   restored intact and Jira is unchanged.
7. **Given** a split draft, **When** the PO opens the review step, **Then** an itemized diff of every issue to be
   created and every link to be made is shown **before** any write.
8. **Given** a reviewed split, **When** the PO commits, **Then** the increments are created in Jira and the result of
   each write is reported individually.
9. **Given** a proposed increment missing a field the hygiene engine requires, **When** the PO views it, **Then** it
   is flagged and satisfiable inline before commit.
10. **Given** a locked session, **When** the PO uses Feature Splitter, **Then** no AI control is visible and the full
    manual split flow works.
11. **Given** an unlocked session, **When** the PO requests an AI split proposal, **Then** a prompt is generated for
    an external assistant, and the reply is ingested only via strict validation.
12. **Given** an ingested AI proposal, **When** the PO reviews it, **Then** each proposed increment is individually
    acceptable/rejectable and freely editable, and **nothing** has been written to Jira.
13. **Given** a malformed or unrelated AI reply, **When** the PO pastes it, **Then** a descriptive validation error is
    shown and the draft is untouched.
14. **Given** Feature Composition, **When** the PO adds a Confluence page by URL, drops a spreadsheet file, pastes a
    note, and references two Jira keys, **Then** all appear as referenced sources alongside the draft in one view,
    each showing where it came from.
14a. **Given** the PO Tool and Team Dashboard are both open, **When** the PO changes the team in the PO Tool,
    **Then** Team Dashboard's team, data, and PI selection are entirely unaffected.
14b. **Given** a committed split, **When** the PO inspects the original Feature in Jira, **Then** its status and
    content are unchanged and it carries a link to each created increment.
14c. **Given** a `.xlsx` with several sheets, **When** the PO adds it, **Then** they can tell which sheet is being
    referenced rather than silently receiving only the first.
15. **Given** a composition draft, **When** the PO views DoR coaching, **Then** deterministic Definition-of-Ready
    guidance and a live checklist of unmet hygiene fields are shown.
16. **Given** a composition draft with no Jira key, **When** the PO commits, **Then** they must choose a target
    project, and the Feature is created there.
17. **Given** a composition draft with an existing Jira key, **When** the PO commits, **Then** that issue is updated
    rather than a duplicate created.
18. **Given** a target project whose Feature type requires a field the draft lacks, **When** the PO attempts to
    create, **Then** the missing required fields are named and the write is blocked until satisfied — no partial
    issue is produced.
19. **Given** a committed draft, **When** the commit succeeds, **Then** the persisted draft is cleared and the PO is
    given the resulting key(s).
20. **Given** a commit that partially fails, **When** the PO views the result, **Then** successes and failures are
    reported per item and the draft is retained for the failures.

### Edge cases

- **Feature key not found / not permitted / not a Feature-like type**: a clear message; the tab stays usable; no
  draft is destroyed.
- **Feature key valid but Jira unreachable (VPN off)**: reported as a connectivity failure, explicitly distinct from
  "no data" — an empty result must never be presented as a successful load.
- **PO edits a Feature in Jira while a split draft is open**: the draft is the PO's authored intent and is not
  silently overwritten; at commit, the original is re-read and any drift is surfaced before writing.
- **Split increments would exceed what the PO intends**: no cap is imposed, but the review step always itemizes every
  issue to be created so a runaway proposal cannot be committed unseen.
- **AI reply proposes an increment referencing an unknown Jira key**: the unknown reference is skipped and reported,
  matching the existing ingest behavior; valid items still ingest.
- **AI reply is valid JSON but the wrong `kind`**: rejected outright — a stray payload from another surface must
  never be misread as a split or a composition.
- **Assistant wraps JSON in prose or code fences**: tolerated and extracted, per the existing round-trip primitive.
- **localStorage unavailable (private browsing) or quota exceeded**: the tab degrades to in-memory for the session
  with an explicit warning that drafts will not survive a reload — it never throws and never silently discards.
- **A stored draft was written by an older version of the app**: it is migrated forward or discarded safely to an
  empty draft; a corrupt draft never breaks the tab.
- **Two drafts for the same Feature key**: a draft is scoped so that returning to the same Feature resumes the same
  draft rather than creating a second one.
- **Target project offers no Feature-like issue type**: the PO is told plainly rather than being offered an invalid
  create.
- **Hygiene field is unconfigured for the instance** (e.g. no Product Owner field configured): the corresponding
  check is skipped rather than false-flagging the draft, matching the engine's existing empty-list guard.
- **Very large source artifact** (a long Confluence page, a wide/multi-thousand-row spreadsheet): it is accepted and
  referenced without freezing the tab; the PO is warned if it is too large to include in a generated AI prompt.
- **Dropped file is not a workbook** (a PDF, an image, a corrupt `.xlsx`): a clear, non-technical message; the
  workspace and draft are untouched.
- **Workbook has multiple sheets**: the PO can see which sheet they are referencing rather than silently getting only
  the first one.
- **Workbook is empty or has no rows**: reported as empty rather than added as a blank source.
- **Confluence URL is malformed, or points to a different instance** than the one configured: rejected with a clear
  message; no partial source is added.
- **Confluence page exists but credentials cannot see it**: reported as a permission failure, distinct from "not
  found" and distinct from "unreachable" (VPN off).
- **Confluence page is fetched, then edited at source afterwards**: the workspace holds what was fetched; the PO can
  re-fetch. The tool never silently mutates a referenced source underneath the PO.
- **Split increments' target project differs from the original's** and lacks the original's Feature type or a
  required field: reported before any write, per FR-034 — no partial creates.
- **Original Feature is closed/Done when a split is committed**: increments are still created and linked; the tool
  does not touch the original's state either way (FR-016b).
- **PO re-locks the AI gate mid-draft**: AI controls disappear; the manual draft and any already-accepted content
  remain fully intact and committable.

## Functional Requirements

### Area 1 — PO Tool shell & reused tabs

- **FR-001**: The system MUST provide a **PO Tool** registered in the app catalog like any other tool, subject to the
  existing tool-visibility administration.
- **FR-002**: The PO Tool MUST present four tabs: **Feature Review**, **PI Review**, **Feature Splitter**, **Feature
  Composition**, using the app's standard tab chrome.
- **FR-003**: Feature Review and PI Review in the PO Tool MUST be **the same components** used by Team Dashboard —
  not copies, forks, or re-implementations. A behavior change to either tab MUST take effect in both tools.
- **FR-004**: Mounting these tabs in the PO Tool MUST NOT change their behavior in Team Dashboard (zero regression).
- **FR-005**: The PO Tool MUST make the team/PI context each reused tab operates on **explicit** at the mount point,
  rather than the tab implicitly resolving it from global state.
- **FR-005a**: The PO Tool MUST have its **own independent** team/PI selection. Changing the PO Tool's selection MUST
  NOT change Team Dashboard's (or any other tool's), and vice versa.
- **FR-005b**: Making the context explicit MUST be **backward-compatible**: a tab mounted without an explicit context
  MUST behave exactly as it does today, so Team Dashboard requires no change and exhibits no behavior difference.
- **FR-005c**: Both tools MUST be able to be open simultaneously (including within Personal Toolbox) with **different**
  team/PI selections, without either tool's selection or data corrupting the other's.
- **FR-006**: The PO Tool MUST NOT require a Team Dashboard visit to function; opening it directly MUST yield a
  usable, clearly-scoped state.

### Area 2 — Feature Splitter (deterministic core, no AI)

- **FR-007**: The PO MUST be able to enter a **Feature key** and load that Feature's content, including summary,
  description, acceptance criteria, and the fields the hygiene engine evaluates for Feature-like issues.
- **FR-008**: The loaded content MUST be presented so it can be **read, selected, and copied** into proposed
  increments, supporting the cut/paste working style.
- **FR-009**: The PO MUST be able to create, edit, reorder, and delete **proposed increments**, editing every field of
  each one by hand, with no AI involvement.
- **FR-010**: The tab MUST display **deterministic split coaching** — concrete heuristics for decomposing a Feature
  into independently valuable increments — always available, requiring no unlock and no network call.
- **FR-011**: Coaching MUST be **guidance, not gating**: it never blocks a PO from splitting the way they judge best.
- **FR-012**: Each proposed increment MUST be evaluated against the **same hygiene rules** the Hygiene tool applies to
  that issue type, with unmet fields flagged and satisfiable inline before commit.
- **FR-013**: The tab MUST show a **review step** itemizing every issue to be created and every link to be made,
  **before** any write occurs.
- **FR-014**: No Jira write MUST occur at any point in the Splitter except through an explicit, human-initiated commit
  from the review step.
- **FR-015**: On commit, the system MUST report the outcome of **each** write individually, retaining the draft for
  any item that failed.
- **FR-016**: Split increments MUST be created as **Feature-like issues of the same type as the original** — peers,
  not children — each carrying Feature-level fields and subject to Feature hygiene.
- **FR-016a**: Each created increment MUST be **linked** to the original Feature as related, and every link MUST
  appear in the review diff before it is written.
- **FR-016b**: The original Feature MUST be **preserved**. The system MUST NOT close, transition, delete, or
  otherwise modify the original's workflow state as part of a split. Closing it remains a deliberate manual act by
  the PO, outside this tool.
- **FR-016c**: The PO MUST be able to choose the **target project** for the increments, defaulting to the original
  Feature's project.

### Area 3 — Feature Splitter AI assist (gated, additive only)

- **FR-017**: The AI assist MUST be gated behind the **existing AI Assist passphrase mechanism** and be invisible and
  inert for any session that has not unlocked it.
- **FR-018**: The assist MUST follow the **established copy-paste round-trip**: generate a prompt for the PO to run in
  an external assistant, and ingest a **strictly-validated** reply — tolerant of assistant chatter and code fences,
  rejecting any payload of the wrong kind, with descriptive validation errors.
- **FR-019**: The generated prompt MUST include the original Feature's content and MUST instruct the assistant to
  propose a breakdown into smaller increments of value, echoing a fixed response shape.
- **FR-020**: An ingested proposal MUST land as **unaccepted proposed increments** in the same editable controls the
  PO operates manually. Every increment MUST be individually acceptable, rejectable, and editable.
- **FR-021**: Ingesting or accepting an AI proposal MUST NOT write to Jira. Jira is reached only via the same explicit
  commit as the manual flow (FR-013/FR-014).
- **FR-022**: No part of the Splitter's function MUST depend on the assist. Removing it entirely MUST leave the tab
  fully usable.

### Area 4 — Feature Composition (deterministic core, no AI)

- **FR-023**: The PO MUST be able to assemble a **composition workspace** referencing multiple sources — Confluence
  material, spreadsheet material, existing Jira keys, and free-text notes — viewable **alongside** the Feature draft
  from a single point, without leaving the tab.
- **FR-023a** *(upload)*: The PO MUST be able to add a spreadsheet by **drag-and-drop or file picker** (`.xlsx`,
  `.xls`, `.csv`). Its tabular content MUST be readable within the workspace. A file that cannot be read as a
  workbook MUST produce a clear, non-technical message and MUST NOT damage the draft.
- **FR-023b** *(Confluence fetch)*: The PO MUST be able to add a Confluence page **by URL**, and the system MUST
  retrieve its content into the workspace. A page that cannot be retrieved (not found, no permission, unreachable)
  MUST report **which** of those occurred, distinctly — an unreachable instance MUST NOT be presented as an empty
  page.
- **FR-023c** *(paste)*: The PO MUST be able to add material by **paste** — plain text, rich text, or tabular — for
  any source the app cannot or should not fetch.
- **FR-023d** *(Jira keys)*: The PO MUST be able to reference **existing Jira issues by key**, retrieved live through
  the existing proxy.
- **FR-024**: Each referenced source MUST be individually viewable, removable, and attributable — the PO can see
  where it came from (file name, page URL, issue key, or "pasted"), and a fetched source MUST retain its origin URL
  as a reference.
- **FR-025**: The PO MUST be able to author the Feature draft's fields **by hand**, with no AI involvement.
- **FR-026**: The tab MUST display **deterministic Definition-of-Ready coaching** — what a ready Feature looks like
  and how to frame/document one effectively — always available, requiring no unlock and no network call.
- **FR-027**: The tab MUST show a **live completeness checklist** derived from the **same hygiene rules** applied to
  Features, naming each unmet field, updating as the PO edits.
- **FR-028**: The checklist MUST **skip** checks whose underlying field is not configured for the instance, rather
  than reporting a field the instance does not use as missing.
- **FR-029**: Coaching and the checklist MUST be advisory: a PO is never prevented from committing by *hygiene*
  (Jira's own required fields are a separate, real block — FR-034).

### Area 5 — Feature Composition AI assist (gated, additive only)

- **FR-030**: The assist MUST be gated by the **same existing passphrase mechanism** (FR-017) and use the **same
  copy-paste round-trip** with strict validation (FR-018).
- **FR-031**: The PO MUST be able to include **their own wording** explaining the Feature, together with the gathered
  source material, in the generated prompt.
- **FR-032**: An ingested reply MUST land as a **proposed draft** in the same editable fields the PO operates
  manually, individually acceptable/rejectable/editable, writing nothing to Jira.
- **FR-033**: The prompt MUST instruct the assistant to produce content covering the fields the hygiene rules require,
  so an accepted proposal starts close to complete.

### Area 6 — Jira write & hygiene completeness

- **FR-034**: Before creating a Feature, the system MUST check the target project/issue-type's **required fields** as
  the instance reports them and MUST **block** the write while any is unsatisfied, naming each — no partial issue is
  ever produced.
- **FR-035**: When the draft has **no** Jira key, the PO MUST select a **target project**, and the system MUST create
  a new Feature there.
- **FR-036**: When the draft **has** a Jira key, committing MUST **update that issue** rather than create a duplicate.
- **FR-037**: The system MUST only offer projects and issue types the **instance reports as available**; it MUST NOT
  invent or hard-code them.
- **FR-038**: Field writes MUST use the app's established instance-correct write behavior (option/user/link/version
  fields resolved against the instance's own metadata) so a write succeeds on both Cloud and Data Center.
- **FR-039**: Every field the hygiene engine checks on a Feature MUST be **reachable and settable** within the
  compose/split flow, so a Feature can leave these tabs hygiene-clean.
- **FR-040**: All Jira reads and writes MUST go through the app's existing proxy layer with its configured
  credentials; no new authentication path is introduced.
- **FR-041**: A failed write MUST surface the instance's actual rejection reason, not a generic error.

### Area 7 — Draft persistence

- **FR-042**: Both tabs MUST persist work-in-progress **across sessions** until it is committed, so a PO can work in
  multiple sittings.
- **FR-043**: A draft MUST be **scoped** such that returning to the same Feature (or the same new-Feature
  composition) resumes that draft rather than starting a second one.
- **FR-044**: A persisted draft MUST NOT be a Jira write. Nothing in a draft reaches Jira until an explicit commit.
- **FR-045**: On a **successful** commit, the corresponding draft MUST be cleared; on a partial or failed commit, it
  MUST be retained.
- **FR-046**: Draft restore MUST **self-heal**: an unreadable, corrupt, or older-version draft MUST degrade to a safe
  empty/migrated state rather than breaking the tab.
- **FR-047**: When persistence is unavailable, the tab MUST remain usable in-memory and MUST **warn** the PO that
  drafts will not survive a reload, rather than silently discarding work.
- **FR-048**: The PO MUST be able to explicitly **discard** a draft.

## Key Entities

| Entity | Source / Owner | Description |
|--------|----------------|-------------|
| PO Tool | NodeToolbox | The new tool shell hosting four tabs and the PO's team/PI context |
| Source Feature | Jira (read) | The existing Feature loaded into the Splitter; the thing being decomposed |
| Proposed Increment | NodeToolbox (draft) | One smaller unit of value proposed from a split — editable, hygiene-evaluated, uncommitted, individually accept/reject when AI-proposed |
| Split Draft | NodeToolbox (persisted) | The full uncommitted split: source key, all proposed increments, accept/reject state; survives sessions until commit |
| Composition Workspace | NodeToolbox (persisted) | The gathered set of referenced sources plus the Feature draft, scoped to one Feature-in-progress |
| Referenced Source | External (Confluence / spreadsheet / Jira / note) | One artifact brought into the workspace for reference, individually viewable and removable |
| Feature Draft | NodeToolbox (draft) | The composed Feature's field values, with or without an existing Jira key |
| Completeness Checklist | Derived (hygiene engine) | The live, advisory view of which hygiene-checked fields the draft has yet to satisfy |
| Required-Field Set | Jira (instance metadata) | What the target project/issue type actually demands — a hard block on create, distinct from hygiene |
| Commit Diff | NodeToolbox (transient) | The itemized set of proposed Jira writes shown for review before any write occurs |
| AI Proposal | NodeToolbox (transient, gated) | A strictly-validated ingested suggestion set; always lands unaccepted, never touches Jira |

## Success Criteria

- **SC-001**: A PO can complete an entire Feature split — load, decompose, review, commit — **without leaving the PO
  Tool** and without opening Jira.
- **SC-002**: Feature Review and PI Review behave **identically** in Team Dashboard before and after this feature
  ships (zero regression), verified against both tools.
- **SC-003**: A behavior change made once to Feature Review or PI Review appears in **both** tools — proving reuse
  rather than duplication.
- **SC-004**: **100%** of a draft's content survives a browser reload and a multi-day gap, with **zero** Jira writes
  having occurred in the interim.
- **SC-005**: A PO who has **never** unlocked AI Assist can complete every task in both new tabs, and sees **no** AI
  controls anywhere.
- **SC-006**: **No** Jira write occurs at any point in either tab except from an explicit human commit after a review
  step — verifiable by observing zero write calls across a full unlocked AI draft-and-ingest cycle.
- **SC-007**: **Every** field the hygiene engine checks on a Feature is settable within the compose flow — a composed
  Feature can reach **zero** hygiene flags at the moment of creation.
- **SC-008**: An attempt to create a Feature missing an instance-required field is blocked with each missing field
  named, and produces **no** issue in Jira (no partial creates).
- **SC-009**: A malformed, wrong-kind, or unrelated AI reply **never** corrupts a draft and always yields a
  descriptive error.
- **SC-010**: An AI-proposed breakdown is fully editable and individually accept/rejectable — a PO can accept a
  subset and commit only that subset.
- **SC-011**: A commit reports per-item success/failure, and a partial failure leaves the failed items still drafted
  and re-committable — no silent loss.
- **SC-012**: A PO can create a Feature in a project of their choosing with no prior Jira key, and separately update
  an existing Feature by key — with no duplicate ever created in the update case.
- **SC-013**: Deterministic coaching is visible in both tabs with **no** unlock and **no** network dependency.
- **SC-014**: A corrupt or stale stored draft never prevents the tab from opening.
- **SC-015**: Changing the PO Tool's team/PI selection produces **no** change in Team Dashboard's selection or data,
  and the reverse — verified with both tools open simultaneously on different teams.
- **SC-016**: After a committed split, the original Feature's **status, workflow state, and content are unchanged**,
  and it is linked to every increment created — zero destructive or workflow side-effects.
- **SC-017**: A PO can bring a Confluence page (by URL), an uploaded spreadsheet, a pasted note, and a Jira key into
  one workspace and see all four alongside the draft **without leaving the tab**.
- **SC-018**: An unreadable file, an unreachable Confluence instance, a permission-denied page, and a not-found page
  each produce a **distinct, accurate** message — and none is ever presented as "empty" or silently swallowed.
- **SC-019**: Adding file upload and Confluence fetch introduces **no new third-party library** and no measurable
  regression in initial load time (the spreadsheet parser stays out of the main bundle).

## Assumptions

- **A1**: The PO Tool is registered through the existing app-catalog/route mechanism and inherits tool-visibility
  administration for free; no new registration concept is introduced.
- **A2** *(confirmed — Q1=A; **cost re-assessed during `/speckit-plan`, see research R1**)*: "Which team is selected"
  is a **single app-wide value**, and the reused tabs read it directly rather than receiving it as input. Independent
  selection is confirmed, so making that input explicit is **in scope** — but the cost is far smaller than first
  feared: the PO Tool holds **its own** profile id and simply never writes the app-wide one (the team-profile list is
  a read-only catalog), and only **one** component needs a change — an optional `dashboardTeamProfileId?` prop on
  Feature Review, defaulting to today's read so Team Dashboard is untouched. The exact prop-else-store idiom already
  ships elsewhere in the same folder. **Correction to an earlier concern:** the shared team-scoped capacity store is
  **not** a blocker for FR-005c — neither reused component touches it (it is reachable only through the Team
  Dashboard PI Review *adapter*, which the PO Tool does not mount), and one view renders at a time per browser
  context regardless.
- **A3**: PI Review already demonstrates cross-tool reuse (two tools mount the same component today via an explicit
  mode + team + PI contract), so it is the proven seam and the model for Feature Review's mount.
- **A4**: Drafts persist client-side, per-operator, scoped by team/Feature — matching the established overlay/draft
  pattern (versioned, self-healing, degrades safely when storage is blocked). No server-side draft store is
  introduced. "Persist in memory till written to Jira" is read as *survives sessions until commit*.
- **A5**: The AI assist reuses the **existing passphrase gate** and the **copy-paste JSON round-trip** with a fixed
  discriminator per surface, strict validation, unaccepted-by-default items, and local-only application — the Feature
  Canvas ingest pattern. No new gate, no new outbound channel, no direct LLM API call.
- **A6**: The automated dispatch-and-poll AI path that some surfaces additionally offer is **not** assumed here; the
  copy-paste round-trip is the baseline. Adding the automated path later is additive and does not change these
  requirements.
- **A7**: The hygiene rules exist in a **client** implementation and a **server** port that have measurably drifted
  (differing check ids, severities, and one server-side no-op). This feature consumes the **client** rules as the
  source of truth and **does not** attempt to reconcile the drift — that is a separate, known issue explicitly out of
  scope.
- **A8**: The AI Assist passphrase gate is a **client-side UI gate only**; the underlying endpoints are
  unauthenticated. This feature adds no capability beyond what those endpoints already expose and does not rely on
  the gate for security — it is a discoverability control. Hardening is out of scope and flagged separately.
- **A9**: Feature creation follows the established create path (project by key, issue type by id, required-field
  pre-flight against instance metadata, empty optionals omitted); field updates follow the established
  instance-correct write helpers. Both Cloud and Data Center remain supported.
- **A10**: "Feature-like" means the issue types the hygiene engine already treats as Features; the tool does not
  introduce its own definition.
- **A11**: An empty result from Jira is treated as a possible **connectivity** failure and reported as such rather
  than rendered as "no data" — a known failure mode when the VPN is down.
- **A12**: Coaching content is authored, deterministic text/heuristics maintained in the app; it is not generated and
  not fetched.
- **A13**: The Splitter operates on one Feature at a time, single-operator, with no concurrent-editing model beyond
  re-reading the original at commit time and surfacing drift.
- **A14** *(confirmed — Q3=C; Framework-First)*: File upload is **largely reuse, not new build**. A spreadsheet
  parser (SheetJS/`xlsx`) already ships as a client dependency and is loaded via **dynamic import** so its weight
  stays out of the main bundle; a drag-and-drop/click-to-pick **dropzone** component accepting `.xlsx/.xls/.csv` and
  a File→rows parser with a typed, user-facing error class already exist in the Jira Intake importer. This feature
  **reuses those patterns** rather than introducing a new file-handling subsystem or a new dependency. Whether the
  existing components are lifted to a shared location or re-implemented against the same primitives is a planning
  decision; either way, no new library is added.
- **A15** *(confirmed — Q3=C)*: Confluence page retrieval uses the **existing server-side Confluence proxy and its
  configured credentials** — the same path the PI Review save already uses. No browser OAuth and no new credential
  are introduced. Consequently a page is only fetchable if the configured account can see it, which is why FR-023b
  requires permission/not-found/unreachable to be reported distinctly.
- **A16** *(confirmed — Q2=A)*: A split **adds and links only**. The tool has no destructive path: it never deletes,
  never closes, and never transitions the original. This keeps the write surface small and makes a mistaken split
  fully recoverable by the PO in Jira.
- **A17**: Increments are created as the **same issue type as the original** rather than a hard-coded "Feature",
  because the hygiene engine treats several types as Feature-like and instances differ. The type is read from the
  original, not assumed.

## Dependencies

- Existing **Feature Review** tab component and its field-write helpers.
- Existing **PI Review** tab component and its cross-tool mode/team/PI contract.
- Existing **app catalog / routing / tool-visibility** registration and the shared tab chrome primitive.
- Existing **team profile / active-team configuration** and the PI/ART context it resolves.
- Existing **deterministic hygiene check engine** (client rules + configurable field ids + enable/disable and custom
  rules) — consumed read-only.
- Existing **Jira proxy layer** with configured credentials, for all reads and commit-time writes.
- Existing **Jira create path** (createmeta issue-type discovery, required-field pre-flight, project-by-key payload).
- Existing **AI Assist passphrase gate**, the **JSON payload extraction** primitive, and the **strict validated
  ingest** pattern — for the gated assists only.
- Existing **scoped localStorage draft** pattern (versioned, self-healing, availability-guarded).
- Existing **Confluence proxy** and its configured credentials — for Confluence page retrieval (FR-023b).
- Existing **spreadsheet parser** (already a client dependency, dynamically imported) and the existing
  **file dropzone / workbook-parse** pattern from the Jira Intake importer — for file upload (FR-023a). **No new
  library is introduced.**
- Existing **Jira issue-link** capability — for relating increments to the original (FR-016a).
