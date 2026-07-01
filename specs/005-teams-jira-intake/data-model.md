# Phase 1 Data Model — Teams → Jira Intake (Toolbox importer)

Entities are client-side TypeScript shapes (in `client/src/views/JiraIntake/lib/intakeTypes.ts`)
plus two persisted blobs in the shared Confluence content property. No server schema changes.

## 1. IntakeSubmission

One normalized Teams submission (from one file row). Produced by `normalizeSubmission`.

| Field | Type | Rules |
|-------|------|-------|
| `id` | `string` | Required, unique. Dedup key. Reject row if blank. |
| `submittedAt` | `string` (ISO 8601) | Required for ordering; keep raw cell text if unparseable. |
| `status` | `'New' \| 'Imported' \| string` | From the file; Toolbox treats anything ≠ `Imported` as importable, but local ledger overrides. |
| `submitter.displayName` | `string` | May be empty; used in the origin note. |
| `submitter.email` | `string` | Drives reporter resolution; may be empty → fallback path. |
| `fields.summary` | `string` | **Required core field** — row flagged if blank. |
| `fields.description` | `string` | Optional. |
| `fields.acceptanceCriteria` | `string` | Optional. |
| `fields.issueType` | `string` | Optional at parse; mapping/validation resolves it. |
| `fields.priority` | `string` | Optional. |
| `extras` | `Record<string,string>` | Any unknown columns, preserved (FR-5.2 forward-compat). |
| `rowIndex` | `number` | Source row for error messages. |
| `parseErrors` | `string[]` | Non-empty → row shown as **invalid** in queue, never created. |

**Normalization rules**: accept flat (`submitterEmail`, `summary`) OR nested/dotted
(`submitter.email`, `fields.summary`) keys; trim whitespace; a blank required core field
(`id`, `summary`) adds a `parseError` rather than throwing.

## 2. IntakeConfig (persisted)

The single active v1 configuration. Persisted in the Confluence content property under
`nodetoolbox.intake.v1`.

| Field | Type | Rules |
|-------|------|-------|
| `projectKey` | `string` | Required. |
| `projectId` | `string` | Numeric Jira project id. |
| `issueTypeId` | `string` | Required. |
| `issueTypeName` | `string` | Display. |
| `fieldMappings` | `IntakeFieldMapping[]` | Core-field → Jira-field bindings (below). |
| `autoCreateOnImport` | `boolean` | `true` = create on import; `false` = review-and-pick (FR-1.3). |
| `updatedAt` | `string` (ISO) | Last save. |
| `updatedBy` | `string` | From `getMyself()`. |

### IntakeFieldMapping

| Field | Type | Rules |
|-------|------|-------|
| `coreField` | `'summary'\|'description'\|'acceptanceCriteria'\|'issueType'\|'priority'` | Source. |
| `jiraFieldId` | `string` | Target Jira field (e.g. `summary`, `description`, `customfield_10xxx`). |
| `jiraFieldType` | `TemplateFieldType` | From the Template Maker field model. |
| `transform` | `'wikiMarkup' \| 'choiceByName' \| 'raw'` | How to coerce the value. |
| `fixedValue` | `unknown` (optional) | When set, overrides the submission value (FR-1.2 constants). |

## 3. QueueEntry (in-memory)

The per-submission view state the queue renders.

| Field | Type | Notes |
|-------|------|-------|
| `submission` | `IntakeSubmission` | The normalized row. |
| `state` | `'new' \| 'invalid' \| 'creating' \| 'imported' \| 'failed' \| 'skipped'` | Drives the badge. |
| `jiraKey` | `string \| null` | Set once created (from ledger or fresh create). |
| `blockingReasons` | `string[]` | Missing required field, drifted option, malformed row (FR-2.4). |
| `reporterOutcome` | `'matched' \| 'fallback' \| null` | Whether submitter resolved to a Jira user. |

State transitions: `new → creating → imported | failed`; `new → invalid` (never creatable until
fixed upstream); `new → skipped` (dismissed in review mode); an id already in the ledger loads
directly as `imported`.

## 4. ProcessedLedger (persisted)

Local dedup record, persisted alongside the config (content property `nodetoolbox.intake.v1`).

| Field | Type | Rules |
|-------|------|-------|
| `entries` | `ProcessedEntry[]` | Append-only in practice. |
| `ProcessedEntry.id` | `string` | Submission id (dedup key). |
| `ProcessedEntry.jiraKey` | `string` | Created issue key. |
| `ProcessedEntry.createdAt` | `string` (ISO) | When Toolbox created it. |
| `ProcessedEntry.reporterOutcome` | `'matched' \| 'fallback'` | Audit of attribution. |

**Invariant (SC-4)**: a create appends its `ProcessedEntry` before success is surfaced; any later
import whose row `id` is in `entries` is rendered `imported`, never re-created.

## 5. Reused shapes (no redefinition)

- `TemplateFieldEntry`, `TemplateFieldType`, `FieldDescriptor`, `AllowedOption` — from
  `JiraTemplateMaker/lib/templateTypes.ts`.
- `CreateIssueRequest`/`CreateIssueResponse`, `JiraMyself`, `JiraProject` — from `jiraApi.ts` types.
