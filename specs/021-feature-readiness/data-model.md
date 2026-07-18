# Data Model: Feature Status & Readiness Workspace (021)

All types are client-side TypeScript in `client/src/views/ArtView/readiness/` unless noted.
No server or storage schema changes; no new persisted keys.

## ReadinessFeature

One Feature-type Jira issue as evaluated by the scan. Wraps the raw `JiraIssue` plus resolved
field readings so the panel never re-reads custom fields.

| Field | Type | Source |
|---|---|---|
| issue | JiraIssue | Jira search (raw, kept for detail panel / fix controls) |
| key, summary | string | issue fields |
| statusName | string | `fields.status.name` |
| statusBucket | 'todo' \| 'inProgress' \| 'done' | `classifyStatusBucket(issue)` |
| piName | string \| null | resolved PI field |
| assigneeDisplayName | string \| null | `fields.assignee` |
| productOwnerDisplayName | string \| null | first configured `productOwnerFieldIds` value |
| estimateValue | string \| null | first configured `estimateFieldIds` value (option unwrapped) |
| pcodeValue | string \| null | first configured `pcodeFieldIds` value |
| targetStartIso, targetEndIso | string \| null | configured target date fields |
| dueDateIso | string \| null | `fields.duedate` |
| ageDays | number \| null | days since `updated ?? created` |
| impedimentReasons | ImpedimentReason[] | `detectImpedimentReasons(issue)` (reused) |
| alerts | ReadinessAlertId[] | evaluated by the scan (below) |

## ReadinessLens

| Field | Type | Notes |
|---|---|---|
| id | 'carryover' \| 'current' \| 'upcoming' | deep-link token (`?readinessLens=`) |
| piNames | string[] | PI values this lens queried (current: 1; upcoming: 0–1; carryover: ≤4 older) |
| features | ReadinessFeature[] | lens membership per contract rules |
| countsByBucket | Record<'todo'\|'inProgress'\|'done', number> | derived from `features` only |
| refinedCount / unrefinedCount | number | upcoming lens only — bucket-based (todo = unrefined) |
| isPiConfigured | boolean | false ⇒ "no upcoming PI configured" (upcoming only) |
| isCoverageCapped | boolean | true when carryover hit the 4-PI cap (rendered as a note) |

**Lens membership rules** (normative copy in `contracts/readiness-scan.md`):
- current: PI field == selected PI.
- upcoming: PI field == next-newer PI name.
- carryover: PI field ∈ older PI names AND statusBucket ≠ 'done'.
- A feature can appear in at most one lens per evaluation (PI value decides); the listing labels
  which lens produced each row.

## ReadinessAlertId and predicates

| Id | Fires when | Fix kind |
|---|---|---|
| missing-ownership | assignee empty AND (PO field empty OR PO family unconfigured) | user search, dual target |
| missing-estimate | configured estimate field empty | value entry (editmeta-aware) |
| missing-pcode | configured PCode field empty | normalized numeric entry |
| target-end-missing-or-past | field empty OR date < today while statusBucket ≠ 'done' | date picker |
| due-date-missing-or-past | duedate empty OR date < today while statusBucket ≠ 'done' | date picker |

Family-level states (not per-feature): `notConfigured` (field family resolved to no id — alert
excluded from all counts, column renders "not checked — no matching field").

## ReadinessScanResult (the single evaluation — FR-010)

```
{
  lenses: { carryover, current, upcoming }: ReadinessLens,
  scannedFeatureCount: number | null,      // null = load failed; 0 = empty scope
  alertFamilyStates: Record<ReadinessAlertId, 'active' | 'notConfigured'>,
  loadError: string | null,
  scopeDescription: string                  // which JQL scope clause applied (projects/label/none)
}
```

Produced by ONE pure function `runReadinessScan(rawFeaturesByLens, config, selectedPiContext)`.
Counts, listings, and AI prompt scope all consume this object — nothing recomputes membership.

## HygieneFieldConfig additions (shared shipped type — additive only)

| Key | Default | Discovery names |
|---|---|---|
| estimateFieldIds | [] | 'Estimate (NF)', 'Estimate' |
| pcodeFieldIds | [] | 'Spark ID/PCode', 'Spark ID', 'PCode' |

Existing keys reused: `productOwnerFieldIds`, `targetStartFieldIds`, `targetEndFieldIds`.
No existing hygiene check reads the new keys — zero behavior change to hygiene surfaces.

## AI shapes (`readiness/ai/readinessAiAssist.ts`)

Reply envelope: `{ kind: 'featureReadiness', items: ReadinessAiItem[] }` via shared
`extractJsonPayload`.

```
ReadinessAiItem {
  issueKey: string,                 // must match a scanned feature; unknown keys reported, ignored
  estimateSuggestion?: string,      // writable on accept
  targetEndSuggestion?: string,     // ISO date, writable on accept
  dueDateSuggestion?: string,       // ISO date, writable on accept
  ownershipSuggestion?: string,     // display guidance ONLY — never writable
  insight?: string                  // narrative note — display only
}
```

Per-item accept state: `'pending' | 'accepted' | 'declined'`; accepted writes route through the
same `featureReviewFixes` writers as manual fixes, then the row refreshes.

## PCode normalization (pure)

`normalizePcodeInput(raw): { ok: true, value: string } | { ok: false, reason: string }`
- strips whitespace; accepts `^\d+$` as-is; accepts `^[Pp]0*(\d+)$` → captured digits;
  anything else ⇒ `{ok:false}` with a plain-language reason. No write attempted on failure.
