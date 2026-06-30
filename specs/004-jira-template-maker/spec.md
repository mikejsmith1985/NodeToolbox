# Feature Specification: Jira Template Maker

**Feature short name**: `jira-template-maker`
**Created**: 2026-06-30
**Status**: Draft — all clarifications resolved (Q1=A, Q2=A, Q3=A); ready for `/speckit-plan`
**Feature directory**: `specs/004-jira-template-maker/`

## Summary

NodeToolbox gains a **Template Maker**: a guided, no-jargon tool that lets anyone —
regardless of technical experience — build a reusable Jira issue template by picking
a project, an issue type, and the fields they want pre-filled, then entering the
values once. The tool only ever offers choices that are *actually valid* for the
selected project and issue type (real issue types, real fields, real dropdown
options), so a non-technical user cannot construct an invalid issue.

The user works through three dependent pickers that narrow as they go:

1. **Project picker** — choose one Jira project.
2. **Issue type picker** — shows *only* the issue types that project actually offers.
3. **Field picker** — shows *only* the fields available on that issue type in that
   project, and lets the user add the ones they want to the template.

For each added field the user supplies a value, with input behaviour matched to the
field's real type:

- **Choice/dropdown fields** (priority, components, custom select lists, etc.) present
  the *actual* allowed options for that field in that project — the user selects, never
  types a guess.
- **Labels fields** are handled with care: labels are case-sensitive, and the template
  must not introduce duplicate labels (neither within the template itself nor against
  labels already present when an issue is created from the template).
- **Free-text fields** offer rich-text editing with the same formatting affordances a
  user gets when editing the issue directly in Jira (bold, italic, lists, links, etc.),
  so a template can carry a properly formatted description rather than flat text.

The finished template can be **re-used to create a real Jira issue in a single action**,
with no physical template issues to clone and no stray issue links created by human
oversight. The creation mechanism — a direct one-click create through NodeToolbox's
existing Jira layer rather than a pre-filled URL — is resolved in **Clarifications Q1**
(direct create works on the team's **Jira Server/Data Center** instance and on Cloud alike).

NodeToolbox owns all Jira reads (project/issue-type/field/option discovery) through its
existing Jira proxy layer.

## Scope Boundary (explicit non-goals)

- **Out of scope**: Editing or transitioning *existing* Jira issues. This tool creates
  new issues from templates; it does not modify issues already in Jira.
- **Out of scope**: Bulk creation. One template produces one issue per use (a template
  may be reused many times, but each use is a single issue).
- **Out of scope**: Cross-project templates or templates that span multiple issue types.
  A template is bound to exactly one project + one issue type.
- **Out of scope**: Workflow/automation rules, SLAs, or post-creation side effects beyond
  setting the field values defined in the template.
- **Out of scope**: Managing Jira field configurations, screens, or permissions. The tool
  reflects whatever the project already exposes; it does not change it.
- **Out of scope**: Attachments and issue links as templated values (deferred unless a
  clarification elevates them).
- **Out of scope**: ServiceNow, Confluence, or any non-Jira integration.

## Clarifications

### Session 2026-06-30 — resolved

- **Q1 — Issue creation mechanism → Option A (one-click direct create).** Templates create
  the Jira issue directly through NodeToolbox's existing Jira layer. The
  `CreateIssueDetails!init.jspa` prefill URL is rejected as the primary mechanism because
  direct create is superior regardless of Jira flavor: it fully supports custom/dropdown
  fields and rich text, dedupes labels, and is a genuine single click with no manual Create
  step. (The team's confirmed instance is **Jira Server/Data Center**, where the prefill URL
  would technically work, but direct create remains the better choice.)
- **Q2 — Template reuse model → Option A (saved template library).** Templates are named,
  saved, listed, editable, and deletable; reuse is a single click. (Storage scope is resolved
  in the clarify-pass session below: **globally shared**, superseding any per-user default.)
- **Q3 — Rich-text fidelity → Option A (core formatting).** Free-text editing supports bold,
  italic, headings, bullet/numbered lists, links, inline code, and code blocks. Tables,
  panels, @-mentions, smart links, and media are out of scope for this release.

### Session 2026-06-30 (clarify pass)

- Q: Which Jira field types must v1 support? → A: Common set — single/multi choice
  (dropdowns), Labels, and free-text, **plus** user pickers (assignee/reporter),
  dates/datetimes, numbers, components, and fix versions. Cascading/dependent selects and
  other custom field types are out of scope for v1 (shown as "unsupported").
- Q: Fixed values vs prompt-at-launch? → A: Per-field — each templated field is marked
  either **fixed** (frozen value) or **prompt-at-launch** (the user is asked for it each
  time). A template with zero prompt fields launches in a single click.
- Q: Template storage scope & location? → A: **Globally shared** across the NodeToolbox
  instance (any user can launch/edit; author recorded). Templates persist in the **same
  backing store as the Shared ART Workspace** — the shared Confluence Database anchored by
  the `nodetoolbox-shared-art` content property — likely as a new Database/table or added
  fields. Supersedes the earlier per-user default.
- Q: Created-issue reporter identity? → A: **Templatable reporter** — Reporter is a normal
  supported field a template can fix or prompt-at-launch; when left unset, the issue is
  reported by NodeToolbox's integration account (documented behavior).

<details>
<summary>Original clarification options (for the record)</summary>

> **Historical note:** the Q1 options below were framed around an assumed Jira **Cloud**
> instance. The instance was later confirmed to be **Jira Server/Data Center**. The decision
> (Option A, direct create) is unchanged; only the Cloud-specific reasoning is superseded by
> the resolved bullets above.

### Q1 — Issue creation mechanism (scope-critical; Jira Cloud compatibility)

**Context (Summary):** "output should be a direct HTML link … `[JIRA_BASE_URL]/secure/CreateIssueDetails!init.jspa?[ARGUMENTS]` … UNLESS you have a better way to create a reusable template that can be accessed and input via a single click?"

**What we need to know:** How does a template turn into a real Jira issue?

**Important constraint:** The team's Jira instance is **Jira Cloud** (`*.atlassian.net`).
The `CreateIssueDetails!init.jspa` prefill URL is a **Jira Server/Data Center** capability.
On Jira Cloud it is unreliable: custom fields and dropdown selections generally do **not**
prefill from query parameters, and rich-text/ADF formatting cannot be carried in a URL.
It also cannot dedupe Labels against an issue's existing labels (the issue does not exist
yet). This directly conflicts with the rich-text and label requirements above.

