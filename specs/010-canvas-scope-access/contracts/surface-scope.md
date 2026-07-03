# Contract: Surface Scoping (Area 1)

Defines the internal function contracts the canvas relies on to surface features by an arbitrary
query, and the passphrase-gated NL→JQL round-trip. All reuse the existing `/jira-proxy` reads; **no
new server endpoint**.

---

## 1. `fetchFeatureNodesByKeys` (new export in `blueprintHierarchy.ts`)

```
fetchFeatureNodesByKeys(
  featureKeys: string[],
  options?: { piName?: string; artProjectKeys?: string[] },
): Promise<BlueprintFeatureNode[]>
```

- Runs the existing child-discovery JQL (`"Epic Link" in (...) OR parent in (...)`) for the supplied
  feature keys, builds each `BlueprintFeatureNode` via the existing `createBlueprintFeatureNode`, and
  returns them with `health` and `completionPercent` populated (computed by the already-present
  `computeBlueprintHealth` / `computeCompletionPercent`).
- `piName` is optional context (off-train detection / completion weighting inputs), **not** a query
  scope — the query is driven by `featureKeys`.
- Reuses the module's private helpers; exposes no new health/completion math.

## 2. `fetchFeatureReviewItemsByJql` (new export in `featureReview.ts`)

```
fetchFeatureReviewItemsByJql(
  jql: string,
  featureReviewFieldConfig?: HygieneFieldConfig,
  customStoryPointsFieldId?: string,
): Promise<FeatureReviewItem[]>
```

- Runs `jiraGet('/rest/api/2/search?jql=<encoded jql>&fields=<feature fields>')` to resolve matching
  **feature/epic** issues.
- Calls `fetchFeatureNodesByKeys(matchedKeys, …)` for health/completion + children.
- Builds each `FeatureReviewItem` via the shared, extracted `buildFeatureReviewItem(featureNode,
  featureIssue, ctx)` — identical child-count + `evaluateHygieneIssue` logic used by the existing
  `fetchFeatureReviewItems`.
- Field config from `fetchFeatureReviewFieldConfig()` when not supplied.
- **Errors** (invalid/unauthorized JQL) reject; the caller surfaces the message and leaves the
  overlay untouched (FR-1.6).

## 3. `useCanvasFeatures` — JQL-driven fetch

- Holds the current `jql` string and a `surfaceGeneration` counter; fetches via
  `fetchFeatureReviewItemsByJql(jql, …)` when `surfaceGeneration` changes (Surface pressed) and once
  on first mount using the **default JQL**.
- Still resolves `team` / `projectKey` / `piName` / `boardId` (for the overlay scope key and commit)
  and seeds the default JQL from them.
- Result shape unchanged (`status`, `items`, `error`, plus `team`/`projectKey`/`piName`/`boardId`),
  so downstream mapping and the overlay scope key are unaffected.

## 4. Pure helpers (`scopeQuery.ts`)

```
buildDefaultScopeJql(input: { projectKey: string; piName: string; piFieldId: string }): string
applyScopeFilters(items: FeatureReviewItem[], filters: ScopeFilters): FeatureReviewItem[]
```

- `buildDefaultScopeJql` → `project = "<KEY>" AND cf[<num>] = "<PI>" AND issuetype in (Feature,
  Epic)`, where `<num>` = `piFieldId` sans the `customfield_` prefix (target the PI field **by id**,
  not display name — per I2). Omit the PI clause when `piName` is empty. The result is a **superset**
  of the old PI rollup (includes childless features — intentional; per I1).
- `applyScopeFilters` narrows the surfaced set deterministically (label / substring / status); empty
  filters are no-ops; never fetches.

## 5. NL→JQL accelerator (passphrase-gated; `canvasAiAssist.ts` `scopeQuery` kind)

**Prompt** (`buildCanvasAiPrompt('scopeQuery', context)`): embeds the project/PI context and asks the
assistant to return **only** JSON:

```json
{ "kind": "scopeQuery", "jql": "project = ENCUC AND labels = ENCUC AND \"Program Increment\" = \"PI 26.3\"" }
```

**Ingestion** (`parseCanvasAiResponse('scopeQuery', responseText)`): reuses `extractJsonPayload`,
validates `kind === 'scopeQuery'` and a non-empty `jql` string, and returns `{ jql }`. A malformed
reply throws a descriptive error and changes nothing.

**Gate**: the control is invisible/inert unless `aiAssistStore.isAiAssistUnlocked`. The proposed JQL
is placed into the scope box only on user accept; rejecting leaves the box unchanged (FR-3).

## Invariants

- Manual parity: `buildDefaultScopeJql`, the JQL box, `applyScopeFilters`, and Surface all work with
  AI locked; the NL helper only pre-fills the box.
- A failed surface never mutates the planning overlay.
- No new dependency; no new server route.
