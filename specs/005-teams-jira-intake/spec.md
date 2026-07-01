# Feature Specification: Teams → Jira Issue Intake

**Feature short name**: `teams-jira-intake`
**Created**: 2026-06-30
**Status**: Draft — clarifications resolved with the user; ready for `/speckit-plan` (Phase 2)
**Feature directory**: `specs/005-teams-jira-intake/`

## Summary

Let people who do **not** use NodeToolbox (and have no Teams↔Jira integration) request Jira
issues from **Microsoft Teams**, and let a Toolbox user turn those requests into real Jira
issues. The flow has two phases that meet at a shared **bridge store**:

- **Phase 1 — Teams capture (built outside this repo, by the user).** A Microsoft Teams +
  Power Automate workflow: a persistent **"New Request"** button card in an intake channel opens
  an **Adaptive Card form** capturing a fixed **core field set**; on submit the flow appends a
  **submission row** (core values + submitter identity + a unique id/timestamp + `Status=New`) to a
  **standard-connector store** — a **SharePoint list or an Excel workbook** (the only license-free
  Power Automate write path; see Clarifications).
- **Phase 2 — Toolbox import (this feature).** The user exports/downloads the store as a file
  (Excel/CSV) and **drags it into Toolbox** (v1). Toolbox parses the rows, shows an **intake
  queue**, **maps** the core fields to real Jira fields via a template (reusing the Jira Template
  Maker), and **creates the Jira issue** — setting the **reporter to the submitter** when
  resolvable. Dedup is by submission **`id`** so re-importing the same file never double-creates.

This feature is **additive** to the Jira Template Maker: it reuses that tool's field model,
field→value mapping, and issue-creation logic, adding the intake source, the queue, the
field-mapping configuration, and the submitter→reporter resolution.

## Scope Boundary (explicit non-goals)

- **Out of scope (this repo)**: Building the Teams app / Power Automate flow itself. Phase 1 is
  authored by the user in their tenant. This spec defines the **submission-record contract** so
  the two phases interoperate, and the implementation work here is the **Toolbox importer**.
- **Out of scope**: A native Teams↔Jira integration or a Toolbox-hosted inbound webhook/endpoint
  (Toolbox is local and cannot receive inbound calls). The bridge is a store both sides reach.
- **Out of scope (v1)**: Automatic polling of the store. v1 imports on a manual action so nothing
  auto-creates while triage still happens in Jira.
- **Out of scope (v1)**: Multiple simultaneous intake configurations. v1 supports one active
  intake configuration (one project + issue type + field mapping).
- **Out of scope**: Replacing the Jira Template Maker or its shareable-link path; this is an
  additional use case alongside it.
- **Out of scope**: Anything that depends on Atlassian **Rovo** (removed from the tenant).

## Clarifications

### Session 2026-07-01 — store pivot (Power Automate premium constraint)

- **Confluence bridge is NOT viable.** In the user's tenant, Power Automate's **HTTP action and
  the Confluence/Jira/ServiceNow connectors are all premium** and unavailable (and elevated access
  / app registrations are a hard no-go). So no "POST to a webhook/API" path works from Teams.
- **Store → SharePoint list or Excel workbook via a STANDARD connector** ("Create item" /
  "Add a row into a table") — the only license-free write path. The submission-record fields are
  unchanged; they become columns/row values.
