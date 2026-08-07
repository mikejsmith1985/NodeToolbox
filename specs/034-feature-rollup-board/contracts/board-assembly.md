# Contract: Board Assembly

**Modules**: `rollupBoardFetch.ts` (I/O) · `featureRollup.ts` (pure) · `defectRollup.ts` (pure)

Covers FR-001 to FR-010, FR-037, FR-055 to FR-057. The two pure modules carry all the judgement; the fetch module
carries only retrieval and honest failure reporting.

---

## 1. Fetch — `rollupBoardFetch.ts`

### Three sweeps, in order

| # | Sweep | Request | Chunking | Failure behaviour |
|---|-------|---------|----------|-------------------|
| 1 | Board issues | `GET /rest/agile/1.0/board/{boardId}/issue?fields=…&startAt=…&maxResults=…` | page until `startAt + maxResults >= total` | **Fatal.** The board cannot render a partial scope silently. |
| 2 | Sub-tasks | `GET /rest/api/2/search?jql=parent in (<board issue keys>)` | 50 parent keys per chunk | **Reported, not swallowed.** A failed chunk sets `isComplete: false` and names the missing parents. |
| 3 | Features | `GET /rest/api/2/search?jql=key in (<resolved feature keys>) ORDER BY key ASC` | 50 keys per chunk | **Reported.** Unreadable Features still get a Master Card (INV-10). |

**Sweep 2 exists because board issues do not include sub-tasks.** Verified: no client fetch requests `subtasks`, and
the agile board endpoint returns board issues only. Mirror `plannerFetch.fetchSubtasksForParents` for the chunking
shape — but **not** its error handling.

> **Deliberate divergence from the planner precedent.** `plannerFetch` swallows per-chunk failures so enrichment
> never fails a run. That is correct for a planner and wrong here: FR-055 forbids a silently short board, and SC-005
> promises nothing is hidden. Chunk failures must reach `LoadCompleteness.failures` and be shown.

### Fields requested

Sweeps 1 and 2 request, at minimum:

```
summary, status, priority, issuetype, assignee, created, updated,
fixVersions, issuelinks, labels, parent,
customfield_10021,                 // flagged — feeds detectImpedimentReasons
<configured feature-link field>,   // loadConfiguredFeatureLinkFieldId()
<discovered sub-status field>,     // '' ⇒ omitted; FR-025 degradation
<story-points candidate fields>    // getStoryPointsCandidateFieldIds()
```

Sweep 3 additionally requests the Feature's own story points and priority.

### Size behaviour

- **Never truncate** (FR-055). `maxResults` bounds a *page*, never the set.
- Past `EXPECTED_BOARD_ISSUE_CEILING` (300), continue loading and set a `isOversized` warning (FR-056).

### Contract tests

| Given | Then |
|---|---|
| Board reports `total: 250`, pages of 100 | 3 requests issued; 250 items returned; `isComplete: true` |
| Board reports `total: 250`, page 2 rejects | Load fails loudly; **no** partial board is rendered |
| 120 board issues | Sub-task sweep issues exactly 3 chunked requests |
| One sub-task chunk rejects | `isComplete: false`; `failures` names stage `subtasks`; the other chunks' items are still present |
| Sub-status field id is `''` | The field is absent from the request; no `undefined` appears in the field list |
| 420 board issues | All 420 returned; `isOversized: true` |

---

## 2. Feature resolution — `featureRollup.ts` (pure)

```ts
function resolveFeatureRollup(
  item: JiraIssue,
  index: RollupIndex,          // key → issue, for both board issues and sub-tasks
  featureLinkFieldId: string,
): RollUpRoute
```

### Rules, in order

