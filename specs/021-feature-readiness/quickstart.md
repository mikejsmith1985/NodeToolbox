# Quickstart & Validation: Feature Status & Readiness Workspace (021)

Runnable validation scenarios that prove the feature end to end. Assumes a configured ART (roster
with `jiraLabel`s or `tbxARTSettings.featureProjectKeys`) and a live/stubbed Jira with Feature-type
issues across at least three PIs.

## Prerequisites

- On `feature/021-feature-readiness`.
- `cd client && npm install` (no new deps expected).
- Unit tests: `npx vitest run src/views/ArtView/readiness`.
- Typecheck: `npx tsc -b`.

## Scenario A — Lenses (User Story 1)

1. Open the app → Agile Hub → Train space → **Readiness** tab (or navigate
   `/agile-hub?space=train&artTab=readiness`).
2. **Expect**: three lens tiles — Carryover, Current PI, Upcoming PI — each showing a count grouped
   by feature state, plus the scanned-feature total.
3. Click the Current PI lens, then a state group → **Expect**: the listing shows exactly those
   features; the tile count equals the row count.
4. Point the PI selector at a value with no features → **Expect**: amber "matched no features"
   message, no healthy zero, no "all clean" score.
5. Open `/agile-hub?space=train&artTab=readiness&readinessLens=upcoming` in a fresh tab →
   **Expect**: the Upcoming lens is already selected; if no newer PI is configured, the lens says
   "no upcoming PI configured".

## Scenario B — Inline fixes (User Story 2)

1. Seed a feature with: no assignee AND no PO value, empty estimate, empty PCode, blank Target End,
   blank Due Date.
2. **Expect** five alert flags on the row.
3. Ownership: search a user, choose the Assignee target, apply → **Expect** Jira updated, alert
   clears, lens count drops by one.
4. PCode: type `P00012345`, apply → **Expect** `12345` written to the configured PCode field; typing
   `abc` shows a rejection message and performs no write.
5. Estimate + dates: set each via its inline control → **Expect** each write reaches Jira and its
   alert clears.
6. Status move requiring screen fields: choose a transition whose workflow demands fields →
   **Expect** the required fields render inline and Apply stays disabled until they are complete.
7. Configure the Jira stub with NO PCode field → **Expect** the PCode column reads "not checked — no
   matching field" and contributes nothing to counts.
8. Force a Jira 400 on a write → **Expect** Jira's actual message on the row; the alert remains.

## Scenario C — Gated AI insights (User Story 3)

1. With AI locked, open the Readiness tab → **Expect** zero AI controls, panels, or hints anywhere.
2. Press Ctrl+Alt+Z to unlock → **Expect** the AI insights panel appears.
3. Request insights → **Expect** one prompt covering ONLY the active lens's features; paste a
   `{kind:'featureReadiness', items:[...]}` reply → per-feature proposals render.
4. Accept exactly one estimate proposal, decline another → **Expect** only the accepted change
   reaches Jira (via the same writer as the manual fix); the scan re-runs.
5. Confirm an `ownershipSuggestion` / `insight` item exposes NO write button (display only).

## Scenario D — No regressions

1. Visit every existing Train space tab (Overview … Settings) → **Expect** unchanged behavior.
2. Switch Train → Product → Team spaces and back → **Expect** each space keeps its own selection;
   the readiness lens/filter never leaks into another space.
3. Existing deep link `/agile-hub?space=team&hygieneFilter=stale` → **Expect** still lands in the
   Team space with the filter (020 guarantee intact).

## Gate before PR

- `npx vitest run` (full client suite) green.
- `npx tsc -b` clean.
- `npx playwright test test/e2e/agile-hub-home.spec.js` green (shell guarantees intact).
- CHANGELOG updated; workflow gates recorded.
