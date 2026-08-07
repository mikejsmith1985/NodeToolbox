# Contract: Board Layout

**Modules**: `boardLayout.ts` (pure) · `boardFilters.ts` (pure) · the swimlane components

Covers FR-000a–j, FR-026 to FR-038, FR-039 to FR-042. This contract exists because the spec's strongest promises —
"nothing is hidden", "the parent is rendered once", "filters never change a Feature's numbers" — are all layout
properties. Expressing them as pure-function invariants is what makes them provable.

---

## 1. Layout construction

```ts
function buildBoardLayout(input: {
  masterCards: MasterCard[];
  columns: RenderedColumn[];
  filters: QuickFilterState;
  preferences: BoardPreferences;
}): BoardLayout
```

### Order of operations (fixed — reordering breaks a guarantee)

1. `computeLaneVitals` — each Master Card's **vitals** from its **unfiltered** items.
2. Apply filters to produce each lane's matched item set.
3. `distributeItemsIntoColumns` — matched items placed by each item's **own** `columnId`.
4. `groupItemsIntoParentContainers` — within each column, group by `parentKey`.
5. Drop containers left with zero items.
6. `orderLanes` — by `preferences.laneOrder`, unknown Features last.

Step 1 precedes step 2 deliberately: it is the only reason FR-014 cannot be violated by a later edit.

`buildBoardLayout` is a thin composition of the four named helpers above; each helper stays under 40 lines
(Article IV) and is independently unit-testable.

---

## 2. The rendering rules

### Columns (FR-000a–d)

- **One** shared header row for the whole board. Lanes do not own columns.
- Columns render in `BoardColumn.order`, with `Unmapped` always last and always present (FR-024, INV-14).
- Horizontal overflow scrolls the **board**, not a lane, so alignment can never be lost (FR-000d).

### Parent containers (FR-031 to FR-035)

Within one lane, one column:

- Items sharing a `parentKey` are wrapped in a `ParentContainer` headed by that parent's key and summary.
- Children of the same parent in **different** columns produce **one container per column** (FR-032).
- A parent's **own card** is a `looseItem` in the column of the parent's own status, drawn **without** children
  (FR-033).
- A container header must be visually distinct from a card (FR-034) — different border treatment and no card
  affordances (not draggable, not clickable-to-open).
- Parent out of scope ⇒ header still drawn, marked as such; **no** parent card anywhere (FR-037).

### Cards (FR-027 to FR-029)

| Bucket | Header colour | Non-colour label |
|--------|---------------|------------------|
| Story | green | `IssueTypeIcon` + type name |
| Defect | red | `IssueTypeIcon` + type name |
| Sub-task | blue | `IssueTypeIcon` + type name |
| Other | neutral | `IssueTypeIcon` + type name |

**Colour is never the only signal** (FR-028). Reuse `components/IssueMeta/` for every chip so the vocabulary matches
the rest of the product.

Each card also carries its roll-up route (FR-036) and, for defects, its precedence route plus any unchosen
candidates (FR-006, FR-007).

### Family highlight (FR-038)

Selecting or focusing any card highlights, across the whole lane: its parent's card, its parent's containers, and its
siblings. Implemented as a lane-scoped `highlightedFamilyKey`, not per-card state.

### Lanes (FR-000e–j)

- Collapsible; board opens **all collapsed** (FR-000f).
- Collapsed lane still shows vitals and child count (FR-000g).
- Collapse state is personal and persisted (FR-000h).
- Expand-all / collapse-all are single actions (FR-000i).
- Changing filters never auto-expands, and never collapses a lane the person expanded (FR-000j).

---

## 3. Filters — `boardFilters.ts`

```ts
function selectMatchingItems(items: RollupBoardItem[], filters: QuickFilterState): RollupBoardItem[]
```

- Type, assignee and fixVersion compose with **AND** (FR-035).
- An empty `typeBuckets` set means "no type filter", not "match nothing".
- A lane with zero matches stays visible, stating `0 of N match` (FR-041).
- Master Card vitals are untouched, and the board states that they ignore filters (FR-014).

---

## 4. Invariants (the assertions that must exist as tests)

| ID | Assertion |
|----|-----------|
| **L-1** | Total items across all lanes, all columns, containers + loose = the resolved item count. *(SC-001 — nothing dropped, nothing duplicated.)* |
| **L-2** | For every parent key P: P appears as a **card** exactly once board-wide; as a container **header** 0…n times; header appearances contribute 0 to every count. *(INV-16 — the single most likely bug.)* |
| **L-3** | An item's column equals the column its own status/sub-status resolves to, for every item, regardless of its parent's or children's columns. |
| **L-4** | `MasterCardVitals` is byte-identical with filters applied and with filters cleared. |
| **L-5** | No container has zero items. |
| **L-6** | Every lane in `masterCards` appears in `layout.lanes`, including lanes with zero matched items. |
| **L-7** | Lane order equals `preferences.laneOrder`, with unlisted Features appended in a stable order. |
| **L-8** | The `Unmapped` column is present in `layout.columns` even when it holds nothing. |
| **L-9** | `buildBoardLayout` is referentially transparent — same inputs, deeply equal output. No clock, no randomness, no module state. |
| **L-10** | `buildBoardLayout` completes within its budget for a synthetic 300-issue / 40-lane / 8-column set, measured rather than assumed (SC-012). |

---

## 5. Rendering performance

- `buildBoardLayout` is memoised on `(masterCards, columns, filters, preferences)`.
- Collapsed lanes render the header only — no cell tree is constructed for a collapsed lane's DOM.
- At ~300 issues the layout computation runs once per filter change, not per card.
- Text sizing follows the project's existing zoom rules; **never** reintroduce `width: calc(100% / zoom)` — the
  standardised zoom double-shrinks and this board is full-width.

---

## 6. Drag and drop

Two **separate** `DndContext`s so the two gestures can never interfere:

| Context | Draggable | Droppable | Library |
|---------|-----------|-----------|---------|
| Card move | `ChildCard` (grip area only) | column cell within a lane | `@dnd-kit/core` |
| Lane order | `MasterCardLane` header | lane list | `@dnd-kit/sortable` |

Follow `MyIssues/Todo/TodoTab.tsx`: drag listeners live on a **grip**, so buttons and links inside a card stay
clickable. A card drop delegates to `statusMoveWriter` (see `status-move.md`); a lane drop writes only local
preferences and never touches Jira (FR-046).
