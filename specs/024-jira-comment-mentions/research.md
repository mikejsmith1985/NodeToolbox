# Phase 0 Research: Jira-Native @-Mentions in Toolbox Comments

**Feature**: `024-jira-comment-mentions` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

Ten questions had to be settled before design. Eight are resolved from the codebase; **R3 is genuinely unresolved and
requires a live Jira instance** — it is the one item the spec flagged as P1 and it stays open by design, with a
fail-safe default so implementation is not blocked.

---

## R1 — Which user search should the picker reuse?

**Decision**: `searchFeatureReviewUsers` (`client/src/views/SprintDashboard/featureReviewFixes.ts:207`), **not**
`searchUsers` (`client/src/services/jiraApi.ts:320`).

**Rationale**: The spec named `searchUsers` as the reuse target. That was the wrong call, and the codebase says so:

| Search | Call sites | Returns |
|---|---|---|
| `searchFeatureReviewUsers` | 5 — HygieneFixControl, ReadinessFixControl, MyIssuesView, FeatureReviewTab, IssueFieldEditingSection | `{ displayName, userIdentifier }` |
| `searchUsers` | 1 — PersonFinder (JQL box) | raw `JiraUser` |

`searchFeatureReviewUsers` is the established shared path, carries the same Data Center legacy-parameter retry, and —
decisively — returns the identifier in a **self-describing, flavour-encoding form** (see R2). `searchUsers` returns a
raw `JiraUser` from which the caller must re-derive the flavour itself, duplicating logic that already exists.

**Alternatives considered**: `searchUsers` (spec's suggestion — rejected: fewer callers, no flavour encoding, would
require re-implementing identifier selection); a new search (rejected outright under Article VII).

**Spec correction**: the Assumptions section's "existing Jira user search" now resolves to `searchFeatureReviewUsers`.
The legacy-fallback behaviour the spec relied on is present in both, so no requirement changes.

---

## R2 — How does a picked person become a mention token?

**Decision**: Map `FeatureReviewUserCandidate.userIdentifier` directly onto the mention forms already enumerated in
`client/src/utils/jiraMentions.ts:87`.

`readFeatureReviewUserIdentifier` (`featureReviewFixes.ts:82`) emits a prefixed string, and
`buildFeatureReviewUserPayload` (`:111`) consumes it by splitting on the first `:`:

| `userIdentifier` | Instance flavour | Mention token |
|---|---|---|
| `accountId:557058:ab-12` | Cloud | `[~accountid:557058:ab-12]` |
| `name:jsmith` | Data Center (username) | `[~jsmith]` |
| `key:JIRAUSER123` | Data Center (user key) | `[~JIRAUSER123]` |

**Rationale**: This is exactly the "instance flavour is derivable, not configured" assumption the spec made, and it
turns out to already be true in the codebase — the search result *tells us* which form the instance uses. No probing,
no config key, no guessing. It also makes NFR-002 (read and write agree by construction) achievable literally: the
same module owns both the parse and the build.

**Alternatives considered**: reading a configured instance-flavour setting (rejected — no such setting exists and the
data already carries it); probing `/rest/api/2/serverInfo` (rejected — an extra round-trip for information already in
hand).

---

## R3 — Does a *name-carrying* mention form exist that still notifies? ⚠️ UNRESOLVED

**Decision**: **Cannot be settled from the codebase. Requires a live-instance test.** Implementation proceeds on the
fail-safe default (FR-013a plain token) and adopts FR-013's readable form only if the test passes.

**What the analysis shows** (evidence, not proof):

- The app posts comments as **wiki-markup strings** through `/rest/api/2/issue/{key}/comment` (five call sites, all
  `jiraPost(..., { body: <string> })`). In wiki markup the documented user-mention macro is `[~identifier]` — a form
  that carries the identifier only, never a display name.
- The aliased-link form `[Jane Doe|~jsmith]` is syntactically valid wiki markup, but it is a **link** construct. Jira's
  mention-notification is produced by the mention parser, and there is no assurance the aliased form is parsed as a
  mention rather than a profile link. **This is the crux and it is untested.**
- A genuinely name-carrying mention *does* exist in **ADF** (Cloud): a `mention` node carries both `attrs.id` and
  `attrs.text` (`"@Jane Doe"`) and notifies correctly. But reaching it requires posting ADF via `/rest/api/3`, which
  would change the posting protocol — contradicting the spec's "Posting is unchanged" assumption and widening the
  feature far beyond its stated scope.

**Therefore the honest expectation is that FR-013 as written is probably not reachable on this instance without a
protocol change, and FR-013a is the likely outcome.** That is stated as expectation, not conclusion — the test decides.

**The deciding test** (Article X — evidence, not documentation):

