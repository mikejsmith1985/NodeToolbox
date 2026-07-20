# Contract: US4 — PO Tool PI Dropdown

Covers FR-012..014, SC-004.

## Control (`PoTool/PoTeamSelector.tsx`, EDIT)

- Replace the Program Increment `<input type="text">` with a `<select>` (matching the Team `<select>` beside it).
- Options come from `loadAvailablePiNamesFromJira(piReviewTeams)` (`ArtView/hooks/artHelpers.ts`), where
  `piReviewTeams` is the same value PoToolView already builds via `buildArtTeamFromProfile`.
- Follow ArtView's pattern: `availablePiNames`, `isLoadingPiOptions`, an optional reload; while loading, the control
  is disabled with a loading hint.

## Selection & persistence

- Preselect the sensible current PI (`findPiNameForDate` / the profile's `selectedPiValue`).
- Changing the **team** reloads the PI options; the selected PI persists via `usePoToolState.selectedPiName`
  (`tbxPoToolSelection`) exactly as today.
- A PI not in the option list cannot be selected (SC-004).

## Failure handling (FR-014)

- If options fail to load: show an honest message + reload, and offer a manual-entry fallback so the tool is never
  blocked by a locked empty dropdown.

## Tests

- Unit: option selection maps to `selectedPiName`; empty options → fallback/loading state (no blank locked control).
- e2e (`po-pi-dropdown.spec.js`): the PI control is a select populated for the team; picking a PI updates the tool;
  switching teams refreshes options; a stubbed load failure shows the fallback.
