# Contract: A single PI Review page refresh run (server-side)

The core operation, shared by the scheduled tick and `POST /run-now`. Pure orchestration over reused logic; all I/O
is injected (Jira/Confluence request helpers, the DOM parser, a `nowIso` clock) so it is unit-testable.

## Signature (conceptual)

```
refreshPiReviewPage({
  page: { pageUrlOrId, piName },
  team: { productOwnerAssignee, piFieldId, dependencyLinkTypes },
  deps: { makeJiraApiRequest, makeConfluenceApiRequest, domParser, nowIso },
  configuration,           // for jira/confluence creds + sslVerify
}) -> PiReviewRunResult
```

## Ordered steps

1. **Preconditions**
   - If `productOwnerAssignee` is blank → return `skipped` ("No Product Owner configured").
   - If `configuration.confluence` has no usable base URL/credentials → return `failed` ("Confluence not configured").
   - Resolve numeric page id from `pageUrlOrId`; if unresolvable → `failed` ("PI Review page URL is invalid").

2. **Fetch page** — `GET /wiki/rest/api/content/{id}?expand=version,body.storage` via `makeConfluenceApiRequest`.
   Capture `version.number` and `body.storage.value` (the storage HTML).

3. **Parse** — with the shared engine (linkedom `DOMParser` injected): `parsePiReviewTable(storageValue)` and the
   confidence/capacity parsers. If no PI Review table is found → `failed` ("No PI Review table found").

4. **Pull Features** — build JQL with `buildDirectFeatureJql(piName, [productOwnerAssignee], piFieldId)` (no project
   clause) and search via `makeJiraApiRequest`. Dedupe by key against existing rows.
   - If **zero** features found → return `no-op` ("No Features found …"); **do not** write (FR-010).

5. **Append + reconcile**
   - Append new features not already on the page as blank rows (feature cell = `KEY - summary`) (FR-007a).
   - Batch-fetch the Jira issues for **all** rows (existing + appended) via `makeJiraApiRequest`.
   - `reconcilePiReviewRowsWithJira(rows, jiraIssueMap)` → refreshes Priority / Point Estimate / Dependency / Risks /
     Notes-migration only; never removes rows (FR-007b, FR-008).

6. **Rebuild storage** — `writePiReviewTable(storageValue, reconciledRows, binding)` (+ capacity de-dupe collapse
     `writePiReviewCapacitySummary` with the page's **existing** parsed capacity, unchanged). Human-curated content
     (carry-over, feature title, committed, capacity, boundary, grouping, confidence) is preserved by construction —
     the writer only rewrites the Jira-owned cells and appended rows.

7. **Write with optimistic concurrency** — `PUT /wiki/rest/api/content/{id}` with `version.number + 1`.
   - On version conflict: **retry once** — re-GET (step 2), re-apply steps 3–6 onto the fresh body, re-PUT.
   - Still conflicting → `failed` ("Confluence version conflict — try again"). A newer human edit is never clobbered
     (FR-009).

8. **Result** — `success` with `featuresAppended` / `rowsReconciled` counts; `no-op` if nothing changed.

## Invariants (asserted by tests)

- **INV-1**: A run with zero Jira features leaves the page's rows byte-for-byte unchanged (never empties the table).
- **INV-2**: Across a run, the Capacity snapshot, commitment boundary, grouping lines, confidence votes, and the
  carry-over/feature-title/committed cells of existing rows are identical before and after.
- **INV-3**: Only Priority/Point Estimate/Dependency/Risks/Notes may differ on an existing row, and only when Jira
  differs — identical to the manual `reconcilePiReviewRowsWithJira` output for the same inputs.
- **INV-4**: The write uses `existingVersion + 1`; a stale-version PUT triggers exactly one retry, then fails without
  overwriting.
- **INV-5**: No row is ever removed by a run.
