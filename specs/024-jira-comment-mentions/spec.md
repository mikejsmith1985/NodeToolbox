# Feature Specification: Jira-Native @-Mentions in Toolbox Comments

**Feature short name**: `jira-comment-mentions`
**Feature branch**: `feature/024-jira-comment-mentions`
**Created**: 2026-07-22
**Status**: Draft — clarified, ready for `/speckit-plan`
**Builds on**: the shared comment thread and its on-demand full-history fetch established by feature
**008-jira-comments-ux**; the shared plain-text normalizer every rich Jira field renders through; the existing Jira
user search (which already copes with both Cloud and Data Center instances); the existing person-search type-ahead
built for the Feature Canvas JQL box; and the existing mention-detection vocabulary that powers the My Issues
"Mentions" report.

## Summary

A Jira comment is a conversation, and conversations name people. Today Toolbox breaks that in both directions.

**Reading is broken.** When a colleague tags someone in a comment, Toolbox does not show a name. Depending on how the
instance stored the comment, the reader sees either a raw machine identifier — `[~accountid:557058:ab-12]` or
`[~jsmith]` — or, worse, *nothing at all*: the mention is silently dropped and the sentence reads as though a word is
missing. The one identifier a user can recognise is their own, so the practical experience is "I can tell when it's
about me, and I have no idea who else is involved."

**Writing is broken.** There is no way to tag a person from inside Toolbox. A user who wants to pull a colleague into
a thread must open the issue in Jira, type the mention there, and post from Jira — abandoning the Toolbox workflow
they were in. If they instead type a name into the Toolbox comment box, the comment posts as ordinary text and **the
person is never notified**, which is a silent failure: the author believes they asked for help and nobody was asked.

This feature closes both directions. Mentions **render as human names** wherever comments are shown, and typing `@`
in any comment box **opens a person search** whose selection posts a real, notifying Jira mention.

The guiding principle is the one feature 008 established for this same surface: **the conversation must look and
behave the same everywhere it appears, and it must never quietly show the user less than the truth.** Feature 008
deliberately left comment bodies rendering as normalized plain text and recorded rich-body rendering as out of scope;
this feature picks up precisely the part of that deferral that costs users the most — the people in the sentence.

## Clarifications

### Session 2026-07-22

- Q: Which text gets mention resolution — comments only, comments plus descriptions, or every rich text field? →
  A: **Comments only.** The smallest, safest change with a single swap point. Issue descriptions keep their current
  behavior; see *Known accepted inconsistency* under Assumptions.
- Q: What does an inserted mention look like while the user is composing? → A: **A readable form that is literally
  what posts** — the mention token carries the person's display name *and* their identifier, so the composer is
  readable without any translate-on-post step. Where the connected instance does not accept a name-carrying mention
  form, this degrades to inserting the plain mention token (the honest, never-desynchronizing fallback).
- Q: What does an unresolvable mention render as? → A: **A neutral placeholder** ("@unknown user"). Readability wins
  over identifier recovery; the raw identifier is deliberately not surfaced to the reader.
- Q: What occupies a mention's place between the comment appearing and its name arriving? → A: **A neutral inline
  loading marker, visually distinct from the unresolvable placeholder**, replaced by the name when it arrives.
  "Still loading" and "cannot be identified" are different facts and must never look the same.
- Q: How long does a resolved name live? → A: **In memory, for the session only** — discarded on reload, never
  persisted. Payload seeding refills it quickly, so no staleness policy, cache-invalidation rule, or directory data
  at rest is introduced.
- Q: When exactly does typing `@` open the picker? → A: **Only when the `@` begins a word** (start of input, or
  preceded by whitespace). Matches Slack/GitHub/Jira convention, and makes "type an email without tagging anyone"
  true by construction rather than by the user dismissing an unwanted popup.
- Q: How are lookups bounded when one thread mentions many unknown people? → A: **Every distinct unresolved person is
  looked up, a few at a time** (bounded concurrency). No one is left permanently unresolved, and the request burst is
  capped. Batching several identifiers per request is an allowed optimization where the instance supports it, but is
  not required.
