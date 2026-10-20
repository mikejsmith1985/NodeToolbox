# Feature Specification: SNow Hub Wizard (Standalone)

**Feature Branch**: `feature/040-snow-hub-wizard`

**Created**: 2026-10-20

**Status**: Draft

**Input**: User description: "I want to create a new HTML only version of SNow Hub with an easier and more guided path the
whole thing should be more "wizard" oriented. The stand alone SNow Hub will need to connect via browser relay just like it
does inside toolbox. It should have 3 primary functions: 1. Creating and Modifying CHG tickets 2. Creating Jira issues from
PRB tickets 3. Change Management Review for feature 1. It needs to be incredibly intuitive and straight forward so that a
small child could follow along. [...] Select the scope of the change, set the values, enhance with ai, attach evidence,
select the CTASKS that are needed, associate CTASKS with environments as Business Checkout for example is needed in PRD but
not REL. Then run the checks to make sure the ticket will pass RM review. AI should still offer fixes and as long as its
needed generate an email and PDF for Production changes. PRBs will let the user search for a PRB and generate a Defect for
the PRB and an SL and QE story at the same time that share the same epic link but also link to the Defect that was created.
Change Management this is where the RM team can open up any change and validate it against the same criteria we're using
for validation when we create a ticket but instead of focusing on fixing the changes it will offer plain english coaching
back to the CHG MGMT team to forward to the person who created the change."

## Context

SNow Hub inside Toolbox grew one capability at a time: a six-step Create builder, a separate Modify flow whose last step
holds add-issue, outage, PRB linking, CTASK timeline, RCP check and risk check, a Configuration tab, a Release Management
tab hosting CAB Prep / Test Evidence / Scheduled Moves, and a PRB Generator. Every capability works; the path through them
has to be remembered. We now know the whole feature set up front, so a fresh application can be laid out in the order the
job is actually done.

The **SNow Hub Wizard** is a separate, single-page application that offers exactly three jobs, each as a wizard of large,
plainly-worded steps — one decision per screen, the next button always obvious, nothing shown that does not apply.

## Clarifications

### Session 2026-10-20

- Q: Which Jira project do the Defect, SL story and QE story go into? → A: One project for all three, chosen by the user
  from Jira's own project list (remembered as the next default).
- Q: Who can use AI in the shared file? → A: Everyone — AI steps are always visible, with no shortcut or passphrase
  (still copy-prompt / paste-reply, propose-only).
- Q: If the probe shows Jira cannot be reached without a server, what is accepted? → A: Expected path is the same
  bookmark relay used for ServiceNow, as the original standalone Toolbox reached Jira; if the probe proves it blocked, a
  "Send to Jira" hand-off step (Wizard copies the work, one click in the Jira tab finishes it). Never a Toolbox
  dependency.
- Q: How does each Story link to its Defect? → A: "Relates to".
- Q: How does an RM reviewer deliver the coaching note? → A: Copy it, or open it as a pre-addressed email to the
  creator; the reviewer sends it. Nothing is posted to ServiceNow.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Raise a new change, start to finish (Priority: P1)

