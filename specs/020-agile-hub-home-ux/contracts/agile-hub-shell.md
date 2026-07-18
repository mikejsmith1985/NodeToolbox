# Contract — Agile Hub Shell (`client/src/views/AgileHub/AgileHubView.tsx`)

## Shape

- Route `/agile-hub`. Top strip: the hub heading plus three space controls — **Team**, **Product**, **Train** —
  always all visible (lenses, not permissions; FR-013). Below: exactly one mounted space view.
- Space → view: team → `SprintDashboardView`, product → `PoToolView`, train → `ArtView`, imported and mounted
  **unchanged**. The shell passes no props and owns no state beyond the space choice.

## Space selection

- `?space=` param authoritative; invalid/absent → settings-store `agileHubLastSpace` → `'team'`.
- Selecting a space updates the URL param (replace) and persists `agileHubLastSpace`.
- Browser back/forward walk space changes naturally (they are URL changes).

## Hard guarantees

1. **Parity by construction (FR-011)**: every tab/action of the three tools exists because the tools themselves
   are mounted. The quickstart parity audit is a verification pass, not a construction task.
2. **Selection carry-over (FR-012)**: the mounted views read the same stores/localStorage as before the merge —
   team profiles, PO-independent selection (017), ART scope all survive untouched.
3. **No internal refactors**: `SprintDashboard/`, `PoTool/`, `ArtView/` directories are read-only for this feature.
4. Query params other than `space` are left intact for the mounted view to consume (e.g. `hygieneFilter`).
5. Layout: the space strip wraps at narrow widths and all text sizes; never clips (GH #160 rules).

## Test hooks

- Shell unit tests: param → space resolution, fallback chain, persistence on switch, one-view-at-a-time.
- e2e: Today card → `/sprint-dashboard?hygieneFilter=stale` → lands in Team space with the hygiene tab filtered
  (the FR-010 acceptance case), plus a space-switch round trip preserving each space's own selection.
