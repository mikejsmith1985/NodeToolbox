# Phase 1 Data Model: PO Tool — Feature Splitter & Feature Composition

**Feature**: `017-po-feature-tools` | **Date**: 2026-07-15 | **Plan**: [plan.md](./plan.md)

All entities are **client-side**. Nothing here is persisted server-side. Two families:

- **Persisted drafts** (`localStorage`, survive sessions until commit) — FR-042…FR-048.
- **Transient** (in-memory, rebuilt per render/run) — proposals, diffs, checklists.

Shapes below are the design intent; exact types land with the code.

---

## 1. Persisted — draft storage

### Storage keys (FR-043)

| Draft | Key |
|-------|-----|
| PO Tool selection | `tbxPoToolSelection` *(the tool's own team/PI — R1; **never** the app-wide active id)* |
| Split draft | `tbxPoFeatureSplitDraft:<profileId>:<sourceFeatureKey>` |
| Composition draft | `tbxPoFeatureCompositionDraft:<profileId>:<scopeKey>` |

`<profileId>` resolves through the existing team-scoped helper (blank → `legacy-default`).
Composition `<scopeKey>` = the existing Jira key when updating, else a stable minted `new:<id>` — so returning to the
same in-progress composition resumes **one** draft (FR-043).

### Shared draft envelope (R7)

Every draft is **self-describing** — it carries its own identity so a save call needs no key argument, and a
mis-filed entry self-corrects on read (identity is taken from the **arguments**, never the payload).

```ts
interface PoDraftEnvelope {
  schemaVersion: number;   // stamped on write; normalize-on-read defaults field-by-field
  profileId: string;
  scopeKey: string;
  updatedAtIso: string;    // caller stamps — pure modules never read the wall clock
}
```

**Lifecycle rules** (FR-044…FR-047):

- **Load never throws.** Absent / unparseable / wrong-shape → an **empty draft** (FR-046).
- **Save silently no-ops** when storage is blocked; the in-memory draft stays authoritative for the session.
- **Availability is surfaced** to the tab so it can **warn** that drafts won't survive a reload (FR-047). *This is
  the one deliberate divergence from the canvas overlay pattern, which fails silently — see research R7.*
- **A draft is never a Jira write** (FR-044). Cleared on **successful** commit; **retained** on partial/failed
  (FR-045). Explicitly discardable (FR-048).

### `SplitDraft`

```ts
interface SplitDraft extends PoDraftEnvelope {
  sourceFeatureKey: string;
  sourceSnapshot: SourceFeatureSnapshot;   // what was loaded, for drift detection at commit
  targetProjectKey: string;                // defaults to the original's project (FR-016c)
  increments: ProposedIncrement[];
  linkTypeName: string;                    // default 'relates to'; chosen from live discovery (R3)
}
```

### `CompositionDraft`

```ts
interface CompositionDraft extends PoDraftEnvelope {
  existingIssueKey: string | null;         // null ⇒ create-new (FR-035); set ⇒ update (FR-036)
  targetProjectKey: string | null;         // required when existingIssueKey is null
  targetIssueTypeId: string | null;        // resolved from createmeta for the chosen project
  fields: Record<string, unknown>;         // the authored Feature draft (FR-025)
  sources: ReferencedSource[];             // FR-023/FR-024
  poNarrative: string;                     // the PO's own wording, fed to the AI prompt (FR-031)
}
```

---

## 2. Entities

### `SourceFeatureSnapshot` — the loaded original (FR-007, R4)

```ts
interface SourceFeatureSnapshot {
  key: string;
  projectKey: string;          // from fields.project — needed for createmeta (R4)
  issueTypeId: string;         // the original's OWN type id — increments echo it (A17, FR-016)
  issueTypeName: string;
  summary: string;
  description: string;
  fields: Record<string, unknown>;   // hygiene-relevant fields, verbatim
  loadedAtIso: string;
}
```

> **Why `projectKey` + `issueTypeId` together**: both come from **one** `jiraGet(..., fields=project,issuetype,…)`.
> Required-field discovery is keyed by project key, so fetching both at once avoids a second round-trip (R4).

### `ProposedIncrement` — one smaller peer Feature (FR-009, FR-020)

```ts
interface ProposedIncrement {
  localId: string;             // stable client id; NOT a Jira key (none exists until commit)
  summary: string;
  description: string;
  fields: Record<string, unknown>;
  origin: 'manual' | 'ai';
  isAccepted: boolean;         // AI-proposed ⇒ false until the PO accepts (FR-020)
  createdJiraKey: string | null;   // set after a successful commit; drives retry-on-partial (FR-045)
}
```

**Rules**: manual increments are `origin:'manual'`, `isAccepted:true`. AI-proposed land `isAccepted:false` and are
individually acceptable, rejectable, and **editable** (FR-020, SC-010). An increment with `createdJiraKey` set is
**not re-created** on a retry.

### `ReferencedSource` — one artifact in the workspace (FR-023, FR-024)

A discriminated union; every variant carries its **origin** so the PO can always see where it came from (FR-024).

```ts
type ReferencedSource =
  | { kind: 'confluence'; id: string; title: string; pageUrl: string; pageId: string; text: string; fetchedAtIso: string }
  | { kind: 'workbook';   id: string; fileName: string; sheetName: string; availableSheetNames: string[]; rows: Record<string,string>[] }
  | { kind: 'jira';       id: string; issueKey: string; summary: string; status: string }
  | { kind: 'paste';      id: string; label: string; text: string };
```

**Notes**:

- `confluence.pageUrl` is retained as a reference link even though content is fetched (FR-024). `text` is the
  **stripped** storage HTML (R2c) — not raw markup, and never injected as HTML.
- `workbook.availableSheetNames` exists so a multi-sheet file doesn't silently surface only the first (spec edge
  case); `sheetName` is the one being referenced.