1. On a scratch issue, post a comment containing `[~<identifier>]` for a willing colleague. Confirm they are notified.
2. Post a second comment containing `[Their Name|~<identifier>]`.
3. Ask whether they received a notification for the **second** comment, and inspect how it renders in Jira's UI.
4. Pass ⇒ implement FR-013. Fail (or ambiguous) ⇒ FR-013a fallback, permanently.

**Fail-safe design consequence**: the token builder returns the **plain form by default**. The readable form is
introduced only behind a passing test, and never guessed at — because FR-012 is the requirement that actually matters,
and a non-notifying mention is the precise silent failure this whole feature exists to eliminate. Shipping a pretty
mention that does not notify would be strictly worse than shipping an ugly one that does.

**Mitigation that makes the fallback acceptable** — see R10.

---

## R4 — Where are comments actually displayed?

**Decision**: `CommentThread.tsx:54` is the **single display swap point**. `SprintDashboardView.normalizeCommentBody`
must be left untouched.

**Rationale**: Grepping `normalizeRichTextToPlainText` across the client finds two comment-related call sites:

- `client/src/components/CommentThread/CommentThread.tsx:54` — renders `comment.body` to the screen. **This is the
  display path**, and every comment surface routes through it (feature 008 unified them deliberately).
- `client/src/views/SprintDashboard/SprintDashboardView.tsx:487` (`normalizeCommentBody`) — used at `:641`, `:668` for
  **keyword matching** (`includes('INT env deployed')`, `includes('INT window Day 4')`) in release-window detection.
  This is analysis, never shown to a user.

Resolving mentions in the analysis path would change strings that drive release decisions for zero user benefit — a
silent behaviour change in an unrelated feature. It is explicitly out of bounds.

**This confirms FR-018 is satisfiable with one edit**, which is what feature 008 bought us.

---

## R5 — Where are comments composed?

**Decision**: Five composers, all plain `<textarea>`, all posting a string body.

| Composer | Location |
|---|---|
| Issue detail panel | `client/src/components/IssueDetailPanel/index.tsx:494` |
| DSU Board overlay | `client/src/views/DsuBoard/DsuBoardView.tsx:924` |
| DSU Daily | `client/src/views/DsuDaily/DsuDailyView.tsx` → `useDsuDailyState.postComment` |
| Bulk comment | `client/src/views/MyIssues/BulkCommentPanel.tsx:56` |
| Mentions reply | `client/src/views/MyIssues/MentionsTab.tsx` (renders `IssueDetailPanel`, so inherits it) |

**Note**: the Mentions reply box is *not* a fifth integration — it renders `IssueDetailPanel`, so wiring that panel
covers it. Effective integration count is **four**.

---

## R6 — What is the type-ahead extraction source?

**Decision**: Extract the popover/debounce shell from the **`AssigneeFieldEditor`** family
(`client/src/components/IssueFieldEditors/IssueFieldEditors.tsx:144`), not `PersonFinder`.

**Rationale**: `AssigneeFieldEditor` already takes an injected `onSearchUsers: (query) => Promise<FeatureReviewUserCandidate[]>`
(`:138`) — the exact seam a shared picker needs, already consuming the R1 search and the R2 identifier shape. It lives
in `client/src/components/`, i.e. already shared. `PersonFinder` is view-local to Feature Canvas, uses the wrong
search (R1), and its selection step returns a **JQL clause** (`buildAssigneeClause`) — the one part that is not
reusable.

