# Research: Component (Repo) Mapping & Repo-Only Story Generation

## R1 — Where the repo/domain classification lives

**Decision**: A new client store (`componentClassificationStore`, zustand + `localStorage` key
`tbxComponentClassification`) mapping **component name (lower-cased) → `'repo' | 'domain'`**. Absent ⇒ unclassified.

**Rationale**: Recon proved components live **only in Jira** (`listProjectComponents` → `{id, name, description}`);
there is no local component store and **no repo/domain marker** anywhere. The spec forbids inferring the kind from the
name (FR-002), so a human-set, persisted classification is required and it must be Toolbox-held (Jira has no field for
it). localStorage+zustand matches the app's existing store idiom (`settingsStore`, `toolVisibilityStore`,
`aiAssistStore`) — zero new dependency (Article VII).

**Identity = name (case-insensitive)**: a repo is one thing across projects, but Jira components are per-project with
per-project ids. Classifying by name lets one decision cover a repo everywhere; the per-project **id** is resolved at
write time from the name (R3).

**Alternatives considered**: (a) store the marker in the Jira component **description** (e.g. `repo:`/`domain:`) —
rejected: mutates Jira, needs write perms, fragile, and not every component was created through us. (b) Infer from a
naming convention — rejected by FR-002 (explicit human action only). (c) A Confluence-backed registry — heavier than
warranted for a small name→kind map; localStorage is per-machine but this is admin-set reference data that can be
re-entered, and export/import can be added later if needed.

## R2 — The AI mapping module (allowlist-constrained, propose-only)

**Decision**: New pure module `componentMappingAiAssist.ts` mirroring `compositionAiAssist.ts`:
- `buildComponentMappingPrompt(feature, repoAllowlist)` — hands the assistant the Feature's summary/description and
  the **repo allowlist**, instructing it to choose components **only** from that list (the exact mechanism
  `buildCompositionPrompt` uses for select-field option labels via `allowedValuesByFieldId`).
- `parseComponentMappingIngest(reply, repoAllowlist)` → `AiIngestResult<{ componentName }>` — echoes
  `parseCompositionIngest`: never throws, guards `payload.kind === 'componentMapping'`, and **drops any value not on
  the allowlist WITH an error** so a domain tag / typo / unknown repo can never be proposed (FR-012, agree-by-
  construction with the allowlist).

**Rationale**: Direct reuse of a shipped, tested pattern (`AiIngestResult`, `extractJsonPayload`, the
allowlist-reject-on-ingest rule). Gated by `useAiAssistStore` and rendered by `PoAiPanel` (unchanged) → propose-only,
per-item accept, renders nothing when locked, never AI-attributed (Article IX). The nine-section prose rules do **not**
apply here — this maps a structured field, not description prose.

**Alternatives considered**: reusing `compositionAiAssist` directly — rejected: it produces a full Feature draft
(summary/description/fields), not a component list; a focused module is clearer and independently testable.

## R3 — Writing components onto a Feature (and onto each Story)

**Decision**: Components are the Jira **system field** `components`, written as `[{ id }, …]`.
- **Composition surface**: accepted repo components go into the composition draft's field bag
  (`draft.fields.components = [{id}]`) and are written by the existing `runCompositionCommit` at Commit — no new writer.
- **Planner / Story surface**: `buildStoryCreateRequest` (piPlanJira) gains the Story's own `components` set to its one
  repo, written by the existing `createIssue`.
- **Name→id resolution**: new tiny `componentResolve.ts` maps allowlist names → this project's component ids via
  `listProjectComponents(projectKey)` (already used by the Component Manager). Names with no matching project component
  are surfaced (honest state), never silently dropped.

**Rationale**: No new write primitive — everything flows through the existing composition commit and `createIssue`
create payloads. Field id is the system name `components`, not a discovered customfield, so no createmeta discovery is
needed beyond confirming the field is on the screen (handled by the existing commit's field allowlist).

## R4 — Repo-only story generation vs the 028 AI breakdown

**Decision**: New deterministic `repoStoryBreakdown.ts` produces **one Story per repo component** on a Feature:
- Title `{Feature summary} ({repo})` (FR-025), each Story carrying that repo for its `components` field (FR-026).
- Idempotent: a repo that already has a matching child Story (matched by its repo component and/or the
  `({repo})` title suffix in `existingChildren`) is not re-created (FR-023).
- Empty: a Feature with no repo components yields **zero** stories and a `honestState` "map repos first" (FR-027).
- Repo/domain status is evaluated against the **current** classification at generation time (FR-024).
The resulting stories feed the **existing** 028 pipeline (scheduling, dating, sub-task scaffold, write) — only the
*origin* of the story set changes for repo-driven Features. The 028 AI breakdown (`piPlanAiAssist`/`piPlanBreakdown`)
is **not removed** and remains available for non-repo-driven use.

**Rationale**: Clarify Q1/Q2 fixed this: deterministic one-per-repo **is** the story set; no fallback. Reusing 028's
downstream keeps sub-tasks, dates, and capacity identical — the change is surgical (a new front-end that emits the
same `StorySuggestion`/`ScheduledStory` shape). Recon confirmed 028 reads **no** component field today, so this is
purely additive to `FeatureInput` (repo components) and to `buildStoryCreateRequest` (set components).

**Alternatives considered**: feeding repos into the AI breakdown prompt and letting the model emit per-repo stories —
rejected (Clarify Q1 = deterministic; AI's role is mapping only, keeping story count honest and repro-testable).

## R5 — The team → domain-component rule

**Decision**: New `teamDomainRuleStore` (zustand + `localStorage` `tbxTeamDomainRules`) keyed by **saved Dashboard Team
profile id** (Clarify Q4) → a list of **domain** component names. Applied **deterministically** (never AI) when a
Feature for that team is composed/planned: the Feature's `components` are unioned with the team's domain components
(dedup by name). A rule entry that names a component classified `repo`, unclassified, or nonexistent is **flagged** at
save/apply, never applied blindly (FR-032). Auto-applied domain components never generate a story (guaranteed by R4's
repo-only rule).

**Rationale**: Reuses the existing team identity the PO Tool/PI Planner already select (no new team concept), and the
same localStorage store idiom. Determinism keeps it out of the AI path entirely.

## Summary of net-new vs reuse

| Net-new (justified) | Reuse |
|---|---|
| `componentClassificationStore` (+ allowlist selector) | zustand+localStorage idiom; `listProjectComponents` |
| `componentMappingAiAssist` (kind:'componentMapping') | `compositionAiAssist` allowlist pattern, `AiIngestResult`, `extractJsonPayload`, `PoAiPanel`, `useAiAssistStore` |
| `componentResolve` (name→id) | `listProjectComponents` |
| `repoStoryBreakdown` (one-per-repo, dedup, empty-state) | 028 scheduling/dating/sub-task/write pipeline; `StorySuggestion`/`ScheduledStory` shapes |
| `teamDomainRuleStore` + apply | team-profile identity; localStorage idiom |
| `ComponentManagerPanel` classification toggle | the existing panel + `componentManager` |
| `buildStoryCreateRequest` components set | `createIssue`, the existing create payload |