- Q: How fast must names settle, in measurable terms? → A: **Within 2 seconds on a typical thread under normal
  connectivity**, paired with a structural guarantee that comment text is never blocked and every loading marker
  eventually becomes a name or the unresolvable placeholder. The clock target exists to catch serialized lookups; the
  structural guarantee is what holds on a slow network.

## User Scenarios & Testing

### User Story 1 — I can see who was tagged (Priority: P1)

A user reads a comment thread in Toolbox. Where a colleague tagged someone, the user sees that person's name in the
sentence, the same way they would in Jira. No raw identifier strings, and no mentions missing from the text.

**Acceptance:**

1. A comment whose stored body identifies a person by machine identifier renders that person's **display name** in
   place of the identifier.
2. A comment whose stored body carries the mention as a structured element (rather than inline markup) renders the
   name too — it is **not** dropped from the sentence, which is today's behavior for that shape.
3. A thread containing several mentions of several different people shows the correct name for each.
4. A mention of the reader themselves is rendered by name like any other (see US4 for emphasis).
5. When a mentioned person genuinely cannot be identified, the reader sees the neutral placeholder — never a blank
   and never a raw identifier. Per the Q3 decision this deliberately does not preserve the identifier.
6. While a name is still resolving, the mention shows a loading marker that a reader can tell apart from the
   "cannot be identified" placeholder; a merely-slow mention is never presented as an unidentifiable one.

### User Story 2 — I can tag the right person without leaving Toolbox (Priority: P1)

A user writing a comment types `@`. A person search opens. They type part of a name, pick the right colleague from the
results, and continue writing. When they post, that colleague receives the **same Jira notification** they would have
received had the mention been typed in Jira itself.

**Acceptance:**

1. Typing `@` in a comment composer opens a person search positioned at the point of typing.
2. Typing after the `@` filters the results by name or email; results appear without the user having to press a
   separate search button.
3. Selecting a person inserts a real mention of that person into the comment being written, and returns focus to the
   composer so typing continues naturally.
4. Posting the comment causes Jira to treat it as a genuine mention — the tagged person is notified and the mention is
   visible as a mention when the same comment is later viewed in Jira.
5. The mention is correct for the connected Jira instance, whichever identifier form that instance uses.
6. Dismissing the search (Escape, or clicking away) leaves the typed `@` as ordinary text and never blocks the user
   from writing a plain `@` that is not a mention (e.g. an email address).
7. The user can complete the whole tag-a-colleague task without opening Jira.

### User Story 3 — It works the same in every comment box (Priority: P2)

Wherever Toolbox shows or accepts a comment, both behaviors above are present and identical — the user never has to
remember which screen supports tagging.

**Acceptance:**

1. Every location that displays comments resolves mentions to names.
2. Every location that composes a comment offers the `@` person search — including the issue detail panel, the daily
   stand-up surfaces, the bulk-comment tool, and the reply box on the Mentions report.
3. The behavior, keyboard interaction, and appearance of the person search are the same in each location.
4. The bulk-comment case posts the same working mention to every selected issue.

### User Story 4 — A mention of me stands out (Priority: P3)

Scanning a thread, the user's eye lands on the comments that are asking *them* for something.

**Acceptance:**

1. A mention of the current user is visually distinguished from mentions of other people.
2. The distinction does not rely on color alone.
3. This does not change which comments are shown, nor the existing "Mentions" report's behavior.

### Edge cases (all stories)

- **Deactivated or departed user** — a mention of a person who no longer exists in the directory still renders
  honestly rather than as a blank or a raw identifier.
- **No permission to view the directory** — if person lookup is unavailable, comment reading still works and mentions
  degrade to the honest fallback; the reader is not shown an error wall over the thread.
- **Person search unavailable** — if the directory cannot be searched while composing, the composer stays fully usable
  for plain text and says so, rather than trapping the user in a broken popup.
- **A literal `@` that is not a mention** — typing an email address, a handle, or `@here` must remain possible; an
  unconfirmed `@` never silently becomes a mention. An `@` mid-word (an email address) does not open the picker at
  all (FR-009a); an `@` that does open it can still be dismissed and left as plain text.
- **Long or duplicate names** — two colleagues with the same display name are distinguishable in the search results
  before the user commits to one.
- **A very long thread** — a thread with many comments and many distinct mentioned people shows its text immediately
  (FR-005), looks up each distinct unknown person with bounded concurrency (FR-007b), and settles every name within
  the SC-007 target. No mention is skipped to meet the target.
