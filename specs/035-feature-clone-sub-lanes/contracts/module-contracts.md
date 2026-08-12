# Module Contracts: Cloned-Feature Sub-Lanes

**Feature**: `specs/035-feature-clone-sub-lanes` | **Date**: 2026-08-12

This feature exposes no HTTP surface. Its contracts are the **pure module boundaries** — which is where the testable
behaviour lives, per Constitution Article V. Each signature below is the unit under test for its requirement.

---

## `rollupBoard/cloneFamily.ts` — new, pure

The whole clone-detection decision. No I/O.

```ts
/** Every clone named on a dev Feature's own links, both directions. (FR-001, A-008) */
export function readCloneLinks(featureIssue: JiraIssue): CloneLink[];

/**
 * Decides what each clone is: another discipline's copy, a peer in our own project, or unconfigured.
 * THE PROJECT DECIDES, NOT THE LINK. (FR-001c, FR-001d)
 */
export function classifyClone(
  cloneIssueKey: string,
  evidence: CloneLink['evidence'],
  devFeatureProjectKeys: readonly string[],
  disciplineProjects: readonly DisciplineProjects[],
): CloneClassification;

/** Exact, trimmed name match inside configured discipline projects only. The net, not the plan. (FR-001b) */
export function findCloneByFeatureName(
  devFeatureIssue: JiraIssue,
  candidateFeatureIssues: readonly JiraIssue[],
  disciplineProjects: readonly DisciplineProjects[],
): CloneLink[];

/** Which tone pair a discipline draws in, by configured position. Stable across reloads. (R-006, US2) */
export function readDisciplineToneIndex(
  discipline: DisciplineProjects,
  disciplineProjects: readonly DisciplineProjects[],
): number;

/** One sentence naming clones in projects nobody configured. Empty when there are none. (FR-001d) */
export function describeUnconfiguredClones(classifications: readonly CloneClassification[]): string;
```

**Contract tests**

| # | Given | Then |
|---|---|---|
| C-01 | A Feature whose links read `is cloned by DENP-1359` and `is cloned by QEINT-610`, dev project `DENP`, QE configured as `QEINT` | `DENP-1359` classifies `peer`; `QEINT-610` classifies `discipline` |
| C-02 | The same links recorded on the other side (`clones`) | Identical result — direction must not decide |
| C-03 | A clone in `BTINT`, nothing configured for it | Classifies `unconfigured`, and `describeUnconfiguredClones` names it |
| C-04 | No `disciplineProjects` configured at all | Every clone classifies `peer` or `unconfigured`; **never** `discipline` |
| C-05 | Two Features with identical Feature Name, one outside the configured projects | `findCloneByFeatureName` returns only the in-project one |
| C-06 | Feature Names differing only by trailing whitespace | Matched |
| C-07 | Feature Names sharing a prefix but not equal | **Not** matched — exact only, no fuzzy |
| C-08 | Same discipline list, two calls | `readDisciplineToneIndex` returns the same index |
| C-09 | A link of a type other than Cloners (e.g. `relates to`) | Not returned by `readCloneLinks` |

---

## `rollupBoard/familyProgress.ts` — new, pure

```ts
/**
 * Both figures, from the SAME computeFeatureProgress. (R-004, FR-008)
 * `family` is null when there are no sub-lanes. (FR-008a)
 */
export function computeFamilyProgress(
  primaryItems: readonly RollupBoardItem[],
  subLaneItems: readonly (readonly RollupBoardItem[])[],
): FamilyProgress;

/** States the dev-vs-family gap. Empty when there is none. (FR-008b) */
export function describeProgressDisagreement(familyProgress: FamilyProgress): string;

/** Warns when the two figures are not directly comparable because their bases differ. (R-004) */
export function haveDifferentBases(familyProgress: FamilyProgress): boolean;
```

**Contract tests**

| # | Given | Then |
|---|---|---|
| P-01 | No sub-lanes | `family` is null; `dev` matches today's value exactly |
| P-02 | Dev all done, QE half done | `dev.percentComplete` 100, `family.percentComplete` < 100, `hasDisagreement` true |
| P-03 | Dev pointed, QE unpointed | `dev.basis` `'story-points'`, `family.basis` `'issue-count'`, `haveDifferentBases` true |
| P-04 | Everything done everywhere | `hasDisagreement` false |
| P-05 | Sub-lane with zero items | `family` equals `dev` in value but is still non-null, because a discipline with no work is a fact worth showing |

---

## `rollupBoard/subLaneLayout.ts` — new, pure

```ts
/**
 * Builds each discipline's band, using the DEV team's columns. (FR-007)
 * Unmapped clone statuses land in the Unmapped column like any other. (FR-007a)
 */
export function buildSubLanes(input: BuildSubLanesInput): SubLane[];
```

**Contract tests**

| # | Given | Then |
|---|---|---|
| L-01 | No clones | Returns `[]`, and the lane renders byte-identically to today (FR-005) |
| L-02 | A QE clone with work | One sub-lane, cards in the dev team's columns |
| L-03 | A clone status no column claims | That card lands in Unmapped, not dropped (FR-007a) |
| L-04 | A clone Feature that could not be read | Sub-lane still present, flagged unreadable (FR-010) |
| L-05 | An item rolling up to the dev Feature AND present in a discipline project | Appears once, in the lane of the Feature it rolls up to (FR-009) |
| L-06 | A clone matched by name | `isInferredMatch` true (FR-001a) |
| L-07 | Active quick filters | Applied to sub-lane cards on the same terms as primary (FR-012); `totalItemCount` still counts everything |

---

## `components/SubLane.tsx` — new, presentational

```ts
interface SubLaneProps {
  subLane: SubLane;
  columns: readonly RenderedColumn[];
  columnMinWidth: string;
  onOpenIssue?: (issueKey: string) => void;
  onToggleCollapsed: (cloneFeatureKey: string) => void;
}
```

**Contract tests**

| # | Given | Then |
|---|---|---|
| S-01 | Any sub-lane | Discipline name rendered as **text**, not colour alone (FR-004) |
| S-02 | A card inside it | Not draggable — no drag listeners on the element (FR-006, R-005) |
| S-03 | Any sub-lane | States it is read-only **before** interaction is attempted (FR-006a) |
| S-04 | A card inside it | Click opens detail exactly as a primary card does (US4-1) |
| S-05 | An unreadable clone | Says which discipline is missing and why (FR-010, SC-006) |
| S-06 | A name-matched clone | Marks the relationship as inferred (FR-001a) |

---

## `components/ChildCard.tsx` — **(existing)**, one prop added

```ts
interface ChildCardProps {
  // …existing props unchanged…
  /** Withholds drag listeners AND disables the hook — the BoardColumnHeaderRow precedent. (R-005) */
  isReadOnly?: boolean;
}
```

**Contract tests**

| # | Given | Then |
|---|---|---|
| R-01 | `isReadOnly` unset | Card behaves exactly as today — the primary lane must not change (US4-3) |
| R-02 | `isReadOnly` set | `useDraggable` disabled **and** listeners withheld; both, because `disabled` alone still advertises a draggable element to assistive technology |

---

## `rollupBoard/boardScopeStore.ts` — **(existing)**, one field added

**Contract tests**

| # | Given | Then |
|---|---|---|
| T-01 | A scope stored before this feature existed | Loads with `disciplineProjects: []` — absent means never configured, not corrupt |
| T-02 | Disciplines saved then loaded | Round-trips exactly, including order (which decides colour) |
| T-03 | Another team's scope | Byte-identical after save — the existing isolation guarantee |
