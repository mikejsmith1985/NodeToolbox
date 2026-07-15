# Contract: Tab Reuse & Independent Team Selection

This contract governs FR-003/FR-004/FR-005/FR-005a–c and SC-002/SC-003/SC-015 — the requirement that the PO Tool
mounts **the same** Feature Review and PI Review components as Team Dashboard, with **its own** team/PI selection and
**zero regression** in Team Dashboard.

It is the highest-risk part of the feature: it is the only place shipped, in-use files are touched. Research R1
established the cost is **one optional prop on one file**.

---

## The rule

> **The PO Tool owns its selection. It never writes the app-wide one.**

The app-wide `sprintDashboardActiveTeamProfileId` is Team Dashboard's. The team-profile **list** is a **read-only
catalog** shared by every tool — it carries everything the tabs need (`boardId`, `boardName`, `projectKey`,
`selectedPiValue`, `piReviewPages`). Only the *active id* is a singleton.

Therefore the PO Tool:

- **reads** the profile catalog,
- **keeps its own** selected profile id (persisted at `tbxPoToolSelection`),
- **never calls** `setSprintDashboardActiveTeamProfileId`.

That alone satisfies FR-005a/FR-005c with **zero contention** (SC-015).

---

## PI Review — mount directly, zero changes

**Mount `views/ArtView/PiReviewTab.tsx`. Do NOT mount `views/SprintDashboard/SprintDashboardPiReviewTab.tsx`.**

Its existing contract is already tool-agnostic and is already consumed by two tools:

```ts
interface PiReviewTabProps {
  selectedPiName: string;                                        // required
  teams: ArtTeam[];                                              // required
  mode?: 'authoring' | 'readout';                                // default 'authoring'
  teamCapacitySummaries?: Record<string, CapacitySummary | null>; // default {}, keyed by team.id
}
```

PO Tool mount:

```tsx
<PiReviewTab
  mode="authoring"
  selectedPiName={poSelectedPiName}
  teams={[artTeamFromPoProfile]}
/>
```

**Changes required: ZERO.** Confirmed by research:

- Its one write to the app-wide active id lives behind the **non-authoring** branch ("Edit in Team Dashboard"
  handoff), which `mode="authoring"` never renders.
- `team.sprintIssues` is **never read** inside the component — it exists only to satisfy the `ArtTeam` shape, so the
  PO Tool passes `[]`.
- Its other implicit reads are the global Confluence URL (correct for any tool) and the roster store (see below).

**Why not the Team Dashboard adapter**: it hardwires the active profile and drags in the capacity store, Capacity
tab, risk, and remap panels — all Team-Dashboard execution concerns. It is **the only path** on which the capacity
singleton would matter. A ~10-line PO-Tool `ArtTeam` adapter is smaller *and* cleaner.

---

## Feature Review — one optional prop (the only shared-file behavior seam)

```ts
interface FeatureReviewTabProps {
  boardId: number | null;
  boardName: string | null;
  projectKey: string;
  selectedPiName: string;
  /** Team profile scoping config + name. Defaults to the app-wide active team (Team Dashboard). */
  dashboardTeamProfileId?: string;   // ← NEW, optional
}
```

Resolution inside the component:

```ts
const activeDashboardTeamProfileId = useSettingsStore((s) => s.sprintDashboardActiveTeamProfileId);
const resolvedTeamProfileId = dashboardTeamProfileId ?? activeDashboardTeamProfileId;
```

`resolvedTeamProfileId` then feeds **both** existing uses — the team-name lookup and
`loadDashboardConfigFromStorage(...)`, which already takes the id as an argument.

**Why this is safe (FR-004, FR-005b, SC-002)**: with the prop **omitted**, the expression is **identical** to
today's. Team Dashboard's call site needs **no edit** and cannot regress.

**Implementation constraints**:

- Keep the **inline selector** form (`useSettingsStore((s) => …)`) rather than switching to a profiles-array +
  `useMemo`, so re-render granularity is byte-identical when the prop is omitted.
- Only **one** value is genuinely team-scoped — the profile id. The tab's other implicit reads (toast context, the
  ART team roster, the ART fallback PI name) are **global and team-profile-independent**; leave them alone.
- **Do not** extract `FeatureReviewTab.module.css` out of the Team Dashboard stylesheet. CSS Modules are hashed class
  maps; a cross-folder import costs nothing at runtime. Extraction is a pure refactor with real regression risk in a
  ~3,700-line stylesheet for zero user-visible gain.
