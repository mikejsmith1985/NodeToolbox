# Phase 1 Data Model: Feature Roll-Up Board

**Feature**: 034-feature-rollup-board | **Date**: 2026-08-07

Shapes are TypeScript-flavoured for precision. Every invariant marked **INV-n** is a unit-testable assertion, not a
UI convention — that is deliberate, because the spec's hardest guarantees ("nothing is hidden", "the parent is
rendered once") are only trustworthy if they can be asserted without rendering anything.

---

## 1. Board Scope

The inputs that decide what the board shows. Derived entirely from the Team space's existing selection.

```ts
interface RollupBoardScope {
  boardId: number;              // from the Team space; never re-picked here (FR-001)
  teamProfileId: string;        // keys the vocabulary and the personal preferences
  featureLinkFieldId: string;   // from ART settings via loadConfiguredFeatureLinkFieldId()
  subStatusFieldId: string;     // discovered by name; '' when this instance has none (FR-025)
  storyPointsFieldIds: string[];// candidate ids, existing helper
}
```

**INV-1**: `boardId` is never written by this feature. It is read-only input.

---

## 2. Loaded Issue Set

```ts
interface RollupBoardIssueSet {
  boardIssues: JiraIssue[];        // every page of /board/{id}/issue
  subtaskIssues: JiraIssue[];      // parent in (<board issue keys>) sweep
  featureIssues: Map<string, JiraIssue>; // key in (<resolved feature keys>), cross-project
  load: LoadCompleteness;
}

interface LoadCompleteness {
  isComplete: boolean;
  expectedBoardIssueCount: number; // Jira's reported total
  loadedBoardIssueCount: number;
  failures: Array<{ stage: 'board' | 'subtasks' | 'features'; detail: string }>;
}
```

**INV-2**: `loadedBoardIssueCount === expectedBoardIssueCount` whenever `isComplete` is true. The board renders the
warning of FR-053 exactly when `isComplete` is false — it is never inferred from an empty array.

**INV-3**: the issue set is never truncated (FR-055). A cap may cause a *warning* (FR-056), never a slice.

---

## 3. Roll-Up Route

How one issue reaches its Master Card. Displayable (FR-006, FR-032, FR-036).

```ts
type RollUpRouteStep =
  | { kind: 'featureLink'; fieldId: string; toKey: string }
  | { kind: 'parent'; toKey: string }
  | { kind: 'issueLink'; linkTypeName: string; toKey: string };

interface RollUpRoute {
  steps: RollUpRouteStep[];      // ordered, from the issue outward
  featureKey: string | null;     // null ⇒ the No Feature master card
  precedenceRank: DefectPrecedence | null; // set only for defects
  unchosenCandidates: RollUpCandidate[];   // FR-007 — never discarded
  notes: RollUpNote[];           // e.g. 'link-loop-detected'
}

type DefectPrecedence = 'dev-story' | 'via-qa-issue' | 'direct-feature';

interface RollUpCandidate {
  toKey: string;
  viaLinkTypeName: string;
  resolvedFeatureKey: string | null;
}
```

**INV-4**: `steps` is non-empty whenever `featureKey !== null`. A Feature is never asserted without a stated route.

**INV-5**: `unchosenCandidates` contains every candidate the precedence chain examined and did not take. It is
**never** filtered for brevity — FR-007 forbids silent discard.

**INV-6**: a route never contains the same key twice (loop termination). A detected loop appends a note and stops.

---

## 4. Board Item

One issue, resolved. The unit everything downstream consumes.

```ts
interface RollupBoardItem {
  issue: JiraIssue;
  key: string;
  typeBucket: 'story' | 'defect' | 'subtask' | 'other';   // FR-027, FR-029
  parentKey: string | null;       // the container this item groups under (FR-035)
  route: RollUpRoute;
  featureKey: string | null;      // null ⇒ No Feature
  columnId: string;               // resolved from own status+sub-status, or UNMAPPED_COLUMN_ID
  statusName: string;
  subStatusValue: string | null;  // null when the instance has no sub-status field
  assigneeAccountId: string | null;
  assigneeDisplayName: string | null;
  fixVersionNames: string[];
  storyPoints: number | null;     // null ⇒ absent, never 0 (FR-013)
  /** Read-only checklist progress, present ONLY when the host issue carries readable checklist data (FR-054). */
  checklistCompletion: { completedCount: number; totalCount: number } | null;
}
```

**INV-7**: `columnId` is derived **only** from this item's own status and sub-status. It never reads the parent's or
children's state (FR-030).

**INV-8**: `typeBucket === 'other'` is a first-class value, not a fallback that hides an issue. Items of any type are
always placed (FR-029). Note that no quick filter selects `other` — FR-039 names exactly three — so any active type
filter excludes them; the lane's `n of N match` count is what keeps that visible.

**INV-8a**: `checklistCompletion` is `null` unless the host issue genuinely carries readable checklist data. It is
never defaulted to `{0, 0}`, because a zero-of-zero indicator would assert a checklist that does not exist.

---

## 5. Master Card

One Feature swimlane.

```ts
interface MasterCard {
  featureKey: string | NO_FEATURE_KEY;
  isSynthetic: boolean;             // true for the No Feature card (FR-008)
  featureIssue: JiraIssue | null;   // null when unreadable — see INV-10
  isFeatureUnreadable: boolean;
  vitals: MasterCardVitals;
  items: RollupBoardItem[];         // the complete, UNFILTERED set for this Feature
}

interface MasterCardVitals {
  key: string;
  summary: string;
  statusName: string | null;
  progress: FeatureProgress;
  dependencyCount: number;          // from detectImpedimentReasons + dependency link types
  isFlagged: boolean;
  storyPoints: number | null;       // null ⇒ shown as absent (FR-013)
  priorityName: string | null;
  childCount: number;               // shown while collapsed (FR-000g)
}
```

