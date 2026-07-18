# Research: Feature Status & Readiness Workspace (021)

All Technical Context unknowns resolved. Format: Decision / Rationale / Alternatives considered.

## R1 — Placement: new `readiness` tab in ArtView

- **Decision**: add `{ key: 'readiness', label: 'Readiness' }` to `ART_TAB_DEFINITIONS` in
  `client/src/views/ArtView/ArtView.tsx`, panel mounted like every other tab; all new code in
  `client/src/views/ArtView/readiness/`.
- **Rationale**: the org dashboard's audience (RTE/Solution Manager) and scope (ART + PI) are the
  Train space's exact charter; the PI selector, roster, and impediment tooling already live there.
  ArtView tabs are `{key,label}` entries with conditional mounts — an additive change.
- **Alternatives**: Reports Hub tab (rejected: read-only surface, inline writes are the point);
  new home card (rejected: 020 consolidated cards, and this is train-scoped work).

## R2 — Feature discovery JQL

- **Decision**: `issuetype = Feature AND cf[<piFieldNumber>] <PI clause>` + scope clause:
  `project in (<featureProjectKeys>)` when `tbxARTSettings.featureProjectKeys` is configured, else
  `labels in (<roster jiraLabels>)` when any team defines one, else no extra clause (with an
  on-screen scope note). Fields fetched: summary, status, assignee, labels, issuelinks, duedate,
  updated, created, flagged (`customfield_10021`), plus the resolved PO / estimate / PCode /
  target-start / target-end field ids. Max 200 per lens query (existing ceiling).
- **Rationale**: memorialized instance rule — Features live in a portfolio/program project; the
  `piReviewPullFeatures.buildDirectFeatureJql` precedent deliberately avoids team projectKey.
  `piFieldNumber` derives from `tbxARTSettings.piFieldId` (default `customfield_10301`) exactly as
  every other ART query does.
