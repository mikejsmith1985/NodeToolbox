# Feature Specification: Release Document

**Feature Branch**: `feature/038-release-document`

**Created**: 2026-10-01

**Status**: Draft

**Input**: User description: GH #395 (latest comment) — pick an unreleased fixVersion and maintain a Confluence release
document for it: every Epic with its children planned for that release (status, assignee), a deployment-steps table
(PR, repo, workflow run, branch, job type, application, environment, repository, tag, task, module, log level),
fixVersion misalignments called out, items following their fixVersion when it changes, one live page per unreleased
fixVersion that has work, managed from Toolbox with one-click Jira refresh. Epics live in other projects than the
team's children (CUC: Epics in DASP and DENP, children in ENCUC; Transformers: Epics in DENP, children in ENFCT).

## Clarifications

### Session 2026-10-01

- Q: Where does the per-deploy data (PR, workflow run, module…) live? → A: In a separate **Deployment Steps** table
  for the release — one row per deploy step — not as columns on every story row. (The GH #395 example is per repo /
  deploy step: application, report and infrastructure.)
- Q: Who supplies deployment data? → A: The user types or pastes it in Toolbox; it is saved with the page. Nothing is
  pulled from GitHub (its API is blocked in this environment).
- Q: Is an Epic included when only some of its children carry the release? → A: Yes, and the mismatch is flagged.
- Q: Which work is in scope? → A: The current Team Dashboard team only — but its Epics may live in several other
  projects, so Epics are found from the team's children, not from the team's project.
- Q: Page layout? → A: One configured parent page; one child page per release.
- Q: Page title format? → A: The release date as **YYYYMMMDD** with a three-letter month name, e.g. **2026Oct14**.
  No team name: each team's pages already live apart.
- Q: What happens when a release ships? → A: Its page is frozen — no further syncing.
- Q: When an item moves to another release, what happens to its hand-entered data? → A: It travels with the item.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Publish a release document for one fixVersion (Priority: P1)

A release manager picks an unreleased fixVersion on the Team Dashboard and publishes a Confluence page for it listing
every Epic that release delivers, each followed by its child issues planned for that release, with each item's key,
summary, type, status and assignee — gathered across every project the team's Epics live in.

**Why this priority**: This is the document the release is managed from; without it nothing else has a home.

**Independent Test**: Choose a fixVersion with children in the team project whose Epics live in two other projects;
publish; confirm the page exists under the parent and lists every Epic with exactly its children for that release.

**Acceptance Scenarios**:

1. **Given** the CUC team and fixVersion "10/14/2026" with ENCUC children under Epics in DASP and DENP, **When** the
   user publishes, **Then** a page "2026Oct14" appears under the parent page with each Epic
   followed by its ENCUC children for that release.
2. **Given** a child with no parent Epic, **When** the user publishes, **Then** the child is listed under a visible
   "No Epic" group rather than dropped.
3. **Given** the page already exists, **When** the user publishes again, **Then** the same page is updated, not
   duplicated.

---

### User Story 2 - Refresh from Jira without losing hand-entered data (Priority: P1)

The user opens the release document in Toolbox, pulls the latest from Jira (statuses, assignees, which items belong),
and saves back — the page reflects Jira, and everything typed by hand is untouched.

**Why this priority**: The point of the document is "no additional overhead"; a refresh that wipes typed data, or a
page that drifts from Jira, defeats it.

**Independent Test**: Enter deployment rows, change an item's status in Jira, refresh and save; the status updates
and every deployment row is unchanged.

**Acceptance Scenarios**:

1. **Given** a saved page with deployment steps, **When** the user refreshes from Jira and saves, **Then** statuses
   and assignees reflect Jira and every deployment step is preserved exactly.
2. **Given** a new child is added to the release in Jira, **When** the user refreshes, **Then** it appears under its
   Epic.

---

### User Story 3 - Record deployment steps (Priority: P1)

The user adds, edits, reorders and removes deployment-step rows for the release — PR (link), repo, workflow run
(link), branch, job type, application, environment, repository, tag, task, module, log level — by typing or pasting.

