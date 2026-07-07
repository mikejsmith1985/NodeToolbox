# Phase 1 Data Model: Role-Aware Roster + Canvas Work Re-Allocation Plan

All types are TypeScript, client-side. **Persisted** entities live in localStorage (team-scoped); **derived**
entities are computed in memory and never stored. No server-side schema changes.

---

## 1. Persisted — Roster member role capabilities (Part 1)

Extends the existing `StandupRosterMember` / `StandupRosterMemberDraft` in
`client/src/views/SprintDashboard/hooks/useStandupRosterStore.ts`.

```ts
/** The three independent role capabilities a person may hold (any combination, incl. none). */
export interface RosterRoleCapabilities {
  canDevelop: boolean;
  canInternalTest: boolean;
  canExternalTest: boolean;
}

// Added to StandupRosterMember AND StandupRosterMemberDraft:
//   roleCapabilities?: RosterRoleCapabilities;
```

**Rules & lifecycle**
- **Optional; absent ⇒ all false.** Existing persisted rosters (no field) remain valid — no migration.
- **Distinct from `roleName`** (the existing free-text job-title label), which is retained unchanged (FR-1.2).
- **Team-scoped** via the existing `teamScopedStorage` roster key — role state is per Team-Dashboard profile
  (FR-1.3), like every other roster field.
- **Validation** (`isStandupRosterMember`): if `roleCapabilities` is present it must be an object whose three
  members, when present, are booleans; a malformed value is dropped to `undefined` (treated as no roles),
  never throwing — consistent with the store's tolerant read.
- **Preservation**: `createRosterMember` and `upsertRosterMembersInList` must carry `roleCapabilities` through
  (the current upsert rebuilds from a draft, so any edit path must include it).
- **Mutation**: new store action `setRosterMemberRoles(memberId: string, capabilities: RosterRoleCapabilities)`
  updates one member and re-persists (mirrors `removeRosterMember`).

---

## 2. Persisted — Additional details (Part 2 input)

New tiny store `client/src/views/FeatureCanvas/ai/useReallocationDetailsStore.ts`, persisted in localStorage
under a **distinct key that mirrors the overlay's exact scoping** — i.e. team profile id **and** the canvas
scope key — so a per-team, per-PI canvas keeps its own constraints (FR-4.3, "active team/work scope").

```ts
interface ReallocationDetailsState {
  additionalDetails: string;                          // free-text operator constraints (FR-4)
  setAdditionalDetails: (text: string) => void;       // persists on change (FR-4.3)
}
```

**Storage key** — reuse `overlayStorage.deriveScopeKey(projectKey, piName)` and the active Team-Dashboard
profile id (the same two inputs `buildOverlayStorageKey` composes), under its own prefix:
`tbxReallocationDetails:<teamProfileId>:<scopeKey>` (e.g. `tbxReallocationDetails:team-a:denp:pi-1`). This is
NOT the profile-only `teamScopedStorage` key — the constraints belong to *this canvas* (project+PI), matching
where the overlay lives.

**Rules**
- Persisted under the composed key above; survives close/reopen (FR-4.3); clearing to empty removes it.
- Never transmitted anywhere except inside the copied prompt (spec A6). No server call.

---

## 3. Data source addition — time in status

Threaded from the blueprint child fetch into the canvas child-story projection.

- `blueprintHierarchy.ts`: add `statuscategorychangedate` to the child-story fetch field list; set
  `statusChangedIso: issue.fields.statuscategorychangedate ?? null` on `BlueprintStoryNode`.
- `client/src/views/FeatureCanvas/logic/canvasTypes.ts` — `CanvasChildStory` gains:

```ts
  /** ISO datetime the story's status *category* last changed; a soft time-in-status signal. Null when
   *  the instance does not return statuscategorychangedate. */
  statusChangedIso?: string | null;
```

- `nodeMapping.ts` (`mapChildStories`): copy `statusChangedIso` from the blueprint child.

