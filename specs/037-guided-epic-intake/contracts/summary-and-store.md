# Contract: Summary Table and Intake Store

**Modules**: `intake/intakeSummary.ts` (pure), `intake/epicIntakeStore.ts` (localStorage).
**Covers**: FR-024, FR-025, US5, US6.

## 1. Summary (`intakeSummary.ts`)

```ts
export function buildSummaryRows(intake: EpicIntake, jiraBaseUrl: string): SummaryRow[];
export function renderSummaryMarkdown(rows: readonly SummaryRow[]): string;
export function renderSummaryHtml(rows: readonly SummaryRow[]): string;
export function formatStatedSizes(areaSizes: readonly AreaSize[]): string;
```

**Row set**: one row per item whose kind is `work`, or whose kind is still open (shown as `open`), in source order.
Non-work items (risk, person action, deferred, noise) appear in a second, collapsed group *"Also in the notes"* so
nothing silently vanishes. Set-aside lines are **not** rows.

**Action derivation** — the first matching row wins:

| Condition | Action | Key | Reason |
|---|---|---|---|
| any applicable decision open | `open` | — | `Waiting on: <step>` |
| `owner = fulfillment` | `skippedFulfillment` | — | the owner reason |
| `owner = notActionable` or duplicate `notActionable` | `notActionable` | — | the decision reason |
| duplicate `existing` | `existing` | the matched key | the match reason |
| `draftAccepted = declined` | `declined` | — | `Declined at review` |
| creation `failed` | `failed` | — | Jira's reason |
| creation `created` | `created` | the new key | — |

**Invariant**: a row is never `created` or `existing` without a key, and never has a key while `open` (US5-3, SC-006).

**Columns**: Item · Owner · Action · Jira key (linked) · Label · Stated sizes · Reason.

**Stated sizes** are formatted `Enrollment XL (1.2M) · Fulfillment M · Infra XL · Facets M`, in source order. This is
the only place sizes appear (FR-023).

**Copy** (R-012): `ClipboardItem({ 'text/html': renderSummaryHtml, 'text/plain': renderSummaryMarkdown })`, falling
back to `writeText(markdown)`. The HTML is a plain `<table>` with inline borders and no classes, so it survives
Outlook, Teams and Confluence paste.

## 2. Store (`epicIntakeStore.ts`)

```ts
export const EPIC_INTAKE_STORAGE_PREFIX = 'tbxPoEpicIntake';
export function saveEpicIntake(intake: EpicIntake): boolean;                          // false when storage unavailable/full
export function loadEpicIntake(teamProfileId: string, intakeId: string): EpicIntakeLoadResult;
export function listEpicIntakes(teamProfileId: string): EpicIntakeSummary[];          // newest first
export function deleteEpicIntake(teamProfileId: string, intakeId: string): void;
```

- **Key**: `buildTeamScopedStorageKey(`${EPIC_INTAKE_STORAGE_PREFIX}:${intakeId}`, teamProfileId)`. Intakes are scoped
  per team profile, and one PO's intake cannot overwrite another team's (FR-025).
- **Result**: `EpicIntakeLoadResult = { status: 'loaded', intake } | { status: 'missing' } | { status: 'unreadable', reason }`.
  A wrong `schemaVersion` or a shape that fails `normalizeEpicIntake` → `unreadable`. It is **never** partially loaded,
  and the PO is offered **Discard**.
- **Normalisation**: `normalizeEpicIntake(raw): EpicIntake | null` validates every enum, drops unknown fields, and
  re-derives nothing. Derived values (step, rows) are never stored.
- **When saves happen**: after every ingest, every PO answer, each item's search, and each create transition.
- **Storage unavailable**: `canPersistDrafts() === false` → the intake still runs in memory, with a warning banner:
  *"This browser is not saving — finish in one sitting."*
- **Discard**: confirmation required (US6-2). It removes only the local record; Jira is untouched.
- **Size**: GH #387 produces a record of about 40 KB. Records over `EPIC_INTAKE_WARN_BYTES = 1_000_000` log a console
  warning. No limit is enforced; `saveEpicIntake` returning `false` surfaces the storage error.

## 3. Tests

- Round-trip of a full record. Wrong version → `unreadable`. Corrupt enum → `unreadable`. Team scoping isolates two
  profiles.
- Summary action table: each row above, plus the invariant. Markdown and HTML render every column; HTML escapes `<`,
  `&` and `"` in titles.
