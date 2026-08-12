# Data Model: Cloned-Feature Sub-Lanes

**Feature**: `specs/035-feature-clone-sub-lanes` | **Date**: 2026-08-12

Every type below is new unless marked **(existing)**. Existing types are shown only where this feature adds a field.

---

## Configuration

### `DisciplineProjects` — new

One non-dev participant in a Feature family.

```ts
interface DisciplineProjects {
  /** Shown on the sub-lane. Free text, so a fourth discipline needs no code change. */
  name: string;
  /** The Jira project holding this discipline's CLONED Features, e.g. 'QEINT'. */
  featureProjectKey: string;
  /** The Jira project holding this discipline's work. May equal featureProjectKey. */
  storyProjectKey: string;
}
```

**Validation**

- `name` non-empty after trimming; duplicates rejected — two sub-lanes with the same label are indistinguishable.
- `featureProjectKey` MUST NOT equal the dev team's own Feature project. That is the DENP-1359 case from R-001: a
  clone in the team's own project is a peer Feature, and configuring it as a discipline would nest a lane under
  itself.
- Project keys are compared upper-cased and trimmed.

### `FeatureScopeSettings` — **(existing)**, one field added

```ts
interface FeatureScopeSettings {
  // …seven existing fields unchanged…
  /** Empty means this feature is off entirely and every lane renders exactly as it does today. */
  disciplineProjects: readonly DisciplineProjects[];
}
```

Touch list for the new field (from recon): `StoredTeamScope` (`boardScopeStore.ts:13`),
`FeatureScopeSettings` (`featureScope.ts:23`), `loadTeamFeatureScope` (`:38`), `saveTeamFeatureScope` (`:68`),
`FeatureScopePanel`, and the three test files.

---

## Discovery

### `CloneLink` — new

One clone found on a dev Feature, before it is judged.

```ts
interface CloneLink {
  cloneIssueKey: string;
  /** How it was found. Reported to the user, per FR-001a. */
  evidence: 'cloners-link' | 'feature-name-match';
}
```

### `CloneClassification` — new

What the board decided to do with a `CloneLink`, and why.

```ts
type CloneClassification =
  /** In a configured discipline project — becomes a sub-lane. */
  | { kind: 'discipline'; discipline: DisciplineProjects; cloneIssueKey: string; evidence: CloneLink['evidence'] }
  /** In the dev team's own Feature project — a peer Feature. Keeps its own top-level lane. (FR-001c) */
  | { kind: 'peer'; cloneIssueKey: string }
  /** In a project nobody configured. Reported once, never guessed at. (FR-001d) */
  | { kind: 'unconfigured'; cloneIssueKey: string; projectKey: string };
```

**State rule**: every discovered clone lands in exactly one of the three. There is no "ignored" case — silently
dropping a clone is the failure mode FR-001d exists to prevent.

---

## Rendering

### `SubLane` — new

One discipline's band under a primary lane.

```ts
interface SubLane {
  discipline: DisciplineProjects;
  cloneFeatureKey: string;
  /** Null when the clone Feature could not be read; the sub-lane still renders and says so. (FR-010) */
  cloneFeatureIssue: JiraIssue | null;
  /** Which tone pair this discipline draws in, by configured position. (R-006) */
  toneIndex: number;
  /** True when found by name rather than by link — shown as an inference. (FR-001a) */
  isInferredMatch: boolean;
  /** Same shape as a primary lane's cells, in the DEV team's columns. (FR-007) */
  cellsByColumnId: Record<string, LaneCell>;
  /** Every item under this clone, unfiltered — the family figure's input. */
  items: RollupBoardItem[];
  isCollapsed: boolean;
  matchedItemCount: number;
  totalItemCount: number;
}
```

### `RenderedLane` — **(existing)**, one field added

```ts
interface RenderedLane {
  // …five existing fields unchanged…
  /** Empty for a Feature with no clones, which then renders byte-identically to today. (FR-005) */
  subLanes: SubLane[];
}
```

**Why nested rather than top-level** (R-003): top-level sub-lanes would enter `allFeatureKeys`, and therefore the
`SortableContext` and the lane-reorder branch of `handleBoardDragEnd`, making a sub-lane draggable against its own
parent.

### `FamilyProgress` — new

```ts
interface FamilyProgress {
  /** The dev figure — computeFeatureProgress over the primary lane's items only. Unchanged from today. */
  dev: FeatureProgress;
  /** Null when there are no sub-lanes: a family figure equal to the dev figure is noise. (FR-008a) */
  family: FeatureProgress | null;
  /** True when dev reads complete and family does not. The signal worth acting on. (FR-008b) */
  hasDisagreement: boolean;
}
```

**Derivation rule**: both figures come from the **same** `computeFeatureProgress` (R-004). The family call receives
the primary items concatenated with every sub-lane's items.

**Honesty rule**: `FeatureProgress.basis` may differ between the two — a family whose QE stories are unpointed falls
back to issue count while dev stays on points. The lane MUST NOT present two different bases as one comparison.

---

## Relationships

```
FeatureScopeSettings
  └── disciplineProjects: DisciplineProjects[]        (configuration)

MasterCard (dev Feature)                              (existing)
  └── RenderedLane                                    (existing, + subLanes)
        ├── cellsByColumnId  → dev work               (existing)
        └── subLanes: SubLane[]                       (new)
              └── cellsByColumnId → that discipline's work, in DEV columns

CloneLink ──classified──> CloneClassification
                            ├── discipline   → becomes a SubLane
                            ├── peer         → keeps its own top-level lane
                            └── unconfigured → reported once
```

---

## Invariants

1. **One issue, one place.** An issue is drawn in the lane of the Feature it rolls up to, resolved by the existing
   precedence chain (FR-009). No new tie-break.
2. **No clones, no change.** `subLanes: []` MUST produce byte-identical rendering to today (FR-005), and
   `FamilyProgress.family` MUST be null (FR-008a).
3. **Absence means absence.** A missing sub-lane always means "no clone", never "a clone we failed to read" (FR-010).
4. **Vitals precede filters.** The family figure is computed over unfiltered items, like the dev figure
   (`boardLayout.ts:3-5`).
5. **One level deep.** A clone of a clone is attributed to the family root, never nested twice (A-007).
6. **Read-only is structural.** Sub-lane cards are non-draggable at the hook, not filtered at the drop (R-005).
