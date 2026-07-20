# Tasks: Quick Issue Lookup — F2 to find, view, and fix any issue without leaving the tool

**Input**: Design documents from `/specs/022-quick-issue-lookup/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (all present)

**Tests**: INCLUDED — Article V (TDD, Red → Green → Refactor) is constitutional; every implementation task (pure,
hook, **and UI shell**) is preceded by its failing test task. Pure functions and hooks get vitest unit tests;
components get testing-library RED tests; full flows get Playwright e2e.

**Organization**: three user stories derived from the spec's scenarios, in priority order, each an independently
shippable increment. Design is reuse-first: only US1's fetch path, US2's editor controls, and US3's recents store are
net-new; rendering, writers, deep-link, and the hotkey+modal pattern are reused.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[US1/US2/US3]**: story label on story-phase tasks only
- Exact file paths in every description

---

## Phase 1: Setup

**Purpose**: workspace ready; zero new dependencies (plan: reuse-only).

- [X] T001 On `feature/022-quick-issue-lookup` (created), confirm the client gates run green pre-change:
      `cd client && npx vitest run && npx tsc -b`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: none required. The foundation is the existing shipped codebase — `IssueDetailPanel` + `IssueMeta/*`
(019), `featureReviewFixes.ts` writers + editmeta, `jiraGet`/`useJiraFetch`, `buildJiraBrowseUrl`, the
`TodoQuickAdd`/`AiAssistUnlockGate` root-gate pattern, and the `settingsStore` recents precedent. No story depends on
another story's code.

**Checkpoint**: Phase 1 done ⇒ US1 → US2 → US3 may proceed in priority order.

---

## Phase 3: User Story 1 — Find & view an issue from anywhere (Priority: P1) 🎯 MVP

**Goal**: press F2 anywhere → type/paste a key → the issue renders in the reused detail view with honest states and a
one-click Jira deep-link (spec FR-001..007, FR-011/012; contract `lookup-and-fetch.md`).

**Independent test**: from any route, F2 → `ENCUC-1234` → Enter shows the issue read-only within 5s; unknown/invalid/
no-permission keys show distinct messages; clicking the key opens Jira. (quickstart E1, E2, E4, E5, E6)

### Tests for User Story 1 (write first, must FAIL)

- [X] T002 [P] [US1] RED — unit test `normalizeIssueKey` in
      `client/src/components/QuickIssueLookup/normalizeIssueKey.test.ts`: ` encuc-1234 `→`ENCUC-1234`;
      `.../browse/ENCUC-1234`→`ENCUC-1234`; `hello world`→`null`; already-upper passthrough
- [X] T003 [P] [US1] RED — unit test `buildIssueLookupPath` in `client/src/services/issueLookup.test.ts`: emits the
      exact `fields=` list including the resolved story-point custom-field id; no `expand`
- [X] T004 [P] [US1] RED — unit test `useIssueByKey` status mapping in `client/src/hooks/useIssueByKey.test.ts`
      (mock `jiraGet`): 200→`loaded`, 404→`not-found`, 403→`no-permission`, 5xx/network→`error`, in-flight→`loading`
- [X] T005 [P] [US1] RED — component test in `client/src/components/QuickIssueLookup/QuickIssueLookup.test.tsx`
      (testing-library, `useIssueByKey` mocked): **Enter** and **Search** both trigger a lookup; `null`-key shows the
      inline hint and does NOT fetch; each status renders its honest-state text (loading/not-found/no-permission/
      error); the key renders as a `/browse/KEY` anchor with `target="_blank"` on `loaded` [C1 — shell test-first]

### Implementation for User Story 1

- [X] T006 [US1] GREEN — implement pure `normalizeIssueKey(raw): { key: string | null }` in
      `client/src/components/QuickIssueLookup/normalizeIssueKey.ts` (trim/collapse/upper, URL-extract, shape-validate
      `^[A-Z][A-Z0-9]+-\d+$`)
- [X] T007 [US1] GREEN — implement `buildIssueLookupPath(key)` + `fetchIssueByKey(key)` (via `jiraGet<JiraIssue>`) in
      `client/src/services/issueLookup.ts`, reusing the story-point id resolution and mirroring
      `AgileHub/search/useSimpleSearchState.ts` `buildIssueDetailPath`
- [X] T008 [US1] GREEN — implement `useIssueByKey(key)` → `{ issue, status, refetch }` in
      `client/src/hooks/useIssueByKey.ts` (status per T004; `refetch` re-runs the GET)
- [X] T009 [US1] Implement `IssueSearchBar.tsx` in `client/src/components/QuickIssueLookup/` — key input + **Search**
      button; **Enter** and click both search via `normalizeIssueKey`; `key===null` shows inline hint "Enter an issue
      key like ABC-123" and does not fetch (FR-002/003/012)
- [X] T010 [US1] Implement popup body `QuickIssueLookup.tsx` + `QuickIssueLookup.module.css` in
      `client/src/components/QuickIssueLookup/` — hosts `IssueSearchBar`, drives `useIssueByKey`, renders the reused
      `IssueDetailPanel` (no `fieldEditing` prop yet — read-only) on `loaded`
- [X] T011 [US1] Implement honest-state rendering in `QuickIssueLookup.tsx`: spinner (`loading`), "No issue found for
      KEY" (`not-found`), "You don't have access to KEY" (`no-permission`), readable retryable error (`error`)
      (FR-012)
- [X] T012 [US1] Render the issue **key** as a `buildJiraBrowseUrl(key, jiraBaseUrl)` link (`target="_blank"`) in the
      QuickLookup header so it opens that exact issue in Jira while the popup stays open (FR-007)
- [X] T013 [US1] Implement `QuickIssueLookupGate.tsx` in `client/src/components/QuickIssueLookup/` — `window`
      `keydown`: **F2** `preventDefault()` + toggle open; ignore F2 when `activeElement` is an input/textarea/
      contenteditable **outside** the popup (NFR-005); `role="dialog" aria-modal="true"` + backdrop; focus the input
      on open (~100 ms target, NFR-001); **Escape** closes non-destructively (FR-001/004)
- [X] T014 [US1] Mount `<QuickIssueLookupGate/>` in `client/src/App.tsx` beside `<TodoQuickAddGate/>`
- [ ] T015 [US1] e2e — add scenarios **E1, E2, E4, E5, E6** plus an **all-populated-visible / omit-empty** assertion
      (FR-006: a seeded multi-field issue shows every populated field and renders no empty placeholder block) to
      `test/e2e/quick-issue-lookup.spec.js`

**Checkpoint**: US1 fully functional — instant lookup + read-only view + Jira escape-hatch. Shippable MVP.

---

## Phase 4: User Story 2 — Edit fields in place (Priority: P2)

**Goal**: the fields Toolbox can safely write become editable in the lookup view, each saving to Jira with immediate
confirmation, description read-only, labels editmeta-conditional (spec FR-008/009/010; contract
`inline-field-editing.md`).

**Independent test**: from a looked-up issue, change status/assignee/priority/story points — each confirms, the panel
reflects it, no reload/close; description offers no editor; a panel rendered without the capability is unchanged.
(quickstart E3, E9, E11)

### Tests for User Story 2 (write first, must FAIL)

- [X] T016 [P] [US2] RED — unit test `fieldEditorPayloads` in
      `client/src/components/IssueFieldEditors/fieldEditorPayloads.test.ts`: value→payload per field (option-id match,
      user field, simple field, labels array set) mirroring the editmeta rules in `featureReviewFixes.ts`
- [X] T017 [P] [US2] RED — component tests in
      `client/src/components/IssueFieldEditors/IssueFieldEditors.test.tsx`: each editor shows current value, activates
      an input, Save calls the delegated writer, error reverts; labels degrade to read-only when editmeta lacks a
      settable labels field
- [X] T018 [P] [US2] RED — extend `client/src/components/IssueDetailPanel/index.test.tsx`: **omitted** `fieldEditing`
      ⇒ render byte-identical to today (no editors); **provided** ⇒ editors render beside the gated fields (E11)

### Implementation for User Story 2

- [X] T019 [US2] GREEN — implement pure `fieldEditorPayloads.ts` in `client/src/components/IssueFieldEditors/`
      (value → Jira write payload per field)
- [X] T020 [US2] GREEN — implement `TextFieldEditor.tsx`, `SelectFieldEditor.tsx`, `AssigneeFieldEditor.tsx`,
      `LabelsFieldEditor.tsx` + `IssueFieldEditors.module.css` in `client/src/components/IssueFieldEditors/`; each
      reads options from editmeta / `searchFeatureReviewUsers` / `fetchFeatureReviewFixVersions` and **delegates every
      write** to the matching `featureReviewFixes.ts` function (labels read-only fallback when editmeta lacks labels)
- [X] T021 [US2] GREEN — add the optional, default-off `fieldEditing?: { editMeta, onFieldSaved }` capability to
      `client/src/components/IssueDetailPanel/index.tsx`: when provided, render the `IssueFieldEditors` beside the
      currently read-only fields (summary/assignee/priority/single-selects/fixVersions/links/labels), gated per-field
      by `editMeta`; status + story points reuse the panel's existing editors; description stays read-only;
      **omitted ⇒ unchanged** (additive)
- [X] T022 [US2] Wire `QuickIssueLookup.tsx` to fetch editmeta via `fetchFeatureReviewEditMeta(key)` and pass
      `fieldEditing={{ editMeta, onFieldSaved: () => refetch() }}` to `IssueDetailPanel` (FR-010)
- [X] T023 [US2] Save UX in the editors / panel: Toast confirmation on success (reuse `ToastProvider`), inline
      readable error + revert to prior value on failure, no reload and popup stays open (FR-010)
- [ ] T024 [US2] e2e — add scenarios **E3, E9, E11** (edit fields + confirm, description read-only, panel-without-
      capability regression) to `test/e2e/quick-issue-lookup.spec.js`

**Checkpoint**: US1 + US2 — find, view, and fix editable fields without leaving; all writes single-sourced through the
existing writers; shipped callers of `IssueDetailPanel` unaffected.

**US2 implementation notes (adaptations found during build):**
- **`fieldEditorPayloads.ts` was not created** (T016/T019) — the existing writers (`saveFeatureReviewOptionField`
  etc.) already own all payload construction, so re-deriving payloads would duplicate logic and violate the
  single-write-path rule. It was replaced by `issueFieldEditing.ts` (pure `isFieldEditable` gating + the shared
  `useFieldEditor` lifecycle), which is the genuinely-needed tested unit. Editors delegate straight to the writers.
- **Editable set (T020) = summary, priority, assignee** — the fields with a safe writer that cover SC-003's
  assignee+priority (status + story points reuse the panel's existing editors). **Fix versions and issue-link editing
  are deferred** (need async option loading / link-type semantics); **labels stay read-only** (no array-set writer
  exists — FR-008 editmeta-conditional / FR-009). All visible, none silently editable-then-failing.
- **Save confirmation (T023)** uses a per-field inline "✓ Saved" flash + inline error/revert via `useFieldEditor`,
  rather than a global Toast — per-field local confirmation is clearer for inline edits and keeps the popup self-
  contained. Failure shows a readable inline error and never commits (FR-010).

---

## Phase 5: User Story 3 — Recents & persistent re-search (Priority: P3)

**Goal**: the popup opens showing recent issues, and the user can look up another key without closing — the
stay-in-tool stickiness (spec FR-002a, FR-007a, FR-001 re-focus; contract `recents-store.md`).

**Independent test**: after viewing several issues, F2 shows the last 5 (persist across reload); selecting one reopens
it; with an issue shown, a new key in the persistent bar swaps in place; F2 while open re-focuses the input.
(quickstart E7, E8)

### Tests for User Story 3 (write first, must FAIL)

- [ ] T025 [P] [US3] RED — unit test `buildRecentIssues` in `client/src/store/recentIssuesStore.test.ts`: empty-add,
      cap-at-5 (oldest dropped), re-add moves to top + refreshes summary, malformed/throwing storage tolerated
- [ ] T026 [P] [US3] RED — component test in
      `client/src/components/QuickIssueLookup/RecentIssuesList.test.tsx`: renders up to 5 entries (key + summary),
      click and ↑/↓+Enter select an entry

### Implementation for User Story 3

- [ ] T027 [US3] GREEN — implement `recentIssuesStore.ts` in `client/src/store/` — `useRecentIssuesStore` with pure
      `buildRecentIssues` (dedupe + `slice(0,5)`), seed from + mirror to `localStorage['tbxRecentIssueKeys']`
      (`try/catch`), cloning the `settingsStore` recents pattern
- [ ] T028 [US3] GREEN — implement `RecentIssuesList.tsx` in `client/src/components/QuickIssueLookup/` (key + summary
      rows; click / arrow-key selection triggers a fetch for that key)
- [ ] T029 [US3] Call `recordRecent({ key, summary })` from `useIssueByKey` on `loaded`; render `RecentIssuesList` in
      `QuickIssueLookup.tsx` when no key is entered (blank on first-ever use) (FR-002a)
- [ ] T030 [US3] Persistent search-bar swap-in-place: a new valid key while an issue is shown swaps the detail without
      closing/reloading (FR-007a); **F2 while open** re-focuses and clears the input, never stacking a second popup
      (FR-001) — in `QuickIssueLookupGate.tsx` / `QuickIssueLookup.tsx`
- [ ] T031 [US3] e2e — add scenarios **E7, E8** (recents persist + reopen, swap-in-place + F2 re-focus) to
      `test/e2e/quick-issue-lookup.spec.js`

**Checkpoint**: all three stories independently functional; the feature is complete.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T032 e2e — add scenario **E10**: run E1–E3 at text sizes A/A+/A++, in light + dark, and at narrow width; assert
      reflow-not-clip and text-beside-color on every chip (NFR-003/004; Article X evidence) in
      `test/e2e/quick-issue-lookup.spec.js`
- [ ] T033 [P] Update `CHANGELOG.md` (Unreleased) with the F2 Quick Issue Lookup feature (one-line summary + bullets)
- [ ] T034 Run full gates and quickstart validation: `cd client && npx vitest run && npx tsc -b`; execute quickstart
      E1–E11 in the e2e harness and capture evidence; confirm `IssueDetailPanel` callers without `fieldEditing` are
      visually unchanged

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)** → no deps, start immediately.
- **Foundational (P2)** → none (existing shipped code is the foundation).
- **US1 (P1)** → after Setup. The MVP; US2 and US3 build on its popup + rendered panel.
- **US2 (P2)** → after US1 (renders editors into US1's `IssueDetailPanel` host).
- **US3 (P3)** → after US1 (layers recents + re-search onto US1's popup); independent of US2.
- **Polish (P6)** → after the desired stories are complete.

### Within each story

- RED test tasks precede their GREEN implementation (Article V) — including the US1 shell test (T005) before T009–T013.
- Pure functions (`normalizeIssueKey`, `buildIssueLookupPath`, `fieldEditorPayloads`, `buildRecentIssues`) before the
  components/hooks that consume them.
- The story's e2e task is last (depends on that story's implementation; shares the single spec file).

### Parallel opportunities

- **US1**: T002, T003, T004, T005 (four independent RED tests, different files) run in parallel.
- **US2**: T016, T017, T018 (independent RED tests) run in parallel.
- **US3**: T025, T026 (independent RED tests) run in parallel.
- **Polish**: T033 (CHANGELOG) is independent of T032/T034.
- e2e tasks (T015, T024, T031, T032) all touch `test/e2e/quick-issue-lookup.spec.js` → sequential, never parallel.

---

## Parallel Example: User Story 1

```bash
# Launch US1's four RED test tasks together (different files):
Task: "RED normalizeIssueKey.test.ts"          # T002
Task: "RED issueLookup.test.ts"                # T003
Task: "RED useIssueByKey.test.ts"              # T004
Task: "RED QuickIssueLookup.test.tsx (shell)"  # T005
```

---

## Implementation Strategy

### MVP first (US1 only)

1. Phase 1 Setup → 2. (Foundational is a no-op) → 3. Phase 3 US1 → **STOP & VALIDATE** E1/E2/E4/E5/E6 → demo:
   instant lookup + read-only view + Jira escape-hatch already delivers standalone value.

### Incremental delivery

1. US1 → test → demo (find & view MVP).
2. US2 → test → demo (now edit in place — the "manage" half).
3. US3 → test → demo (recents + re-search stickiness).
4. Polish → responsive/theme gates + CHANGELOG + full validation.

Each story ships without breaking the previous; the `IssueDetailPanel` capability stays default-off so unrelated
callers never regress.

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- Every WRITE in US2 delegates to an existing `featureReviewFixes.ts` writer — the recorded Art VII drift is control
  shape only.
- The `IssueDetailPanel` `fieldEditing` prop is additive and default-off — verify byte-identical behavior for
  omitting callers (T018/E11) before merge.
- Commit after each task or logical group; verify RED tests fail before GREEN.
