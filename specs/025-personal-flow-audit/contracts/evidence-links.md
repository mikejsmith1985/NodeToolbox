# Contract: Evidence Links

**Module**: `client/src/views/ReportsHub/flowAuditLinks.ts` (new, pure)
**Feature**: `025-personal-flow-audit` | **Satisfies**: FR-011, FR-011a, FR-012, FR-013, FR-015, FR-016, FR-018, SC-002, SC-009a

> **The one thing to get right in this feature.** Every other part can be imperfect and the document still helps. Get
> a link wrong and the document actively misleads — the number says one thing, the link returns another, and it looks
> authoritative either way.

---

## The problem this module exists to solve

The report's fetch query is a **deliberate superset** of what gets counted. From `buildSearchJql`'s own comment
(`PersonalFlowTab.tsx:258`):

> `assignee WAS` (not `=`) captures work she has since handed off; `updated >= -Nd` is a cheap superset — the engine
> does the exact windowing by each completed stint's end, so an over-broad fetch is harmless.

Harmless for **computing**. Not harmless for **linking**. Attaching that JQL to a credited count produces a link that
returns more issues than the number beside it — reintroducing precisely the count-vs-link mismatch feature 023
eliminated for the Hygiene tiles, and undermining this feature's entire premise.

---

## Three link kinds, one per claim

| Claim | Link kind | Built from |
|---|---|---|
| "N issues were **fetched** for this person" | the fetch JQL itself | `buildSearchJql(person, windowDays)` |
| "N issues were **credited**" | `issueKey in (…)` over credited keys | `buildJiraIssueNavigatorUrl(creditedKeys, baseUrl)` |
| "N issues were **excluded** as `<reason>`" | `issueKey in (…)` over that category's keys | `buildJiraIssueNavigatorUrl(reasonKeys, baseUrl)` |

Each returns **exactly its own number** — so every row of the `fetched = credited + excluded` reconciliation is
independently checkable, and the three together prove the accounting.

---

## Exports

### `buildFetchedIssuesLink(person, windowDays, baseUrl): EvidenceLink`

The query that actually ran. Uses `buildSearchJql` unchanged — never a reconstruction, or the displayed query could
drift from the executed one, which is the very drift that function was factored out to prevent.

### `buildCreditedIssuesLink(creditedKeys, baseUrl): EvidenceLink`

The issues behind every credited figure (throughput, cycle time, points).

### `buildExcludedIssuesLink(reasonKeys, baseUrl): EvidenceLink`

One per exclusion category, so a reader can confirm each exclusion was correct rather than taking the count on trust
(FR-018).

```ts
interface EvidenceLink {
  /** Navigator URL, or the raw JQL text when no base URL is configured. */
  href: string;
  /** The query text, always shown beside the link so it can be inspected or adapted (FR-013). */
  queryText: string;
  /** True when href is a real URL; false when it degraded to query text (FR-015). */
  isClickable: boolean;
}
```

---

## Guarantees

| # | Guarantee | Requirement |
|---|---|---|
| L1 | A credited-count link returns **exactly** the credited issues — never the fetched superset | FR-012, SC-002 |
| L2 | Every link is **per person**; no link spans the whole roster | FR-011a, SC-009a |
| L3 | Query text is always present, whether or not the link is clickable | FR-013 |
| L4 | With no base URL, `href` degrades to query text and `isClickable` is false — never a broken link | FR-015 |
| L5 | An empty key set yields a link that is honest about being empty, not a malformed query | edge cases |
| L6 | Links are absolute and work from a published page with Toolbox closed | FR-014 |

**L4 is free**: `buildJiraIssueNavigatorUrl` already returns the raw JQL string when `jiraBaseUrl` is null or the key
list is empty (`buildHygieneJqlUrl.ts:100`). This module surfaces that behaviour rather than reimplementing it.

**On L1 and issue-key lists**: a very large credited set produces a long `issueKey in (…)` clause. If that becomes
unwieldy, the answer is **not** to fall back to the fetch JQL — that silently breaks L1. Either keep the key list, or
state in the document that the link was omitted and why. A missing link is honest; a wrong one is not.

---

## Required unit tests (red first — Article V)

**The superset trap (the highest-value test in the feature)**
- Given a person whose fetch returned 20 issues of which 12 were credited: the credited link's query names **12
  keys**, and is **not** the fetch JQL. *This test fails if anyone ever "simplifies" the two link kinds into one.*

**Per link kind**
- Fetched link's query text equals `buildSearchJql(person, windowDays)` exactly — character for character.
- Credited link contains every credited key and no excluded key.
- One excluded link per reason, each containing only that reason's keys.

**Reconciliation**
- The three counts satisfy `credited + Σ excluded === fetched` for a representative fixture.

**Degradation**
- `baseUrl = null` → `isClickable === false`, `href === queryText`, and query text is still populated.
- Empty key set → no malformed `issueKey in ()` query is produced.

**Scoping**
- Two people in one roster produce disjoint credited links; neither contains the other's keys (L2).
