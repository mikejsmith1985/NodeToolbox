# Quickstart Validation — Agile Hub Home (020)

Contracts: [home-gating](./contracts/home-gating.md), [agile-hub-shell](./contracts/agile-hub-shell.md),
[route-redirects](./contracts/route-redirects.md).

## Unit gates

```powershell
cd client
npx vitest run src/store/toolVisibilityStore.test.ts src/views/Home src/views/AgileHub src/views/AdminHub/ToolVisibilitySection.test.tsx src/App.test.tsx
npx tsc -b
npx eslint src
```

Expected: green. Coverage: visibility store rules (admin-hub pin, persistence, corrupt storage), home card/section
gating (locked vs unlocked, toggles, empty sections omitted), shell space resolution + persistence, redirect table.

## E2E gates (real browser)

```powershell
cd C:\ProjectsWin\NodeToolbox
npx playwright test test/e2e/agile-hub-home.spec.js
```

Expected per contracts: (1) locked home shows no SNow card and direct `/snow-hub` lands home; unlocked shows and
enters it. (2) Admin toggle hides a card live. (3) `/sprint-dashboard?hygieneFilter=stale` lands inside the Agile
Hub **Team** space with the hygiene tab filtered (FR-010 acceptance). (4) Space strip holds at A++/narrow.

## Capability-parity audit (SC-006 — run once before release)

Open the Agile Hub and verify one-for-one against this checklist (each item = a tab/action of a retired tool):

- **Team space** (= Team Dashboard): Overview · By Assignee · Blockers · Defects · Standup · Hygiene · Metrics ·
  Planning · Pointing · Feature Review · PI Review · Remediation · Releases · Settings
- **Product space** (= PO Tool): Feature Review (own selection) · PI Review (own selection) · Feature Splitter ·
  Feature Composition
- **Train space** (= ART View): PI health · dependencies · blueprint rollups · PI Review readouts · release
  visibility · ART settings

Then: switch spaces round-trip and confirm each space kept its own team/PI/scope selection (FR-012).

## Manual gating sanity

1. Fresh tab (locked): home shows three sections, no SNow anywhere, no empty dividers.
2. Unlock Admin Hub: SNow card appears under Insights & Admin without reload; lock → disappears.
3. Toggle a tool off in Admin Hub → its card and recent chip vanish immediately; direct route lands home; Admin
   Hub itself offers no self-toggle.

## Release gate

```powershell
cd client && npm run build
```
