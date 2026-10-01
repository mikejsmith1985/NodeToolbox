# Contract: the release page in Confluence storage

Module: `views/SprintDashboard/releaseDocument/releasePageStorage.ts` — pure; DOM parser injectable for tests.

```ts
buildReleasePageStorage(document: ReleaseDocument): string
parseReleasePageStorage(storageValue: string): { deploymentSteps: DeploymentStep[]; notesByKey: Map<string, string> }
formatReleasePageTitle(version: { releaseDate: string | null; name: string }): string | null   // "2026Oct14"
```

Page layout (in order):
1. `<p>` "Last synced from Jira: <local date time>".
2. `<h2>Release items</h2>` + table, headers **Key · Summary · Type · Status · Assignee · Release check · Notes**.
   Epic rows bold; child rows prefixed "↳ "; Key cells link to Jira browse URL; "Release check" holds misalignment
   text (blank when aligned); "No Epic" group row last.
3. `<h2>Deployment Steps</h2>` + table, headers **PR · Repo · Workflow run · Branch · Job type · Application ·
   Environment · Repository · Tag · Task · Module · Log level**. PR / Workflow run cells are `<a>` when the value is a URL.

Rules:
- Every text value escaped; no `data-` markers (Confluence strips them) — tables found by header labels.
- `parse` reads Notes by the issue key in each row's Key cell; reads Deployment Steps rows verbatim (link text → href
  when the cell is a link). Missing table → empty result, never an error.
- Round trip: `parse(build(doc))` returns `doc.deploymentSteps` and every item's notes unchanged.
