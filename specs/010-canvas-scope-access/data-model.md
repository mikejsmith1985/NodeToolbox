# Phase 1 Data Model: Canvas Surface Scoping & AI-Tools Access Hardening

This change is mostly UI + query-sourcing (Area 1) and deletion + a behavior fix (Area 2). It
introduces a few small **transient** view-state shapes and **reuses** existing domain types
(`FeatureReviewItem`, `BlueprintFeatureNode`, `HygieneFlag`) rather than defining new persisted
entities. Nothing new is persisted; one existing persisted flag is removed.

---

## Area 1 — new (transient) shapes

### `ScopeQuery` (view state, not persisted)

Held in the Feature Canvas view / `useCanvasFeatures`; drives what gets surfaced.

| Field | Type | Notes |
|-------|------|-------|
| `jql` | `string` | The query the user will run. Seeded with the default (below); freely editable. |
| `surfaceGeneration` | `number` | Bumped when the user presses **Surface**; the fetch runs on change. |

**Default seed** (pure `buildDefaultScopeJql`): `project = "<projectKey>" AND cf[<num>] = "<piName>"
AND issuetype in (Feature, Epic)` — where `<num>` is `piFieldId` with the `customfield_` prefix
stripped (targets the PI field **by id**, not display name, so it works on any instance; per I2). The
PI clause is omitted when no PI is resolved. Inputs: `team.projectKey`, `piName`,
`readArtFeatureScopeSettings().piFieldId`. **Note (I1)**: this default surfaces *all* Feature/Epic in
the project+PI — a superset of the old canvas, which hid childless features (intentional for triage).

### `ScopeFilters` (view state, not persisted)

Deterministic, client-side refinement applied to the already-surfaced set (`applyScopeFilters`).

| Field | Type | Notes |
|-------|------|-------|
| `label` | `string \| null` | Keep features whose Jira labels include this value |
| `text` | `string` | Case-insensitive substring match on key/summary |
| `status` | `string \| null` | Keep features whose status name matches |

**Validation**: empty/blank filters are no-ops; filters never fetch — they narrow the surfaced set.

### `SurfaceResult` (derived)

The output of running a `ScopeQuery`, consumed by the existing canvas mapping.

| Field | Type | Derivation |
|-------|------|-----------|
| `status` | `'idle' \| 'loading' \| 'ready' \| 'error'` | fetch lifecycle |
| `items` | `FeatureReviewItem[]` | from `fetchFeatureReviewItemsByJql(jql, …)` — **reused type** |
| `error` | `string \| null` | Jira/query error message; surfaced without touching the overlay |

**State transition**: `idle → loading → (ready | error)`. An `error` never clears or corrupts the
existing arrangement (FR-1.6); a subsequent successful surface replaces `items`.

### `ScopeQuerySuggestion` (transient, passphrase-gated)

Produced by the NL→JQL accelerator (`canvasAiAssist` `scopeQuery` kind).

| Field | Type | Notes |
|-------|------|-------|
| `jql` | `string` | The proposed query parsed from the assistant reply |

Only offered when `aiAssistStore.isAiAssistUnlocked`; the user reviews it and places it into
`ScopeQuery.jql` (accept) or ignores it (reject — no change).

---

## Area 1 — reused domain types (unchanged)

- `FeatureReviewItem` (`featureReview.ts`) — now also produced from a JQL source via
  `fetchFeatureReviewItemsByJql`; shape unchanged.
- `BlueprintFeatureNode` (`blueprintHierarchy.ts`) — now also produced by the new exported
  `fetchFeatureNodesByKeys`; `health`/`completionPercent` populated exactly as today.
- The canvas overlay, `CanvasNode`, and all 009 types are **unchanged** — surfacing changes *which*
  features arrive, not the node model or persistence.

---

## Area 2 — removed / changed state

### Removed: `FeatureFlags.isAiEnabled` (orphan flag)

| Item | Change |
|------|--------|
| `FeatureFlags.isAiEnabled` (`useAdminHubState.ts:99`) | **Removed** — field deleted from the interface |
| `FEATURE_AI_KEY = 'tbxFeatureAIVisible'` (`:30`) | **Removed** — constant + persistence deleted |
| `buildInitialFeatureFlags().isAiEnabled` (`:396`) | **Removed** |
| `toggleFeatureFlag` AI branch (`:730`) | **Removed** (only `isSnowIntegrationEnabled` remains) |
| The "Hidden prompt tools" checkbox + props (`AdminHubView.tsx:444/449/473/525-536/2619`) | **Removed** |

**Zero downstream impact**: no surface outside AdminHub reads this flag (confirmed by full grep), so
removal changes no other feature's behavior.

### Changed: admin credential entry (behavior, no new entity)

| Item | Before | After |
|------|--------|-------|
| `tryUnlock` submitted username (`useAdminHubState.ts:750`) | `adminUsernameRef.current \|\| 'admin'` | the entered username; **empty → no submit + error** |
| `tryUnlock` submitted password (`:751`) | `adminPinInputRef.current \|\| 'toolbox'` | the entered password; **empty → no submit + error** |

Server `/api/admin-verify` and the `isAdminUnlocked` sessionStorage flag are **unchanged**. A
correctly-entered default still unlocks on an unconfigured install (designed behavior).

### Preserved (must not regress)

- The Ctrl+Alt+Z passphrase machinery + the passphrase-gated "⚡ AI Assist" tab (owner-only).
- Admin-gated operational features: SNow/GitHub proxy URLs, service-connectivity credentials,
  advanced feature controls (the SNow Integration checkbox), developer utilities.

### Optional (pending R11 confirmation)

- **Dev Panel visibility** gated behind `isAdminUnlocked` (currently ungated). If confirmed, the Dev
  Panel tab/panel renders only when admin is unlocked; otherwise unchanged.
