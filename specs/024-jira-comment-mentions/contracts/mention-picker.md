# Contract: Mention Picker (caret-anchored `@` control)

**Module**: `client/src/components/MentionPicker/` (new shared control)
**Feature**: `024-jira-comment-mentions` | **Satisfies**: FR-009, FR-009a, FR-010, FR-011, FR-012, FR-014, FR-015, FR-016, FR-017, FR-019, FR-020, NFR-001, NFR-003, SC-004, SC-008, SC-009

---

## Article VII drift — recorded justification

This is the feature's **one** new abstraction. Two type-aheads already exist and neither can do this:

| Existing | Why it does not fit |
|---|---|
| `AssigneeFieldEditor` (`IssueFieldEditors.tsx:144`) | Button-anchored popover that **replaces a whole field value**. No caret model, no character trigger, no partial insertion. |
| `PersonFinder` (`FeatureCanvas/canvas/PersonFinder.tsx`) | View-local; uses `searchUsers` (wrong search per R1); selection returns a **JQL clause**. |

**The drift is the trigger and the insertion only.** The debounced search, result list, loading/error/empty states,
and keyboard handling are **extracted from `AssigneeFieldEditor`** into a shared shell that both it and this control
consume — so the duplicated surface is minimal and `AssigneeFieldEditor`'s four existing callers are unaffected
(NFR-005). This justification must be repeated as a comment at the component (Article VII).

---

## Composition

```
MentionPicker/
├── useMentionTrigger.ts      # word-boundary detection, query extraction, caret insertion (pure)
├── MentionPicker.tsx         # the popover: wraps the extracted shell, owns positioning
├── MentionDraftSummary.tsx   # "Tagging: …" companion line (R10)
└── MentionPicker.module.css
```

`useMentionTrigger.ts` holds all the logic and **no React state or DOM access** beyond the caret index passed in, so
the trigger rule is unit-testable without rendering anything.

---

## The trigger rule (FR-009a) — SC-008's enforcement

The picker opens **only when the `@` begins a word**: at index 0, or immediately preceded by whitespace.

```ts
/** True when the '@' at `atIndex` begins a word, so an email address never opens the picker (FR-009a). */
export function isMentionTriggerPosition(draftText: string, atIndex: number): boolean
```

| Input | Opens? | Why |
|---|---|---|
| `@` (empty draft) | ✅ | start of input |
| `Hi @` | ✅ | preceded by a space |
| `Hi\n@` | ✅ | preceded by a newline |
| `mike@example.com` | ❌ | preceded by `e` |
| `(@` | ❌ | preceded by `(` — not whitespace. Conservative by design: never open unbidden |
| `@@` | ❌ (second) | preceded by `@` |

**This function is what makes SC-008 true.** Without it the promise "type an email without tagging anyone" rests on
the user noticing and dismissing a popup.

**Query extraction**: from the trigger `@` to the caret. Whitespace closes the picker (a mention query is one token).
Below `MIN_QUERY_LENGTH` (2, matching `PersonFinder`) no request is issued.

---

## Behaviour

| # | Requirement | Behaviour |
|---|---|---|
| M1 | FR-009/FR-009a | Opens on a word-boundary `@`, anchored near the caret |
| M2 | FR-010 | Debounced search (300 ms, matching `PersonFinder`); no request per keystroke; stale responses dropped |
| M3 | FR-011 | Selection replaces `@query` with the token and **returns focus to the composer, caret after the token** |
| M4 | FR-012 | Inserts `buildMentionToken(...)`. A candidate yielding `null` is **not offered** — never insert a non-notifying name |
| M5 | FR-014 | Escape or click-away closes and leaves the typed `@` as plain text |
| M6 | FR-016 | Search failure → an inline "user search unavailable" note; the composer stays fully usable and posting is never blocked |
| M7 | FR-017 | Searches all users the viewer can see — no roster or team filter |
| M8 | FR-020 | Purely additive; no composer's post/validation/success/error path changes |

**M4 is the one that protects the feature's promise.** Offering an un-buildable candidate would post their plain name
and notify nobody — FR-012's silent failure, wearing a friendly face.