- **Editing after inserting** — a user who backspaces into or deletes part of an inserted mention does not end up
  posting a corrupted half-mention that notifies the wrong person. Because the inserted text *is* the posted text
  (FR-013), editing the readable name portion may change the label but MUST NOT redirect the notification to a
  different person; damaging the identifier portion degrades to plain text (nobody notified), which is visible to the
  author before posting rather than silent.
- **Mention pasted from elsewhere** — a raw identifier pasted into the composer by hand still posts as whatever Jira
  makes of it; Toolbox does not need to rewrite it, but must not corrupt it.

## Requirements

### Functional — US1: mentions read as names

- **FR-001**: Wherever a comment body is displayed, any mention of a person MUST be rendered as that person's human
  display name rather than a machine identifier.
- **FR-002**: Mentions stored as a structured element (rather than as inline markup) MUST be rendered as a name and
  MUST NOT be omitted from the displayed sentence. This is a defect fix — such mentions currently disappear.
- **FR-003**: Name resolution MUST cover every mention identifier form the connected Jira instance may use, and MUST
  use a single shared definition of those forms so that reading a mention and writing one can never disagree about
  what a mention looks like.
- **FR-004**: When a mentioned person cannot be resolved to a name, the display MUST render a **neutral placeholder**
  ("@unknown user") in place of the mention — readable, clearly indicating that *someone* was tagged, and never a
  blank or a raw machine identifier. The identifier is deliberately not surfaced to the reader (clarified).
- **FR-005**: Resolving names MUST NOT require the reader to take an action (no "load names" button) and MUST NOT
  delay the appearance of the comment text itself.
- **FR-005a**: While a mention's name is still being resolved, its place MUST be held by a **neutral inline loading
  marker** that is **visually distinct from the unresolvable placeholder of FR-004** (clarified). A mention that is
  merely slow MUST NEVER be presented as one that cannot be identified. The marker MUST be replaced by the name as
  soon as it resolves, or by the FR-004 placeholder if resolution fails.
- **FR-005b**: During the transition from loading marker to resolved name, **only the mention element itself may
  change** — the surrounding text of the comment MUST NOT be removed, replaced, re-ordered, or re-rendered. Stated
  this way the requirement is directly testable (assert the sibling text nodes are identical before and after the
  swap) rather than resting on the unmeasurable "reader loses their place".
- **FR-006**: The feature MUST NOT obtain names by rendering server-supplied HTML for comment bodies. Feature 019
  rejected that approach on sanitization-risk grounds and that decision stands.
- **FR-007**: Name resolution MUST reuse identities the application has already retrieved (such as comment authors,
  assignees, and reporters) before requesting any additional directory information, and MUST NOT repeatedly re-request
  the same person while the user works.
- **FR-007a**: The resolved-name store MUST live **in memory for the session only** (clarified). It MUST NOT be
  persisted across reloads, and consequently MUST NOT define an expiry or invalidation policy — a reload starts empty
  and refills from FR-007 seeding. No directory data is written to durable storage.
- **FR-007b**: Every distinct unresolved person in a thread MUST eventually be looked up, with **bounded
  concurrency** so one thread cannot burst an unbounded number of simultaneous requests (clarified). The feature MUST
  NOT cap lookups in a way that leaves a resolvable person showing the FR-004 unresolvable placeholder — that would
  reintroduce the very conflation FR-005a forbids. Batching multiple identifiers into a single request is a permitted
  optimization where the instance supports it, not a requirement.
- **FR-008**: Mention resolution applies to **comment bodies only** (clarified). Issue descriptions and other rich
  text fields retain their current rendering; the change MUST be confined so that no other field's displayed text is
  altered.

### Functional — US2: the `@` person picker

- **FR-009**: Typing `@` in a comment composer MUST open a person search anchored to the composer.
- **FR-009a**: The picker MUST open **only when the `@` begins a word** — at the start of the input, or immediately
  preceded by whitespace (clarified). An `@` preceded by a non-whitespace character (as in `mike@example.com`) MUST
  NOT open it. This makes SC-008 hold by construction rather than relying on the user dismissing the picker.