1. **Sub-task** (`issuetype.subtask === true`, or a populated `parent` in this instance's classic scheme):
   resolve the **parent's** Feature and prepend a `{kind:'parent'}` step (FR-004).
   - Parent not in `index` ⇒ route still resolves through the parent key, and the container header marks the parent
     out of scope (FR-037). No parent card is drawn.
2. **Defect** (`issuetype.name === 'Defect'`, case-insensitive): delegate to `defectRollup` (§3).
   - Note: this instance uses **"Defect"**, not "Bug". Matching must be configurable-tolerant but must not
     silently treat an unknown type as a defect.
3. **Anything else**: `extractFeatureKeyFromIssueFields(fields, featureLinkFieldId)` — one hop, reusing
   `featureLink.ts` unchanged, with a `{kind:'featureLink'}` or `{kind:'parent'}` step.
4. **No key resolved** ⇒ `featureKey: null` ⇒ the No Feature Master Card (FR-008).

### Contract tests

| Given | Then |
|---|---|
| Story with the configured Feature Link field set | `featureKey` matches; one `featureLink` step naming the field id |
| Story with only Epic Link set | Resolves via the Epic Link fallback |
| Sub-task whose parent Story links to a Feature | Route is `parent` → `featureLink`; `featureKey` is the Story's Feature |
| Sub-task whose parent is not in scope | `featureKey` still resolves; parent marked out of scope |
| Story with nothing set | `featureKey: null`; `steps: []` |
| Feature lives in another project | Resolution is unaffected — no project comparison occurs anywhere |

---

## 3. Defect precedence — `defectRollup.ts` (pure)

The FR-005 chain. This module exists because `featureLink.ts` resolves one hop and this is a walk.

```ts
function resolveDefectRollup(
  defect: JiraIssue,
  index: RollupIndex,
  featureLinkFieldId: string,
): RollUpRoute
```

### Precedence, strictly ordered — first match wins

| Rank | Route | Test |
|------|-------|------|
| 1 | **`dev-story`** | Any `issuelinks` entry resolving to an in-scope issue whose type is Story (or Task) that itself resolves to a Feature |
| 2 | **`via-qa-issue`** | Any linked in-scope issue that is **not** a Story but which links onward to a Story that resolves to a Feature. The intermediate is named in the route (FR-006, US3 scenario 6) |
| 3 | **`direct-feature`** | Any linked issue that **is** a Feature, or a populated Feature Link field on the defect itself |
| 4 | — | No match ⇒ `featureKey: null` ⇒ No Feature |

### Determinism rules

- **Tie-break within a rank**: ascending issue key. Two candidates at the same rank must never produce a
  render-order-dependent placement.
- **Loop safety**: a `visited` set of keys; re-entering a key terminates that branch and appends the note
  `link-loop-detected` (spec edge case), which the card surfaces as a hygiene note.
- **Depth cap**: rank 2 walks **one** intermediate hop only. Deeper chains are not searched — the defect falls to
  rank 3 or 4. (Unbounded walking would make placement unexplainable, defeating "impossible to misread".)
- **`unchosenCandidates` is complete**: every candidate examined at every rank, including those the tie-break
  rejected, with its own resolved Feature. FR-007 forbids dropping any.

### Contract tests

| Given | Then |
|---|---|
| Defect linked to a dev Story that has a Feature | `precedenceRank: 'dev-story'` |
| Defect linked to a QA issue that links to a Story with a Feature | `'via-qa-issue'`; the QA issue key appears in `steps` |
| Defect linked to both a QA issue **and** a dev Story | `'dev-story'` wins; the QA route appears in `unchosenCandidates` |
| Defect linked directly to a Feature only | `'direct-feature'` |
| Defect linked to two Stories under **different** Features | Lower key wins deterministically; the other Feature appears in `unchosenCandidates` (spec edge case) |
| Defect → QA → the same defect | Terminates; `notes` contains `link-loop-detected`; no stack overflow |
| Defect linked to a Story two hops from any Feature | Falls through to rank 3/4 — the depth cap holds |
| Defect with no links | `featureKey: null` |

---

## 4. Master Card grouping

```ts
function buildMasterCards(items: RollupBoardItem[], featureIssues: Map<string, JiraIssue>): MasterCard[]
```

- One card per distinct `featureKey`, plus exactly one synthetic **No Feature** card when any item is unattributed.
- The No Feature card states its count and is marked as a hygiene problem (FR-008) and offers the same per-card
  actions as any other (FR-009).
- A Feature key present but unreadable ⇒ card with `isFeatureUnreadable: true`, never folded into No Feature.
- A Feature with **zero** in-scope items produces **no** card (spec edge case — board scope is the team's board, not
  the Feature backlog).

### Contract tests

| Given | Then |
|---|---|
| 10 items across 3 Features, 2 unattributed | 4 cards; the No Feature card reports 2 |
| 10 items, all attributed | 3 cards; **no** No Feature card is rendered |
| Feature key resolved but missing from `featureIssues` | A card exists, keyed, flagged unreadable |
| Sum of `items` across all cards | Equals the resolved item count exactly — no loss, no duplication (SC-001) |