**INV-9**: `items` always holds the Feature's whole set. Filtering never mutates it, which is what makes FR-014
("Master Card figures ignore filters") true by construction rather than by discipline.

**INV-10**: a Feature whose issue could not be read still produces a Master Card, keyed and marked
`isFeatureUnreadable` — it is never folded into No Feature (spec edge case).

---

## 6. Feature Progress

```ts
interface FeatureProgress {
  percentComplete: number | null;   // null when there is nothing to measure
  basis: 'story-points' | 'issue-count' | 'none';
  completedUnits: number;
  totalUnits: number;
}
```

**INV-11**: `basis` is always returned with the number. FR-012 cannot be forgotten at the call site because the value
is not available without it.

**INV-12**: `basis === 'story-points'` only when **every** contributing item has a non-null `storyPoints`. A single
missing estimate demotes the whole Feature to `issue-count`, because a partial points sum silently understates.

---

## 7. Board Column and Status Mapping

```ts
interface BoardColumn {
  id: string;                    // stable, generated once
  name: string;                  // the team's own words
  order: number;
  mapping: ColumnStatusMapping | null; // null ⇒ defined but not yet mapped
}

interface ColumnStatusMapping {
  jiraStatusName: string;
  subStatusValue: string | null; // null when the instance has no sub-status field (FR-025)
}

interface BoardVocabulary {
  teamProfileId: string;
  columns: BoardColumn[];
  updatedAt: string;             // ISO
  lastSyncedAt: string | null;   // null ⇒ never synced with the workspace (FR-019c)
}
```

**INV-13**: no two columns share a `(jiraStatusName, subStatusValue)` pair. Validated on save and **refused** with an
explanation (FR-018) — never silently deduplicated.

**INV-14**: `UNMAPPED_COLUMN_ID` always exists in the rendered column set and is never user-editable or removable
(FR-024). It is not stored in `columns`; it is appended at render.

**INV-15**: a column whose `mapping` is null holds no items and says so. It is not an error state.

---

## 8. Parent Container

The per-column grouping label. **Not a card.**

```ts
interface ParentContainer {
  parentKey: string;
  parentSummary: string;
  isParentInScope: boolean;      // false ⇒ header still shown, no card drawn (FR-037)
  items: RollupBoardItem[];      // only this column's children of this parent
}
```

**INV-16 (the load-bearing one)**: for any parent key P, across the entire board, P appears as a **card** exactly
once — in the column matching P's own status — and as a **container header** zero or more times. Container headers
are excluded from every issue count. This is what makes FR-002 and SC-001 provable, and it is the single most likely
thing to be got wrong.

**INV-17**: a container with zero items after filtering is removed entirely (FR-042). An empty container implies work
that is not there.

---

## 9. Board Layout

The rendered arrangement.

```ts
interface BoardLayout {
  columns: RenderedColumn[];         // shared header row, includes Unmapped (FR-000a/b)
  lanes: RenderedLane[];             // ordered by the personal Board Order
}

interface RenderedLane {
  masterCard: MasterCard;
  isCollapsed: boolean;
  matchedItemCount: number;          // under active filters
  totalItemCount: number;            // ignores filters (FR-036, FR-041)
  cellsByColumnId: Record<string, LaneCell>;
}

interface LaneCell {
  containers: ParentContainer[];     // grouped children
  looseItems: RollupBoardItem[];     // items with no in-scope parent, incl. parents' own cards
}
```

**INV-18**: `sum over lanes, columns of (looseItems + container items) === ` the number of resolved board items.
Nothing is dropped by layout. This is the direct expression of SC-001 and is asserted in a unit test.

**INV-19**: `totalItemCount` is computed from `masterCard.items` (unfiltered) and `matchedItemCount` from the filtered
set. They are two counts of two sets, never one count reused.

---

## 10. Quick Filter State

```ts
interface QuickFilterState {
  typeBuckets: Set<'story' | 'defect' | 'subtask'>; // empty ⇒ no type filter
  assigneeAccountId: string | null;
  fixVersionName: string | null;
}
```

**INV-20**: filters compose with AND (FR-035). Clearing resets all three in one action.

**INV-21**: filters affect `LaneCell` contents only. They never touch `MasterCard.vitals` (FR-014).

---

## 11. Personal Preferences

Never shared, never written to Jira.

```ts
interface BoardPreferences {
  teamProfileId: string;
  boardId: number;
  laneOrder: string[];                      // feature keys, ordered (FR-043–047)
  collapsedByFeatureKey: Record<string, boolean>;
}
```

**INV-22**: a Feature absent from `laneOrder` sorts to the end (FR-041); its absence is not an error.

**INV-23**: nothing in this entity is ever included in a Confluence publish (FR-045) or in any Jira write (FR-046).

---

## Entity relationships

```
RollupBoardScope
      │ drives
      ▼
RollupBoardIssueSet ──resolve──► RollupBoardItem[] ──group──► MasterCard[]
                                        │                          │
                                  columnId via                 vitals via
                                  BoardVocabulary            FeatureProgress
                                        │                          │
                                        └────────► BoardLayout ◄────┘
                                                   ▲        ▲
                                          QuickFilterState  BoardPreferences
```

The single-direction flow is intentional: `MasterCard.vitals` is computed from `MasterCard.items` **before**
`QuickFilterState` is applied anywhere. There is no path by which a filter can reach a vital.
