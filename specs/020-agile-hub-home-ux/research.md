# Research — Agile Hub Home (020)

Phase 0 output. All Technical Context unknowns resolved.

## 1. How is the three-tool merge executed without a parity disaster?

- **Decision**: **thin shell**. `AgileHubView` renders a space switcher and mounts the existing
  `SprintDashboardView`, `PoToolView`, and `ArtView` components unchanged, one at a time. No tab system is
  rebuilt, no view internals move.
- **Rationale**: FR-011 (capability parity) and FR-012 (selections carry over) become properties of the
  construction rather than a 100-item QA burden — the spaces ARE the current tools, reading the same stores and
  localStorage they read today. The 6,700-line `SprintDashboardView` and the 017-guaranteed PO selection isolation
  are untouched. The user-visible change is exactly what the spec asks for: one door instead of three.
- **Alternatives considered**: merging the three tab systems into one navigation (parity risk across ~20 tabs, a
  giant refactor of the dashboard monolith, and it would re-open the 017 capacity-singleton trap); iframes or
  remounting per space with fresh state (would lose working context — violates FR-012).

## 2. How does space selection work and persist?

- **Decision**: `?space=team|product|train` URL param is authoritative (deep-linkable, redirect-friendly); a new
  settings-store field `agileHubLastSpace` supplies the space when the param is absent; first-run default `team`
  (FR-013, US3.3). Changing space updates both.
- **Rationale**: params make the redirect table trivial and keep browser back/forward sane; the settings store is
  the app's established persisted-UI-state home (`sprintDashboardActiveTab` precedent).
- **Alternatives considered**: path segments (`/agile-hub/team`) — equivalent power but every redirect must then
  merge params into a path AND query; a param keeps old-route query strings pasteable verbatim.

## 3. How do old routes redirect with parameters intact?

- **Decision**: a tiny `RedirectToAgileHub space=…` element used by the three retired routes: it reads the current
  `location.search`, appends/overrides `space`, and `Navigate replace`s to `/agile-hub`. The ~8 legacy redirects
  that today point at `/sprint-dashboard` (e.g. `/standup`, `/metrics`) repoint to the same element (one hop, not
  a redirect chain). Full table in `contracts/route-redirects.md`.
- **Rationale**: the Today cards navigate to `/sprint-dashboard?hygieneFilter=…` and set the dashboard tab through
  the settings store — both survive verbatim: the query rides the redirect, the tab store is read by the SAME
  `SprintDashboardView` now mounted inside the Team space. Zero changes needed in the Today code (FR-010).
- **Alternatives considered**: updating every in-app link to the new canonical route (touches ~6 files now and
  every future external bookmark never — the redirect is needed regardless, so it is the mechanism).

## 4. How does the Tool Visibility map become live?

- **Decision**: promote the load/save/resolve helpers out of `ToolVisibilitySection` into a shared zustand store
  (`toolVisibilityStore`) backed by the SAME `tbxToolVisibility` localStorage key. The Admin section becomes a
  consumer; `HomeView` and route gating subscribe. `admin-hub` is pinned visible in the resolver itself (FR-004)
  and absent from the toggle list; toggles for the three retired cards are dropped.
- **Rationale**: existing persisted maps keep working (same key, same shape); one writer/reader pair means the
  admin toggle and the home page can never disagree (the app's agree-by-construction doctrine); zustand is the
  established reactive-store pattern (admin/aiAssist/settings/todo).
- **Alternatives considered**: HomeView re-reading localStorage on an interval or storage events (same-tab writes
  do not fire `storage`; polling is a lie waiting to drift).

## 5. How are card and route gating expressed?

- **Decision**: `AppCardDef` gains `gateKind?: 'admin-unlock'` (only `snow-hub` sets it). Home filters:
  card visible ⇔ `resolveToolIsVisible(map, id)` AND (no gate OR gate satisfied). Routes: the `/snow-hub` route
  element is wrapped so a locked session `Navigate replace`s home (FR-002); the same wrapper consults the
  visibility store for hideable tools' routes (FR-005). The gate only guards ENTRY — an already-mounted SNow
  workspace is not unmounted when the unlock lapses (spec edge case).
- **Rationale**: gate-as-data keeps the "switch the gate later" assumption a one-line change; entry-only guarding
  avoids yanking work mid-task.
- **Alternatives considered**: hiding via the visibility map for SNow too (conflates an admin's curation choice
  with a security-ish session gate; two different owners, two mechanisms — one store each, both honest).

## 6. Recents and saved card order across the retirement

- **Decision**: extend the existing `LEGACY_RECENT_VIEW_CARD_IDS` map (`sprint-dashboard`, `po-tool`, `art` →
  `agile-hub`) and keep their `RECENT_VIEW_LABELS` pointing at the hub. Saved card order needs nothing: the
  existing reconciliation drops unknown ids and appends new cards.
- **Rationale**: both mechanisms were built for exactly this (the `dsu-board` precedent already maps a retired id).