| Option | Answer | Implications |
|--------|--------|--------------|
| A *(Recommended)* | **One-click direct create** via NodeToolbox's existing Jira layer (REST create). | Works on Jira Cloud; full support for custom/dropdown fields, rich text, and label dedupe; true single click. Creates the issue immediately (no native review screen first). |
| B | **Prefill URL** (`CreateIssueDetails!init.jspa`) exactly as proposed. | Matches the original request and opens Jira's native create screen for review, but on Cloud most fields (custom, dropdown, rich text) will *not* prefill and label dedupe is impossible — likely fails the stated requirements. |
| C | **Hybrid**: NodeToolbox creates the issue directly (Option A), and *also* offers a "open in Jira's create screen" link where the platform supports it. | Best UX coverage, highest build cost; the direct-create path is the dependable one and the link is a convenience. |
| Custom | Provide your own answer. | e.g. "generate the URL but validate every value via REST first," or a Server/DC target where B is viable. |

**Resolved:** Option A.

### Q2 — Template reuse model (scope-critical)

**Context (Summary):** "a reusable template that can be accessed and input via a single click … we dont [want] the overhead of managing physical templates."

**What we need to know:** Is a template a **saved, named, reusable** definition the user
returns to, or a **one-shot** artifact generated on the spot?

| Option | Answer | Implications |
|--------|--------|--------------|
| A *(Recommended)* | **Saved template library** inside NodeToolbox — name a template once, then launch it with one click any time; edit/delete supported. | Delivers true "single click reuse"; needs lightweight persistence (small field→value definitions, no physical Jira issues). |
| B | **One-shot generator** — build values each visit and create/copy immediately; nothing is stored. | Simplest to build; but "reusable / single click" is lost — the user rebuilds every time. |
| Custom | Provide your own answer. | e.g. "saved per-user vs. shared across the team," or "export/import template definitions." |

**Resolved:** Option A.

