# Tasks: Jira-Native @-Mentions in Toolbox Comments

**Input**: Design documents from `/specs/024-jira-comment-mentions/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all present)

**Tests**: INCLUDED — Article V (TDD, Red → Green → Refactor) is constitutional. Every implementation task is preceded
by its failing test. Pure modules and the store get vitest; components get testing-library RED tests; each story's
end-to-end flow gets a Playwright spec.

**Organization**: four user stories in priority order, each an independently shippable increment.
**US1 (read) is the MVP** — it fixes half the user's complaint on its own and ships without any of the write side.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no dependency on an incomplete task)
- **[US1..US4]**: story label on story-phase tasks only
- Exact file paths in every description

---

## Phase 1: Setup

- [X] T001 Confirm gates run green **before** any change: `cd client && npx vitest run && npx tsc -b`, then
      `npm test` and `npm run test:dom` from `C:\ProjectsWin\NodeToolbox`. Record the baseline so a later failure is
      attributable to this feature.
- [ ] T002 **Run the R3 deciding test** — follow `specs/024-jira-comment-mentions/quickstart.md` Test 0 against a live
      Jira with a colleague, and record the outcome (pass/fail/ambiguous) in the R3 section of
      `specs/024-jira-comment-mentions/research.md`. **This does not block any other task** — the fail-safe plain-token
      default lets everything proceed — but it MUST be answered before T034. Ambiguous counts as fail (FR-012 > FR-013).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the shared vocabulary and the directory store. **Both US1 and US2 depend on these**, so no story work
starts until this phase is green.

**⚠️ CRITICAL**: `client/src/utils/richTextPlainText.ts` and
`client/src/views/SprintDashboard/SprintDashboardView.tsx` (`normalizeCommentBody`, `:487`) are **out of bounds** for
this entire feature — the first feeds PO Tool drafts / Feature Canvas / SNow / story-point extraction (research R7),
the second drives release-window keyword matching, not display (research R4).

- [X] T003 [P] RED — create `client/src/utils/jiraMentionFormat.test.ts` covering the full test list in
      `specs/024-jira-comment-mentions/contracts/mention-format.md`: wiki parse (all three flavours, mid-sentence,
      adjacent mentions, malformed `[~]`/`[~accountid:]`/unclosed, a bare email address), **ADF parse (mention node
      between text nodes is NOT dropped — the FR-002 defect)**, build (three flavours + `null` for unrecognised), and
      the round-trip invariant `parse(build(person)).identifier === identifierOf(person)`.
- [X] T004 GREEN — implement `client/src/utils/jiraMentionFormat.ts` exporting `parseCommentMentions`,
      `buildMentionToken`, `formatMentionForDisplay`, and `extractMentionTokens` per
      `contracts/mention-format.md`. Map `FeatureReviewUserCandidate.userIdentifier` (`accountId:`/`name:`/`key:`) onto
      `[~accountid:X]`/`[~X]` per research R2. **Emit the plain token form only** — the readable form is T037, gated on
      T002.
- [X] T005 Refactor `client/src/utils/jiraMentions.ts` so its mention-form table is imported from
      `client/src/utils/jiraMentionFormat.ts` instead of restated at `:87`, making NFR-002 structural. **Behaviour must
      not change** — `client/src/utils/jiraMentions.test.ts` stays green with no edits (FR-022: the Mentions report must
      detect exactly what it detects today).
- [X] T006 [P] RED — create `client/src/store/mentionDirectoryStore.test.ts` covering the test list in
      `contracts/mention-directory.md`: seeding (idempotent, never downgrades, ignores empties), de-duplication
      (repeat identifiers → one request; a `pending` identifier suppresses a second fetch), **concurrency (12
      identifiers with cap 4 → never >4 in flight AND all 12 resolve — the anti-capping test, D4)**, terminal states
      (success/404/network error/empty → `resolved` or `unresolvable`, never stuck `pending`), and **no
      `localStorage`/`sessionStorage` write occurs**.
- [X] T007 GREEN — implement `client/src/store/mentionDirectoryStore.ts` as a Zustand store with the tri-state
      `DirectoryEntry` (`resolved` | `pending` | `unresolvable`), `seedFromUsers`, and `resolveMissing` with
      `MAX_CONCURRENT_LOOKUPS = 4`. **No `persist` middleware** — add a comment at the definition explaining that
      session-only is a deliberate FR-007a decision (no staleness policy, nothing at rest) so a later reader does not
      "fix" it by adding persistence.
- [X] T008 [P] RED — extend `client/src/views/SprintDashboard/featureReviewFixes.test.ts`: assert
      `normalizeFeatureReviewUserCandidates` carries an optional `emailAddress` through from the raw Jira response, and
      that a candidate without one is still returned (no filtering change).
- [X] T009 GREEN — add optional `emailAddress?: string` to `FeatureReviewUserCandidate` (`:46`),
      `FeatureReviewRawUserCandidate` (`:56`), and `normalizeFeatureReviewUserCandidates` (`:98`) in
      `client/src/views/SprintDashboard/featureReviewFixes.ts`. Purely additive — the four existing callers ignore the
      field and must not change. Needed for SC-004 (telling two same-named colleagues apart).

**Checkpoint**: format module + store + candidate shape are green. US1 and US2 can now proceed in parallel.

---

## Phase 3: User Story 1 — I can see who was tagged (Priority: P1) 🎯 MVP

**Goal**: every mention in every comment renders as a human name (FR-001..FR-008; contracts `mention-format.md`,
`mention-directory.md`).

**Independent test**: open any thread containing mentions — names appear, zero raw identifiers, and a mention in an
ADF-bodied comment is no longer missing (quickstart Tests 1–3). Ships with no write-side work whatsoever.

- [X] T010 [P] [US1] RED — create `client/src/components/CommentThread/CommentBody.test.tsx`: renders a run list;
      `resolved` → display name; `pending` → **loading marker**; `unresolvable` → `@unknown user`; and an explicit
      assertion that **the loading marker and the unresolvable placeholder are distinguishable** (FR-005a — the Q4
      decision; a test that fails if someone reuses one for the other). Also assert **FR-005b**: when an entry moves
      `pending` → `resolved`, only the mention element changes — the sibling text nodes around it are identical before
      and after the swap.
- [X] T011 [US1] GREEN — implement `client/src/components/CommentThread/CommentBody.tsx` rendering
      `parseCommentMentions` output, reading names from `mentionDirectoryStore`, per `contracts/mention-format.md`.
- [X] T012 [US1] RED — extend `client/src/components/CommentThread/CommentThread.test.tsx`: a thread whose comment body
      contains `[~accountid:…]` renders the person's name and **not** the token; a thread whose body is ADF with a
      mention node renders the name (currently dropped — FR-002).
- [X] T013 [US1] GREEN — in `client/src/components/CommentThread/CommentThread.tsx` replace the
      `normalizeRichTextToPlainText(comment.body)` call at `:54` with `<CommentBody body={comment.body} />`; seed the
      store from every `comment.author` in the thread before rendering (free names, FR-007), then call `resolveMissing`
      for the residue. **This one line is the single display swap point** (research R4) — no other display site exists.
- [X] T014 [US1] Add loading-marker and unresolvable-placeholder styles to
      `client/src/components/CommentThread/CommentThread.module.css`, honouring light/dark themes, A/A+/A++ text sizes,
      and **never carrying meaning by colour alone** (NFR-001). The two states must differ in shape/text, not just hue.
- [X] T015 [US1] Create `test/e2e/comment-mentions.spec.js` with the read-half scenarios: a thread renders names not
      identifiers (SC-001), and an unresolvable mention renders `@unknown user` without an error wall (SC-006).

**Checkpoint**: US1 is independently shippable. The user can read who was tagged.

---

## Phase 4: User Story 2 — I can tag the right person without leaving Toolbox (Priority: P1)

**Goal**: typing `@` opens a person search whose selection posts a genuinely notifying mention (FR-009..FR-017;
contract `mention-picker.md`). This phase wires **one** composer to prove the control; US3 wires the rest.

**Independent test**: in the issue detail panel, type `@`, pick a colleague, post — the colleague is notified
(quickstart Tests 4–5). Requires US1's store but not its rendering.

- [X] T016 [P] [US2] RED — create `client/src/components/MentionPicker/useMentionTrigger.test.ts` covering every row of
      the trigger table in `contracts/mention-picker.md`: opens at index 0, after a space, after a newline; **does not
      open in `mike@example.com`** (SC-008), after `(`, or on the second `@` of `@@`. Plus query extraction
      (whitespace closes, below min length issues no request) and caret insertion (replaces `@query` exactly, leaves
      surrounding text byte-identical, caret lands after the token, works mid-prose not just at the end).
- [X] T017 [US2] GREEN — implement `client/src/components/MentionPicker/useMentionTrigger.ts` exporting
      `isMentionTriggerPosition`, query extraction, and caret insertion as **pure functions** (no React state, no DOM
      access beyond the passed caret index).
- [X] T018 [US2] ~~Extract the debounced search + result list shell from `AssigneeFieldEditor`~~ — **extraction not
      performed; decision recorded instead.** Inspection during implementation showed research R6 was wrong about the
      source: `AssigneeFieldEditor` (`IssueFieldEditors.tsx:144`) has **no debounce and no popover** — it is a Search
      *button* plus a `<select>` that replaces a whole field value. The debounced popover actually lives in
      `PersonFinder`, which R6 had dismissed, but that one searches through a different function and returns a JQL
      clause. Neither is a clean extraction source, and forcing one would have destabilised a shipped control with
      four callers for little gain (NFR-005 argues against it). `MentionPicker` therefore reuses what genuinely is
      shared — `searchFeatureReviewUsers` (R1 stands) — and mirrors `PersonFinder`'s debounce constants and
      stale-response cancellation so the two behave alike. The wider Article VII drift is justified in the comment
      at the top of `client/src/components/MentionPicker/MentionPicker.tsx`.
- [X] T019 [P] [US2] RED — create `client/src/components/MentionPicker/MentionPicker.test.tsx`: debounce collapses a
      keystroke burst into one search; a stale response never overwrites a newer one; `↑`/`↓`/`Enter`/`Escape` per the
      keyboard contract; **a candidate whose `buildMentionToken` returns `null` is not offered as selectable** (M4 —
      inserting their plain name would notify nobody); search failure shows an inline note and never blocks posting.
- [X] T020 [US2] GREEN — implement `client/src/components/MentionPicker/MentionPicker.tsx` wrapping the T018 shell,
      anchored near the caret, searching via `searchFeatureReviewUsers`
      (`client/src/views/SprintDashboard/featureReviewFixes.ts:207`) and showing `emailAddress` from T009 to
      disambiguate same-named colleagues (SC-004). Record the Article VII drift justification from
      `contracts/mention-picker.md` as a comment at the component.
- [X] T021 [P] [US2] RED — create `client/src/components/MentionPicker/MentionDraftSummary.test.tsx`: a draft with two
      mentions lists both names; a draft with none renders nothing; an unresolved mention shows the loading marker, not
      `@unknown user`.
- [X] T022 [US2] GREEN — implement `client/src/components/MentionPicker/MentionDraftSummary.tsx` rendering
      "Tagging: …" from `extractMentionTokens(draft)` + the directory store (research R10). Satisfies SC-009 regardless
      of how T002 landed, and stays correct if T037 later ships the readable form.
- [X] T023 [US2] Wire `MentionPicker` and `MentionDraftSummary` into the comment textarea at
      `client/src/components/IssueDetailPanel/index.tsx:494`. **Additive only** — the textarea keeps its
      value/onChange and `postComment` is untouched (FR-020).
- [X] T024 [US2] Create `client/src/components/MentionPicker/MentionPicker.module.css` — popover, active-option
      highlight, and the "Tagging:" line, across light/dark themes and A/A+/A++ text sizes; narrow widths reflow rather
      than clip (NFR-001).
- [X] T025 [US2] Extend `test/e2e/comment-mentions.spec.js` with the write half: type `@`, pick a person, post, assert
      the posted body contains the mention token; and type `mike@example.com` asserting the picker never opens
      (SC-008).

**Checkpoint**: US1 + US2 together are the full feature in one place. Both halves of the user's complaint are fixed.

---

## Phase 5: User Story 3 — It works the same in every comment box (Priority: P2)

**Goal**: the same `@` control in every composer (FR-018..FR-020). Display consistency was already achieved by US1's
single swap point, so this phase is the remaining **three** composer wirings.

**Independent test**: walk all surfaces in quickstart Test 6 — identical trigger, keyboard behaviour, and appearance.

- [X] T026 [P] [US3] Wire `MentionPicker` + `MentionDraftSummary` into the comment textarea at
      `client/src/views/DsuBoard/DsuBoardView.tsx:924`, leaving `onPostComment` untouched.
- [X] T027 [P] [US3] Wire `MentionPicker` + `MentionDraftSummary` into the comment composer in
      `client/src/views/DsuDaily/DsuDailyView.tsx`, leaving `postComment` in
      `client/src/views/DsuDaily/hooks/useDsuDailyState.ts` untouched.
- [X] T028 [P] [US3] Wire `MentionPicker` + `MentionDraftSummary` into the textarea at
      `client/src/views/MyIssues/BulkCommentPanel.tsx:56`. The draft is composed once and posted to N issues, so the
      literal token reaches every issue identically (US3 acceptance 4) — assert this in
      `client/src/views/MyIssues/BulkCommentPanel.test.tsx`.
- [X] T029 [US3] Add a test to `client/src/views/MyIssues/MentionsTab.test.tsx` confirming the Mentions reply box
      offers the picker **by inheritance** from `IssueDetailPanel` (T023) — no separate wiring, so the count of
      integration sites stays four (research R5).
- [X] T030 [US3] Extend `test/e2e/comment-mentions.spec.js` with an all-surfaces pass and the bulk-comment case
      (one composed mention → 3 issues each carrying a working mention).

**Checkpoint**: no surface is exempt (SC-005).

---

## Phase 6: User Story 4 — A mention of me stands out (Priority: P3)

**Goal**: self-mentions are visually distinct (FR-021, FR-022). Depends on US1's `CommentBody`.

**Independent test**: open a thread where you are tagged; your mention is distinguishable — including in greyscale
(quickstart Test 8).

- [X] T031 [US4] RED — extend `client/src/components/CommentThread/CommentBody.test.tsx`: a mention matching the
      current user's identity renders with the self-mention treatment; a mention of anyone else does not.
- [X] T032 [US4] GREEN — in `client/src/components/CommentThread/CommentBody.tsx` compare the mention's identifier
      against the current user (reuse the `MentionIdentity` shape already in
      `client/src/utils/jiraMentions.ts:14`) and apply the treatment. **Must not change which comments are shown, nor
      the Mentions report** (FR-022).
- [X] T033 [US4] Add the self-mention style to `client/src/components/CommentThread/CommentThread.module.css` using
      weight or an outline **in addition to** colour, and verify in a greyscale screenshot (NFR-001).

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T034 **Conditional on T002** — if the R3 test **passed**, change `buildMentionToken` in
      `client/src/utils/jiraMentionFormat.ts` to emit the readable name-carrying form (FR-013), and update
      `client/src/utils/jiraMentionFormat.test.ts` accordingly. If it **failed or was ambiguous**, do nothing: FR-013a
      stands, `MentionDraftSummary` (T022) already covers SC-009, and record the closure in `research.md`.
      **Never adopt the readable form without an observed notification** (Article X; FR-012 outranks FR-013).
- [ ] T035 Run the full regression sweep in `specs/024-jira-comment-mentions/quickstart.md` Test 9 — My Issues
      Mentions unchanged, issue descriptions still render as today (the **accepted** Q1 inconsistency, not a bug), PO
      Tool Composition/Splitter text unchanged, Sprint Dashboard release-window detection unchanged, Feature Canvas and
      SNow Hub unchanged, and all four assignee pickers still working after the T018 extraction.
- [ ] T036 Verify quickstart Test 2 by hand under DevTools throttling: comment text appears immediately, loading
      markers resolve, **none spins forever**, and no mention shows `@unknown user` before becoming a name (SC-007).
- [ ] T037 Verify quickstart Test 7 — full keyboard-only operation of the picker with `aria-activedescendant`
      announced, composer focus never lost (NFR-003).
- [X] T038 Add one `CHANGELOG.md` entry under `## [Unreleased]` → `### Added` / `### Fixed` covering both halves, and
      call out the **ADF mention data-loss bug** (mentions were silently dropped, not merely unreadable) as a Fixed
      item in its own right.
- [X] T039 **NFR-004a — settle the logging question explicitly.** Confirm no display name is written to console or any
      log by the resolver in `client/src/store/mentionDirectoryStore.ts`. Then make an explicit decision on
      `emitApiEvent` in `client/src/services/jiraApi.ts:116`: it records every request URL, and a per-person lookup URL
      carries that person's identifier, so identifiers enter the API event stream by construction. Decide whether that
      is acceptable (it is the same exposure every other Jira call already has) or whether these lookups should be
      excluded from tracking, and **record the outcome** in the transport section of
      `specs/024-jira-comment-mentions/contracts/mention-directory.md`. An unrecorded decision does not satisfy
      NFR-004a.
- [X] T040 Verify **FR-006** is not quietly circumvented: grep the feature's new files for `renderedBody` /
      `renderedFields` and confirm none appear. If lookup latency tempted anyone toward server-rendered HTML, the
      sanctioned answer is the batching option in `contracts/mention-directory.md`, never rendered HTML (feature 019's
      rejection stands).
- [X] T041 Final gates: `cd client && npx vitest run && npx tsc -b`, then `npm test`, `npm run test:dom`, and
      `npx playwright test test/e2e/comment-mentions.spec.js` from `C:\ProjectsWin\NodeToolbox`. All green **plus a
      colleague confirming they received the notification** (SC-002 — a successful POST is not proof).

---

## Dependencies

```
Phase 1 (Setup: T001, T002)
        │
        ▼
Phase 2 (Foundational: T003–T009)   ◀── blocks everything
        │
        ├──────────────┬──────────────┐
        ▼              ▼              │
   US1 (T010–T015) US2 (T016–T025)    │   US1 and US2 are independent after Phase 2
        │              │              │
        │              ▼              │
        │         US3 (T026–T030)     │   needs US2's picker
        ▼                             │
   US4 (T031–T033) ◀──────────────────┘   needs US1's CommentBody
        │
        ▼
Phase 7 (Polish: T034–T039)
```

**Story independence**:
- **US1** needs only Phase 2. Ships alone as the MVP.
- **US2** needs Phase 2 (uses the store for `MentionDraftSummary`, not US1's rendering).
- **US3** needs US2 (wires the same control into three more places).
- **US4** needs US1 (extends `CommentBody`).

**T002 (the R3 test) gates only T034.** Everything else builds against the fail-safe default.

---

## Parallel execution opportunities

| Phase | Parallel set | Why safe |
|---|---|---|
| 2 | T003 ∥ T006 ∥ T008 | Three different test files, no shared state |
| 2 | T004 ∥ T007 | `jiraMentionFormat.ts` and `mentionDirectoryStore.ts` — the store keys by identifier string and does not import the format module |
| 3/4 | **US1 ∥ US2** | Disjoint file areas after Phase 2 — `CommentThread/` vs `MentionPicker/`. The best two-agent split |
| 4 | T016 ∥ T019 ∥ T021 | Three different test files |
| 5 | T026 ∥ T027 ∥ T028 | Three different composer files, all additive |

**Shared-file caveat**: T011/T013 (US1) and T032 (US4) both edit
`client/src/components/CommentThread/CommentBody.tsx`. Keep US4 sequenced after US1, not concurrent.

---

## Implementation strategy

**MVP = Phase 1 + Phase 2 + US1** (T001–T015). That alone fixes "I can't tell who was tagged", including the ADF
data-loss bug, and touches exactly one line of shipped rendering code.

**Increment 2 = US2** (T016–T025) — the user can tag someone in the issue detail panel without opening Jira. At this
point both halves of the original complaint are resolved.

**Increment 3 = US3 + US4** (T026–T033) — reach and polish.

**Then Phase 7.** Note T034 is the only place the R3 outcome changes code; if T002 came back negative, the feature is
already complete without it.

**Total: 41 tasks** — 2 setup, 7 foundational, 6 (US1), 10 (US2), 5 (US3), 3 (US4), 8 polish.

*(T039 and T040 were added by `/speckit-analyze` remediation to close the NFR-004a logging gap and the FR-006
prohibition guard; the final-gates task moved to T041.)*
