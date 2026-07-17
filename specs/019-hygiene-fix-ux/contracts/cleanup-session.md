# Contract — Guided Cleanup Session (`useHygieneSession` + HygieneView)

Available identically on every surface that renders the hygiene workspace (team tab, personal tab, standalone —
clarification #2).

## Entry / exit

- "Review these findings" control appears whenever the filtered list has ≥ 1 finding; starting a session opens the
  first finding with a visible cursor "1 of M".
- Escape (or the End-session control) exits; changing the filter/project/scope ends the session (fresh list ⇒ fresh
  session). Nothing persists (spec: ephemeral).

## Keyboard map (active only during a session)

| Key | Action |
|---|---|
| → | next finding (cursor clamped at ends) |
| ← | previous finding |
| S | skip current finding (records outcome, advances) |
| Escape | end session (shows summary) |

Guard: events originating in `input`, `textarea`, `select`, or contenteditable elements are ignored — typing a
comment never navigates or skips.

## Outcome semantics (clarification #1 — explicit Skip)

- A finding is **settled** only by: fix applied → `fixed`; comment posted → `commented`; Skip → `skipped`.
- Merely advancing past a finding leaves it **untouched**.
- Precedence: fixed > commented > skipped — an acted-on finding never downgrades.
- Settled findings are visibly distinguished in the list (outcome mark on the row); untouched rows are visibly not.

## Summary

On exit (any path): "M findings — F fixed, C commented, S skipped, U untouched" where F+C+S+U = M. Informational
only; dismissing it discards it.

## Non-loss guarantees

- Applying a fix or posting a comment keeps the cursor on the current finding (FR-014) and updates the row without
  a full reload.
- A failed write shows its readable error inline; cursor and outcomes are unaffected.

## E2E gates (Playwright, real browser)

1. Start session on a seeded 3-finding list → arrow through all, S-skip one, comment one → summary reads
   "3 findings — 0 fixed, 1 commented, 1 skipped, 1 untouched".
2. Typing "s" inside the comment box neither skips nor navigates.
3. Layout holds at A++ text size and a narrow window (no clipping; in-shell scroll only).