### Q3 — Rich-text fidelity for free-text fields

**Context (Summary):** "the same formatting … available when editing the issue directly in Jira."

**What we need to know:** How much of Jira's editor must the template editor reproduce?

| Option | Answer | Implications |
|--------|--------|--------------|
| A *(Recommended)* | **Core formatting**: bold, italic, headings, bullet/numbered lists, links, inline code, code blocks. | Covers the vast majority of description content; bounded, achievable editor scope. |
| B | **Full Jira parity**: everything in A plus tables, panels/info boxes, @-mentions, issue/smart links, emoji, media embeds. | Matches Jira exactly but is a large editor surface; @-mentions/links require extra Jira lookups. |
| Custom | Provide your own answer. | e.g. "core formatting + tables only." |

</details>

## User Scenarios & Testing *(mandatory)*

### Primary user stories

**Story A — Non-technical creator builds a template:**
A program coordinator with no Jira admin knowledge opens the Template Maker, picks their
project from a list, picks "Task" from the issue types that project offers, and is shown
the fields available for a Task. They add Summary, Priority, Components, Labels, and
Description. For Priority and Components they pick from the real option lists; for Labels
they add a few tags; for Description they type a formatted paragraph with a bulleted list.
They save the template as "Weekly Ops Task."

**Story B — One-click reuse:**
Later, the coordinator opens "Weekly Ops Task" and creates a real Jira issue from it in a
single action, without re-entering any values and without cloning an existing issue.

**Story C — Guardrails prevent invalid choices:**
The coordinator never sees an issue type that the project does not have, never sees a field
that the issue type does not support, and can never select a dropdown value that is not a
real option for that field — so the resulting issue is always valid.

**Story D — Labels stay clean:**
The coordinator accidentally adds the label `Ops` twice and also adds `ops`. The tool keeps
`Ops` and `ops` as distinct (case-sensitive) but collapses the duplicate `Ops`, and on
creation does not re-add a label the issue already carries.

### Acceptance scenarios

1. **Given** a user has selected a project, **when** the issue-type picker loads, **then**
   it lists exactly the issue types that project offers and nothing else.
2. **Given** a user has selected an issue type, **when** the field picker loads, **then**
   it lists exactly the fields available for that issue type in that project, and excludes
   fields not on that screen.
3. **Given** a user adds a dropdown/choice field, **when** they open its value control,
   **then** they see the actual allowed options for that field in that project and can only
   choose from them.
4. **Given** a user adds a Labels field and enters `Ops`, `Ops`, and `ops`, **when** the
   template is saved, **then** it stores `Ops` and `ops` once each (case-sensitive, deduped).
5. **Given** a template includes Labels, **when** an issue is created from it, **then** no
   label already present on the created issue is duplicated.
6. **Given** a user adds a free-text field, **when** they format the value (bold, list,
   link, etc.), **then** the created issue shows that same formatting.
7. **Given** a saved template, **when** the user triggers create once, **then** exactly one
   Jira issue is created with all templated values applied (mechanism per Q1) and no
   unintended issue links.
8. **Given** a required field for the issue type is left empty, **when** the user attempts
   to create, **then** they are warned which required field is missing before any issue is
   created.
9. **Given** a template with one field marked prompt-at-launch and the rest fixed, **when**
   the user launches it, **then** they are asked only for that one field's value (pre-filled
   with its default if set) and the fixed values are applied without re-entry.
10. **Given** a template with zero prompt-at-launch fields, **when** the user launches it,
    **then** the issue is created in a single confirmed action with no value entry.
11. **Given** the Jira project/field metadata cannot be retrieved, **when** a picker loads,
    **then** the user sees a clear, non-technical error and the tool does not present stale
    or guessed choices.

### Edge cases

- A project the user can see but lacks permission to create issues in → the tool surfaces
  this before the user invests time building a template.
- A field that is required by the issue type but not added to the template → flagged at
  create time (scenario 8).
- A dropdown field whose option list is very large → the value control remains usable
  (searchable/filterable).
- A label containing spaces or characters Jira disallows → handled gracefully with a clear
  message rather than a silent failure.
- An issue type or field that is removed/renamed in Jira after a template was saved → the
  tool detects the drift and tells the user the template needs review rather than creating
  a malformed issue.
