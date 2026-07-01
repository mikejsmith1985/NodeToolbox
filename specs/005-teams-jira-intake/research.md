# Phase 0 Research — Teams → Jira Intake (Toolbox importer)

All unknowns resolved against the real codebase and the validated Phase-1 sample. No open
NEEDS CLARIFICATION remain.

## R1 — File parsing (Excel + CSV, client-side)

- **Decision**: Parse the dropped file with the already-bundled **SheetJS `xlsx@^0.18.5`**.
  Read as `ArrayBuffer`, `XLSX.read(data, { type: 'array' })`, take the `Submissions` sheet if
  present else the first sheet, then `XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })`
  to get header-keyed row objects. `xlsx` parses `.xlsx` and `.csv` through the same call, so one
  path covers both of the export options in `phase1-teams.md` §5.
- **Rationale**: Zero new dependency (Framework-First). `raw: false` yields formatted strings so a
  date cell comes back as text rather than an Excel serial; we still re-validate `submittedAt` as an
  ISO string and fall back to the cell text for display.
- **Alternatives rejected**: `papaparse` (CSV-only, not bundled); hand-rolled CSV (fails on quoted
  multiline `description`/`acceptanceCriteria`).

## R2 — Submission shape: flat columns vs nested JSON

- **Decision**: Treat the **flat 10-column Excel shape as the primary contract** and also accept the
  nested JSON shape. Column headers from the validated flow:
  `id, submittedAt, status, submitterDisplayName, submitterEmail, summary, description,
  acceptanceCriteria, issueType, priority`.
  `normalizeSubmission` accepts, per key, either the flat column (`submitterEmail`, `summary`, …) or
  a dotted/nested equivalent (`submitter.email`, `fields.summary`) so a JSON export also works.
- **Rationale**: A downloaded `.xlsx`/CSV always contains **flat** columns (confirmed in GH #105);
  the nested JSON is only the logical record. FR-5.2 requires tolerating both and extra columns.
- **Alternatives rejected**: Nested-only (a real download would never match); strict schema (breaks
  on the extra columns Power Automate/SharePoint add, e.g. `__PowerAppsId__`).

## R3 — Config + processed-`id` persistence

- **Decision**: Store the **IntakeConfig** and the **processed-`id` ledger** in the **shared
  Confluence content property**, reusing the exact mechanism `useTemplateLibrary` +
  `confluenceApi.ts` already use (fetch remote → merge working copy → persist when conflict-free).
  Use a distinct property key (e.g. `nodetoolbox.intake.v1`) separate from the template library.
- **Rationale**: Rovo-independent, already authenticated via the Confluence proxy, team-visible so
  dedup and config are shared — matches FR-4.2 ("tracked locally by Toolbox" = Toolbox-owned store,
  not the dropped file). No new server table (Framework-First, Article VII).
- **Alternatives rejected**: `localStorage` (per-browser, loses team-shared dedup); a new server
  endpoint/table (unjustified when the content-property store already fits).

## R4 — Reporter resolution (Jira Data Center)

- **Decision**: Add `searchUsers(query)` to `jiraApi.ts` using the **proven DC pattern** from
  `SprintDashboard/featureReviewFixes.ts`: try `/rest/api/2/user/search?query=<email>&maxResults=…`,
  and on the DC "username query parameter was not provided" 400, retry
  `/rest/api/2/user/search?username=<email>&maxResults=…`. Match the submitter email to a user's
  `emailAddress` (case-insensitive); on a unique match set `reporter: { name: <username> }` (DC uses
  `name`, not `accountId`). No match / ambiguous / lookup error → **integration-account fallback**:
  omit `reporter` (issue created as the integration account) **and** prepend an origin note to the
  description via `describeSubmitter`.
- **Confirmed identity of the "integration account"** (closes analysis finding U1): the Toolbox
  `/jira-proxy` (`src/routes/proxy.js`) forwards **every** Jira call with the single credential set
  in `configuration.jira` (Basic Auth username+apiToken, or a PAT). So an omitted `reporter` resolves
  to that one configured proxy account — deterministic, never the current UI user. No per-user Jira
  auth exists to worry about.
- **Rationale**: Reuses a pattern already shipped and tested for this exact DC instance. Guarantees
  FR-3.2 / SC-3 and "origin never lost" (Story D).
- **Alternatives rejected**: Cloud `accountId` reporter (wrong flavor); failing the create when the
  reporter can't be matched (violates Story D — issue must still be created).

## R5 — Idempotency / dedup semantics

- **Decision**: Dedup key is the submission **`id`**. On import, partition rows into *new* (id not in
  the processed ledger) and *already-imported* (shown with their stored Jira key, greyed). A create
  succeeds → append `{ id, jiraKey, createdAt }` to the ledger **before** surfacing success, so a
  crash/re-import can't double-create (FR-3.4, FR-4.1, SC-4). Bulk auto-create iterates new rows
  sequentially, each guarded by a re-check of the in-memory ledger.
- **Rationale**: The dropped file is immutable to us (no write-back in v1), so the Toolbox-side
  ledger is the single source of truth for "already created".
- **Alternatives rejected**: Dedup by content hash (summary text repeats legitimately); writing
  status back into the file (out of scope v1).

## R6 — Field mapping (core → Jira) via the Template Maker

- **Decision**: An IntakeConfig references a **project + issue type** and a **core-field→Jira-field
  map**. `mapToTemplateFields` converts a normalized submission's core values into
  `TemplateFieldEntry[]` (the Template Maker's shape), then `buildCreatePayload` produces the create
  body. `requiredFields` validates before create; `drift` flags a submission whose mapped
  choice/option no longer exists in createmeta (FR-2.4 edge case) instead of creating a malformed
  issue. Text fields (`description`, `acceptanceCriteria`) render through `wikiMarkup`.
- **Rationale**: Full reuse of the create/validation/drift stack — the intake feature is explicitly
  additive to the Template Maker (spec Summary). Fixed/constant defaults come for free via the
  existing `mode: 'fixed'` entries (FR-1.2).
- **Alternatives rejected**: A parallel create path (duplicates logic; violates Article VII).

## R7 — Dark-theme tokens (avoid the earlier white-in-dark bugs)

- **Decision**: Use only the confirmed real tokens: `--color-surface`, `--color-surface-2/3`,
  `--color-surface-hover`, `--color-border`, `--color-text-primary`, `--color-text-muted`,
  `--color-success`, `--color-error`, `--color-error-bg`, `--color-accent`, `--color-field-bg`,
  `--color-card-bg-subtle`, `--color-border-warning`. Dropdowns use solid `--color-surface`.
- **Rationale**: The Template Maker shipped fixes for exactly the non-existent tokens
  (`--color-surface-alt`, `--color-success-bg/border/text`, `--color-warning-bg/text`) that rendered
  white in dark mode. Reuse the corrected palette.
- **Alternatives rejected**: Inventing new semantic tokens (caused the prior regressions).
