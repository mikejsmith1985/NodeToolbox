# Contract: the Release Doc tab

Component: `views/SprintDashboard/releaseDocument/ReleaseDocumentTab.tsx`, mounted on the Team Dashboard as tab
`release-doc` ("Release Doc"). Additive edits only to `SprintDashboardView.tsx` (tab option, union member, one
dispatch line) and `useSprintData.ts` (tab union).

Props: `{ projectKey: string; teamProfileId: string; teamName: string }`.

Behaviour:
- **Parent page** input (remembered per team in `tbxReleaseDocumentParents`, Settings-Backup prefix).
- **Release** `<select>` of unreleased versions with a title preview (`2026Oct14`) — pick, never type.
- **Pull from Jira** → gathers and merges with the saved page; shows groups, items, misalignment flags, last synced.
- **Notes** column editable per item; **Deployment Steps** rows add / edit / move up-down / remove.
- **Save to Confluence** → read-merge-write; link to the page on success; unsaved-changes badge.
- **Sync all releases** → runs `syncAllReleases`; shows the per-version report.
- Styles from `SprintDashboardView.module.css` (no unstyled markup).
- Every failure shown in plain words; nothing written on failure.