- Cascading/dependent choice fields (option B depends on option A) → **out of scope for v1**;
  shown in the field picker as unsupported and not addable.

## Functional Requirements

### FR-1: Dependent project → issue-type → field selection

- **FR-1.1**: The tool MUST let the user pick exactly one Jira project from the projects
  they can access.
- **FR-1.2**: After a project is chosen, the issue-type picker MUST present only issue types
  valid for that project.
- **FR-1.3**: After an issue type is chosen, the field picker MUST present only fields
  available for that issue type in that project (i.e., on its create screen/field config).
- **FR-1.4**: Changing the project or issue type MUST re-scope the downstream pickers and
  warn the user if previously added fields are no longer valid.

### FR-2: Field value entry matched to field type

- **FR-2.1**: For each added field, the tool MUST present an input appropriate to the
  field's real type. v1 MUST support: single/multi choice (dropdowns), Labels, free-text,
  user pickers (e.g. assignee/reporter), dates and datetimes, numbers, components, and fix
  versions. Field types outside this set — notably cascading/dependent selects — MUST be
  shown in the field picker as **unsupported** (visible but not addable) rather than hidden,
  so the user understands why a field is unavailable.
- **FR-2.2**: For choice/dropdown fields, the tool MUST offer only the actual allowed
  options for that field in that project, and MUST reject free-typed values not in the list.
- **FR-2.3**: For free-text fields, the tool MUST provide rich-text editing supporting core
  formatting (bold, italic, headings, bullet/numbered lists, links, inline code, code
  blocks) per resolved **Q3=A**.
- **FR-2.4**: The tool MUST indicate which fields are required for the chosen issue type.
- **FR-2.5**: For each added field, the user MUST be able to mark it as **fixed** (a frozen
  value stored in the template) or **prompt-at-launch** (no stored value; the user is asked
  for it each time the template is used). A field marked prompt-at-launch MAY carry an
  optional default to pre-fill the prompt.

### FR-3: Labels handling

- **FR-3.1**: Labels MUST be treated as **case-sensitive** (`Ops` ≠ `ops`).
- **FR-3.2**: The tool MUST collapse exact-duplicate labels within a template to a single
  entry.
- **FR-3.3**: On issue creation, the tool MUST NOT add a label already present on the issue
  (no duplication when writing to Jira).
- **FR-3.4**: Labels that Jira would reject (e.g., containing spaces) MUST be surfaced to the
  user with a clear message before creation.

### FR-4: Template reuse

- **FR-4.1**: Per resolved **Q2=A**, templates MUST be named, saved, listed, editable, and
  deletable, and reusable to create issues with no re-entry of fixed values.
- **FR-4.2**: A template MUST store field→value definitions only — never a physical Jira
  issue — so reuse creates no clones and no stray issue links.
- **FR-4.3**: Templates MUST be **globally shared** across the NodeToolbox instance — any
  user can list, launch, and edit any template — with the author recorded on each template.
  The author is the current Jira user's display name, resolved from `GET /rest/api/2/myself`
  (the same identity source NodeToolbox already uses for mention-state); if that lookup fails,
  the author is recorded as `unknown` rather than blocking the save.
- **FR-4.4**: Templates MUST persist in the **same shared backing store as the Shared ART
  Workspace** (the shared Confluence Database anchored by the `nodetoolbox-shared-art`
  content property), via a new Database/table or added fields as needed. They MUST NOT be
  stored only in browser/local state, so they are visible to every user of the instance.

### FR-5: One-action issue creation

- **FR-5.1**: Per resolved **Q1=A**, the user MUST be able to turn a template into a real
  Jira issue via NodeToolbox's direct Jira create path (not a prefill URL). When the template
  has no prompt-at-launch fields this MUST be a single action; when it has prompt fields, the
  user is asked only for those values, then confirms once.
- **FR-5.2**: Before creating, the tool MUST validate that all required fields have values
  and report any gaps without creating a partial issue.
- **FR-5.3**: After creation, the tool MUST give the user a direct way to open the new issue
  in Jira.
- **FR-5.4**: Creation MUST NOT produce any issue link, parent/child relationship, or clone
  artifact that the user did not explicitly define.