- **Alternatives**: Blueprint's project-scoped walk (rejected: misses features not under configured
  program epics and contradicts the portfolio rule); PO-assignee scoping from PI Review pull
  (rejected: readiness must cover the whole ART, not one PO's slice).

## R3 — Lens PI derivation

- **Decision**: from ArtView's live `availablePiNames` (already fetched and sorted): Current =
  `selectedPiName`; Upcoming = the next-newer name (none ⇒ the lens renders "no upcoming PI
  configured"); Carryover = up to the 4 next-older names, queried with the PI `in (...)` clause and
  filtered client-side to not-done features.
- **Rationale**: reuses the existing PI list source (`loadAvailablePiNamesFromJira` +
  `sortPiNames`) — no new configuration; 4 older PIs bounds query size while covering realistic
  carryover depth (a capped-coverage note is shown when the cap applies).
- **Alternatives**: a configured "upcoming PI" setting (rejected: duplicate source of truth);
  unbounded carryover history (rejected: unbounded JQL and noise).

## R4 — Refinement & state grouping

- **Decision**: refined = `classifyStatusBucket(feature)` ∈ {In Progress, Done} (i.e. status
  category has left `new`); unrefined = To Do bucket. Listing groups show real status NAMES;
  summary counts roll up by the three buckets.
- **Rationale**: implements the spec clarification (state-based, mirroring Feature States & Exit
  Criteria) with the canonical shared bucket mapper — no per-instance state-name hardcoding.
- **Alternatives**: named-state allowlist ("Funnel", "Analyzing") (rejected: instance-specific and
  brittle); hygiene-based readiness (rejected in clarification Q1).

## R5 — Blocker/risk signals

- **Decision**: reuse `detectImpedimentReasons` / `classifyImpedimentStaleness` from
  `ArtView/hooks/artHelpers.ts` per feature; a feature with any reason renders a risk marker with
  the reason labels.
- **Rationale**: pure JiraIssue-only helpers already power the Impediments tab — one detection
  vocabulary across the Train space.
- **Alternatives**: new risk heuristics (rejected: duplicate signal logic, drift risk).

## R6 — Field families (Estimate NF, PCode) via hygiene field config

- **Decision**: add `estimateFieldIds: string[]` and `pcodeFieldIds: string[]` to
  `HygieneFieldConfig` (defaults `[]`), with name discovery in `loadHygieneFieldConfig` via
  `matchFieldIdsByName(availableFields, ['Estimate (NF)', 'Estimate'])` and
  `(['Spark ID/PCode', 'Spark ID', 'PCode'])`. Ownership reuses the existing
  `productOwnerFieldIds`; dates reuse `targetStartFieldIds`/`targetEndFieldIds`.
- **Rationale**: framework-first — one field-discovery system already exists with the exact
  "configured first, defaults after, absent ⇒ not-checked" semantics the spec requires; additive
  keys cannot affect existing hygiene checks (each check reads only its own keys — verified).
- **Alternatives**: a separate readiness field-config module (rejected: second discovery system to
  keep in sync); hardcoded field ids (rejected: instance-specific, dishonest when absent).

## R7 — Inline fix control

- **Decision**: new `ReadinessFixControl` in the readiness dir, delegating every write to
  `featureReviewFixes`: `saveFeatureReviewUserField` (ownership — user search via
  `searchFeatureReviewUsers`, target choice assignee vs PO field), `saveFeatureReviewSimpleField`
  (dates, numeric estimate, PCode), `saveFeatureReviewOptionField` + `fetchFeatureReviewEditMeta`
  (select-shaped estimate fields), `fetchFeatureReviewTransitions` / `saveFeatureReviewTransition`
  + the shared `TransitionRequiredFields` component (status moves). PCode input normalized by a
  pure `normalizePcodeInput` (strips a leading P and zeros: `P00012345` → `12345`; rejects
  non-numeric remainder before any write).
- **Rationale**: `HygieneFixControl` is keyed by hygiene check-id descriptors and cannot express
  dual-target ownership or PCode normalization; the drift is at the CONTROL layer only — every
  write still flows through the one shared writer set (Article VII justification recorded in
  plan). `TransitionRequiredFields` is already the app-wide transition-screen collector.
- **Alternatives**: extending `HygieneFixControl` with readiness-only kinds (rejected: bloats the
  shipped hygiene surface with concerns it never renders and risks 019 regressions).

## R8 — AI insights

- **Decision**: `readiness/ai/` mirroring `ArtView/ai` (016): gate via `useAiAssistStore` (panel
  returns `null` locked), exchange via the shared `useAiAssistExchange` hook, one prompt per
  request covering the active lens's features, reply envelope `{kind: 'featureReadiness',
  items: [...]}` parsed with the shared `extractJsonPayload`, per-item accept/decline. Accepted
  proposals may write ONLY estimate, target end date, or due date — through the same
  `featureReviewFixes` writers; ownership suggestions and narrative insights render as
  read-only guidance (no write button).
- **Rationale**: exact conformance with the app-wide propose-only doctrine and the newest
  precedent; ownership writes are excluded because the AI cannot know valid account identities —
  a wrong-identity write is the one unrecoverable-embarrassment case.
- **Alternatives**: AI-driven bulk accept (rejected: violates per-item doctrine); letting AI
  propose owner account ids (rejected above).

## R9 — Deep linking

- **Decision**: ReadinessPanel reads/writes `?readinessLens=carryover|current|upcoming` and
  `?readinessFilter=<state-or-alert token>` via `useSearchParams`; `useArtData` gains a one-time
  initial-tab seed from `?artTab=` (validated against the tab union, additive, no persistence
  change). Full deep link example:
  `/agile-hub?space=train&artTab=readiness&readinessLens=upcoming`.
- **Rationale**: the Agile Hub shell already forwards foreign params untouched (020 FR-010
  machinery); ArtView merely needs an initial-tab seed — smallest possible touch to a shipped
  file, benefiting every future tab link.
- **Alternatives**: state-only (rejected: spec FR-003 requires shareable views); a readiness-only
  routing wrapper (rejected: more moving parts than one seed read).

## R10 — Honest states

- **Decision**: three-way distinction per GH #167 doctrine: (a) scope matched nothing ⇒ explicit
  amber "matched no features" message, no counts; (b) load failed ⇒ error message, no counts; (c)
  unconfigured field family ⇒ that alert column reads "not checked — no matching field" and is
  excluded from totals. Scanned-feature counts are always displayed next to lens totals.
- **Rationale**: the empty-scope-as-perfect-score lie is this codebase's most-litigated bug class;
  the doctrine is established and tested elsewhere.
- **Alternatives**: none worth considering.
