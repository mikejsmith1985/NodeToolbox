# Contract: Team → Domain-Component Rule (deterministic)

**Module**: `client/src/views/PoTool/domain/teamDomainRuleStore.ts` (zustand + localStorage) + application at the
Composition/Planner surfaces. **Never AI.**

## Store shape
- Persistence key: `tbxTeamDomainRules`.
- State: `rulesByTeam: Record<teamProfileId, string[]>` — the domain component names always applied to that team's
  Features. `teamProfileId` is the saved Dashboard Team profile id (Clarify Q4).

## Operations
| Operation | Behaviour |
|---|---|
| `setTeamDomainComponents(teamProfileId, names)` | replace that team's list |
| `getTeamDomainComponents(teamProfileId): string[]` | read (empty when none) |
| `validateRule(teamProfileId, classificationLookup): { valid: string[]; flagged: {name, reason}[] }` | flag names that are classified `repo`, unclassified, or nonexistent (FR-032) |

## Application (deterministic, FR-030/031)
- When a Feature for `teamProfileId` is composed or planned, union the Feature's `components` with the team's **valid**
  domain components (dedup by name). No AI involved.
- Applied domain components are resolved name→id (`componentResolve`) and written via the same `components` field path.
- Already-present domain components are **not duplicated** (FR-031).
- A flagged rule entry (repo/unclassified/nonexistent) is **not applied** and is surfaced to the PO (FR-032) — a repo
  can never be applied as a domain tag.

## Interaction with story generation
- Auto-applied domain components never generate a story — guaranteed by the repo-only rule (repo-story-generation
  contract, FR-020); this contract adds no story behaviour.

## Tests (teamDomainRuleStore.test.ts)
- set/get round-trip; apply unions + dedups; `validateRule` flags a repo-classified name, an unclassified name, and a
  nonexistent name; a valid domain name passes; applying twice does not duplicate.
