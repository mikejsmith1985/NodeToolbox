# Contracts — Intake Deduplication (Phase 2A)

Internal module + hook contracts. Consumes the existing Jira proxy (`/rest/api/2/search`, create);
no new HTTP surface. Contracts are what tasks build and test against.

## A. Label helper (pure)

```ts
// intakeLabel.ts
const INTAKE_LABEL_PREFIX = 'intake-';

/** Builds the dedup label for a submission id, or null when the id can't form a valid label. */
buildIntakeLabel(submissionId: string): string | null
//   trims; returns null if empty or contains whitespace; else `intake-<id>`

/** True when a submission id can be stamped as a label. */
isStampableId(submissionId: string): boolean

/** Given an issue's labels, returns the submission id it was stamped with (strips prefix), or null. */
extractSubmissionId(labels: string[]): string | null
```

## B. Jira search wrapper

```ts
// jiraApi.ts — NEW
searchIssuesByLabels(labels: string[], maxResults?: number): Promise<JiraLabelSearchIssue[]>
//   GET /rest/api/2/search?jql=labels in ("l1","l2",...)&fields=labels&maxResults=<n>
//   returns [{ key, labels }]; [] for an empty input; chunks large label lists internally
export interface JiraLabelSearchIssue { key: string; labels: string[] }
```

## C. Reconcile (pure)

```ts
// reconcileExisting.ts
buildFoundIdToKey(results: JiraLabelSearchIssue[]): {
  idToKey: Map<string, string>;
  ambiguousIds: Set<string>;   // ids matched by >1 issue
}

reconcileExisting(entries: QueueEntry[], idToKey: Map<string,string>, ambiguousIds?: Set<string>): {
  entries: QueueEntry[];       // matched ids → imported+key; ambiguous → invalid+reason; others unchanged
  newLedgerEntries: ProcessedEntry[];  // for matched ids not previously known
}
```

## D. Create-hook additions (`useCreateFromSubmission`)

```ts
// stamp on create — buildIntakeFields now includes the label
buildIntakeFields(submission, config, projectKey): { ...; labels: ['intake-<id>'] }

// batched pre-scan (called by the view after ingestFile)
reconcileExisting(entries: QueueEntry[]): Promise<QueueEntry[]>
//   ids of state==='new' rows → searchIssuesByLabels → reconcile → recordProcessed for matches
//   on search failure: entries unchanged (rows stay new); surfaced via a returned/logged reason

// per-row guard inside createFromSubmission (before createIssue):
//   found unique  → return imported+key (+recordProcessed), NO create
//   ambiguous     → return invalid with the keys, NO create
//   check-failed  → return failed with a retry reason, NO create
//   not-found     → proceed to create (payload carries the intake-<id> label)
```

## E. Consumed existing endpoints (unchanged)

| Purpose | Call |
|---------|------|
| Existence check | `searchIssuesByLabels(['intake-<id>', ...])` → `/rest/api/2/search?jql=labels in (...)` |
| Create issue (now stamped) | `createIssue({ fields: { …, labels: ['intake-<id>'] } })` |
| Local cache | `recordProcessed(entry)` (feature 005 `useIntakeConfig`) |

## Behavior contract (invariants)

- **Never create when a stamped issue exists** (found or ambiguous) — FR-002/003.
- **Never create when the check fails** — surface for retry, no partial change — FR-007.
- **Cache-first**: rows already in the ledger are `imported` with no Jira call — FR-005.
- **All create paths stamped + guarded**: auto-create, bulk, per-row, retry — FR-008.
- **Every created issue carries `intake-<id>`** and is findable by that label — FR-001/010.