The user opens the Wizard, connects (one screen that says exactly what to do and turns green when it works), chooses
**New change**, and walks through: **Scope** (choose the Jira work by release or by search, add single issues) →
**Details** (the change's values, pre-filled wherever the scope or a saved template already knows them) → **Enhance with
AI** (optional; copy prompt, paste reply, accept or decline each suggestion) → **Evidence** (attach test evidence) →
**Tasks** (choose which CTASKs this change needs) → **Environments** (tick which environment each CTASK applies to;
Business Checkout ticked for PRD, not REL, by default) → **Checks** (every RM review criterion, each passed, needs action
with one fix, not applicable, or could not check) → **Production extras** (approval email and change-plan PDF, only when
required) → **Create**. The final screen lists every record created and anything that could not be done.

**Why this priority**: New changes are the most frequent and most error-prone job; it is the flow every other story
reuses (the checks drive Story 3; the same steps drive Story 2).

**Independent Test**: With the relay connected, build a REL + PRD change from a release with three issues, keep Business
Checkout on PRD only, accept one AI suggestion, attach one evidence file, fix one failing check, and create. ServiceNow
shows one change per environment, Business Checkout only on the PRD change, the evidence attached, and the email/PDF
offered only for PRD.

**Acceptance Scenarios**:

1. **Given** the relay is not connected, **When** the user opens the Wizard, **Then** the first screen shows numbered,
   plain instructions to connect and does not let the user start a job until the connection is confirmed.
2. **Given** a release is chosen as scope, **When** the user continues, **Then** the issues in that release are listed and
   the user can remove any or add more by key before moving on.
3. **Given** the Details step, **When** a value is required by ServiceNow, **Then** it is chosen from a list taken from
   ServiceNow itself (never typed free-hand), and the step cannot be completed while a required value is empty.
4. **Given** the AI step, **When** the user skips it, **Then** the wizard continues with no AI content and nothing is
   marked as AI-written.
5. **Given** the Tasks and Environments steps, **When** Business Checkout is selected, **Then** it is pre-ticked for PRD
   and un-ticked for REL, and the user can change either tick.
6. **Given** the Checks step, **When** a criterion fails, **Then** it shows in one sentence what is wrong, why RM will
   reject it, and one button that fixes it or returns to the exact step that does; fixing it clears the item.
7. **Given** a criterion the Wizard could not read, **When** checks run, **Then** it reads *could not check*, never
   *passed*, and blocks Create until resolved or explicitly acknowledged.
8. **Given** a change with no Production environment, or a Production change whose window needs no special approval,
   **When** the user reaches the end, **Then** the email and PDF step is skipped and says why.
9. **Given** a Production change that needs approval, **When** the user reaches Production extras, **Then** the approval
   email can be copied and the change-plan PDF saved before or after Create.

---

### User Story 2 - Modify an existing change (Priority: P2)

The user chooses **Change an existing change**, enters a CHG number, and walks the same steps as Story 1, each pre-filled
from the change as it stands in ServiceNow, with changed values highlighted. Checks run against the result. **Save**
writes back to the same change and reports what changed.

**Why this priority**: Rework after RM rejection is the second most common job and reuses every Story 1 step.

**Independent Test**: Load a change missing Business Checkout on PRD and failing two checks; add the CTASK, fix both, save;
ServiceNow shows the CTASK and the corrected values on the same CHG number.

**Acceptance Scenarios**:

1. **Given** a CHG number, **When** the user loads it, **Then** every step opens pre-filled and the summary screen lists
   which steps have changes pending.
2. **Given** a step the user does not need, **When** they choose **Skip — nothing to change**, **Then** that step is left
   untouched in ServiceNow.
3. **Given** a value changed in ServiceNow since the change was loaded, **When** the user saves, **Then** the Wizard warns
   and shows both values before overwriting anything.
4. **Given** a closed or cancelled change, **When** it is loaded, **Then** the Wizard says it cannot be modified and offers
   Change Management Review instead.

---

### User Story 3 - Turn a PRB into Jira work (Priority: P3)

The user chooses **Problem to Jira**, searches for a PRB (by number or words), confirms it, chooses the Jira project
the work goes into and the Epic it belongs to, and reviews three ready-to-create items: a **Defect** for the problem, an **SL story**, and a **QE story**.
One **Create all** makes all three, gives all three the same Epic link, and links each story to the Defect. The final
screen shows the three keys as links.

**Why this priority**: Frequent but smaller than the change job; independent of Stories 1–2.

**Independent Test**: Search a known PRB, pick an Epic, create; Jira shows one Defect and two Stories on that Epic, each
Story linked to the Defect, and the Defect text carries the PRB number.

**Acceptance Scenarios**:

1. **Given** a search, **When** results return, **Then** each PRB shows number, short description and state, and choosing
   one shows its full detail before continuing.
2. **Given** the review screen, **When** the user edits a summary, **Then** the edit is what gets created.
3. **Given** the Defect is created but a story fails, **When** creation ends, **Then** the result shows what exists, what
   failed, and a **Retry the rest** that never creates a second Defect.
4. **Given** the PRB already has Jira work created by the Wizard, **When** the user selects it, **Then** the existing keys
   are shown and creating duplicates requires an explicit confirmation.

---

### User Story 4 - Change Management Review with coaching (Priority: P4)

A Change Management (RM) reviewer chooses **Review a change**, enters any CHG number, and sees the same checks as Story 1
— but read-only. For every criterion that does not pass, the Wizard writes **plain-English coaching** addressed to the
change's creator: what is missing, why it matters, and what a good answer looks like. The reviewer can edit the note and
copy it (or open it as an email) to forward to the creator.

**Why this priority**: Depends on the Story 1 checks; it reuses them rather than adding new ones.

**Independent Test**: Review a change with two failing criteria; the coaching note names exactly those two, in plain
language, and nothing in ServiceNow changes.

**Acceptance Scenarios**:

1. **Given** any change, **When** reviewed, **Then** the verdicts equal what Story 1's Checks step shows for the same change
   at the same moment.
2. **Given** a change that passes everything, **When** reviewed, **Then** the note says it is ready, with no coaching items.
3. **Given** review mode, **When** the reviewer works, **Then** no screen offers a fix or write to ServiceNow.
4. **Given** a criterion that could not be checked, **When** the note is built, **Then** it says so honestly rather than
   coaching the creator about it.

---

### Edge Cases

- The relay tab is closed or the ServiceNow session expires mid-wizard: the current step is kept, a banner says how to
  reconnect, and the user resumes where they were.
- The browser is refreshed or closed mid-wizard: an in-progress new change, modification, or PRB job resumes from its last
  step on return (per job, per user's browser).
- Creating several environment changes and one fails: the result lists which were created; retry creates only the missing
  ones.
- A release in scope has zero issues: the Scope step says so and cannot continue empty.
- A CTASK is ticked for no environment: the Environments step flags it before moving on.
- The AI reply is malformed or names fields that do not exist: the reply is rejected with a plain message; nothing is
  applied.
- Attached evidence exceeds ServiceNow's size limit: the file is refused with the limit stated, before upload.
- The PRB has no description: the Defect is pre-filled with what exists and the empty part is highlighted.

## Requirements *(mandatory)*

### Functional Requirements

**Shell and connection**

- **FR-001**: The Wizard MUST be a separate application from Toolbox's SNow Hub, offering exactly three jobs from its home
  screen: Create or modify a change, Problem to Jira, Review a change.
- **FR-002**: The Wizard MUST reach **both** ServiceNow and Jira through a browser relay that uses the user's own logged-in
  sessions in their own browser tabs (no stored passwords or tokens), and MUST show the status of each connection on every
  screen.
- **FR-003**: The Wizard MUST be delivered as **one self-contained HTML file** that a user can receive (e.g. by email or a
  shared drive), open directly in their browser, and use with **no installation, no Toolbox, and no local server**. Its
  only prerequisites are a supported browser and access to ServiceNow and Jira.
- **FR-003a**: Connecting MUST take no more than a few plain, numbered actions shown on the Connect screen (e.g. "open
  ServiceNow in a tab, click the Wizard button there"), and the Wizard MUST confirm each connection with a live read before
  any job can start.
- **FR-003c**: Jira MUST be reached by the same bookmark relay as ServiceNow. If the browser blocks that relay for Jira,
  every Jira read or write MUST instead go through a **Send to Jira** hand-off: the Wizard prepares the request, the user
  clicks the Wizard bookmark once in the Jira tab, and the result returns to the Wizard. The Wizard MUST NOT require
  Toolbox in either case.
- **FR-003b**: The Wizard MUST keep working in-progress jobs and remembered preferences in the user's own browser only; it
  MUST send nothing anywhere except ServiceNow and Jira.
- **FR-004**: Every step MUST ask for one kind of decision, use everyday words (no internal field names), show progress
  ("Step 3 of 9"), and allow Back without losing entries.
- **FR-005**: Any value that must match ServiceNow or Jira exactly MUST be chosen from that system's own list.

**Change job (Stories 1–2)**

- **FR-006**: Scope MUST support choosing by release, by search, and adding/removing individual issues.
- **FR-007**: Details MUST be pre-filled from a saved change template, the chosen scope, or (when modifying) the existing
  change, and MUST mark every required value.
- **FR-008**: The AI step MUST be visible to every user with no unlock (no shortcut, no passphrase), optional, and
  propose-only: the user copies a prompt, pastes the reply, and accepts or
  declines each suggestion; AI output MUST NEVER be written without acceptance and MUST NEVER claim AI authorship.
- **FR-009**: The Evidence step MUST attach files the user chooses (and MAY gather Jira attachments for the scope) to the
  change.
- **FR-010**: The Tasks step MUST list the CTASK types ServiceNow allows; the Environments step MUST record, per CTASK, which
  environments (REL, PRD, PFIX) it applies to, with default rules (Business Checkout: PRD yes, REL no) the user can change.
- **FR-011**: The Checks step MUST evaluate every RM review criterion Toolbox evaluates today (formula sections, quality-gate
  questions, CTASK rules, restricted-change-period rules, outage record for Production, PRB links) and report each as
  passed, needs action, not applicable, or could not check.
- **FR-012**: A failed read MUST be *could not check*, never *passed*.
- **FR-013**: Each *needs action* item MUST offer one fix — an AI fix suggestion (propose-only) or a jump to the step that
  fixes it.
- **FR-014**: For Production changes that require approval, the Wizard MUST generate an approval email to copy and a
  change-plan PDF to save; for all others the step MUST be skipped with the reason shown.
- **FR-015**: Create MUST make one change per selected environment with only that environment's CTASKs, and report every
  record created and every failure; retry MUST create only what is missing.
- **FR-016**: Modify MUST write to the same CHG number, change only the steps the user edited, and warn on values changed in
  ServiceNow since load.

**Problem to Jira (Story 3)**

- **FR-017**: The user MUST be able to search PRBs by number or text and view the chosen PRB's detail.
- **FR-018**: One action MUST create a Defect, an SL Story and a QE Story, all in the **same** Jira project the user picks
  from Jira's own project list (last choice remembered as the default), all with the same user-chosen Epic link, each
  Story linked to the Defect with a "Relates to" link, the Defect referencing the PRB number.
- **FR-019**: Partial failure MUST be reported per item, and retry MUST never duplicate an item already created.

**Review a change (Story 4)**

- **FR-020**: Review MUST evaluate the same criteria with the same verdicts as FR-011 — one shared set of checks, never a
  second copy.
- **FR-021**: Review MUST NOT write to ServiceNow or Jira.
- **FR-022**: Review MUST produce an editable plain-English coaching note addressed to the change's creator, one item per
  non-passing criterion, each stating what is missing, why it matters, and an example of a good answer. The reviewer
  delivers it by **Copy** or **Open as email** (addressed to the creator, subject naming the CHG); the Wizard never posts
  it to ServiceNow.

### Key Entities

- **Wizard job**: one in-progress run of a job (type, current step, entries so far), resumable.
- **Change draft**: scope, details, AI-accepted values, evidence, CTASK selection, environment plan.
- **CTASK environment plan**: for each chosen CTASK type, the environments it applies to; seeded from default rules.
- **Check result**: criterion, verdict (passed / needs action / not applicable / could not check), reason, fix.
- **Coaching note**: change number, creator, coaching items derived from check results, reviewer edits.
- **PRB job**: PRB, chosen Epic, the three draft issues, created keys.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user with no training creates a valid two-environment change in under 15 minutes without asking
  for help.
- **SC-002**: Changes created through the Wizard pass RM review on first submission at least 90% of the time over the first
  month.
- **SC-003**: A PRB becomes a Defect + SL + QE story set, correctly linked, in under 2 minutes.
- **SC-004**: An RM reviewer produces a forwardable coaching note for any change in under 3 minutes.
- **SC-005**: For any change, Review and the Create/Modify Checks step show identical verdicts 100% of the time.
- **SC-006a**: A new user goes from receiving the file to a confirmed connection to both systems in under 5 minutes, with no
  install step and no help.
- **SC-006**: Every wizard screen asks for no more than one kind of decision, and no screen shows an internal field name.

## Assumptions

- The Wizard **coexists** with Toolbox's SNow Hub; SNow Hub is release-critical and is not removed or changed by this
  feature. Release Management, Sync Monitor, Assignment Groups, Scheduled Moves and CAB Prep stay in Toolbox only.
- **Why standalone (owner's decision, 2026-10-20)**: people struggle with Toolbox setup; a single HTML file is trivially
  shared. This rules out reusing Toolbox's local relay server and its stored Jira credentials.
- **Highest risk, to be proven first in planning**: Toolbox's relay depends on its local server as the go-between, and
  ServiceNow's pages block the simplest direct browser-tab messaging. A server-free relay for both ServiceNow and Jira is
  therefore unproven and MUST be demonstrated against the live systems before any wizard step is built; if it cannot be
  done for Jira, the fallback is the "Send to Jira" hand-off step (see Clarifications); a Toolbox dependency is never
  the fallback.
- The checks are the **same** rules Toolbox already uses (formula card, quality gates, CTASK rules, RCP rules), produced
  from one shared source so the two applications cannot disagree; feature 039's readiness checklist is the same idea and
  the two MUST share one engine. A new rule version reaches Wizard users only when they receive a new file.
- The copy-prompt / paste-reply pattern carries over unchanged; there is no automated AI channel. Toolbox's AI gate
  (shortcut + passphrase) does **not** apply in the Wizard — AI is visible to everyone (owner's decision); Toolbox's own
  gate is unchanged.
- Coaching text is written by rules from the check results; an optional copy-paste AI round may polish it.
- "Production extras needed" uses Toolbox's existing restricted-change-period rules to decide when approval is required.
- The Epic is chosen by the user from a Jira search.
- The PRB flow creates standalone Stories (not sub-tasks), which differs from Toolbox's current PRB Generator by design.
- Users have their own ServiceNow and Jira permissions; the Wizard adds no role gating and ServiceNow enforces who may edit.
- Default CTASK-to-environment rules are editable and remembered per browser.
