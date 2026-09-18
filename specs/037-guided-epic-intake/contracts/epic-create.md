# Contract: Epic Create

**Module**: `intake/epicCreate.ts`. Payload building is pure; `runEpicCreates` takes injected dependencies.
**Covers**: FR-020, FR-022, FR-023, FR-027, US4-3…US4-6.

## 1. Exports

```ts
export const EPIC_NAME_FIELD_NAME_PATTERN = /^epic\s*name$/i;
export const INTAKE_SUPPLIED_FIELD_IDS = ['project', 'issuetype', 'summary', 'description', 'labels'] as const;

export function readUnansweredEpicRequiredFields(createFields: readonly CreateMetaFieldEntry[]): { epicNameFieldId: string | null; unanswered: TransitionRequiredField[] };
export function buildEpicCreatePayload(item: IntakeItem, intake: EpicIntake, epicNameFieldId: string | null): CreateIssueRequest;
export async function runEpicCreates(intake: EpicIntake, deps: EpicCreateDeps, onProgress: (intake: EpicIntake) => void): Promise<EpicIntake>;
```

`EpicCreateDeps = { createIssue, searchIssues, nowIso }`.

## 2. Pre-flight (once per batch, before the first create)

1. `epicType` must be `resolved` (`duplicate-search.md` §2); otherwise Create is disabled and the reason is shown.
2. `getIssueTypeFields(targetProjectKey, epicType.id)` → `readUnansweredEpicRequiredFields`:
   - A field that is `required` and has no default (`hasDefaultValue !== true`), whose id is not in
     `INTAKE_SUPPLIED_FIELD_IDS`, and whose **name** matches `EPIC_NAME_FIELD_NAME_PATTERN` → `epicNameFieldId` (filled
     from the summary, never asked).
   - Every other such field → `unanswered`, mapped to `TransitionRequiredField` (`featureReviewFixes.ts:276`).
3. If `unanswered` is non-empty → render `TransitionRequiredFields` once. The answers are stored in
   `batchRequiredFieldValues` and applied to every Epic. Create stays disabled until
   `areTransitionSelectionsComplete` (`featureReviewFixes.ts:357`).
4. A createmeta read failure → Create disabled with Jira's message. Nothing is guessed.

**Field-blind**: no field id is written in source. Epic Name is found by **name** from the live create screen, so the
module passes `fieldMappingBoundary.test.ts` (R-008).

## 3. Payload (`buildEpicCreatePayload`)

```ts
{ fields: {
    project:   { key: intake.targetProjectKey },
    issuetype: { id: intake.epicType.id },
    summary:   draft.summary.trim(),
    description: stripAiAttribution(normalizeFeatureDescription(draft.description)),
    labels:    [labelSlot.value],                  // exactly one of 'Roadmap' | 'Stability' (FR-020)
    [epicNameFieldId]: draft.summary.trim(),       // only when the screen requires it
    ...buildTransitionFieldsPayload(batchRequiredFieldValues)
} }
```

- **Never** includes area sizes, costs, or any AI rationale (FR-023, FR-021).
- Throws (programmer error) if called for an item whose `draftAccepted ≠ accepted` or whose label is unsettled. The
  engine never offers such an item, and the throw keeps it that way.

## 4. The loop (`runEpicCreates`)

For each item, in intake order, where `draftAccepted = accepted` and `creation.state ∈ { notStarted, failed, creating }`:

1. **`creating` recovery (R-009)**: if the item is already `creating` (the tab died after the POST), search
   `project = DENP AND issuetype = "<name>" AND summary ~ "<summary>" AND creator = currentUser() AND created >= -1d`.
   An exact summary match adopts that key as `created`, with no POST.
2. Write `creating` and save (`onProgress`).
3. Call `createIssue(payload)`:
   - On success: write `created { key }` and save.
   - On failure: write `failed { reason: readFailureReason(error) }` (exported from `jira/runCommit.ts:47`) and save.
     Then **continue** with the next item (US4-5).
4. Items already `created` are never posted (US4-6).

Sequential, not parallel. The DENP create screen is shared, and ordering keeps failures readable.

## 5. Tests (all mocked)

- The payload has exactly one label, no size or cost text, Epic Name only when required, and batch answers merged.
- An item that fails mid-batch does not stop the others. A retry re-posts only the failed items.
- `created` items are never re-posted across a simulated reload.
- `creating` recovery adopts an exact-summary match and posts when none exists.
- Pre-flight: an Epic Name-only required field → nothing asked. Another required field → asked once.