**Rule**: soft heuristic only (spec A11). Days-in-status is derived downstream (§5), not stored.

---

## 4. Derived — Assembled target-sprint work (Part 2, in-memory)

Computed by the pure `reallocationModel.ts` from `CanvasNode[]` + the selected sprint container id. Never
persisted.

```ts
/** One child work item as the re-allocation reasoner sees it. */
export interface ReallocationWorkItem {
  key: string;
  summary: string;
  storyPoints: number | null;
  status: string;                 // raw Jira status name (verbatim; no phase inference here)
  statusCategoryKey: string | null;
  daysInStatus: number | null;    // whole days since statusChangedIso (today injected); null when unknown
  assignee: string | null;        // display name, or null when unassigned
}

/** The work carried by one person (or the unassigned/off-roster bucket) within the target sprint. */
export interface ReallocationPersonLoad {
  displayName: string;            // roster member name, or "Unassigned" / the raw assignee name
  roles: RosterRoleCapabilities | null; // null ⇒ not on roster (off-roster assignee) or unassigned bucket
  isOnRoster: boolean;
  items: ReallocationWorkItem[];
  totalPoints: number;            // Σ storyPoints (nulls counted as 0)
}

/** Everything the prompt needs for one target sprint. */
export interface ReallocationContext {
  targetSprintTitle: string;
  piName: string;
  piStartIso: string | null;
  piEndIso: string | null;
  daysRemainingInPi: number | null;
  loads: ReallocationPersonLoad[];      // roster members with work + unassigned/off-roster buckets
  rosterWithoutWork: { displayName: string; roles: RosterRoleCapabilities }[]; // available capacity
  unassignedCount: number;
  offRosterAssignees: string[];
}
```

**Assembly rules (R6)**
- A child story belongs to the target sprint when its **resolved box** — `node.storyPlacements[storyKey] ??
  node.containerId` — equals the selected container id.
- Group items by `assignee`; match to roster members case-insensitively on `assigneeQueryValue`/`displayName`
  (mirrors `doesIssueBelongToRosterMember`). Unmatched, non-null assignees → `offRosterAssignees` + an
  off-roster `ReallocationPersonLoad` (`isOnRoster:false, roles:null`). Null assignees → the Unassigned bucket.
- `rosterWithoutWork` lists active-team roster members carrying **no** target-sprint items — the spare
  capacity the plan can move work *to* (with their roles, so role-legal moves are visible).
- `daysInStatus` = whole days from `statusChangedIso` to injected `today`; null when `statusChangedIso` absent.

---

## 5. Derived — Generated prompt (Part 2 output, transient)

`reallocationPrompt.ts` turns a `ReallocationContext` + `additionalDetails` into a single string (see
`contracts/reallocation-prompt.md` for the exact shape). Not persisted; produced on render, copied on demand.

---

## Entity → spec traceability

| Entity / field | Spec ref |
|----------------|----------|
| `RosterRoleCapabilities` (3 flags, any combination, team-scoped) | FR-1, FR-2, Key Entity "Roster Member Role Capabilities" |
| `roleCapabilities` distinct from `roleName` | FR-1.2 |
| `useReallocationDetailsStore` (persisted, scoped) | FR-4, Key Entity "Additional Details" |
| `CanvasChildStory.statusChangedIso` → `daysInStatus` | FR-5.1, FR-5.4b, A11, Key Entity "Time in Status" |
| `ReallocationWorkItem` (raw status + category, points, assignee) | FR-5.1, Q3=A |
| `ReallocationPersonLoad` / `rosterWithoutWork` (per-person grouping, off-roster/unassigned flags, spare capacity) | FR-5.2, FR-8, SC-3 |
| `ReallocationContext` PI start/end + days remaining | FR-5.3, Key Entity "PI Runway" |
| point-as-days convention (prompt text) | FR-5.4a, A10, Key Entity "Estimation Conventions" |
| Generated prompt (one-way, no ingest) | FR-6, FR-7, Q1=A |
