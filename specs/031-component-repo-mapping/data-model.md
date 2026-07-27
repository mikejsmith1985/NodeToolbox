# Data Model: Component (Repo) Mapping & Repo-Only Story Generation

All shapes are plain data (no I/O, no clock) so the stores, the AI ingest, the deterministic breakdown, and the write
layer share one source of truth. Persistence is `localStorage`; the entities below are the in-memory contracts.

## ComponentClassification (persisted)

The authoritative repo/domain marker Jira does not have.

| Field | Type | Notes |
|---|---|---|
| `nameKey` | string | component name, **lower-cased** — the identity (case-insensitive, cross-project) |
| `displayName` | string | original-cased name for display |
| `kind` | `'repo' \| 'domain'` | set by an explicit human action |

- **Absence = unclassified**: a component with no entry is neither repo nor domain (drives no story, not auto-applied),
  and is surfaced as "not yet classified" (FR-002). The store never invents an entry from a name.
- **Store**: `Record<nameKey, {displayName, kind}>` persisted at `tbxComponentClassification`.
- **Validation**: `kind` ∈ {repo, domain}; re-classifying overwrites and takes effect everywhere immediately (FR-004).

## RepoAllowlist (derived)

The set of `displayName`s whose `kind === 'repo'`. Derived by a store selector; it is the **only** value set the AI
mapping may propose and the **only** components that generate a story (FR-003 — one source, cannot disagree).

## TeamDomainRule (persisted)

| Field | Type | Notes |
|---|---|---|
| `teamProfileId` | string | the saved Dashboard Team profile id (Clarify Q4) |
| `domainComponentNames` | string[] | domain components always applied to that team's Features |

- **Store**: `Record<teamProfileId, string[]>` at `tbxTeamDomainRules`.
- **Validation** (FR-032): each name SHOULD resolve to a component classified `domain`; a name that is classified
  `repo`, unclassified, or nonexistent is **flagged** (not applied).

## FeatureComponentMapping (transient)

The AI-proposed, human-accepted repo components for one Feature. Not persisted as its own record — accepted values are
written to the Feature's `components` field (Composition draft bag or a direct edit on the Planner surface).

| Field | Type | Notes |
|---|---|---|
| `featureKey` | string | |
| `proposedRepoNames` | string[] | every entry is on the RepoAllowlist (non-allowlist rejected on ingest, FR-012) |
| `rejected` | `{ value: string; reason: string }[]` | non-allowlist values, surfaced not dropped |

## RepoStoryProposal (transient)

One deterministic Story per repo component, feeding the 028 scheduling/dating/write pipeline.

| Field | Type | Notes |
|---|---|---|
| `featureKey` | string | parent Feature |
| `repoName` | string | the single repo this Story represents (RepoAllowlist member) |
| `title` | string | `{Feature summary} ({repoName})` (FR-025), PO-editable before creation |
| `matchExistingKey` | string \| null | set when an existing child Story already covers this repo (idempotency, FR-023) |

- Maps onto the existing `StorySuggestion`/`ScheduledStory` shapes; on create, `buildStoryCreateRequest` sets the
  Story's `components` to `[{ id: <resolved id of repoName> }]` (FR-026).
- **Empty case**: a Feature with zero RepoAllowlist components produces zero `RepoStoryProposal`s and a `honestState`
  "map repos first" (FR-027). Domain/unclassified components never appear here (FR-020).

## Relationships

```
ComponentClassification ──derives──▶ RepoAllowlist
        │                                  │
        │ (kind=domain)                    │ (constrains)
        ▼                                  ▼
   TeamDomainRule ──applies domain──▶ Feature.components ◀──accept── FeatureComponentMapping (AI, HITL)
                                            │
                                            │ (repo components only)
                                            ▼
                                   RepoStoryProposal (one per repo) ──▶ 028 pipeline ──▶ Story (components={repo})
```

## State / lifecycle notes

- A component moves `unclassified → repo|domain` (and may be re-classified) purely in the classification store;
  existing Features keep whatever components they already carry, but **story generation re-evaluates against the
  current classification** (FR-024) — a now-`domain` component stops generating a story; a now-`repo` one starts.
- Repo-story generation is **idempotent**: re-running proposes stories only for repos without an existing matching
  child Story (FR-023).