- A workbook is **reference material** — no row ever becomes an issue (spec non-goal).

### `HygieneChecklistEntry` — derived, advisory (FR-012, FR-027, FR-028)

```ts
interface HygieneChecklistEntry {
  checkId: string;            // the engine's own check id
  label: string;              // the engine's own label
  severity: 'warn' | 'error';
  isSatisfied: boolean;
}
```

Derived by calling the **existing** evaluator over the draft-as-issue. **Not persisted** — always recomputed, so it
can never go stale against edits (FR-027).

> **FR-028 is free**: the engine already **skips** checks whose configured field list is empty, so an unconfigured
> field never false-flags. This requires correct wiring, not new logic (R8).

### `CommitDiff` — the review step (FR-013, transient)

```ts
interface CommitDiff {
  creates: { localId: string; projectKey: string; issueTypeId: string; summary: string; fields: Record<string, unknown> }[];
  updates: { issueKey: string; changedFields: { fieldId: string; label: string; before: unknown; after: unknown }[] }[];
  links:   { fromLocalId: string; toIssueKey: string; linkTypeName: string }[];
  blockingIssues: { scope: string; missingRequiredFields: string[] }[];   // FR-034 — non-empty ⇒ commit disabled
  sourceDriftWarnings: string[];                                          // original changed since load (edge case)
}
```

**Rule**: the diff is built **purely** and shown in full before any write (FR-013). A non-empty `blockingIssues`
**disables** commit — no partial creates (FR-034, SC-008).

### `CommitOutcome` — per-item result (FR-015, FR-041)

```ts
interface CommitOutcome {
  items: {
    scope: string;                       // localId | issueKey | 'link:A→B'
    status: 'created' | 'updated' | 'linked' | 'failed' | 'skipped';
    jiraKey?: string;
    failureReason?: string;              // the instance's ACTUAL rejection reason (FR-041)
  }[];
  isFullySuccessful: boolean;            // drives draft clear-vs-retain (FR-045)
}
```

**Link semantics (R3)**: links are **best-effort** — a failed link is reported as `status:'failed'` but **never**
throws and never undoes a successful create. Jira has no transaction; a thrown link error would strand a created
issue with no record. This mirrors the server's proven create-then-link implementation.