- **FR-010**: The search MUST match people by name or email as the user types, without requiring a separate submit
  action, and MUST NOT issue a request for every keystroke.
- **FR-011**: Selecting a person MUST insert a mention of that person into the comment text at the `@` position and
  return the caret to the composer so the user can keep typing.
- **FR-012**: The inserted mention MUST use the identifier form the connected Jira instance requires, so that posting
  the comment produces a **real Jira mention that notifies the tagged person** — not plain text resembling a name.
- **FR-013**: The inserted mention MUST be **readable in the composer while remaining literally the text that posts**
  — a mention form carrying both the person's display name and their identifier (clarified). There MUST be no
  translate-on-post step: what the user sees in the box is what is sent to Jira, so editing can never desynchronize
  the visible text from the mention actually posted.
- **FR-013a**: Where the connected instance does not accept a name-carrying mention form that still notifies, the
  composer MUST fall back to inserting the plain mention token. The fallback MUST be chosen from the instance's own
  capability, not from a user setting, and MUST NOT silently post a non-notifying mention (FR-012 governs).
- **FR-014**: The user MUST be able to dismiss the search without inserting anything, leaving the typed `@` as
  ordinary text; a `@` that the user never confirms MUST NOT become a mention.
- **FR-015**: The person search MUST work against both instance flavours Toolbox supports, reusing the existing user
  search rather than introducing a second one.
- **FR-016**: If the directory cannot be searched, the composer MUST remain usable for plain text and MUST say the
  search is unavailable, rather than blocking comment posting.
- **FR-017**: The picker MUST search the full set of Jira users the viewer can see — not only members of a configured
  team or roster — because the person a user needs to tag is frequently outside their team.

### Functional — US3: consistency across surfaces

- **FR-018**: Every comment-display location MUST resolve mentions identically, via one shared rendering path, so no
  screen can drift.
- **FR-019**: Every comment composer MUST offer the same `@` person search, via one shared control, with identical
  keyboard behavior and appearance.
- **FR-020**: Adding the picker MUST NOT change any composer's existing posting behavior, validation, or success and
  error reporting.

### Functional — US4: self-mention emphasis

- **FR-021**: A mention of the current user MUST be visually distinguished from mentions of other people, without
  relying on color alone.
- **FR-022**: This emphasis MUST NOT alter which comments are displayed, nor the existing Mentions report's detection
  or contents.

### Non-functional

- **NFR-001**: All new controls and rendered mentions MUST honor the standing responsive rules — light and dark
  themes, the A / A+ / A++ text sizes, and narrow widths reflowing rather than clipping — and MUST never carry meaning
  by color alone.
- **NFR-002**: Reading a mention and writing one MUST agree by construction: both MUST derive from a single shared
  definition of the instance's mention formats, never from two independently maintained lists.
- **NFR-003**: The person search MUST be operable by keyboard alone (open, filter, move through results, select,
  dismiss) and MUST expose result options to assistive technology.
- **NFR-004**: Name resolution MUST NOT leak identity information into logs, MUST NOT write directory data to durable
  storage (FR-007a), and MUST NOT grant the viewer any directory access they do not already have in Jira.
- **NFR-004a**: The logging half of NFR-004 MUST be verified explicitly, not assumed. In particular: a per-person
  lookup URL contains that person's identifier, and the app's Jira transport records every call's URL into its API
  event stream. Whether that recording is acceptable under NFR-004 MUST be an explicit, recorded decision — display
  names MUST NOT reach logs in any case.
- **NFR-005**: Existing comment surfaces MUST be extended additively; no current caller may regress.

## Key Entities

- **Mention** — a reference to a person inside a comment body. It has a stored form (an instance-specific identifier)
  and a displayed form (a human name). The whole feature is the translation between those two.
- **Mention format vocabulary** — the single authoritative set of stored forms a mention can take on the supported
  Jira flavours. Both reading and writing derive from it.
- **Person directory entry** — the association between a stored identifier and a display name (plus email, where
  available, to disambiguate people with the same name). Populated opportunistically from identities already on hand
  and, where necessary, by lookup. Lives in memory for the session only; never persisted, and therefore never stale.
- **Person search result** — one candidate person offered while composing: enough to choose confidently between
  similarly named colleagues.