**Alternatives considered**: extracting `PersonFinder` (spec's suggestion — rejected on all three counts above);
building a new type-ahead (rejected under Article VII — two exist).

**Article VII note**: the new **caret-anchored trigger** behaviour (open on `@` at a word boundary, insert at caret)
is not provided by either existing control — both are click-to-open popovers attached to a button. That delta is the
documented gap justifying a new shared component; the search, debounce, result list, and keyboard handling are reused.

---

## R7 — Why do ADF mentions vanish today?

**Decision**: Root cause confirmed in `client/src/utils/richTextPlainText.ts:18`.

```
function collectDocumentText(documentNode) {
  const nodeText = typeof documentNode.text === 'string' ? documentNode.text : '';
  const contentNodes = Array.isArray(documentNode.content) ? documentNode.content : [];
  ...
}
```

An ADF mention node is `{ type: 'mention', attrs: { id, text } }` — it has **no `text` property at the top level and
no `content` array**. Both branches yield `''`, so the node contributes nothing and the mention disappears from the
sentence. This is FR-002's defect, and it is a genuine data-loss bug independent of the identifier-readability one.

**Design consequence**: the fix belongs in the **new comment renderer**, not in `normalizeRichTextToPlainText`. That
normalizer is called from PO Tool drafts, Feature Canvas inspectors, SNow field rendering, and story-point feature
extraction — changing it would alter text in all of them, which Q1 scoped out.

---

## R8 — Sequencing against features 022 and 023 ⚠️ SPEC CORRECTION

**Decision**: The spec's sequencing constraint is **obsolete**. Both features are already implemented.

**Evidence**: `client/src/components/QuickIssueLookup/` exists complete with `quickLookupStore.ts` and tests;
`IssueDetailPanel/index.tsx` already imports `useQuickLookupStore`, `IssueFieldEditingSection`, and the `IssueMeta`
chip family; `test/e2e/` contains `quick-issue-lookup.spec.js`, `linked-issue-lookup.spec.js`,
`myissues-personas.spec.js`, `po-pi-dropdown.spec.js`; and `CHANGELOG.md`'s Unreleased section carries GH #200
follow-up fixes.

`CLAUDE.md` still describes 019–023 as "planned — ready for `/speckit-tasks`". **That file is stale**, which is why
the spec inherited the wrong constraint.

**Consequence**: there is **no concurrency hazard**. `IssueDetailPanel` can be edited directly. The spec's
"whichever lands second rebases onto the first" instruction is dropped.

---

## R9 — Store shape and concurrency bounding

**Decision**: A Zustand store at `client/src/store/`, in-memory only (FR-007a), with a bounded-concurrency resolver.

**Rationale**: Zustand is the repo's established store primitive — ten stores in `client/src/store/` and view-local
directories. Per FR-007a the store must **not** use the `persist` middleware that `settingsStore`/`recentIssuesStore`
use; this is the deliberate difference and deserves a comment at the definition so a later reader does not "fix" it by
adding persistence.

Bounded concurrency (FR-007b) is a small worker-pool over the distinct-unresolved set — a fixed number of in-flight
lookups, draining a queue. No new dependency; `Promise.all` over chunks is sufficient and matches the chunking pattern
already used for label searches (`jiraApi.ts:344`, `LABEL_SEARCH_CHUNK_SIZE`).

**In-flight de-duplication** matters as much as the cache: two comments mentioning the same unresolved person must
produce **one** request. The store therefore holds `identifier → displayName | 'pending' | 'unresolvable'`, and a
pending entry suppresses a duplicate fetch (FR-007's "MUST NOT repeatedly re-request").

---

## R10 — Making the FR-013a fallback acceptable

**Decision**: Add a **"Tagging: …" companion line** beneath any composer whose draft contains mention tokens, listing
the resolved display names.

**Rationale**: If R3 fails, the composer shows `[~accountid:557058:ab-12]` and SC-009 ("a user can read back who they
tagged") is unmet by the textarea alone. A plain textarea cannot style or hide part of its own value, so no amount of
in-box treatment fixes this; a highlight overlay would still leave the raw characters legible-but-opaque, and hiding
them requires a `contenteditable` — the rich-text editor the spec put out of scope.

Parsing the draft with the same shared vocabulary (R2) and rendering the names *beside* the box delivers SC-009's
intent — read back who you tagged — without touching the posted text at all, so FR-013's "no translate-on-post"
guarantee is preserved absolutely. It costs one small component and reuses the resolver already built for reading.

It is also **strictly additive**: if R3 passes and FR-013's readable form ships, the companion line remains correct
and simply becomes redundant reassurance.

**Alternatives considered**: transparent-textarea highlight overlay (rejected — solves visibility, not readability, and
adds scroll/font-metric sync); `contenteditable` composer (rejected — explicitly out of scope); accepting SC-009 as
unmet (rejected — it is the measurable form of the user's original complaint).

---

## Resolved / Unresolved summary

| # | Question | Status |
|---|---|---|
| R1 | Which user search | ✅ `searchFeatureReviewUsers` — spec corrected |
| R2 | Identifier → token mapping | ✅ Direct, flavour already encoded |
| R3 | Name-carrying mention form | ⚠️ **Open — live test required; fail-safe default set** |
| R4 | Comment display sites | ✅ One swap point; analysis path excluded |
| R5 | Composer inventory | ✅ Four integrations (five surfaces) |
| R6 | Type-ahead source | ✅ `AssigneeFieldEditor` — spec corrected |
| R7 | ADF drop root cause | ✅ Confirmed at `richTextPlainText.ts:18` |
| R8 | Sequencing vs 022/023 | ✅ **Obsolete — both already shipped; `CLAUDE.md` stale** |
| R9 | Store + concurrency | ✅ Zustand, no persist, pooled resolver, in-flight dedupe |
| R10 | Fallback acceptability | ✅ Companion "Tagging:" line |

**R3 does not block implementation.** Every task can be built against the fail-safe token form; adopting the readable
form later is a one-function change behind a passing test.