- **Do not** relocate the tab or its sibling modules. The PO Tool imports it across folders — exactly as the Team
  Dashboard PI Review adapter already imports across folders today.

**Precedent**: this optional-`dashboardTeamProfileId?`-resolved-against-the-catalog shape **already ships** in the
same folder (the Standup tab). This is a known-good pattern, not a novel one.

---

## The `ArtTeam` adapter

~10 lines, mirroring the existing Team Dashboard adapter's synthesis, built from the PO Tool's **own** selected
profile:

```ts
// poToolArtTeam.ts — pure; unit-tested
export function buildArtTeamFromProfile(profile: SprintDashboardTeamProfile): ArtTeam
// id/name/projectKey/boardId/piReviewPages from the profile; sprintIssues: [] (never read by PiReviewTab)
```

---

## The roster store (optional, recommended)

PI Review's "Pull Features from Jira" filters by Product Owner via a team-scoped roster store. Scope it to the PO
Tool's profile **on mount** — the established 3-line idiom, already shipped by another tool with an explanatory
comment.

**Safe for Team Dashboard**: it **re-asserts** all its team-scoped stores on every mount and on every active-profile
change, so it self-heals. This is a *sequencing/ownership* concern, already solved by an accepted idiom — **not** a
correctness blocker.

---

## The capacity singleton — explicitly a NON-issue

Recorded because the spec originally flagged it as a schedule risk (assumption A2, since corrected).

The shared team-scoped capacity store is a module-level singleton holding **one** profile id. It is **not** a blocker
for FR-005c, for four independent reasons:

1. **Neither mounted component touches it.** Not `ArtView/PiReviewTab`, not `FeatureReviewTab`. It is reachable only
   through the Team Dashboard **adapter** — which this contract forbids mounting.
2. **One view renders per context.** Routing is a flat `<Routes>`; two tool views cannot co-mount in one browser tab.
3. **Separate tabs are separate module instances.** There is **no `storage` event listener anywhere in the repo**, so
   no cross-context in-memory interference.
4. **Its keys are already team-scoped.** A collision requires both tools on the **same** team — the same data by
   design, and pre-existing last-write-wins behavior, not new.

**It becomes a (still mild, self-healing) concern only if the PO Tool mounts the Team Dashboard PI Review adapter or
the Capacity tab. This contract forbids both.**

---

## Registration (FR-001)

Four touch points; there is no single registry:

| # | File | Change |
|---|------|--------|
| 1 | `views/Home/homeCardData.ts` | Append the PO Tool to the app-card catalog |
| 2 | `App.tsx` | Route const + `<Route>` + import |
| 3 | `views/Home/homeCardData.ts` | Recents-strip label entry |
| 4 | `views/PersonalToolbox/personalToolboxModules.ts` | *(optional)* expose in Personal Toolbox |

The card catalog entry transitively powers Home rendering/ordering **and Admin Hub tool-visibility for free** —
satisfying FR-001's "subject to the existing tool-visibility administration" with no extra work.

---

## Invariants

- **INV-T1** — Feature Review and PI Review in the PO Tool are **the same components** Team Dashboard mounts. No
  copy, fork, or re-implementation exists. *(FR-003, SC-003)*
- **INV-T2** — With `dashboardTeamProfileId` omitted, Feature Review behaves **identically** to today. Team
  Dashboard's call sites are unedited. *(FR-004, FR-005b, SC-002)*
- **INV-T3** — The PO Tool **never** writes `sprintDashboardActiveTeamProfileId`. Changing the PO Tool's selection
  has **no** effect on Team Dashboard's, and vice versa. *(FR-005a, FR-005c, SC-015)*
- **INV-T4** — `PiReviewTab` is mounted **unmodified**. *(FR-003)*
- **INV-T5** — A behavior change made once to either tab appears in **both** tools. *(SC-003)*

---

## Residual risk (accepted, non-blocking)

The team-scoped storage helper runs a **one-time legacy migration** that fires only before any scoped key exists. A
PO Tool reading a *different* profile first could theoretically win that race and stamp the legacy blob onto the PO's
team rather than Team Dashboard's. It requires a **never-migrated** user opening the **PO Tool first** — vanishingly
rare, and the only genuine cross-tool coupling left in the storage layer. Accepted; noted in quickstart.
