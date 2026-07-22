# Implementation Plan: Jira-Native @-Mentions in Toolbox Comments

**Branch**: `feature/024-jira-comment-mentions` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/024-jira-comment-mentions/spec.md`

## Summary

Comments name people, and Toolbox breaks that in both directions: a mention renders as `[~accountid:557058:ab-12]`
(wiki bodies) or **vanishes entirely** (ADF bodies — a real data-loss bug, root cause confirmed at
`richTextPlainText.ts:18`), and there is no way to tag anyone without leaving for Jira.

The design turns on one discovery from Phase 0: **`searchFeatureReviewUsers` already returns a flavour-encoded
identifier** — `accountId:…` / `name:…` / `key:…` (`featureReviewFixes.ts:82`). That maps one-to-one onto the mention
forms already enumerated in `jiraMentions.ts:87`. So the entire feature reduces to one small pure module owning both
directions of that mapping, plus three thin consumers:

1. **`jiraMentionFormat.ts`** (new, pure) — the single vocabulary. Parses a body into text/mention runs; builds a token
   from a picked person. Read and write derive from *the same table*, which is how NFR-002 becomes true by
   construction rather than by discipline.
2. **`mentionDirectoryStore.ts`** (new, Zustand, **no persist**) — session-only identifier→name map, seeded free from
   user records already on screen, filling the residue with a bounded-concurrency pooled resolver that de-duplicates
   in-flight requests.
3. **`CommentBody.tsx`** (new) — renders runs, swapping a **loading marker** (distinct from the *unresolvable*
   placeholder — Q4's whole point) for the name as it lands. Wired at the **single** display site,
   `CommentThread.tsx:54`.
4. **`MentionPicker`** (new shared control) — caret-anchored `@` type-ahead over the extracted `AssigneeFieldEditor`
   shell, wired into four composers.

**The one open risk is deliberate.** FR-013's readable, name-carrying mention form cannot be verified without a live
instance (R3). The build therefore defaults to the **plain token that is known to notify**, because FR-012 — the
person is actually notified — outranks FR-013's readability. A pretty mention that silently fails to notify is the
exact bug this feature exists to kill. A **"Tagging: Jane Doe" companion line** beside each composer delivers SC-009's
intent regardless of how R3 lands (R10).

**Two spec corrections came out of Phase 0**: the reuse targets were misidentified (R1, R6), and the
sequencing-against-022 constraint is **obsolete — 022 and 023 are already shipped; `CLAUDE.md` is stale** (R8).

## Technical Context

**Language/Version**: TypeScript + React (client SPA), CSS Modules on the existing token system. Client-only — no
server, scheduler, or Jira-protocol changes.

**Primary Dependencies**: **zero new**. Reuse — `searchFeatureReviewUsers` + `FeatureReviewUserCandidate`
(`featureReviewFixes.ts:207`/`:46`); the mention-form vocabulary in `jiraMentions.ts:87`; the `AssigneeFieldEditor`
debounce/popover shell (`IssueFieldEditors.tsx:144`); `CommentThread` (feature 008); Zustand as used by the ten
existing stores.

**Storage**: In-memory Zustand only (FR-007a). **No `persist` middleware** — a deliberate departure from
`settingsStore`/`recentIssuesStore`, commented at the definition so it is not "fixed" later. Nothing written to
durable storage (NFR-004).

**Testing**: vitest + @testing-library (`cd client && npm test`), red-first per Article V. Unit: the format module
(parse/build, every flavour, malformed input), the store reducer (seed, dedupe, pool, pending/unresolvable states),
the trigger rule. Component: `CommentBody` render states, `MentionPicker` keyboard flow. Playwright e2e
(`test/e2e/`): read a mention as a name, `@`-tag a person end-to-end, type an email without triggering.

**Target Platform**: NodeToolbox SPA (browser + exe-embedded client); light and dark themes; A/A+/A++ text sizes.

**Project Type**: Web application, client-only.

**Performance Goals**: SC-007 — names settle within **2s** on a typical thread under normal connectivity; comment text
never blocks (FR-005); bounded concurrency caps the request burst (FR-007b).

**Constraints**: agree-by-construction between read and write (NFR-002); `normalizeRichTextToPlainText` **must not
change** — it feeds PO Tool drafts, Feature Canvas, SNow, and story-point extraction (R7, Q1/FR-008);
`SprintDashboardView.normalizeCommentBody` **must not change** — it is release-decision keyword matching, not display
(R4); additive-only, no caller regressions (NFR-005).

**Scale/Scope**: 4 new modules, 1 changed display site, 4 composer integrations. Thread scale ~50 comments / ~15
distinct mentioned people.

## Constitution Check

*GATE — evaluated pre-Phase-0 and re-checked post-design: **PASS**. One recorded Article VII drift.*

- **Art I (Best route, not fastest)**: ✅ The fail-safe R3 default is the costlier, correct route — it accepts an ugly
  composer rather than risk a mention that does not notify. The `normalizeRichTextToPlainText` blast radius was
  measured (R7) rather than assumed, and the shared normalizer left alone.
- **Art III (Branching)**: ✅ `feature/024-jira-comment-mentions`, merged via PR. Never committed to `main`.
- **Art IV (Code quality)**: ✅ Verb-first functions (`parseCommentMentions`, `buildMentionToken`,
  `resolveDisplayName`), `is/has/can` booleans (`isMentionResolvable`, `hasPendingLookup`), named constants for the
  concurrency limit and debounce, purpose comment per file, doc comment per export, functions under 40 lines.
- **Art V (Testing, TDD)**: ✅ Red→green per task; the format module and store are pure and fully unit-testable with
  no I/O. Three layers kept separate.
- **Art VI (Documentation)**: ✅ One CHANGELOG entry. No auxiliary status docs. `specs/024-*/` is the exempt pipeline
  artifact.
- **Art VII (Framework-first)**: ⚠️ **One drift, justified** — see Complexity Tracking. Everything else reuses:
  search, identifier encoding, mention vocabulary, popover shell, comment thread, store primitive.
- **Art X (Verification & proof)**: ✅ R3 is settled by observing a **real notification**, not by reading docs or a
  200 response. SC-002 demands the same. This is why R3 stays open rather than being guessed.
- **Art XI (Output restraint)**: ✅ No dashboard artifact; no phase-name narration.

**Gate result: PASS.** No unjustified violations.

## Project Structure

### Documentation (this feature)

```text
specs/024-jira-comment-mentions/
├── plan.md              # This file
├── spec.md
├── research.md          # Phase 0 — R1..R10, R3 open by design
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1 — includes the R3 deciding test
├── contracts/
│   ├── mention-format.md      # the shared vocabulary (read + write)
│   ├── mention-directory.md   # store + bounded resolver
│   └── mention-picker.md      # caret-anchored @ control
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 — /speckit-tasks, NOT created here
```

### Source Code (repository root)

```text
client/src/
├── utils/
│   ├── jiraMentions.ts              # EXISTING — token vocabulary; becomes the shared source
│   ├── jiraMentionFormat.ts         # NEW — parse body → runs; build token from person
│   └── richTextPlainText.ts         # UNCHANGED (R7 — feeds PO Tool, Canvas, SNow, pointing)
├── store/
│   └── mentionDirectoryStore.ts     # NEW — session-only map + pooled resolver (no persist)
├── components/
│   ├── CommentThread/
│   │   ├── CommentThread.tsx        # CHANGED — one line: plain text → <CommentBody/>
│   │   └── CommentBody.tsx          # NEW — renders runs; loading vs unresolvable states
│   └── MentionPicker/               # NEW — shared caret-anchored @ control
│       ├── MentionPicker.tsx
│       ├── useMentionTrigger.ts     # word-boundary detection + caret insertion
│       ├── MentionDraftSummary.tsx  # "Tagging: …" companion line (R10)
│       └── MentionPicker.module.css
└── components/IssueFieldEditors/
    └── IssueFieldEditors.tsx        # CHANGED — extract popover/debounce shell for reuse

