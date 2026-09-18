# Contract: The Epic Intake Mode inside Feature Composition

**Files**: `views/PoTool/FeatureCompositionTab.tsx` (additive edit), `views/PoTool/intake/EpicIntakeWorkspace.tsx`
and its child components. **Covers**: FR-001, FR-002, FR-009, FR-026, US1–US6 surfaces.

## 1. The toggle (the only edit to the shipped tab)

- `const [compositionMode, setCompositionMode] = useState<'compose' | 'intake'>('compose')` at the top of the tab.
- A two-option segmented control, **"Compose one Feature" / "Epic Intake from notes"**, rendered as the first child of
  `.compositionTab`. It uses `role="radiogroup"` for accessibility.
- `compose` renders the existing body **unchanged**. `intake` renders
  `<EpicIntakeWorkspace dashboardTeamProfileId={…} />` in its place.
- The composition hooks stay mounted, so the draft survives any number of toggles (FR-001, R-001).
- The default is `compose`, and the mode is not persisted.

**Guards**:

- `FeatureCompositionTab.test.tsx` passes **unmodified**.
- `poToolWithoutAi.test.tsx`'s existing cases pass **unmodified**. One **additive** case switches to intake mode with
  AI locked, drives an intake to the summary, and asserts `findAnyAiAffordance` finds nothing (R-011).

## 2. Workspace layout

This reuses `FeatureCompositionTab.module.css` (`panel`, `panelTitle`, `panelSubtitle`, `infoBanner`, `warningBanner`,
`errorBanner`, `primaryButton`, `secondaryButton`, `dangerButton`, `selectInput`, `textArea`, `dropzone`) and
`rewrite/rewrite.module.css` (`journeyStrip`, `journeyStep`, `journey_done`, `journey_current`, `journey_waiting`,
`journeyNextAction`, `batchList`, `batchRow`). Classes that are genuinely new (the decision badge, the table) go in
`intake/EpicIntakeWorkspace.module.css`, prefixed `intake`. Per the UI Styling rule, no unstyled markup is allowed.

| Region | Component | Content |
|---|---|---|
| Resume bar | `IntakeResumeBar` | saved intakes for this team (name, updated, open count) with Resume and Discard (confirm) buttons, plus **Start new** |
| Notes | `IntakeNotesPanel` | paste box (rich paste via `readPastedText`), file drop (routed by extension to the PDF, .msg or workbook reader, per `BulkRewriteTab.readFileAsSource`), Confluence URL; **Start intake** numbers the lines and builds the baseline |
| Journey | `IntakeJourneyStrip` | the eight steps, each done / current / waiting, plus the next action and open count from `readIntakeNextStep` (FR-009) |
| Items | `IntakeItemsTable` | one row per item: title, lines (expandable to raw text), kind, owner, sizes, named keys, candidates, label, each with a **settled-by badge** (Rule / Suggested / You) and its reason on hover and focus |
| Turn panel | `IntakeTurnPanel` | one of: `PoAiPanel` for the current AI round (unlocked, AI's turn); the **Check DENP** button with progress (Toolbox's turn); `IntakeQuestionList` (PO's turn); `IntakeDraftReview`; `IntakeCreatePanel` |
| Summary | `IntakeSummaryTable` | the table plus **Copy table**; shown whenever at least one item exists, with `open` rows visible |

## 3. PO questions (`IntakeQuestionList`) — pick, don't type

Every PO question is a `<select>` or a radio group, never a text box. The AI's suggestion and reason are shown beside
it, with the suggestion pre-selected where one exists.

| Question | Choices |
|---|---|
| Kind | Work · Risk · Action for a person · Deferred · Noise |
| Owner | Enrollment · Fulfillment · Not actionable |
| Unassigned line | an item id · Set aside (heading/prose, not work, context only) |
| Match | each candidate key + summary · None of these — create new · Not actionable |
| Named key unusable | Use it anyway · Create new · Not actionable |
| Label | Roadmap · Stability |

**The exceptions** are the draft's summary and description, which are free text by nature. A draft is edited in place
and then **Accept** or **Decline** is chosen.

## 4. AI turn

- Exactly **one** `PoAiPanel` is mounted at a time, which avoids its fixed element ids colliding.
- When a round has several parts, a part selector ("Part 1 of 2") sits above the panel.
- The panel's `onIngest` calls the round's parser and `apply…`, saves, and returns `{ acceptedCount, errors }`, where
  `errors` are the rejection reasons, item ids included.
- The PO can skip an AI round at any time with **"Answer these myself"**. That moves every open slot in the step to the
  PO by setting `aiAttempts` to the maximum. The label is deliberately free of the words AI, prompt and reply.

## 5. AI locked

- The `PoAiPanel`s render nothing.
- The engine returns `turn: 'po'` for every AI slot (INV-5).
- The draft step shows `buildManualDraft` output for editing.
- The whole flow — notes → baseline → questions → Check DENP → labels → drafts → create → summary — is completable.

## 6. Tests (Testing Library, real events per Art. V)

- The toggle preserves an in-progress composition draft across switches.
- The mode's rendered text passes the no-AI scan when locked.
- A full flow with mocked Jira and pasted replies reaches `done`, and Copy table writes both flavours.
- Resume restores the same step and the same answers after unmount and remount (US6-1).
