# Contract — Home Gating (visibility store + gate kinds + route gating)

## Visibility store (`client/src/store/toolVisibilityStore.ts`)

1. Backed by the SAME `tbxToolVisibility` localStorage key `ToolVisibilitySection` writes today — existing
   persisted maps keep working with zero migration.
2. `resolveToolIsVisible('admin-hub')` is `true` unconditionally; `setToolVisibility('admin-hub', …)` is a no-op
   (FR-004 — no toggle can lock the admin out of the toggles).
3. Store writes update subscribers synchronously: an Admin Hub toggle changes the home page in the same session
   without reload (SC-002), because both read one store.
4. Corrupt/missing storage degrades to "everything visible".

## Card gating (HomeView)

- A card renders ⇔ `resolveToolIsVisible(card.id)` AND (`card.gateKind` absent OR the gate is satisfied).
- `gateKind: 'admin-unlock'` is satisfied by `useAdminStore.isAdminUnlocked` (session-scoped, reactive).
- Recently Used chips apply the same predicate; sections with zero visible cards render nothing (no divider).

## Route gating (App)

- The `/snow-hub` route element renders the tool only while admin-unlocked; otherwise `Navigate replace` to `/`
  (FR-002). The gate guards ENTRY only — an already-open SNow workspace is never unmounted mid-task by a lapsed
  unlock (spec edge case; next navigation applies the gate).
- Routes of hideable tools apply the same wrapper against the visibility store (FR-005).
- Deep links BETWEEN tools are not vetoed by visibility (FR-004): gating applies to the gated/hidden tool's own
  route, never to links out of it.

## Test hooks

- Store unit tests: default-visible, admin-hub pin, persistence round-trip, corrupt storage.
- HomeView tests: locked ⇒ no SNow card and no gap; unlocked ⇒ card appears; toggle ⇒ card + recents chip react.
- e2e: lock/unlock flow in a real browser (seed the unlock via `addInitScript` on the `tbxAdminUnlocked`
  sessionStorage key — no auth-route stubbing needed); direct `/snow-hub` while locked lands home.
