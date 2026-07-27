# Contract: Repo-Only Story Generation

**Module**: `client/src/views/ArtView/piPlan/repoStoryBreakdown.ts` (pure) + a `buildStoryCreateRequest` edit in
`piPlanJira.ts`. Feeds the existing 028 scheduling/dating/sub-task/write pipeline.

## buildRepoStoryProposals(feature, repoComponents, existingChildren, classificationLookup)
- Inputs:
  - `feature`: `{ key, summary }`.
  - `repoComponents`: the Feature's components filtered to the **RepoAllowlist** (evaluated at generation time — FR-024).
  - `existingChildren`: `ExistingChild[]` (028 shape) for idempotency.
  - `classificationLookup`: `getKind(name)` — so domain/unclassified are excluded here too.
- Output: `RepoStoryProposal[]` — **one per repo component**, plus `honestStates: string[]`.

## Rules
| Rule | Requirement |
|---|---|
| One per repo | Exactly one Story per `repo` component; **zero** for `domain`/unclassified (FR-020) |
| Title | `{feature.summary} ({repoName})`, PO-editable before creation (FR-025) |
| Story component | On create, the Story's own `components = [{ id: resolve(repoName) }]` (FR-026) |
| Idempotency | Skip a repo whose `existingChildren` already contains a matching Story (matched by the `({repoName})` title suffix and/or the Story's repo component); re-run creates no duplicate (FR-023) |
| Empty | Zero repo components → `[]` + honestState `"No repo components mapped — map repos first."` (FR-027, no fallback) |
| Count/capacity | Domain/unclassified components never counted toward the story total (FR-021) |
| Replaces 028 breakdown | For repo-driven Features this is THE story set; the AI breakdown (`piPlanAiAssist`/`piPlanBreakdown`) is not used to decide count/identity and is not removed for other uses (FR-020, Clarify Q1) |

## Downstream (reused, unchanged)
Each `RepoStoryProposal` maps to the existing `StorySuggestion`/`ScheduledStory` and flows through 028's expansion,
scheduling, dating, and the sub-task scaffold (`internalTest` + deploy INT/REL/PROD). Only the *origin* of the story
set changes.

## buildStoryCreateRequest edit (piPlanJira.ts)
Add the Story's repo to the create payload:
```
fields.components = [{ id: resolvedComponentId }]   // when the ScheduledStory carries a repo (031)
```
Guarded so 028's non-repo stories (no repo carried) are unaffected — the field is added only when a repo id is present.

## Tests (repoStoryBreakdown.test.ts)
- N repo components → N proposals titled `{summary} ({repo})`; a domain + an unclassified component → 0 proposals for
  them; empty repo set → [] + honestState; existing matching child → skipped (idempotent); re-classify repo→domain →
  that repo stops generating; each proposal carries its single repo for the components write.
