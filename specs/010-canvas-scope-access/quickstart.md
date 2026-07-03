# Quickstart & Validation Guide: Canvas Surface Scoping & AI-Tools Access Hardening

Proves both areas work end to end and maps each check to a Success Criterion (SC) / requirement (FR).
Validation/run guide only — implementation detail lives in `tasks.md`.

## Prerequisites

- Client running: `cd client && npm install && npm run dev`.
- **Area 1**: an ART team matched to a board + a selected PI (same as the Feature Canvas today), so
  the default scope query has real inputs and returns features.
- **Area 2**: an install with **no** custom admin `credentialHash` configured (the common default
  state) so the silent-unlock behavior is reproducible before the fix.

## Build & test gates

```powershell
cd client
npm run test    # Vitest: all pure-logic + component/hook tests pass
npm run lint    # ESLint clean
npm run build   # tsc -b && vite build succeed
```

Article V (TDD): the pure units below are written red-first.
- `canvas/scopeQuery.ts` — `buildDefaultScopeJql` (PI present / absent) and `applyScopeFilters`
  (label / text / status; empty = no-op).
- `ai/canvasAiAssist.ts` — `scopeQuery` prompt build + strict parse (valid `{kind,jql}`; malformed →
  descriptive error, no-op).

## Behavioral validation

### Area 1 — Surface scoping

- **V1 — Default prefill (SC-2, FR-1.2)**: Open Feature Canvas → the scope box is pre-filled with a
  working query for your team + PI (targeting the PI field by `cf[<num>]`); pressing **Surface**
  as-is shows the project+PI Feature/Epic set. Note this is a **superset** of the old canvas — it also
  shows features with no child stories, which the previous rollup hid (intentional; A8). It is not
  expected to be a byte-for-byte match of the pre-change set.
- **V1b — Re-surface preserves arrangement (FR-1.4)**: Arrange a few features, then edit the query to
  a narrower set and Surface → features still in scope keep their position/size/priority/box; features
  no longer matched drop off (and reappear arranged if a later query re-includes them).
- **V2 — Query-driven surface (SC-1, FR-1.1/1.3/1.5)**: Edit the query to a specific PI + label (e.g.
  `project = ENCUC AND labels = ENCUC AND "Program Increment" = "PI 26.3"`) → Surface → only matching
  features appear as nodes, each with health + hygiene badges; node count equals the query result.
- **V3 — Refine filters (FR-2)**: Type a label/text/status into the filters → the surfaced set narrows
  instantly with no refetch; clearing restores the full set.
- **V4 — Safe failure (SC-4, FR-1.6)**: Enter a malformed/unauthorized query → Surface → nothing is
  surfaced, a clear error shows, and any prior arrangement is untouched.
- **V5 — Manual parity (SC-3)**: With AI **locked**, do V1–V4 → every capability works and no
  AI-related control appears in the scope bar.
- **V6 — NL→JQL accelerator (FR-3)**: With AI **unlocked** (Ctrl+Alt+Z), open the scope helper, type
  "features for PI 26.3 with the ENCUC label", run the round-trip, paste the reply → a proposed JQL
  appears; accept places it in the box; a malformed reply errors and changes nothing.

### Area 2 — Access hardening

- **V7 — No AI on admin unlock (SC-6, FR-4.2)**: Unlock Admin Access with the admin password →
  inspect every admin section → there is **no** "Hidden prompt tools" checkbox or any AI reference.
- **V8 — Passphrase still works (SC-5, FR-4.4)**: Without touching admin, press Ctrl+Alt+Z and enter
  the passphrase → the AI tools/surfaces become available exactly as before (e.g. the Feature Canvas
  AI helper, the ⚡ AI Assist tab). Removing the admin checkbox did not break the passphrase path.
- **V9 — No silent unlock (SC-7, FR-5.1/5.2)**: With admin locked, click **Unlock** with empty
  username/password → admin does **not** unlock; an error prompts for credentials.
- **V10 — Designed unlock intact (SC-8, FR-5.3/5.4)**: Enter valid admin credentials (the default
  `admin`/`toolbox` on an unconfigured install, or a configured credential) → admin unlocks and the
  operational features (SNow/GitHub config, connectivity credentials, advanced controls, dev
  utilities) are available.
- **V11 — Dev Panel gating (FR-5.5, only if confirmed)**: With admin **locked**, the Dev Panel is not
  reachable; after a valid unlock, it is. *(Skip if R11 was declined.)*

## Done (feature-level acceptance)

Area 1: V1–V6 pass with AI both locked and unlocked. Area 2: V7–V10 (and V11 if in scope) pass. The
three build/test/lint gates are green, and `CHANGELOG.md` has entries for both areas (Article VI). A
live-board smoke run for Area 1 (real Jira query + enrichment) is recommended before release.
