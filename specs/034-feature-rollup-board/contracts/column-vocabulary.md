# Contract: Column Vocabulary

**Modules**: `boardColumns.ts` (pure) · `boardVocabularyStore.ts` · `ColumnVocabularyEditor.tsx`

Covers FR-015 to FR-019, FR-024, FR-025. This is the feature's headline capability: the team's own status names,
each mapped to the compliant Jira status + sub-status pair it stands for.

---

## 1. Resolution — issue to column (pure)

```ts
const UNMAPPED_COLUMN_ID = '__unmapped__';

function resolveColumnIdForItem(
  statusName: string,
  subStatusValue: string | null,
  vocabulary: BoardVocabulary,
  hasSubStatusField: boolean,
): string
```

### Rules

1. **Exact pair match** — a column whose mapping matches both `jiraStatusName` and `subStatusValue`.
2. **Status-only match** — when `hasSubStatusField === false`, compare `jiraStatusName` alone (FR-025). The board
   states that sub-status precision is unavailable.
3. **No match** ⇒ `UNMAPPED_COLUMN_ID` (FR-024). The item is shown with its **raw** Jira status and sub-status.

### Explicitly forbidden

- **No nearest-guess.** A near-miss on sub-status resolves to `Unmapped`, never to the status-only column. Guessing
  would silently misplace exactly the items whose state is most in question.
- **No hiding.** There is no branch that omits an item.

### Comparison semantics

Trimmed, case-insensitive on both sides. Jira status names vary in casing between screens and a case difference is
never a real distinction.

### Contract tests

| Given | Then |
|---|---|
| Column mapped to `In Progress` + `Dev Complete`; item matches both | That column's id |
| Item in `In Progress` with sub-status `Code Review`; no column claims it | `UNMAPPED_COLUMN_ID` |
| `hasSubStatusField: false`; column mapped to `In Progress` (sub-status null); item in `In Progress` | That column's id |
| `hasSubStatusField: true`; item's sub-status is null; column requires `Dev Complete` | `UNMAPPED_COLUMN_ID` — never a partial match |
| Casing differs (`in progress` vs `In Progress`) | Matches |
| Vocabulary is empty | Every item resolves to `UNMAPPED_COLUMN_ID`; the board still renders |

---

## 2. Validation (pure)

```ts
function validateVocabulary(vocabulary: BoardVocabulary): VocabularyValidation
interface VocabularyValidation { isValid: boolean; errors: VocabularyError[] }
```

| Rule | Error | Requirement |
|------|-------|-------------|
| Two columns claim the same `(status, subStatus)` pair | `duplicate-mapping`, naming both columns | FR-018 — **refused**, never auto-deduplicated |
| Two columns share a name (case-insensitive) | `duplicate-name` | Ambiguity is the thing this feature removes |
| Column name is blank after trimming | `blank-name` | |
| `order` values are not a contiguous 0…n-1 sequence | normalised silently | Ordering is presentation, not user data |
| A column has no mapping | **not an error** (INV-15) | It holds nothing and says so |

Save is refused while `isValid === false`, with the reason shown. The editor never saves a partially-valid set.

### Contract tests

| Given | Then |
|---|---|
| Two columns mapped to `Done` + `null` | `duplicate-mapping` naming both; save refused |
| Two columns both named `In Dev` | `duplicate-name`; save refused |
| One column with no mapping | Valid |
| Orders `[0, 5, 9]` | Valid; normalised to `[0, 1, 2]` |

---

## 3. Option sourcing for the editor (FR-017)

The editor offers only values Jira will accept — never free text.

| Value | Source |
|-------|--------|
| Jira status names | The distinct `fields.status.name` values across the in-scope issue set, plus the `to.name` of every available transition already fetched for those issues |
| Sub-status values | `fetchFeatureReviewEditMeta(issueKey).allowedValues` for the discovered sub-status field, sampled across in-scope issues and unioned |

**Instance constraint**: this Jira deployment removed the legacy full `createmeta`, so a single global options call is
not available. Options are therefore assembled from per-issue metadata over the issues actually in scope — the same
layered approach the GitHub email intake uses for its sub-status options.

**When no in-scope issue exposes the sub-status field**, the editor says so and offers status-only mapping (FR-025).
It does **not** fall back to a text input, because a value Jira rejects would fail at the moment of a card move — the
worst possible time to discover it.

---

## 4. Storage and scope

```
localStorage key: `tbxRollupBoardVocabulary`
shape:            Record<teamProfileId, BoardVocabulary>
```

- Scoped to the **team profile**, never to the person (FR-019).
- The local copy is a mirror; the shared copy is the Confluence property (see `vocabulary-sync.md`).
- `lastSyncedAt` is stored so the board can state which vocabulary it is using and how current it is (FR-019c).

### Contract tests

| Given | Then |
|---|---|
| Vocabulary saved for team A | Team B's board is unaffected |
| Corrupt JSON in localStorage | Reads as empty; the board renders with all items `Unmapped` and does not throw |
| A vocabulary is edited | `updatedAt` advances; `lastSyncedAt` does **not** |

---

## 5. Field discovery (additive change to `hygieneFieldConfig.ts`)

Two new families join `loadHygieneFieldConfig`, following the 021 Readiness precedent (configured-first, then
name-matched, empty ⇒ the feature degrades and says so):

```ts
subStatusFieldIds: matchFieldIdsByName(availableFields, ['Sub-Status', 'Sub Status', 'Substatus']),
flaggedFieldIds:   matchFieldIdsByName(availableFields, ['Flagged', 'Impediment']),
```

**Non-negotiable**: both default to `[]` when the instance has no such field. An empty `subStatusFieldIds` triggers
FR-025's stated degradation — it must never resolve to a hardcoded `customfield_10201`, which is this instance's
configuration and not a platform constant.

### Regression requirement

`hygieneFieldConfig.test.ts` and `hygieneChecks.test.ts` must pass **unmodified**. If either needs editing, the change
was not additive and must be reworked, not accommodated.