- **FR-5.5**: Issues are created via NodeToolbox's integration account. Reporter is a
  templatable field (fixed or prompt-at-launch); when a template does not set Reporter, the
  created issue's Reporter defaults to the integration account, and this MUST be made clear
  to the user (so ownership is never silently misattributed).

### FR-6: Accessibility for non-technical users

- **FR-6.1**: All labels, prompts, and errors MUST be written in plain language (no Jira
  schema jargon, no field IDs shown as the primary label — human field names instead).
- **FR-6.2**: The three-step flow MUST make the user's current step and remaining steps
  obvious, and MUST prevent moving forward until the prerequisite choice is made.

### FR-7: Resilient metadata retrieval & drift detection

- **FR-7.1**: Project, issue-type, field, and option data MUST come from live Jira metadata,
  not hard-coded lists.
- **FR-7.2**: When metadata cannot be retrieved, the tool MUST show a clear error and avoid
  presenting stale/guessed choices.
- **FR-7.3**: When a saved template references an issue type/field/option that no longer
  exists, the tool MUST flag the template for review rather than create a malformed issue.

## Success Criteria

- **SC-1**: A first-time, non-technical user can build and save a working template in under
  5 minutes without external help.
- **SC-2**: 100% of issues created from a template are valid on the first attempt (no Jira
  rejection for invalid field/option/required-field errors).
- **SC-3**: Creating an issue from a saved template takes a single confirmed action and
  under 10 seconds from launch to created issue.
- **SC-4**: 0 dropdown values offered that are not real options for the field/project
  (measured across a representative sample of fields).
- **SC-5**: 0 duplicate labels written to Jira across created issues, with case distinctions
  preserved.
- **SC-6**: Reusing a template requires 0 re-entry of previously supplied values.
- **SC-7**: When Jira metadata is unavailable, 100% of affected pickers show a clear message
  and 0 present guessed data.

## Key Entities

- **Template**: A named, reusable, **globally shared** definition bound to one project + one
  issue type, holding an ordered set of field-value entries plus the recorded author.
  Contains no physical Jira issue. Persisted in the shared ART Workspace backing store.
- **Field-Value Entry**: One templated field plus its value(s); typed (choice, labels,
  free-text, user picker, date, number, components, fix versions) so the right input and
  validation apply, and carrying a **mode** — *fixed* (stores the value) or
  *prompt-at-launch* (stores no value, optionally a default) per FR-2.5.
- **Project / Issue Type / Field / Option (metadata)**: Live Jira-sourced reference data
  that constrains every choice the user can make. Read-only to this tool.
- **Created Issue (outcome)**: The real Jira issue produced by reusing a template; the tool
  records enough to link the user straight to it.

## Assumptions

- The team's Jira is **Jira Server/Data Center** (confirmed via the configured Jira base URL,
  not Cloud). This sets the technical contract: the classic `/rest/api/2/issue/createmeta`
  endpoint and **wiki-markup** text fields (not Cloud's ADF). The Q1 direct-create decision is
  unchanged (it works on both flavors); only the serializer/endpoint specifics follow from this.
- NodeToolbox's existing Jira proxy/credentials can read project, issue-type, field, and
  option metadata, and create issues, for the projects the user can access.
- "Fields available for an issue type" means the fields the project exposes for that issue
  type's create screen / field configuration.
- A template targets a single project + issue type (multi-target is out of scope).
- Rich-text values are stored as **Jira wiki markup** (Server/DC) and written verbatim to the
  target text field at the fidelity chosen in Q3 (core formatting).
- Templates are **globally shared** and persist in the Shared ART Workspace backing store
  (shared Confluence Database, property `nodetoolbox-shared-art`); a new Database/table or
  additional fields may be added there. This store is reachable via the existing authenticated
  Confluence proxy for all instance users.

## Dependencies

- Live Jira metadata APIs (project list, issue types per project, fields per issue type,
  allowed options per field) via the existing NodeToolbox Jira proxy.
- Jira issue-creation capability via the same proxy, with credentials that permit creating
  issues in the target projects.
- Existing NodeToolbox configuration for Jira base URL and authentication.
- The Shared ART Workspace backing store (shared Confluence Database, property
  `nodetoolbox-shared-art`) and its authenticated Confluence proxy, used to persist templates
  for all instance users.
