# Contract: Mention Directory Store

**Module**: `client/src/store/mentionDirectoryStore.ts` (new, Zustand)
**Feature**: `024-jira-comment-mentions` | **Satisfies**: FR-004, FR-005, FR-005a, FR-007, FR-007a, FR-007b, NFR-004, SC-007

---

## Responsibility

Hold the session's identifier→name map and resolve what is missing, so `CommentBody` can render a name synchronously
whenever one is known and never blocks on one that is not.

**Explicitly not persisted.** No `persist` middleware, unlike `settingsStore` and `recentIssuesStore`. This is a
deliberate FR-007a decision — a session-scoped store can never go stale, so the feature needs no expiry policy, no
invalidation rule, and writes no directory data to disk (NFR-004). **A comment at the store definition must say this**,
or a later reader will "improve" it by adding persistence and silently introduce staleness.

---

## State

```ts
interface MentionDirectoryState {
  entriesByIdentifier: Record<string, DirectoryEntry>;
  seedFromUsers(users: Array<{ userIdentifier: string; displayName: string }>): void;
  resolveMissing(identifiers: string[]): void;
}
```

Keyed by the **prefixed** identifier (`accountId:557058:ab-12`) — see [data-model](../data-model.md#4-directoryentry).

`DirectoryEntry` is tri-state (`resolved` / `pending` / `unresolvable`). A two-state `string | null` cannot express
FR-005a, because `null` would mean both "not yet" and "never" — the exact conflation Q4 rejected.

---

## `seedFromUsers(users)` — the free path

Records names the app already has. Every issue payload carries `assignee`, `reporter`, and `comment.author` objects
pairing an identifier with a display name; recording them costs **zero requests** (FR-007).

**Rules**:
- Only ever writes `resolved`. Seeding never creates `pending` or `unresolvable`.
- Never downgrades an existing `resolved` entry.
- Ignores entries with an empty identifier or display name.
- Idempotent — re-seeding the same users changes nothing.

**Callers**: `CommentThread` seeds from `comment.author` for the thread it is about to render, before requesting
anything. On a typical thread this alone resolves most mentions, because people who are mentioned are usually also
people who comment.

---

## `resolveMissing(identifiers)` — the residue path

Ensures every identifier reaches a terminal state, with the request burst bounded.

**Algorithm**:
1. Filter to identifiers with **no entry** — skip `resolved`, `unresolvable`, **and `pending`**. The `pending` skip is
   the in-flight de-duplication FR-007 requires: two comments mentioning the same unknown person must produce **one**
   request.
2. Mark each remaining identifier `pending` **before** any request starts, so a concurrent call sees them.
3. Drain the queue with at most `MAX_CONCURRENT_LOOKUPS` in flight (FR-007b).
4. On success → `resolved`. On failure, 404, or an empty result → `unresolvable`.

```ts
// Bounds the request burst when one thread mentions many unknown people (FR-007b).
// Matches the chunking approach already used for label searches in jiraApi.ts.
const MAX_CONCURRENT_LOOKUPS = 4;
```

**Guarantees**:
| # | Guarantee | Requirement |
|---|---|---|
| D1 | Every identifier passed in reaches `resolved` or `unresolvable` — none stays `pending` forever | SC-007 structural guarantee |
| D2 | No identifier is requested twice in a session | FR-007 |
| D3 | Never more than `MAX_CONCURRENT_LOOKUPS` in flight | FR-007b |
| D4 | **No cap on how many are resolved** — bounded concurrency, not a bounded total | FR-007b |
| D5 | A failed lookup never blocks the others | edge cases |
| D6 | Nothing written to durable storage | FR-007a, NFR-004 |

**D4 is the trap FR-007b names explicitly.** Capping the *total* looks like a reasonable optimisation and would leave
resolvable people showing `@unknown user` — the terminal "cannot be identified" state — which undoes Q4's whole point.
Bound the rate, never the set.

---

## Lookup transport

Per-identifier user fetch through the existing proxy, flavour-appropriate:

| Flavour | Path |
|---|---|
| `accountId` | `/rest/api/2/user?accountId=<value>` |
| `name` | `/rest/api/2/user?username=<value>` |
| `key` | `/rest/api/2/user?key=<value>` |

Via `jiraGet` (`client/src/services/jiraApi.ts:128`), so proxying, auth, error normalisation, and API-event tracking
are inherited.

> ⚠️ **NFR-004a — inherited tracking records the identifier.** `trackApiCall` calls `emitApiEvent({ method, url, … })`
> for every request, and these lookup URLs carry a person's identifier in the query string. That identifier therefore
> enters the API event stream by construction. This is **not automatically a violation** — it is the same exposure
> every other Jira call already has — but NFR-004a requires it to be an explicit recorded decision rather than an
> accident. Settle it during implementation (task T039) and record the outcome here. Display names, which are *not*
> in the URL, must never reach logs either way.
>
> **DECISION (2026-07-22, T039): accepted as-is; no exclusion added.** Reasoning: (a) the identifier is already
> present in the API event stream for every other Jira call the app makes — issue fetches, assignee writes, the user
> *search* that backs the picker — so excluding only these lookups would remove nothing an observer could not
> already see; (b) the event stream is in-memory and developer-facing, not a durable log; (c) **display names never
> appear** — they exist only in the response body, which `emitApiEvent` does not record. Verified by inspection:
> `jiraApi.ts:116` records `{ method, url, status, durationMs, errorMessage }` only. Adding an exclusion would have
> introduced a special case in shared transport code for no privacy gain. Revisit if the event stream ever becomes
> durable or is shipped off-device.

**Permitted optimisation (FR-007b, not required)**: where the instance offers a bulk endpoint
(`/rest/api/2/user/bulk?accountId=…&accountId=…`), batching several identifiers per request is allowed. Bounded
concurrency remains the requirement either way. Do not adopt this without confirming the endpoint exists on the target
instance — the same evidence standard as R3.

**Failure is normal, not exceptional.** A deactivated user or one outside the viewer's directory visibility yields
`unresolvable`, which renders as the FR-004 placeholder. It must never surface an error to the reader or block the
thread (edge case: "No permission to view the directory").

---

## Required unit tests (red first — Article V)

The reducer is pure and fully testable with a mocked fetch — no browser, no Jira.

**Seeding**
- Seeds a user → `resolved`. Re-seeding → no change. Empty identifier/name → ignored.
- Seeding does not overwrite an existing `resolved` name.

**De-duplication (D2)**
- `resolveMissing(['a','a','a'])` → one request.
- `resolveMissing(['a'])` twice, second call while the first is `pending` → still one request.
- Identifiers already `resolved` or `unresolvable` → zero requests.

**Concurrency (D3, D4)**
- 12 identifiers with `MAX_CONCURRENT_LOOKUPS = 4` → never more than 4 in flight, and **all 12 resolve** (D4 —
  the anti-capping test).

**Terminal states (D1, D5)**
- Success → `resolved`. 404 → `unresolvable`. Network error → `unresolvable`. Empty body → `unresolvable`.
- One failure among several → the others still resolve.
- After every settled promise, no entry remains `pending`.

**Persistence (D6)**
- No `localStorage`/`sessionStorage` write occurs during any operation. *(Guards against a later "improvement".)*
