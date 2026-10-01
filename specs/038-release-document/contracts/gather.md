# Contract: gathering a release from Jira

Module: `views/SprintDashboard/releaseDocument/releaseGather.ts` — pure orchestration; every Jira call is an injected
dependency, every field id is passed in as data (fieldMappingBoundary ratchet).

```ts
interface ReleaseGatherDeps {
  searchAll(jql: string, fields: string): Promise<JiraIssue[]>;   // fetchIssuesPaged underneath
  fetchByKeys(keys: readonly string[], fields: string): Promise<JiraIssue[]>;
}
interface ReleaseGatherInput {
  teamProjectKey: string;
  versionName: string;
  featureLinkFieldIds: readonly string[];   // featureLinkCandidateFieldIds(...)
  epicLinkFieldId: string | null;           // for `cf[...] in (…)` child lookup
  extraEpicProjectKeys: readonly string[];  // team feature scope
}
gatherRelease(input, deps): Promise<{ groups: EpicGroup[]; warnings: string[] }>
```

Rules:
1. Children = `project = <team> AND fixVersion = "<name>"`, all pages.
2. Parents = keys from `extractFeatureKeyFromIssueFields`; fetched by key; unreadable → group kept, `epic: null`.
3. Extra Epics: per project in (parents' projects ∪ extraEpicProjectKeys) minus the team project,
   `project = P AND fixVersion = "<name>"`; a 400 for one project → skipped with a warning, never fatal.
   Keep only those with ≥1 team-project child (`parent in (…)` / `cf[epicLink] in (…)`).
4. Groups sorted by Epic key; "No Epic" last; items keep Jira order.
5. Misalignments per data-model.md, comparing names case-insensitively, trimmed.