- **Toolbox ingest (v1) → drag-and-drop file import.** The user downloads the store as Excel/CSV
  (Excel download, or SharePoint's built-in Export) and drags it into Toolbox, which parses it
  client-side (Toolbox already bundles an Excel parser). **No server-side SharePoint/Graph auth, no
  premium connector, no elevated access, no inbound endpoint.**
- **Live pull is a v2 upgrade** (not v1): read the SharePoint list live via a browser-relay using
  the user's authenticated session (the same pattern Toolbox already uses for ServiceNow) — only if
  desired later; still no app registration.
- **Dedup by `id`** (file re-imports are expected): a submission already turned into an issue is
  never created again, tracked by Toolbox locally on `id`.

### Session 2026-06-30 — resolved with the user

- **Bridge store → Confluence (primary).** Toolbox already reads/writes Confluence via an API
  token (Rovo-independent). Power Automate writes submissions there. The user will **verify
  Power Automate can write to Confluence** during Phase 1; if it cannot, a fallback store (e.g. a
  SharePoint list) is a documented contingency that would require a new Toolbox reader. The
  submission-record **contract** (fields below) is store-agnostic.
- **Trigger → "New Request" button card** in the intake channel that opens the Adaptive Card form
  (not a DM).
- **Fields → fixed core set**, mapped to real Jira fields in Toolbox via a template.
- **Create → Toolbox creates the issue directly** (no prefill link on this path).
- **Reporter → the submitter**, resolved from the stamped email/UPN via Jira user search at
  create time; if unresolvable, the **integration account** is the reporter **and** the
  submitter's name/email is recorded in the issue description.
- **Dedup → `id` + `Status`.** Each record carries a unique id; Toolbox flips `Status` `New →
  Imported` and writes back the Jira key after creating, so re-reads never duplicate.
- **Triage → configurable.** v1 default: create on import (triage continues in Jira). Build a
  **review queue** so that later the team can review and create only selected submissions
  (toggle: auto-create-on-import vs review-and-pick).
- **Import → manual** "Import / Refresh" action in v1; submissions shown **newest-first**.

## User Scenarios & Testing *(mandatory)*

### Primary user stories

**Story A — Requester (non-Toolbox user) submits from Teams:**
A stakeholder with no Jira/Toolbox access opens the intake channel, clicks **New Request**, fills
the Adaptive Card (e.g. summary, description, type, priority), and submits. They get a
confirmation in Teams. They never touch Jira or Toolbox.

**Story B — Toolbox user imports and creates issues:**
A Toolbox user opens the intake view, clicks **Import / Refresh**, and sees the new submissions
(newest-first) with who submitted them and when. With auto-create on, each new submission becomes
a Jira issue; the issue's **reporter is the original requester**. The submission shows its created
Jira key and is marked Imported.

**Story C — Review-and-pick (configurable, future-facing):**
With auto-create off, imported submissions sit in a **queue**. The Toolbox user reviews them and
**creates only the ones to move forward**; the rest stay pending (or are dismissed). Created ones
are marked Imported with their Jira key; nothing is created twice.

**Story D — Submitter can't be matched to a Jira user:**
A submission comes from someone with no matching Jira account. The issue is still created, with
the **integration account as reporter** and the submitter's name/email recorded in the
description, so the origin is never lost.

### Acceptance scenarios

1. **Given** the store holds three `New` submissions, **when** the user clicks Import/Refresh,
   **then** all three appear newest-first with submitter and timestamp, and none that are already
   `Imported` reappear as new.
2. **Given** auto-create is **on** and a new submission, **when** it is imported, **then** exactly
   one Jira issue is created with the core fields mapped per the intake template.
3. **Given** a submission whose submitter email matches a Jira user, **when** the issue is created,
   **then** that user is the **reporter**.
4. **Given** a submission whose submitter cannot be matched, **when** the issue is created, **then**
   the reporter is the integration account **and** the description records the submitter's
   name/email.
5. **Given** an issue was created from a submission, **when** the user imports again, **then** that
   submission is **not** created a second time (it is `Imported` with its Jira key shown).
6. **Given** auto-create is **off**, **when** submissions are imported, **then** they sit in the
   queue and **no** issues are created until the user explicitly creates them.
7. **Given** a required Jira field is not provided by the mapping, **when** creation is attempted,
   **then** the submission is flagged with the missing field and **no** partial issue is created.
8. **Given** the store is unreachable, **when** the user imports, **then** a clear error is shown
   and no partial state is recorded.

### Edge cases

- A malformed/partial submission record (missing core field) → flagged in the queue, not silently
  created.
- The same submission processed concurrently by two imports → created once (dedup on `id`/`Status`).
- Writing `Status=Imported`/Jira-key back to the store fails after the issue was created → the
  submission is marked locally as processed (by `id`) so a retry never double-creates, and the
  write-back is retried/surfaced.
- A submission whose mapped option value no longer exists in Jira → flagged for review (reuses the
  Template Maker's drift handling) rather than creating a malformed issue.
- Store holds a very large backlog → the queue remains usable (paged/limited with a clear count).

## Functional Requirements

### FR-1: Intake configuration

- **FR-1.1**: The tool MUST let an admin configure one active intake: the bridge-store location,
  the target **project + issue type**, and the **mapping** from each core intake field to a Jira
  field (reusing the Template Maker's field model + mapping).
- **FR-1.2**: The mapping MUST support fixed values and constant defaults in addition to
  submission-driven values (e.g. a fixed component, a default priority).
- **FR-1.3**: The tool MUST expose a toggle: **auto-create on import** vs **review-and-pick**.

### FR-2: Import & queue

- **FR-2.1**: The user MUST be able to **drag and drop (or pick) an exported Excel/CSV file** of
  submissions into Toolbox; Toolbox parses the rows and lists them **newest-first** with submitter,
  timestamp, and core values. (v1 ingest is a file, not a live pull.)
- **FR-2.2**: Submissions already turned into issues MUST NOT be created again on re-import (dedup
  by submission **`id`**, tracked locally by Toolbox) — re-importing the same or a superset file is
  safe.
- **FR-2.3**: In review-and-pick mode, the queue MUST let the user create or dismiss individual
  submissions; created ones show their Jira key.
- **FR-2.4**: The queue MUST clearly flag submissions that cannot be created (missing required
  field, drifted option, malformed row) with the reason, without blocking the others.

### FR-3: Issue creation

- **FR-3.1**: Creating an issue MUST map the core fields per the intake template and create it via
  the existing Jira create path.
- **FR-3.2**: The **reporter** MUST be set to the submitter when the stamped email/UPN resolves to
  a Jira user; otherwise the integration account is reporter **and** the submitter's name/email is
  recorded in the description (FR — origin never lost).
- **FR-3.3**: Required-field validation MUST run before creation; missing fields block that
  submission without creating a partial issue.
- **FR-3.4**: Creation MUST be idempotent per submission `id` — a submission is never turned into
  more than one issue.

### FR-4: Processed tracking & dedup (local)

- **FR-4.1**: After a successful create, the tool MUST record the submission `id` locally as
  processed, along with the created **Jira key**, and show that key in the queue.
- **FR-4.2**: Because v1 ingests a downloaded file (Toolbox does not write to the SharePoint/Excel
  store), dedup is **local by `id`** — a processed submission is skipped on any later import. (A
  future live-pull v2 MAY additionally write `Status=Imported` back to the store.)

### FR-5: Submission-record contract (Phase 1 ↔ Phase 2 interface)

- **FR-5.1**: Each submission record (one per file row / list item) MUST contain: a unique `id`, a
  `submittedAt` timestamp, `status` (Teams sets `New`), a **submitter** (`displayName` + `email`),
  and the **core fields** — confirmed from the real sample as `summary`, `description`,
  `acceptanceCriteria`, `issueType`, `priority`.
- **FR-5.2**: Toolbox MUST tolerate extra/unknown columns (forward-compatible), accept the record
  whether nested (JSON) or flattened (spreadsheet columns like `submitter.email` /
  `fields.summary`), and validate the required core fields are present per row.

Reference sample (from the working Teams flow):

```json
{
  "id": "2921ea40-6eff-47a5-aecf-ae3b6d7b76aa",
  "submittedAt": "2026-06-30T22:31:49.6154481Z",
  "status": "New",
  "submitter": { "displayName": "Michael Smith", "email": "Michael_Smith3@hcsc.com" },
  "fields": { "summary": "Summary", "description": "Description", "acceptanceCriteria": "AC", "issueType": "Story", "priority": "Medium" }
}
```

### FR-6: Resilience & clarity

- **FR-6.1**: Store-unreachable or auth failures MUST show a clear, non-technical message and make
  no partial changes.
- **FR-6.2**: The tool MUST never auto-poll in v1; imports happen only on the user's action.

## Success Criteria

- **SC-1**: A non-Toolbox requester can submit a request from Teams in under 2 minutes with no Jira
  or Toolbox access.
- **SC-2**: 100% of imported submissions that pass validation become exactly one valid Jira issue
  (no duplicates across repeated imports).
- **SC-3**: Reporter is correctly attributed to the submitter for 100% of submissions whose email
  matches a Jira user; the rest are created with the documented fallback and never lose the origin.
- **SC-4**: 0 submissions are created twice across any number of Import/Refresh actions.
- **SC-5**: When the store is unreachable, 100% of import attempts show a clear error and create
  nothing.
- **SC-6**: A Toolbox user can go from "Import" to created issues for a batch of 10 submissions in
  under 2 minutes (auto-create mode).

## Key Entities

- **Intake Submission**: One Teams form submission — `id`, `submittedAt`, submitter (name +
  email/UPN), core field values, `Status` (`New` → `Imported`), and (after import) the created
  `jiraKey`. Lives in the bridge store.
- **Intake Configuration**: The active setup — store location, target project + issue type, the
  core-field→Jira-field mapping (Template Maker reuse), and the auto-create/review toggle.
- **Core Field Set**: The fixed fields the Teams Adaptive Card captures (e.g. summary, description,
  issue type, priority, plus a small number of custom fields) — the contract both phases share.
- **Created Issue (outcome)**: The Jira issue produced from a submission; its key is written back
  to the submission.

## Assumptions

- Power Automate authoring is available to the user; the Teams flow stamps the submitter's
  email/UPN automatically.
- Bridge store is a **SharePoint list or Excel workbook** written by a **standard** Power Automate
  connector (Confluence/HTTP connectors are premium and unavailable). Toolbox never authenticates
  to SharePoint in v1 — it ingests an exported **Excel/CSV file** the user drags in. A live
  browser-relay read is a possible v2, still with no app registration.
- One active intake configuration in v1; multiple later.
- **File drag-and-drop import** in v1 (no scheduler, no live store read); newest-first ordering;
  dedup by `id` tracked locally.
- Reuses the Jira Template Maker's field model, mapping, drift detection, and create path.
- Jira is **Data Center** (per the Template Maker work); reporter is set by username/key.

## Dependencies

- A working Phase-1 Teams + Power Automate workflow (standard connectors only) that appends the
  submission-record fields (FR-5) as rows in a **SharePoint list or Excel workbook**. The real
  sample record has been provided (see FR-5) and finalizes the reader contract.
- The user can **export/download that store as Excel/CSV** (built-in, no special access) to drag
  into Toolbox.
- A client-side spreadsheet parser (Toolbox already bundles one) to read the dropped file.
- Existing Jira create + user-search capability via the Toolbox Jira proxy.
- The Jira Template Maker feature (field model, mapping, create logic) it extends.