---

## Keyboard contract (NFR-003)

| Key | Behaviour |
|---|---|
| `@` at word boundary | opens |
| printable | filters |
| `↑` / `↓` | move the active result (wraps) |
| `Enter` / `Tab` | insert the active result |
| `Escape` | close, leave `@` as text, focus stays in the composer |
| whitespace | close (query ended) |

Fully operable without a mouse. The list is an ARIA listbox with the active option exposed via `aria-activedescendant`;
the composer keeps DOM focus throughout, so screen-reader context is never lost.

**Guard**: while the picker is open it consumes `↑`/`↓`/`Enter`; when closed those keys behave normally in the
textarea. This mirrors the keyboard guard feature 019 established for the hygiene cleanup session (keys originating in
inputs must not drive navigation).

---

## `MentionDraftSummary` — the R10 companion line

Renders beneath a composer whose draft contains mentions:

> Tagging: **Jane Doe**, **Bob Smith**

Built from `extractMentionTokens(draft)` plus the directory store — the same resolver the read side uses.

**Why it exists**: if R3 fails and FR-013a's plain token ships, the textarea shows
`[~accountid:557058:ab-12]` and SC-009 ("read back who you tagged") is unmet by the box alone. A plain `<textarea>`
cannot style or hide part of its own value, so nothing in-box can fix it without a `contenteditable` — the rich-text
editor the spec put out of scope.

Rendering names **beside** the box meets SC-009's intent while leaving the posted text untouched, so FR-013's
"no translate-on-post" guarantee holds absolutely.

**It is strictly additive**: if R3 passes and the readable form ships, this line stays correct and simply becomes
redundant reassurance. Ship it either way.

Unresolved names reuse the read side's states — loading marker or `@unknown user` — so the composer and the thread
never disagree about a person.

---

## Integration sites (FR-019 — one control, four wirings)

| # | Composer | Location |
|---|---|---|
| 1 | Issue detail panel | `client/src/components/IssueDetailPanel/index.tsx:494` |
| 2 | DSU Board overlay | `client/src/views/DsuBoard/DsuBoardView.tsx:924` |
| 3 | DSU Daily | `client/src/views/DsuDaily/DsuDailyView.tsx` |
| 4 | Bulk comment | `client/src/views/MyIssues/BulkCommentPanel.tsx:56` |

The **Mentions reply box is covered by #1** — `MentionsTab` renders `IssueDetailPanel`.

Each wiring is additive: the textarea keeps its value/onChange; the picker observes the caret and proposes an
insertion. **No composer's posting code is touched** (FR-020).

**Bulk comment note (US3 acceptance 4)**: the draft is composed once and posted to N issues. Since the token is
literal text in the draft, every issue receives the identical working mention — no per-issue rebuild, nothing to
diverge.

---

## Required tests (red first — Article V)

**Unit — `useMentionTrigger` (pure, the highest-value tests here)**
- Every row of the trigger table above, `mike@example.com` included (SC-008).
- Query extraction: `@ja` → `ja`; whitespace closes; below min length → no request.
- Insertion: replaces `@query` exactly, leaves surrounding text byte-identical, caret lands after the token.
- Insertion into the middle of existing prose (not just at the end).

**Component — `MentionPicker`**
- Debounce collapses a burst of keystrokes into one search; a stale response never overwrites a newer one.
- `↑`/`↓`/`Enter`/`Escape` per the keyboard contract.
- A candidate whose token is `null` is not rendered as selectable (M4).
- Search failure → inline note; the textarea still accepts input and posting is unaffected (M6).

**Component — `MentionDraftSummary`**
- Two mentions → both names; none → renders nothing; unresolved → loading marker, not `@unknown user`.

**E2E — `test/e2e/comment-mentions.spec.js`**
- Type `@`, pick a person, post → the comment body contains the token (SC-002's in-app half; the notification half is
  the quickstart's live check).
- Type an email address → the picker never opens (SC-008).
- Reading a thread shows names, not identifiers (SC-001).