**Why this priority**: The deploy steps are the operational content the release is executed from (GH #395 example).

**Independent Test**: Add three deployment steps including one marked "PR: to be created", save, reopen; all three
come back in order with links clickable on the page.

**Acceptance Scenarios**:

1. **Given** an open release document, **When** the user adds a step and fills its fields, **Then** saving writes it
   to the page's Deployment Steps table with PR and workflow-run values rendered as links when they are URLs.
2. **Given** a field such as tag reads "Does not matter", **When** saved, **Then** the text is kept as written.

---

### User Story 4 - See fixVersion misalignments (Priority: P2)

Where an Epic and its children disagree about the release — the Epic carries this fixVersion but some children do not,
or a child is in this release while its Epic names a different one or none — the page and Toolbox say so beside the
item.

**Why this priority**: Misalignment is how work silently ships early, late, or not at all.

**Independent Test**: Give an Epic fixVersion A and one child fixVersion B; both pages flag the pair, naming both
versions.

**Acceptance Scenarios**:

1. **Given** an Epic with this fixVersion and a team child carrying another, **When** the document is built, **Then**
   the Epic is listed with a misalignment flag naming the child and its fixVersion.
2. **Given** a child in this release whose Epic has no fixVersion, **When** the document is built, **Then** the flag
   says the Epic has none.

---

### User Story 5 - Keep every unreleased release's page current (Priority: P2)

With one action, the user brings every unreleased fixVersion that has work for the team up to date: creates missing
pages, refreshes existing ones, moves items whose fixVersion changed to the right page (with their hand-entered data),
and leaves released versions' pages alone.

**Why this priority**: The user wants a live page per upcoming release without opening each one.

**Independent Test**: Move a child from release A to B in Jira, sync all; it leaves A's page, appears on B's, and any
data attached to it moved too.

**Acceptance Scenarios**:

1. **Given** three unreleased versions with work and one with none, **When** the user syncs all, **Then** three pages
   exist or are updated and none is created for the empty version.
2. **Given** an item moved from A to B, **When** the user syncs all, **Then** it appears only on B's page.
3. **Given** a version was released since the last sync, **When** the user syncs all, **Then** its page is not changed.

---

### Edge Cases

- An Epic is found through a child but the user cannot read the Epic: list the children under the Epic key with an
  "Epic not readable" note — never drop them.
- An Epic carries this fixVersion but has no children in the team project: not included (it is another team's work).
- Two projects have versions with the same name: alignment compares by name, which is the intended behaviour.
- A fixVersion has no release date and its name is not a date: it cannot be titled, so it is listed as "needs a release
  date" and not published.
- The parent page link is missing or invalid: nothing is published, and the user is told what to fix.
- Someone edits the page directly in Confluence between syncs: Jira-sourced cells are rewritten from Jira; the
  Deployment Steps table is read back from the page, so edits made there in Confluence are kept.
- Confluence rejects a save because the page changed meanwhile: re-read and retry once, then report.
- A release has more items than one Jira search returns: all are fetched; none silently truncated.
- Jira or Confluence is unreachable (e.g. off VPN): the action fails with a plain message, and nothing is half-written.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Users MUST be able to choose an unreleased fixVersion of the current Team Dashboard team's project.
- **FR-002**: The system MUST find the release's children as the team project's issues with that fixVersion, and their
  Epics by following each child's parent link to whichever project the Epic lives in.
- **FR-003**: The system MUST also include Epics, in the parent projects found in FR-002 plus the team's configured
  feature projects, whose own fixVersion has the same name, when they have at least one child in the team project.
- **FR-004**: The document MUST list each Epic followed by its children in this release, showing key (linked to Jira),
  summary, issue type, status and assignee for every row, plus a hand-entered **Notes** cell per item; children with no
  Epic MUST appear in a "No Epic" group.
- **FR-005**: The document MUST flag, beside the item, any child/Epic pair whose fixVersions differ by name, including
  an Epic with no fixVersion and an Epic in this release whose team children carry another or none.
- **FR-006**: The document MUST hold a Deployment Steps table with columns PR, Repo, Workflow run, Branch, Job type,
  Application, Environment, Repository, Tag, Task, Module, Log level; PR and Workflow run render as links when they
  are URLs.
- **FR-007**: Users MUST be able to add, edit, reorder and remove deployment steps in Toolbox, by typing or pasting.
- **FR-008**: Refreshing from Jira MUST update only Jira-sourced content; deployment steps and item notes MUST be
  preserved exactly.
- **FR-009**: The system MUST publish each release as a child page of a configured parent page, titled with the
  release date as YYYYMMMDD using a three-letter month name (e.g. "2026Oct14"), updating the existing page rather than
  creating a duplicate. The date comes from the fixVersion's release date, or from its name when that is a date; a
  fixVersion with neither MUST be reported and not published.
- **FR-010**: Users MUST be able to sync every unreleased fixVersion that has team work in one action, creating
  missing pages and updating existing ones; versions with no team work MUST NOT get a page.
- **FR-011**: When an item's fixVersion changes, the next sync MUST show it only on the new release's page, carrying
  any hand-entered data attached to it.
- **FR-012**: Pages for released fixVersions MUST NOT be changed by any sync.
- **FR-013**: The parent page MUST be remembered per team, and an invalid or missing parent MUST block publishing with
  a plain explanation.
- **FR-014**: A failed Jira read or Confluence write MUST leave existing pages unchanged and tell the user what failed.
- **FR-015**: The document MUST show when it was last synced from Jira.

### Key Entities

- **Release**: one unreleased fixVersion of the team project — name, release date, released flag.
- **Epic group**: an Epic (any project) — key, summary, type, status, assignee, its fixVersion names, misalignment
  notes — and its child items in this release.
- **Release item**: a child issue in the team project — key, summary, type, status, assignee, fixVersion names, and
  hand-entered notes (the per-item data that travels when the item moves to another release).
- **Deployment step**: one deploy action for the release — PR, repo, workflow run, branch, job type, application,
  environment, repository, tag, task, module, log level — ordered, hand-entered.
- **Release page**: the Confluence page for one release under the team's parent page — title (YYYYMMMDD, e.g.
  2026Oct14), last-synced time.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A release manager can publish a complete release document for a chosen fixVersion in under 1 minute.
- **SC-002**: 100% of the team project's issues with the chosen fixVersion appear on its page — none dropped, including
  those whose Epics live in other projects or that have no Epic.
- **SC-003**: Refreshing from Jira and saving preserves 100% of hand-entered deployment steps.
- **SC-004**: Every child/Epic fixVersion mismatch in a release is flagged on its page.
- **SC-005**: After one "sync all", every unreleased fixVersion with team work has exactly one up-to-date page, and no
  released version's page has changed.
- **SC-006**: An item whose fixVersion changed appears on exactly one release page after the next sync.

## Assumptions

- The current Team Dashboard team profile supplies the team project, the fixVersion list and the team name.
- Configured feature projects (existing ART settings) are reused as extra places to look for Epics.
- The same Confluence connection PI Review's "Save to Confluence" uses is used here.
- "Released" means Jira marks the fixVersion released.
- Deployment data is entered by hand; integrating GitHub is out of scope while its API is blocked.
- Syncing is user-triggered; a scheduled sync is out of scope for this feature.
