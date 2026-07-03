# Contract: Jira Write Operations (Commit Step)

All writes go through the existing frontend proxy client (`client/src/services/jiraApi.ts`)
to the `/jira-proxy` passthrough. **No backend change is required** — the proxy already
forwards arbitrary `/rest/...` paths. Writes occur **only** when the user confirms selected
items in the Review & Commit diff (spec FR-7; Q1=A). Each `CommitDiffItem.kind` maps to
exactly one operation below.

Legend: ✅ = existing call site reused; 🆕 = new helper added to `jiraApi.ts`.

---

## 1. Assign issue → sprint  (`kind: 'sprintAssign'`) ✅

```
POST /jira-proxy/rest/agile/1.0/sprint/{sprintId}/issue
Content-Type: application/json
{ "issues": ["ENFCT-101"] }
```
- Expected: `204 No Content`.
- Reuses the shape from `moveIssueToSprint` (`useSprintData.ts:909`).
- `{sprintId}` is `ContainerProvenance.jiraSprintId` (must be non-null — a provisional
  sprint is created first via §5 and its returned id backfilled).
- **Feature→sprint expansion (FR-6.1a)**: when a *feature* is boxed into a sprint,
  `commitDiff.ts` emits one `sprintAssign` **per child story** (`{issueKey}` = each story),
  not one for the feature — Jira sprints hold stories, not epics. A feature with no child
  stories emits a single `sprintAssign` for the feature itself. The `issues` array MAY batch
  multiple story keys targeting the same sprint in one call.

## 2. Assign issue → fixVersion  (`kind: 'versionAssign'`) ✅

```
PUT /jira-proxy/rest/api/2/issue/{issueKey}
Content-Type: application/json
{ "update": { "fixVersions": [ { "set": [ { "name": "6/18" } ] } ] } }
```
- Expected: `204 No Content` (via `jiraPut`).
- Reuses `saveFeatureReviewFixVersion` (`featureReviewFixes.ts:313`). Name comes from
  `ContainerProvenance.jiraVersionName`.

## 3. Set story points  (`kind: 'pointsSet'`) ✅

```
PUT /jira-proxy/rest/api/2/issue/{issueKey}
Content-Type: application/json
{ "fields": { "<spFieldId>": 5 } }
```
- `<spFieldId>` resolved per research R5: `DashboardConfig.customStoryPointsFieldId` →
  `tbxARTSettings.spFieldId` → `customfield_10028` → (on failure) `customfield_10016`.
- `to` value = `sizeMapping[node.size]` when the user sized it on the canvas.
- Reuses `saveFeatureReviewStoryPoints` (`featureReviewFixes.ts:326`), including its retry.

## 4. Set priority  (`kind: 'prioritySet'`, OPTIONAL) ✅ shape

```
PUT /jira-proxy/rest/api/2/issue/{issueKey}
Content-Type: application/json
{ "fields": { "priority": { "name": "High" } } }
```
- Priority is an **overlay-only** attribute by default (MoSCoW). This item appears in the
  diff **only if** the user opts to map MoSCoW buckets to Jira priority names. If they don't,
  no `prioritySet` items are generated. Mapping (e.g. Must→Highest, Should→High, Could→Medium,
  Wont→Lowest) is user-confirmed, not assumed.

## 5. Create sprint (provisional → real)  (`kind: 'createSprint'`) 🆕

```
POST /jira-proxy/rest/agile/1.0/sprint
Content-Type: application/json
{ "name": "Sprint 25", "originBoardId": 123, "startDate": "2026-07-07T00:00:00.000Z", "endDate": "2026-07-18T00:00:00.000Z", "goal": "" }
→ 201 { "id": 456, "name": "Sprint 25", ... }
```
- New helper: `createSprint(input): Promise<{ id: number; name: string }>` using
  `jiraPost<{id:number;name:string}>`.
- `originBoardId` = active `boardId` from the resolved team profile. `startDate`/`endDate`
  optional (from `ContainerProvenance.startDateIso`/`endDateIso`).
- On success, the returned `id` is written back to `ContainerProvenance.jiraSprintId` and
  `state` flips to `'real'` **before** any `sprintAssign` item that `dependsOn` it runs.

## 6. Create version / fixVersion (provisional → real)  (`kind: 'createVersion'`) 🆕

```
POST /jira-proxy/rest/api/2/version
Content-Type: application/json
{ "name": "6/25", "project": "DENP", "releaseDate": "2026-06-25", "released": false }
→ 201 { "id": "10234", "name": "6/25", ... }
```
- New helper: `createVersion(input): Promise<{ id: string; name: string }>`.
- `project` = active feature/project key. On success, `jiraVersionName` is set and `state`
  flips to `'real'` before dependent `versionAssign` items run.

---

## Ordering & failure semantics (Q3=A, FR-7.4/7.5)

1. **Phase A — reconcile containers**: execute all `createSprint`/`createVersion` items
   first. Backfill returned ids/names into provenance.
2. **Phase B — assignments & fields**: execute `sprintAssign`, `versionAssign`, `pointsSet`,
   `prioritySet`. Any item whose `dependsOn` create item failed is **skipped** and reported.
3. **Per-item result**: each write reports success/failure independently. Failed items remain
   in the overlay (uncommitted) so the user can retry; successful items are marked committed.
4. **No partial-container orphaning**: an assignment is never attempted against a container
   still in `provisional` state.

## Read dependencies (already existing, GET only)

- Available sprints: `GET /rest/agile/1.0/board/{boardId}/sprint?state=active,future`
  (`useSprintData.ts:884`).
- Project versions: `GET /rest/api/2/project/{projectKey}/versions`
  (`useSprintData.ts:453`).
- Field id resolution: `GET /rest/api/2/field` via `fetchFeatureReviewFieldConfig`
  (`featureReview.ts:69`).

## Non-goals (explicit)

- No status transitions are performed by the canvas (that is `003-sprint-release-workflow`).
- No assignee changes.
- No deletion of sprints/versions/issues.