### `AiProposal` — transient, gated (FR-018…FR-021, FR-032)

```ts
interface AiIngestResult<TItem> {
  items: TItem[];       // valid items — land unaccepted
  errors: string[];     // per-item, human-readable; partial success is the point (R6)
}
```

**Rules**: a wrong `kind` is rejected outright (SC-009). Business-invalid **items** become `errors` while good ones
survive — a PO must not lose four good increments to one bad field (R6). Unknown Jira keys are filtered against live
data **in the UI** and reported, not silently dropped. Ingesting/accepting **never** writes to Jira (FR-021, SC-006).

---

## 3. Relationships

```text
PoToolSelection (own profile id + PI)  ──derives──>  ArtTeam ──> PiReviewTab (mounted, unchanged)
                                        └──prop────>  FeatureReviewTab (dashboardTeamProfileId?)

SourceFeatureSnapshot ──1:N──> ProposedIncrement ──> CommitDiff.creates ──> CommitOutcome
        └──────────────────────1:N link───────────> CommitDiff.links  (best-effort)

CompositionDraft ──1:N──> ReferencedSource
        └──> fields ──evaluate──> HygieneChecklistEntry[]   (advisory)
        └──> fields ──preflight─> CommitDiff.blockingIssues  (hard block)

AiIngestResult ──> ProposedIncrement[] (isAccepted:false) | CompositionDraft.fields (proposed)
```

**Hygiene vs required fields — two different gates, never conflated:**

| | Source | Effect |
|---|--------|--------|
| `HygieneChecklistEntry` | NodeToolbox's own rules | **Advisory** — never blocks commit (FR-029) |
| `blockingIssues` | The Jira instance's createmeta | **Hard block** — commit disabled (FR-034) |

---

## 4. State transitions

**Draft**

```text
(none) ──create/load──> Editing ──save(auto)──> Editing
Editing ──discard──> (none)                                        [FR-048]
Editing ──review──> Reviewing ──back──> Editing
Reviewing ──commit, fully successful──> (cleared) + keys reported  [FR-045, SC-011]
Reviewing ──commit, partial/failed────> Editing (retained; succeeded items marked createdJiraKey)
```

**Proposed increment**

```text
manual add ─────────> accepted (isAccepted:true)
AI ingest ──────────> proposed (isAccepted:false) ──accept──> accepted
                                                   ──reject──> (removed)
                                                   ──edit────> proposed (still unaccepted)
```

**AI gate** (FR-017, spec A8)

```text
locked ──(app-root Ctrl+Alt+Z + passphrase)──> unlocked ──(re-lock)──> locked
```

Locked ⇒ AI controls **absent and inert**; the manual draft is fully intact and committable either way (SC-005, spec
edge case "re-locks mid-draft"). The gate is **discoverability, not security** — the underlying endpoints are
unauthenticated (spec A8); this feature adds no capability beyond what they already expose.

---

## 5. Validation rules

| Rule | Source |
|------|--------|
| An increment needs a non-empty summary | FR-009 |
| Increments are created with the **original's own** issue type id | FR-016, A17 |
| The original is **never** closed, transitioned, or deleted | FR-016b, A16, SC-016 |
| Create requires a target project; update requires an existing key; never both paths at once | FR-035, FR-036 |
| Instance-required fields must be satisfied before create — else commit blocked, each named | FR-034, SC-008 |
| Only instance-reported projects/types/link-types are offered | FR-037 |
| A wrong-`kind` AI payload is rejected outright | FR-018, SC-009 |
| AI items land unaccepted | FR-020, FR-032 |
| Unknown-key AI items are skipped **and reported** | spec edge case |
| Confluence failures distinguish not-found / permission / unreachable | FR-023b, SC-018 |
| An unreadable workbook leaves the draft untouched | FR-023a |
| Draft load never throws | FR-046 |
| Coaching never blocks | FR-011, FR-029 |