- **Comment composer** — any place a user writes a comment. Each one gains the `@` behavior.
- **Comment display** — any place a comment body is shown. Each one gains name rendering.

## Success Criteria

- **SC-001**: In a comment thread containing mentions, a reader sees a human name for every tagged person: **zero**
  raw machine identifiers and **zero** mentions missing from the text, where today one or the other always occurs.
- **SC-002**: A user tags a colleague entirely within Toolbox, and that colleague receives the **same Jira
  notification** they would have received from a mention typed in Jira — verified against a real instance, not merely
  by the comment posting successfully.
- **SC-003**: Tagging a colleague requires **zero** visits to Jira, where today it requires opening the issue in Jira.
- **SC-004**: A user picks the correct person from the search on the first attempt even when two colleagues have
  similar names, because the results carry enough detail to tell them apart.
- **SC-005**: Every comment-display and comment-composing location in the product exhibits the behavior — measured by
  walking each surface, with none exempt.
- **SC-006**: A thread whose mentions name people the directory cannot resolve still **reads as a sentence** — the
  reader can tell a person was tagged and the surrounding text is intact. Per the Q3 decision this trades away
  identifier recovery: the raw identifier is intentionally no longer shown, so for these mentions the reader gains
  readability and loses the ability to work out who it was by hand.
- **SC-007**: On a typical thread — a full comment history mentioning a realistic number of distinct people — every
  resolved name has settled **within 2 seconds** of the thread appearing, under normal connectivity. Independently of
  timing, two structural guarantees hold on any network: the comment text is never blocked waiting on resolution, and
  every loading marker eventually becomes either a name or the unresolvable placeholder — none remains a loading
  marker indefinitely.
- **SC-008**: A user can write a comment containing a literal `@` (such as an email address) without accidentally
  tagging anyone.
- **SC-009**: A user composing a comment can read back who they tagged directly in the comment box, and the text they
  see is exactly the text that posts — no mention is rewritten between the box and Jira.

## Assumptions

- **Both halves share one vocabulary.** The application already carries a definition of every mention form used by the
  supported Jira flavours (built for the Mentions report). That definition becomes the single source of truth for
  reading *and* writing; neither side restates it. This is what makes NFR-002 true by construction rather than by
  discipline.
- **The instance flavour is derivable, not configured.** A person returned by the existing user search carries the
  identifier the instance uses; the mention written for that person is derived from the person record itself. No new
  configuration switch, and no instance-probing, is introduced.
- **Open dependency — the name-carrying mention form (FR-013).** The Q2 decision assumes the connected instance
  accepts a mention form that embeds the display name alongside the identifier *and still notifies the tagged
  person*. This is **not yet verified against the target instance** and is the single highest-risk assumption in the
  spec: if it does not hold, FR-013a's fallback applies and the composer shows plain mention tokens (the Q2 option A
  behavior). Confirming it — by posting a test mention in each supported form and observing whether the recipient is
  actually notified — is a **P1 research task for `/speckit-plan`**, and must be settled by evidence, not by
  documentation reading (Constitution Article X).
- **Known accepted inconsistency (Q1).** Issue descriptions can contain mentions and have the same defect, but are
  out of scope by decision. Until a later feature addresses them, a user may see a resolved name in a comment and a
  raw identifier in the description of the same issue. This is accepted knowingly, not overlooked.
- **Reuse over rebuild (Article VII).** *(Reuse targets corrected by Phase 0 research — see research.md R1 and R6.
  The originally drafted targets were wrong; these are the verified ones.)* The picker reuses **`searchFeatureReviewUsers`**
  (`client/src/views/SprintDashboard/featureReviewFixes.ts:207`) — the codebase's dominant user search (five callers),
  which carries the Data Center legacy-parameter retry **and** returns a flavour-encoded identifier. It reuses the
  debounce/popover shell of the **`AssigneeFieldEditor`** family
  (`client/src/components/IssueFieldEditors/IssueFieldEditors.tsx:144`), which already accepts an injected search.
  **Not** `jiraApi.searchUsers` (one caller, no flavour encoding) and **not** the Feature Canvas `PersonFinder`
  (view-local, wrong search, returns a JQL clause). Building a second search or a second type-ahead would require a
  documented gap that does not exist.
