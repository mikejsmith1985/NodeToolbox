# Contract: US3 — Linked Issue → F2 Lookup (imperative open)

Covers FR-009..011, SC-003, NFR-003.

## Store: `useQuickLookupStore` (`components/QuickIssueLookup/quickLookupStore.ts`, NEW)

```ts
interface QuickLookupState {
  isOpen: boolean;
  seedKey: string | null;   // preset lookup key; null when opened via F2
  openNonce: number;        // bumped per open() so a repeat open re-seeds/re-focuses
  open: (seedKey?: string) => void;   // sets isOpen=true, seedKey=seedKey??null, openNonce++
  close: () => void;                  // isOpen=false, seedKey=null
}
```

## Gate change (`QuickIssueLookupGate.tsx`, EDIT — additive/behavior-preserving)

- Read `isOpen`/`seedKey`/`openNonce` from the store instead of local `useState`.
- The F2 `keydown` handler calls `open()` (no seed) — same guard/preventDefault as today; F2-while-open still resets.
- Pass `seedKey` to `<QuickIssueLookup key={openNonce} seedKey={seedKey} …/>`.
- Escape/close call `close()`.
- **Regression guard**: pressing F2 behaves exactly as feature 022 (open focused, honest states, recents, etc.).

## Popup change (`QuickIssueLookup.tsx`, EDIT)

- New optional prop `seedKey?: string`. When present, initialize `lookupKey` to it (so `useIssueByKey` loads it
  immediately) and prefill the search input; when absent, behaves exactly as today (idle → recents).

## Linked-issue trigger (`IssueDetailPanel/index.tsx` `renderIssueLinkRow`, EDIT — additive)

- The linked-issue key (currently a non-interactive `<span className={styles.linkKey}>`) becomes a focusable control
  (button/anchor) that calls `useQuickLookupStore.getState().open(linkedIssue.key)`.
- Keyboard-operable (Enter/Space). The originating view is not navigated away from; closing the lookup returns focus.
- Works on every host that renders the shared panel's linked issues (hygiene, AgileHub, quick lookup itself, …).

## Tests

- Unit: `quickLookupStore` — `open()` sets isOpen + null seed + bumps nonce; `open('ABC-1')` seeds the key;
  `close()` clears. Gate renders nothing until `isOpen`; opens on store `open`.
- Unit: `QuickIssueLookup` with `seedKey` immediately drives `useIssueByKey(seedKey)`.
- e2e (`linked-issue-lookup.spec.js`): open an issue with a link → click the linked key → the F2 lookup opens showing
  that linked issue; the underlying view is intact after closing.
