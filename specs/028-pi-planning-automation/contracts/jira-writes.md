# Contract: Jira Write Flows (`piPlanJira.ts`)

The highest-risk surface. Every write **delegates to an existing primitive**; the only new behavior is passing `parent` to `createIssue` for sub-tasks and orchestrating create order. Propose-only: called **only** for a `PlanItemProposal` the PO accepted (FR-052).

## Reused primitives (do not re-implement)

| Operation | Primitive | Location |
|-----------|-----------|----------|
| Create issue (Story/Sub-task) | `createIssue({ fields })` | `services/jiraApi.ts:293` |
| Link Story ↔ Feature | `saveFeatureReviewIssueLinkField` / feature-link field | `featureReviewFixes.ts:417` |
| Set Target Start/End + Due | `savePiReviewFeatureDates` | `piReviewJira.ts:760` |
| Set fixVersion | `saveFeatureReviewFixVersion` | `featureReviewFixes.ts:436` |
| Set story points (dropdown-aware) | `saveFeatureReviewStoryPoints` | `featureReviewFixes.ts:461` |
| Read board sprints | `getBoardSprints` | `jiraApi.ts:219` |
| Create sprint (derived-fill only) | `createSprint` | `jiraApi.ts:196` |
| Assign issue → sprint | `assignIssueToSprint` | `commitJira.ts:38` |
| Discover field ids (name→id) | `loadHygieneFieldConfig` / `matchFieldIdsByName` | `hygieneFieldConfig.ts:76,93` |

Field-id defaults: Target Start `customfield_10101`, Target End `customfield_10102`, PI `customfield_10301`, Feature link `customfield_10108`, Due = native `duedate`; overridable from `tbxARTSettings`.

## New orchestration

```ts
applyPlanItem(item: PlanItemProposal, ctx: WriteContext): Promise<ApplyResult>
```

### Create order (per accepted Feature breakdown)
1. **Ensure sprints**: reuse `getBoardSprints`; for a `sprintCreate` proposal (derived-to-fill), call `createSprint` once. Never create a sprint that already exists (FR-055).
2. **Create Story**: `createIssue({ fields: { project, issuetype: Story, summary, ...featureLink } })`; then `saveFeatureReviewStoryPoints`, `savePiReviewFeatureDates` (Target Start/End + Due), `saveFeatureReviewFixVersion`, `assignIssueToSprint`, set assignee.
3. **Create Sub-tasks** under the new Story key: `createIssue({ fields: { project, issuetype: Sub-task, parent: { key: storyKey }, summary } })` for internal-test (only if `hasTestableOutput`) + deploy INT/REL/PROD; set each sub-task's date field (internal-test end / INT / REL / PROD Due) via `savePiReviewFeatureDates`.

### Idempotency (FR-055)
- An item with `status='existing'` is **skipped** (no create). 
- Creation is resumable: `applyPlanItem` returns the created key so a re-run recognizes it as an `ExistingChild`.

### WriteContext
`{ projectKey, boardId, fieldIds, existingSprintsByName, dryRun?: boolean }`. `dryRun` returns the would-write payloads without calling Jira (mirrors GitHub-intake preview) for test/verification.

## Read: Feature children (`featureChildren.ts`)

```ts
fetchFeatureChildren(featureKey: string): Promise<ExistingChild[]>
```
Requests the Feature's child Stories and each Story's `subtasks` (the field `loadSourceFeature.ts:17` omits today), classifies each by issuetype + naming convention into `ExistingChild.kind`. Read-only.

## Guarantees

- No write occurs for a non-accepted item (FR-052).
- Every write routes through a listed primitive; no ad-hoc Jira calls.
- `dryRun` performs zero writes and returns the full payload set (Article X verification without side effects).
- A failed create surfaces the error and does not orphan half a Story silently — the returned `ApplyResult` reports which sub-items succeeded so the PO can retry (idempotent).

## Test obligations (TDD, vitest, mocked proxy)

- Story create payload carries project + Story type + feature link; sub-task payload carries `parent.key` + Sub-task type.
- Internal-test sub-task is omitted when `hasTestableOutput=false`.
- `status='existing'` item ⇒ zero `createIssue` calls.
- Dates written via `savePiReviewFeatureDates` with the discovered field ids.
- `dryRun=true` ⇒ no proxy POST/PUT; payloads returned.
- Existing sprint reused (no `createSprint`); missing sprint created once.
