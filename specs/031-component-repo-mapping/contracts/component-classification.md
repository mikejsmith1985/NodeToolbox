# Contract: Component Classification Store

**Module**: `client/src/views/AdminHub/lib/componentClassificationStore.ts` (zustand + localStorage) +
`ComponentManagerPanel.tsx` UI.

## Purpose
Hold the repo/domain marker Jira does not have, keyed by component name (case-insensitive). This is the allowlist the
AI mapping and story generation consume.

## Store shape
- Persistence key: `tbxComponentClassification`.
- State: `classifications: Record<nameKey, { displayName: string; kind: 'repo' | 'domain' }>` where `nameKey =
  name.trim().toLowerCase()`.

## Operations
| Operation | Behaviour |
|---|---|
| `classify(name, kind)` | upsert `nameKey → {displayName, kind}`; overwrite on re-classify (FR-001, FR-004) |
| `clearClassification(name)` | remove the entry → back to unclassified |
| `getKind(name): 'repo' \| 'domain' \| null` | `null` ⇒ unclassified (never guessed, FR-002) |
| `repoAllowlist(): string[]` | selector: `displayName`s where `kind==='repo'` (FR-003) |
| `isRepo(name) / isDomain(name)` | convenience over `getKind` |

## Rules
- **Never infer** a kind from the name — only an explicit `classify` sets one (FR-002).
- **Case-insensitive identity**; display uses the original casing of the most recent `classify`.
- A change is visible everywhere immediately (the store is the single source; consumers read the selector) (FR-004).

## UI (ComponentManagerPanel)
- When listing/importing a project's components, each row shows its current kind and a **Repo / Domain** control; an
  unclassified component is clearly marked "not yet classified".
- Reuses `AdminHubView.module.css` vocabulary (Article: UI styling) and the existing `listProjectComponents` /
  `importComponentsToProjects` flow — classification is additive, not a rewrite.

## Tests (componentClassificationStore.test.ts)
- classify/getKind/clear round-trip; re-classify overwrites; `repoAllowlist` returns only repos; unclassified →
  `getKind` null; case-insensitive match; persistence key stable.
