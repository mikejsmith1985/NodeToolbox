# Contract: Recents Store

Covers FR-002a and the *Recents list* entity. Clones the app's existing recents precedent
(`store/settingsStore.ts` `buildRecentViews`; `store/todoStore.ts` localStorage mirror). Zero new dependencies.

## Store: `useRecentIssuesStore` (`client/src/store/recentIssuesStore.ts`)

State:
```ts
type RecentIssue = { key: string; summary: string };
interface RecentIssuesState {
  entries: RecentIssue[];              // most-recent-first, max 5
  recordRecent: (entry: RecentIssue) => void;
}
```

## Pure reducer (red-first tested)

`buildRecentIssues(list, entry) → RecentIssue[]`:
- Prepend `entry`.
- De-dupe by `key` (case-insensitive on the normalized key): an already-present key **moves to top**, keeping the
  latest `summary`.
- `slice(0, MAX_RECENT_ISSUE_COUNT)` where `MAX_RECENT_ISSUE_COUNT = 5`.

## Persistence

- Key: `localStorage['tbxRecentIssueKeys']` (JSON array of `RecentIssue`).
- Seed `entries` from storage on store creation (`try/catch`, tolerate malformed/missing → `[]`).
- Mirror to storage on every `recordRecent` (`try/catch`, silent on failure — matches house convention; no `persist`
  middleware).
- **Client-only, never synced to the server.** Disposable convenience data (spec clarification: "ephemeral, not
  synced").

## Interaction

- `recordRecent` is called by `useIssueByKey` on a successful (`loaded`) fetch.
- `RecentIssuesList` reads `entries` to render the pre-search list; selecting one triggers a fetch for its `key`.

## Test cases (unit)

| Case | Expectation |
|------|-------------|
| Add to empty | `[entry]` |
| Add 6 distinct | length 5, oldest dropped |
| Re-add existing key | moves to top, no duplicate, summary updated |
| Malformed localStorage | seeds `[]`, no throw |
| Storage write throws | state still updates in memory, no throw |
