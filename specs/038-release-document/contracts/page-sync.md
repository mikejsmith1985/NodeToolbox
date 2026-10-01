# Contract: saving one release and syncing all

Module: `views/SprintDashboard/releaseDocument/releasePageSync.ts` — Confluence calls injected (same shape as the
release-notes publisher's `ReleaseNotesConfluenceApi`, plus `fetchPageBody`).

```ts
saveReleasePage(request: { parentPageReference; title; storageValue }, api): Promise<{ pageUrl; wasCreated }>
readReleasePage(request: { parentPageReference; title }, api): Promise<{ storageValue: string | null }>
syncAllReleases(input: { versions: ReleaseVersion[]; ... }, deps): Promise<SyncAllReport>
```

Rules:
1. Save: resolve parent → space key → find by title → update (version + 1) or create child page.
   On "Version must be incremented": re-read, re-merge hand-entered parts, retry once; then report.
2. Load before save: the page's Deployment Steps and Notes are read and merged before any write (FR-008).
3. Sync all: only unreleased versions; skip versions with no team items (no page created); read all existing pages
   first, collect notes by issue key across them; gather each release; attach notes by key wherever the item now
   lives (FR-011); write each page. One failing release is reported, the others still sync.
4. `SyncAllReport`: per version — `created | updated | skipped-empty | skipped-no-date | failed(reason)`.
5. A Jira or Confluence failure never leaves a page half-written: storage is built fully before the single write.
