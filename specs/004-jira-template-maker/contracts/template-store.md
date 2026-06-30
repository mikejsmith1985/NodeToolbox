# Contract — Shared template store (Confluence content property)

Templates are globally shared (FR-4.3) and persist as one JSON document under a **new content
property** on the existing shared ART Confluence Database. Reuses the primitives in
`client/src/services/confluenceApi.ts`; all traffic flows through `/confluence-proxy/*`
(`src/routes/proxy.js`), auth injected server-side.

## Constants

- New: `JIRA_TEMPLATES_PROPERTY_KEY = 'nodetoolbox-jira-templates'`
- Reused: the shared ART database id (locked `684163133` in `ArtView.tsx`); the template store
  hangs off the **same** database under the new key — independent of the
  `nodetoolbox-shared-art` payload, so the ART `schemaVersion` is **not** touched.

## Primitives reused (no change)

- `fetchConfluenceDatabasePropertyByKey<T>(databaseId, propertyKey): Promise<ConfluenceContentProperty<T> | null>`
  (`confluenceApi.ts:256`) — GET v2 `/databases/{id}/properties?key=...`; `null` if absent.
- `upsertConfluenceDatabaseProperty<T>(databaseId, propertyKey, value): Promise<...>`
  (`confluenceApi.ts:276`) — POST if new, else PUT with `version.number + 1`.

## New wrappers (`confluenceApi.ts`)

### `loadJiraTemplates(databaseId): Promise<JiraTemplateStore>`
- Reads the property by `JIRA_TEMPLATES_PROPERTY_KEY`.
- **Absent** → return an empty store `{ schemaVersion: 1, updatedAt, templates: [] }` (first run;
  do **not** throw — unlike `loadSharedArtWorkspace`, absence is normal here).
- **Present** → validate `schemaVersion` is known (reject unknown per INV-5) and return the value
  plus the underlying property `version.number` (needed for the next write).

### `saveJiraTemplates(databaseId, store, baseSnapshot?): Promise<JiraTemplateStore>`
- Re-reads remote, runs the **3-way merge** (below), upserts the merged store, returns it.
- Stamps `updatedAt` and preserves `schemaVersion`.

## Concurrency — 3-way merge (mirrors ArtView)

Modeled on `mergeSharedArtWorkspacePayload` (`ArtView.tsx:3263`), keyed by `JiraTemplate.id`:

1. Load `remote` store; compare against the local `base` snapshot taken at last load and the
   local `working` edits.
2. Merge the `templates[]` arrays by id:
   - id in working only (new) → add.
   - id edited locally, unchanged remotely → take local.
   - id changed remotely, untouched locally → take remote.
   - id changed on both → **conflict**: abort the save and surface which templates conflict
     (do not last-writer-win silently).
   - id deleted locally, unchanged remotely → remove.
3. On no conflict: `upsertConfluenceDatabaseProperty` the merged store; refresh the base
   snapshot.

This protects the shared library when two users edit concurrently.

## Failure modes

- Confluence proxy returns 502 when `confluence.baseUrl`/credentials are unconfigured
  (`proxy.js:97`) → surface a plain-language "shared store unavailable" message; the wizard may
  still build a template but cannot save/launch until resolved.
- **Size limit**: the whole library is one property value (~hundreds of KB practical ceiling).
  On approaching the limit, surface a clear message; do not silently truncate. (Future: shard
  across multiple keys.)
- **Drift (FR-7.3)**: a loaded template referencing an issue type/field/option missing from live
  createmeta is flagged *stale* in the library and blocked from launch until reviewed.

## Store shape

See data-model.md §1 (`JiraTemplateStore`, `JiraTemplate`, `TemplateFieldEntry`).