- **Names already in hand are free.** The application continuously handles user records — comment authors, assignees,
  reporters — that already pair an identifier with a display name. These seed the directory at no request cost, so
  lookups are only needed for the residue.
- **No server-rendered HTML.** Feature 019 evaluated and rejected asking Jira to render bodies (which would resolve
  mentions for free) because it returns HTML requiring sanitization. That rejection is carried forward as FR-006, so
  resolution is done in-product.
- **Comment retrieval is unchanged.** Feature 008 standardized on fetching the full thread on demand; this feature
  changes how a body is *displayed*, not how it is *retrieved*.
- **Posting is unchanged.** Comments continue to post through the existing paths with the same validation and
  success/error reporting; the picker only affects the text the user composes.
- **Read-only directory access.** Person search and name resolution read the directory under the viewer's own Jira
  access. Nothing here grants visibility of users the viewer could not already find in Jira.
- **Sequencing — no constraint.** *(Corrected by Phase 0 research — see research.md R8.)* An earlier draft of this
  spec required serializing against feature **022-quick-issue-lookup** because both touch the shared issue detail
  panel. That constraint is **void**: 022 and 023 are **already shipped** — `client/src/components/QuickIssueLookup/`
  exists complete with its store and tests, and `IssueDetailPanel` already imports `useQuickLookupStore`. The false
  constraint came from `CLAUDE.md`, which still described that shipped work as "planned". `IssueDetailPanel` may be
  edited directly; no worktree isolation or rebase ordering is needed.

## Out of Scope

- **Full rich-text rendering of comment bodies.** Feature 008 recorded this as out of scope and it remains so. This
  feature resolves *people*; it does not introduce formatting, links, tables, or images into comment display.
- **A rich-text or WYSIWYG comment editor.** Composers remain plain-text; the picker inserts into plain text.
- **Editing or deleting existing comments**, threading, or reactions.
- **Tagging groups, teams, or roles** (`@here`-style broadcast mentions), and mentioning issues or pull requests.
- **A new user directory, roster, or people data model.** The existing Jira user search is the directory.
- **Changing the Mentions report's detection logic or contents** — it keeps working as it does today; this feature
  only makes the mentions it finds readable and, per US4, visually distinct.
- **Changing how comments are retrieved from Jira** (feature 008's decision stands).
- **Server-side or scheduled behavior.** This is an in-app reading and authoring change.
- **Mention resolution in issue descriptions and other rich text fields** (Q1 decision). These share the defect and
  are a natural follow-up, but this feature is confined to comment bodies.
- **Surfacing the raw identifier behind an unresolvable mention** (Q3 decision). The placeholder is terminal; there is
  no hover, expand, or debug affordance to recover the identifier.

## Decision Log

| # | Question | Decision | Consequence carried into the spec |
|---|----------|----------|-----------------------------------|
| Q1 | Scope of mention resolution | **Comments only** | FR-008; descriptions listed in *Out of Scope*; inconsistency accepted knowingly in *Assumptions* |
| Q2 | Composer appearance of an inserted mention | **Readable form that is literally what posts** | FR-013 + FR-013a fallback; verification of the name-carrying form is a P1 `/speckit-plan` research task |
| Q3 | Unresolvable mention rendering | **Neutral placeholder ("@unknown user")** | FR-004; SC-006 restated to name the identifier-recovery tradeoff honestly; recovery affordance in *Out of Scope* |
| Q4 | What shows while a name is resolving | **Neutral loading marker, distinct from the unresolvable placeholder** | FR-005a, FR-005b; US1 acceptance 6. "Slow" and "unidentifiable" must never look alike |
| Q5 | Resolved-name store lifetime | **In memory, session only — never persisted** | FR-007a; NFR-004 extended to durable storage; no staleness or invalidation policy exists |
| Q6 | When `@` opens the picker | **Only when `@` begins a word** | FR-009a; makes SC-008 hold by construction; email addresses never trigger it |
| Q7 | Bounding lookups on a busy thread | **All distinct people, bounded concurrency** | FR-007b; capping-with-placeholder explicitly rejected as it would undo Q4 |
| Q8 | Measurable resolution speed | **2s on a typical thread, plus structural guarantees** | SC-007 rewritten from a vague adjective into a clock target that catches serialized lookups, plus network-independent liveness |
