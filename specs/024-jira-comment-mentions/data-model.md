# Phase 1 Data Model: Jira-Native @-Mentions in Toolbox Comments

**Feature**: `024-jira-comment-mentions` | **Date**: 2026-07-22 | **Plan**: [plan.md](./plan.md)

Four entities. All client-side and in-memory; nothing is persisted (FR-007a) and no server schema changes.

---

## 1. `MentionFlavour`

The instance's identifier form, derived from data already in hand — never configured, never probed (R2).

```ts
type MentionFlavour = 'accountId' | 'name' | 'key';
```

| Flavour | Instance | Token form | Source |
|---|---|---|---|
| `accountId` | Jira Cloud | `[~accountid:<value>]` | `FeatureReviewUserCandidate.userIdentifier` prefix |
| `name` | Data Center (username) | `[~<value>]` | same |
| `key` | Data Center (user key) | `[~<value>]` | same |

**Validation**: a `userIdentifier` without a recognised prefix, or with an empty value after the first `:`, yields no
token — the person is not insertable and the picker must not offer them. `readFeatureReviewUserIdentifier`
(`featureReviewFixes.ts:82`) already returns `''` in that case and `normalizeFeatureReviewUserCandidates` filters it
out, so this is inherited, not re-implemented.

---

## 2. `MentionToken`

One mention as stored in a comment body — the write side's output and the read side's input.

```ts
interface MentionToken {
  /** Which identifier form this instance uses. */
  flavour: MentionFlavour;
  /** The identifier value, WITHOUT the flavour prefix (e.g. '557058:ab-12', 'jsmith'). */
  identifier: string;
  /** The exact literal text as it appears in / will be written to the body. */
  raw: string;
}
```

**Invariant (NFR-002)**: `parse(build(person)).identifier === identifierOf(person)` for every flavour. This round-trip
is the executable form of "read and write agree by construction" and is a required unit test.

**Note on `raw`**: kept so the renderer can substitute in place without re-deriving, and so an unrecognised token
survives untouched (the "mention pasted from elsewhere" edge case — Toolbox must not corrupt it).

---

## 3. `MentionRun`

The parse output: a comment body becomes an ordered list of runs. This is what `CommentBody` renders.

```ts
type MentionRun =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; token: MentionToken };
```

**Why a run list and not string replacement**: a mention must render as a *distinguishable element* — it needs a
loading state, an unresolvable state, and self-mention emphasis (FR-021). A string substitution cannot carry that.

**Validation rules**:
- Concatenating every run's source text reproduces the original body exactly. No characters invented or dropped.
- A body with no mentions yields exactly one `text` run — the common case stays cheap.
- **ADF bodies** are walked to produce runs, so a `mention` node becomes a `mention` run instead of vanishing (FR-002,
  root cause at `richTextPlainText.ts:18` — R7). This walker lives in the new module; the shared normalizer is not
  touched.

---

## 4. `DirectoryEntry`

One person in the session directory. The **tri-state is the load-bearing design decision** — it is what makes Q4's
"still loading ≠ cannot be identified" representable rather than merely intended.

```ts
type DirectoryEntry =
  | { status: 'resolved'; displayName: string }
  | { status: 'pending' }
  | { status: 'unresolvable' };
```

| Status | Renders as | Terminal? |
|---|---|---|
| `resolved` | the display name | yes |
| `pending` | neutral **loading marker** (FR-005a) | no — becomes `resolved` or `unresolvable` |
| `unresolvable` | **"@unknown user"** placeholder (FR-004) | yes |

**If this were a two-state `string \| null`, FR-005a would be unimplementable** — `null` would have to mean both "not
yet" and "never", which is exactly the conflation Q4 rejected and FR-007b forbids re-introducing.

**State transitions**:

```
(absent) ──seed from payload──▶ resolved          [free, no request]
(absent) ──lookup starts─────▶ pending
pending  ──lookup succeeds───▶ resolved
pending  ──lookup fails/404──▶ unresolvable
```

`resolved` and `unresolvable` are terminal for the session. There is no expiry or invalidation (FR-007a) — the store
dies with the page, so it can never be stale.

**Store shape**:

```ts
interface MentionDirectoryState {
  entriesByIdentifier: Record<string, DirectoryEntry>;
  /** Records names already on hand (comment authors, assignees, reporters) — costs no request. */
  seedFromUsers(users: Array<{ userIdentifier: string; displayName: string }>): void;
  /** Ensures every identifier resolves, with bounded concurrency and in-flight de-duplication. */
  resolveMissing(identifiers: string[]): void;
}
```

**Keying**: by the **prefixed** `userIdentifier` (`accountId:557058:ab-12`), not the bare value. Two flavours could
otherwise collide — a DC username and a user key are both bare strings — and the prefix makes every key
self-describing at a glance during debugging.

**Validation rules**:
- `resolveMissing` MUST skip identifiers already `resolved`, `unresolvable`, or `pending` (FR-007 — never re-request).
- At most `MAX_CONCURRENT_LOOKUPS` in flight at once (FR-007b).
- Every identifier passed in MUST eventually reach a terminal state — no silent dropping, or a loading marker would
  spin forever (SC-007's second structural guarantee).
- Nothing written to `localStorage` or any durable store (FR-007a, NFR-004).

---

## 5. `PickerCandidate`

One row in the `@` type-ahead. Deliberately **the existing `FeatureReviewUserCandidate`**, unchanged:

```ts
interface FeatureReviewUserCandidate {   // client/src/views/SprintDashboard/featureReviewFixes.ts:46
  userIdentifier: string;   // 'accountId:…' | 'name:…' | 'key:…'
  displayName: string;
}
```

**No new type is introduced.** This shape already carries everything both halves need — the display name for the list
and the flavour-encoded identifier for the token — which is why R1 chose this search.

**Gap noted for `/speckit-tasks`**: SC-004 requires distinguishing two colleagues with the same display name, and this
shape carries **no email**. The raw response has one (`searchUsers` surfaces `emailAddress`), but
`normalizeFeatureReviewUserCandidates` (`featureReviewFixes.ts:98`) drops it. Options, in preference order:

1. Add an optional `emailAddress?: string` to `FeatureReviewUserCandidate` and carry it through the normalizer —
   additive, benefits the four existing callers, no behaviour change for anyone who ignores it.
2. Disambiguate by showing the identifier tail — works, but exposes machine identifiers in the UI, against the spirit
   of the feature.

**Option 1 is recommended.** It is a two-line additive change to a shared shape, and SC-004 is otherwise unmet.

---

## Entity relationships

```
FeatureReviewUserCandidate ──build──▶ MentionToken ──serialised into──▶ comment body (string | ADF)
                                                                              │
                                                                            parse
                                                                              ▼
                                                                        MentionRun[]
                                                                              │
                                          MentionToken.identifier ──lookup──▶ DirectoryEntry
                                                                              │
                                                                            render
                                                                              ▼
                                                    name │ loading marker │ "@unknown user"
```

The cycle closes on `MentionToken`: the same module builds it and parses it, from the same table. That is NFR-002 —
not a rule to remember, but a property of the shape.
