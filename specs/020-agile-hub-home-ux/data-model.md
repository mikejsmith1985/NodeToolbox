# Data Model — Agile Hub Home (020)

All client-side; persisted pieces use existing storage locations.

## Tool card catalog (`homeCardData`)

```ts
type SectionKey = 'my-work' | 'agile' | 'insights-admin';

interface AppCardDef {
  id: string;
  route: string;
  icon: string;
  title: string;
  description: string;
  tags: readonly string[];
  sectionKey: SectionKey;
  /** Session gate required to SEE and ENTER the tool; absent = ungated. */
  gateKind?: 'admin-unlock';
}
```

| Section | Cards (default catalog) |
|---|---|
| 🙋 My Work | my-issues, personal-toolbox |
| 🏃 Agile Delivery | **agile-hub** (new; icon 🏃), feature-canvas, jira-intake, jira-template-maker, business-helper |
| 📈 Insights & Admin | reports-hub, admin-hub, snow-hub (`gateKind: 'admin-unlock'`), code-walkthrough, text-tools |

Retired card ids: `sprint-dashboard`, `po-tool`, `art` (mapped to `agile-hub` for recents; dropped from the
visibility toggle list; tolerated by saved-order reconciliation).

**Invariants**: no default section has exactly one card; `admin-hub` has no gate and is never hideable.

## Visibility state (`toolVisibilityStore`)

| Field | Shape | Rules |
|---|---|---|
| visibilityByCardId | `Record<string, boolean>` | persisted at the existing `tbxToolVisibility` key; absent ⇒ visible |
| resolveToolIsVisible(id) | derived | `id === 'admin-hub'` ⇒ always true; else `visibilityByCardId[id] !== false` |
| setToolVisibility(id, isVisible) | action | writes store + localStorage atomically; ignores `admin-hub` |

## Gate state

Read-only reuse of `useAdminStore.isAdminUnlocked` (session-scoped). Card visibility and route entry for
`gateKind: 'admin-unlock'` derive from it live; no new persistence.

## Agile Hub space

```ts
type AgileHubSpace = 'team' | 'product' | 'train';
```

| Concern | Rule |
|---|---|
| Source of truth when present | `?space=` URL param (invalid values fall back as below) |
| Fallback | settings-store `agileHubLastSpace`; first-run default `'team'` |
| On space change | update URL param and `agileHubLastSpace` together |
| Space → mounted view | team → `SprintDashboardView` · product → `PoToolView` · train → `ArtView` (unchanged components) |

**Invariants**: exactly one space view mounted at a time; the shell owns NO other state — every tab, scope, and
selection inside a space belongs to the existing view exactly as today (FR-012 by construction).

## Route redirect table (summary — full table in contracts/route-redirects.md)

| Old route | New destination | Params |
|---|---|---|
| /sprint-dashboard | /agile-hub?space=team | query string carried verbatim, `space` appended |
| /po-tool | /agile-hub?space=product | carried verbatim |
| /art | /agile-hub?space=train | carried verbatim |
| /standup, /metrics, /pointing, /dsu-daily, /pipeline, /defects, /release-monitor, /sprint-planning | /agile-hub?space=team | single hop (repointed, not chained) |
| /snow-hub (locked) | / (home) | gate wrapper |
| any hidden tool's route | / (home) | visibility wrapper |
