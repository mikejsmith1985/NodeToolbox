# Contracts — Teams → Jira Intake (Toolbox importer)

The intake feature exposes **internal module contracts** (pure functions + hooks) and consumes
**existing Jira/Confluence proxy endpoints**. It defines no new HTTP surface (Toolbox is local; the
only new I/O is reading a user-dropped file). Contracts below are the stable interfaces tasks build
and test against.

## A. File → records

```ts
// parseSubmissions.ts — thin SheetJS boundary (I/O)
parseWorkbook(file: File): Promise<RawRow[]>
//   RawRow = Record<string, string>  (header-keyed; Submissions sheet preferred, else first sheet)
//   throws IntakeParseError with a clear message when the file is not a readable workbook/CSV

// normalizeSubmission.ts — pure
normalizeSubmission(row: RawRow, rowIndex: number): IntakeSubmission
//   accepts flat (summary) OR nested/dotted (fields.summary, submitter.email) keys
//   blank required core field (id, summary) → pushed to parseErrors (never throws)
//   unknown columns preserved in `extras`
```

## B. Mapping + validation

```ts
// mapToTemplateFields.ts — pure
mapToTemplateFields(sub: IntakeSubmission, config: IntakeConfig): TemplateFieldEntry[]
//   applies fixedValue overrides; transforms per IntakeFieldMapping.transform

// reuse from JiraTemplateMaker/lib:
buildCreatePayload(entries, { projectKey, issueTypeId }): CreateIssueRequest
validateRequiredFields(entries, fieldDescriptors): { missing: string[] }   // requiredFields.ts
detectDrift(entries, fieldDescriptors): DriftFinding[]                      // drift.ts
```

## C. Reporter resolution

```ts
// jiraApi.ts — NEW thin wrapper (Data Center pattern)
searchUsers(query: string, maxResults?: number): Promise<JiraUser[]>
//   GET /rest/api/2/user/search?query=<q>&maxResults=<n>
//   on DC 400 "username query parameter was not provided" → retry ?username=<q>

// resolveReporter.ts — pure over an injected searchUsers
resolveReporter(email: string, deps: { searchUsers }): Promise<
  { outcome: 'matched'; reporter: { name: string } }
| { outcome: 'fallback'; reporter: null }>
//   unique case-insensitive emailAddress match → matched; else/ambiguous/error → fallback
//   fallback reporter:null means "omit reporter on create" → Jira attributes the issue to the
//   /jira-proxy account (configuration.jira). That IS the integration account (see research R4).

// describeSubmitter.ts — pure
describeSubmitter(sub: IntakeSubmission): string   // wiki-markup origin note prepended on fallback
```

## D. Persistence (Confluence content property, reused mechanism)

```ts
// useIntakeConfig.ts
loadIntakeConfig(): Promise<{ config: IntakeConfig | null; ledger: ProcessedLedger }>
saveIntakeConfig(config: IntakeConfig): Promise<void>          // merge-then-persist, conflict-safe
recordProcessed(entry: ProcessedEntry): Promise<void>          // append to ledger, persist
//   property key: nodetoolbox.intake.v1  (separate from the template library property)
```

## E. Orchestration hooks

```ts
// useIntakeQueue.ts
useIntakeQueue(config, ledger): {
  entries: QueueEntry[];
  ingestFile(file: File): Promise<void>;   // parse → normalize → dedup vs ledger → newest-first
  count: { total; new: number; imported; invalid };
}

// useCreateFromSubmission.ts
createFromSubmission(entry: QueueEntry): Promise<QueueEntry>    // validate → resolve reporter →
//   buildCreatePayload → createIssue → recordProcessed → returns entry with jiraKey/state
createAllNew(entries: QueueEntry[]): Promise<QueueEntry[]>      // sequential, ledger-guarded
```

## F. Consumed existing endpoints (unchanged)

| Purpose | Call |
|---------|------|
| Issue type fields (createmeta) | `getIssueTypeFields(projectKey, issueTypeId)` |
| Project id resolution | `getProject(projectKey)` |
| Create issue | `createIssue(payload)` → `POST /rest/api/2/issue` |
| Current user (config author) | `getMyself()` |
| Config/ledger store | Confluence content-property read/write via `confluenceApi.ts` |

## Error contract

- Unreadable file → `IntakeParseError`, surfaced as a clear non-technical dropzone message; no queue
  state changes (FR-6.1, SC-5).
- Per-row validation/drift failure → that `QueueEntry.state = 'invalid'` with `blockingReasons`; other
  rows unaffected (FR-2.4).
- Create failure → `state = 'failed'`, no ledger entry written, retryable; never a partial issue
  (FR-3.3).