# Composer integrations (additive)
client/src/components/IssueDetailPanel/index.tsx      # :494  (also covers MentionsTab reply)
client/src/views/DsuBoard/DsuBoardView.tsx            # :924
client/src/views/DsuDaily/DsuDailyView.tsx
client/src/views/MyIssues/BulkCommentPanel.tsx        # :56

test/e2e/comment-mentions.spec.js                     # NEW
```

**Structure Decision**: Two pure modules (`jiraMentionFormat.ts`, the store's reducer) carry all the logic and all the
risk, so both are fully unit-testable without a browser or Jira. The React layer stays thin: one render component, one
control, four wiring sites. This mirrors the repo's established shape — pure `*.ts` beside the components that consume
them (`hygieneChecks.ts`, `readinessScan.ts`, `myIssuesRoleLens.ts`).

The critical structural guard: **the two shared text paths stay untouched.** `richTextPlainText.ts` feeds five
unrelated features and `SprintDashboardView.normalizeCommentBody` drives release-window decisions. Mention rendering is
confined to a new comment-only renderer, which is precisely what Q1's "comments only" decision bought.

## Phase 1 — Design summary

**Data model** ([data-model.md](./data-model.md)): four entities — `MentionRun` (the parse output: text or mention),
`MentionToken` (stored form + flavour), `DirectoryEntry` (`resolved | pending | unresolvable` — the tri-state that
makes Q4's loading-vs-unidentifiable distinction representable rather than aspirational), and `PickerCandidate`.

**Contracts**:
- [`mention-format.md`](./contracts/mention-format.md) — the read/write vocabulary. **Highest-risk contract**: it is
  the single point where NFR-002 is enforced, and where R3's decision lands as a one-function change.
- [`mention-directory.md`](./contracts/mention-directory.md) — seeding, in-flight dedupe, bounded pool, tri-state.
- [`mention-picker.md`](./contracts/mention-picker.md) — the word-boundary trigger (FR-009a), caret insertion,
  keyboard contract (NFR-003), and the companion summary line.

**Quickstart** ([quickstart.md](./quickstart.md)) — runnable validation, led by the **R3 deciding test**, which must
be run before FR-013 is implemented either way.

**Agent context**: `CLAUDE.md` updated to point at this plan — and corrected, since R8 found its 019–023 entries
describe shipped work as "planned".

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| **New `MentionPicker` control family** (Art VII drift) | Both existing type-aheads (`AssigneeFieldEditor`, `PersonFinder`) are **button-anchored popovers that replace a whole field value**. This feature needs a **caret-anchored trigger** that fires on `@` at a word boundary and **inserts at a position inside free text**. Neither provides that, and neither can be configured into it. | Reusing `AssigneeFieldEditor` as-is (rejected — no caret model, no trigger, no partial insertion); `PersonFinder` (rejected — view-local, wrong search per R1, returns a JQL clause). **The drift is the trigger and insertion only** — search, debounce, result list, and keyboard handling are the extracted shell, so the duplicated surface is genuinely minimal. Justification recorded at the component per Art VII. |

**Not a drift**: `jiraMentionFormat.ts` extends the existing `jiraMentions.ts` vocabulary rather than restating it —
`jiraMentions.ts` keeps its detection role and both import the one table.
