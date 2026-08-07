# Contract: Vocabulary Sync

**Modules**: `boardVocabularySync.ts` · additive extension to `services/confluenceApi.ts`

Covers FR-019a to FR-019e. The team's column vocabulary is published to Confluence by one person and pulled by the
others, so everyone reads the board in the same language.

---

## 1. Storage decision (the recorded Article VII drift)

The vocabulary lives in its **own Confluence content property** on the same database the shared ART workspace uses —
**not** inside `SharedArtWorkspacePayload`.

```ts
const BOARD_VOCABULARY_PROPERTY_KEY = 'nodetoolbox-board-vocabulary';
const BOARD_VOCABULARY_SCHEMA_VERSION = 1;

interface BoardVocabularyStorePayload {
  schemaVersion: number;
  updatedAt: string;
  vocabularyByTeamProfileId: Record<string, BoardVocabulary>;
}
```

### Why not the ART workspace payload

| Option | Fails because |
|--------|---------------|
| Bump `SHARED_ART_WORKSPACE_SCHEMA_VERSION` 2 → 3 | `loadSharedArtWorkspace` throws on any payload newer than the client (`confluenceApi.ts:374-376`). One publish from this build and **every colleague on an older build loses the whole workspace** — not just the new field. Directly violates FR-019e. |
| Add `boardColumns` to the v2 team record | `mergeSharedArtTeamRecord` merges strictly over the `SHARED_ART_TEAM_FIELD_NAMES` allowlist (`ArtView.tsx:3518`). An older client rebuilds the record from that list and **silently drops** the vocabulary. Quiet data loss. |

### Why a sibling property is reuse, not invention

The same service file already solves this once. The Jira template library is a separate property with its own
version, commented *"kept independent so the ART schema is untouched"* (`confluenceApi.ts:399`), and treats an absent
property as the empty state rather than an error (`:405-415`). Mirroring it delivers FR-019e for free: clients that
predate this feature never read or write the property, so they can neither break on it nor erase it.

`loadBoardVocabularyStore` / `saveBoardVocabularyStore` mirror `loadJiraTemplateStore` / `saveJiraTemplateStore`
exactly, including the absent-property-is-empty behaviour.

---

## 2. Publish

```ts
async function publishBoardVocabulary(databaseId: string, teamProfileId: string, vocabulary: BoardVocabulary)
```

1. Load the current store (absent ⇒ empty).
2. Replace **only** this team's entry — other teams' vocabularies are preserved untouched.
3. Save, stamping `updatedAt`.
4. Set the local mirror's `lastSyncedAt`.

**Explicit action only** (FR-019b). Nothing publishes on edit, on load, or on a timer.

---

## 3. Pull

```ts
async function previewBoardVocabularyPull(databaseId, teamProfileId, localVocabulary): Promise<VocabularyPullPreview>

interface VocabularyPullPreview {
  remote: BoardVocabulary | null;
  differences: VocabularyDifference[];
  hasDifferences: boolean;
}

type VocabularyDifference =
  | { kind: 'column-added';    name: string }
  | { kind: 'column-removed';  name: string }
  | { kind: 'column-renamed';  fromName: string; toName: string }
  | { kind: 'mapping-changed'; name: string; from: ColumnStatusMapping | null; to: ColumnStatusMapping | null }
  | { kind: 'order-changed';   name: string; fromOrder: number; toOrder: number };
```

**Preview first, always** (FR-019d). The differences are shown and the pull is refusable. Accepting replaces the
local vocabulary wholesale and sets `lastSyncedAt`.

**Never silent** (FR-019b): no automatic overwrite in either direction. A newer remote does not win by being newer.

---

## 4. Degradation

| Situation | Behaviour |
|---|---|
| No shared ART workspace configured for the team | The vocabulary works **locally**; the board states plainly that it cannot currently be shared (spec edge case) |
| The property is absent | Pull reports "nothing published yet"; publish creates it |
| The property has a **newer** schema version than this client | Pull refuses with a clear message and **does not** touch the local vocabulary |
| Confluence is unreachable | Sync fails with the reason; the board keeps working on the local vocabulary |

Note the asymmetry from the ART workspace: a newer property version blocks only the **vocabulary**, never the board
and never the ART workspace. That containment is the entire point of the sibling property.

---

## 5. Conflict handling

Two people publishing in the same period: **the later publish wins**, and `lastSyncedAt` lets a viewer see their copy
is stale (spec edge case, FR-019c).

Three-way merge is deliberately **not** used here, even though the ART workspace has one. A column vocabulary is a
small, ordered, jointly-authored artefact — a field-level merge could produce a set neither author wrote, and an
unreviewed board vocabulary is exactly the ambiguity this feature exists to remove. Preview-and-accept keeps a human
in the loop instead.

---

## 6. Contract tests

| Given | Then |
|---|---|
| Property absent; publish for team A | Property created; only team A's entry present |
| Property holds teams A and B; publish A | B's entry is byte-identical afterwards |
| Remote differs from local | `previewBoardVocabularyPull` enumerates every difference by kind |
| Preview refused | Local vocabulary and `lastSyncedAt` are unchanged |
| Preview accepted | Local equals remote; `lastSyncedAt` advances |
| Remote `schemaVersion` is 2, client supports 1 | Pull refuses; local is untouched |
| No `databaseId` configured | Publish and pull both report "not shareable"; the board still renders |
| Publish then pull on a second client | Both clients' vocabularies are deeply equal (SC-011) |
| An older client saves the ART workspace | The vocabulary property is untouched (FR-019e) — asserted by proving no ART code path reads or writes this key |
