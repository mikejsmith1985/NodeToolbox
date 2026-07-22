# Contract: Mention Format Vocabulary

**Module**: `client/src/utils/jiraMentionFormat.ts` (new, pure — no I/O, no React)
**Feature**: `024-jira-comment-mentions` | **Satisfies**: FR-002, FR-003, FR-012, FR-013, FR-013a, NFR-002

> **This is the highest-risk contract in the feature.** It is the single place where reading and writing agree, and
> the single place R3's outcome lands. Everything else is wiring.

---

## Why this module exists

`jiraMentions.ts:87` already enumerates every mention form, but only to answer *"does this body mention me?"* — it
flattens the body to a string and substring-matches. It cannot say *where* a mention is, *which* person it names, or
*how to write a new one*.

This module owns the table and exposes both directions over it. `jiraMentions.ts` keeps its detection role and imports
the same table, so **no form is ever stated twice** (NFR-002).

---

## Exports

### `parseCommentMentions(body: unknown): MentionRun[]`

Splits a comment body into ordered text and mention runs.

**Accepts** — the two shapes Jira actually returns:
- **string** (wiki markup, the `/rest/api/2` default): scan for `[~…]` tokens.
- **ADF object**: walk `content` recursively; a `{ type: 'mention', attrs: { id, text } }` node becomes a mention run.
  **This is the FR-002 defect fix** — the shared normalizer drops these entirely because the node has neither `text`
  nor `content` (`richTextPlainText.ts:18`, R7).
- `null` / `undefined` / anything else → `[]`.

**Guarantees**:
| # | Guarantee |
|---|---|
| P1 | Concatenating the runs' source text reproduces the input exactly — no characters invented or lost |
| P2 | A body with no mentions yields exactly one `text` run (cheap common case) |
| P3 | A malformed or unrecognised `[~…]` token stays a **text** run, verbatim — never a broken mention |
| P4 | Parsing is pure and synchronous; it never triggers a lookup |

**P3 matters**: the "mention pasted from elsewhere" edge case requires Toolbox not to corrupt what it does not
understand.

### `buildMentionToken(candidate: FeatureReviewUserCandidate): MentionToken | null`

Builds the token to insert when a person is picked.

**Mapping** (R2 — the flavour is already encoded in `userIdentifier`, never guessed):

| `userIdentifier` | Produces |
|---|---|
| `accountId:557058:ab-12` | `[~accountid:557058:ab-12]` |
| `name:jsmith` | `[~jsmith]` |
| `key:JIRAUSER123` | `[~JIRAUSER123]` |
| unrecognised prefix / empty value | `null` |

**Returning `null` is a real case**, not defensive padding: the picker MUST NOT offer a person it cannot build a token
for, because inserting their plain name would post a comment that notifies nobody — FR-012's silent failure.

### `formatMentionForDisplay(token, entry): string`

Maps a token plus its directory entry to display text. The tri-state (`resolved` / `pending` / `unresolvable`) is
resolved to a name, a loading marker, or `@unknown user`; the *visual* treatment belongs to `CommentBody`.

### `extractMentionTokens(draftText: string): MentionToken[]`

Pulls every mention out of a composer draft, for the "Tagging: …" companion line (R10, SC-009). Same scanner as
`parseCommentMentions`, string input only.

---

## The R3 decision point ⚠️

`buildMentionToken` is **the one function that changes** when R3 is settled.

**Default, shipped until proven otherwise** — the plain form above, which is known to notify.

**If the [quickstart](../quickstart.md) test proves the aliased form `[Jane Doe|~jsmith]` also notifies**, the mapping
gains a display-name prefix and FR-013's readable composer is achieved with no other change anywhere in the feature.

**Do not adopt the readable form on documentation alone.** Article X and SC-002 require an observed notification, and
FR-012 outranks FR-013: an unreadable mention that works beats a readable one that silently does not.

**Corresponding parse requirement**: `parseCommentMentions` MUST recognise the aliased form **regardless of R3's
outcome** — other people's comments, and Jira's own UI, may already contain it. Reading is permissive; writing is
conservative.

---

## Required unit tests (red first — Article V)

**Round-trip (the NFR-002 invariant)**
- For each of the three flavours: `parseCommentMentions(buildMentionToken(person).raw)` yields one mention run whose
  identifier equals the person's. **This is the test that makes "agree by construction" executable.**

**Parse — wiki**
- Cloud token mid-sentence → `[text, mention, text]`.
- DC `[~jsmith]` → recognised as `name`/`key` flavour.
- Several mentions of several people → correct identifier for each, in order.
- Adjacent mentions with no text between → two mention runs, no empty text run.
- Malformed `[~]`, `[~accountid:]`, unclosed `[~foo` → text runs, verbatim (P3).
- An email address `mike@example.com` → a single text run (no `[~]`, so nothing to find).

**Parse — ADF (the FR-002 regression guard)**
- A mention node between two text nodes → three runs, **name not dropped**. *Fails against today's behaviour.*
- Nested mention inside a paragraph inside a doc → found.
- A mention node with `attrs.id` but no `attrs.text` → still a mention run (identifier is what matters).

**Build**
- Each flavour → the correct token.
- Unrecognised prefix, empty value, empty string → `null`.

**Extract**
- A draft with two mentions and prose → both tokens, in order.
- A draft with none → `[]`.

---

## Non-goals

- Rendering (`CommentBody` owns it) and lookup (the store owns it).
- Formatting beyond mentions — no bold, links, tables. Feature 008's out-of-scope decision stands.
- Changing `jiraMentions.ts`'s detection behaviour. It gains a shared import; the Mentions report must not shift
  (FR-022).
- Touching `richTextPlainText.ts` (R7 — five unrelated consumers) or
  `SprintDashboardView.normalizeCommentBody` (R4 — release-decision keyword matching, not display).
- **Obtaining names from server-rendered HTML (FR-006).** Asking Jira to render the body (`expand=renderedBody` /
  `renderedFields`) would resolve mentions for free and is the obvious shortcut to reach for if lookups ever feel
  slow. It is **prohibited**: feature 019 rejected it on HTML-sanitization grounds and FR-006 carries that rejection
  forward. If resolution performance becomes a problem, the answer is batching (see `mention-directory.md`), never
  server-rendered HTML.
