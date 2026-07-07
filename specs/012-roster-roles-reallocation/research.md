# Phase 0 Research: Role-Aware Roster + Canvas Work Re-Allocation Plan

All decisions below resolve the Technical Context and the one spec-flagged unknown (time-in-status source,
spec A11). No NEEDS CLARIFICATION remains after this phase.

---

## R1 — Where roles live: extend the existing roster, not a new people store

**Decision**: Add role capabilities to `StandupRosterMember` in `useStandupRosterStore.ts` (Team Dashboard
roster), not a new store.

**Rationale**: The roster is already the canonical, team-scoped people list shared by Standup/DSU, and the
canvas already resolves the *same* active Team-Dashboard profile via `useCanvasScope` (verified in code). One
people list, one place to set roles. Framework-First: reuse the store, its `teamScopedStorage` persistence,
and `filterRosterMembersByActiveTeam`.

**Shape**: optional `roleCapabilities?: { canDevelop: boolean; canInternalTest: boolean; canExternalTest: boolean }`.
Optional + all-false-default keeps existing persisted rosters valid (no migration). Kept **separate** from the
existing free-text `roleName` (a job-title chip), per spec FR-1.2.

**Alternatives rejected**:
- *Three flat booleans on the member* — works, but a named object documents intent and validates as a unit.
- *A new `useRosterRolesStore` keyed by member* — a second source of truth to keep in sync with roster
  add/remove; strictly worse than one member record.
- *Reuse `roleName` as a delimited string* — overloads a display label with structured meaning; brittle.

---

## R2 — Editing roles: extend `RosterTab`'s Current-roster cards

**Decision**: Add three checkboxes (Developer / Internal Tester / External Tester) and role chips to each
member card in `RosterTab`'s "Current roster" section, wired to a new `setRosterMemberRoles(memberId, caps)`
store mutator (mirrors `removeRosterMember`).

**Rationale**: The card already renders `roleName` and the SNow linked-work panel per member; roles belong on
the same card. A dedicated mutator avoids round-tripping the whole member through `upsertRosterMembers` (which
rebuilds from a draft and risks dropping fields). Editing must work with AI locked (FR-2.3) — `RosterTab` has
no AI dependency, so this is automatic.

**Alternatives rejected**:
- *A separate roles editor screen* — unnecessary surface; the roster card is the natural home.
- *Set roles at add-time only* — people's capabilities change; must be editable on existing members.

---

## R3 — Time-in-status source (spec A11): use `statuscategorychangedate`, not the changelog

**Decision**: Add the Jira system field `statuscategorychangedate` to the blueprint child-story fetch
(`blueprintHierarchy.ts`, the `summary,status,issuetype,assignee,…` field lists), carry it as
`statusChangedIso` on `BlueprintStoryNode` → `CanvasChildStory`, and compute whole **days-in-status** in the
pure prompt builder as `today − statuscategorychangedate` (today injected).

**Rationale**: Jira exposes no direct "time in current status" field. The two ways to get it:
1. `statuscategorychangedate` — a single system field already returnable on the existing search, **zero extra
   requests**. Limitation: it moves only when the status *category* changes (To Do→In Progress→Done), so it
   does not distinguish two In-Progress statuses ("In Dev" → "In QA"). That is acceptable here because the
   signal is explicitly a **soft heuristic** (spec A11 / FR-5.4b) — "how long in this active phase," weighed by
   the assistant, never definitive — and the assistant infers dev-vs-test from the raw status name anyway.
2. Per-issue changelog (`expand=changelog`) — exact last-transition time, but an N-issue or heavy expand fetch,
   adding latency and complexity for a soft signal.

Option 1 wins on Framework-First + minimal footprint. When the field is absent (older Jira, not returned),
degrade to "time in status: unknown" — the prompt still generates.

**Alternatives rejected**: changelog expand (cost ≫ value for a soft heuristic); `updated` timestamp (moves on
any edit, misleading); computing nothing (loses the signal the operator explicitly asked for).

---

## R4 — Additional-details persistence: a small scoped store, not the overlay model

**Decision**: Persist the additional-details text in a new `useReallocationDetailsStore` keyed **exactly like
the overlay** — team profile id + the canvas scope key — not as a field on `overlayModel`, and not under the
profile-only `teamScopedStorage` key.

**Key**: `tbxReallocationDetails:<teamProfileId>:<deriveScopeKey(projectKey, piName)>`, reusing
`overlayStorage.deriveScopeKey` (the same normalization the overlay uses, e.g. `denp:pi-2026.3`) under its own
prefix. The overlay is keyed by *both* the profile and project+PI (`buildOverlayStorageKey`), and the
constraints belong to *this canvas*, so the details store must match that scoping — the profile-only
`teamScopedStorage` key would wrongly share one details blob across every PI of a team.

**Rationale**: The overlay is consumed by commit, capacity, and mapping logic and has its own
serialization; threading an AI-only free-text field through it invites migration and blast radius for no
benefit. A tiny dedicated store keeps the AI concern isolated and satisfies FR-4.3 ("persisted with the
canvas planning context, scoped to team/work scope") with the *same* scope the overlay uses.

**Alternatives rejected**:
- *Field on `overlayModel`* — overlay migration + wider blast radius for an AI-only string.
- *Ephemeral component state* — loses the text on close, violating FR-4.3.

---

## R5 — Panel design: a separate copy-out panel, not a new `AiSuggestionKind`

**Decision**: Build `WorkReallocationPanel.tsx` as a sibling of `AiSuggestionPanel.tsx`, reusing its
`copyToClipboard` helper and the `useAiAssistStore` gate. Do **not** add a `workReallocation` kind to the
existing ingest-shaped panel.

**Rationale**: Every existing `AiSuggestionKind` follows copy-prompt → paste-JSON → accept/reject and mutates
the overlay. Re-allocation is **one-way** (no ingest, no mutation) and needs a target-sprint selector plus a
persisted free-text box — a different shape. Folding it into `AiSuggestionPanel` would branch that component's
ingest logic and risk regressing the untouched analyses (SC-8). A separate panel keeps each concern simple and
makes "existing analyses unchanged" true by construction. Shared primitives (`copyToClipboard`, the gate) are
still reused.

**Alternatives rejected**: new kind in `AiSuggestionPanel` (couples one-way flow to ingest UI; risks SC-8);
duplicating the clipboard helper (needless copy — export/reuse it instead).

---

## R6 — Target-sprint work assembly: derive from the overlay, purely

**Decision**: A pure `reallocationModel.ts` computes, for a selected sprint container id: the set of child
stories whose resolved box equals that container — resolved box = `node.storyPlacements[storyKey] ?? node.containerId`
— grouped by `assignee`, each carrying key/summary/points/status/statusCategory/statusChangedIso, plus flags
for **unassigned** and **assignee-not-on-roster** (matched case-insensitively against roster
`assigneeQueryValue`/`displayName`, reusing the roster's existing match convention).

**Rationale**: Sprints hold stories (feature 009 FR-6.1a); `storyPlacements` already models per-story sprint
splits, defaulting to the feature's box. Assembly is deterministic from `CanvasNode[]` + the target container id
— no new fetch, <10ms testable. Assignee matching mirrors `doesIssueBelongToRosterMember` in `RosterTab` for
consistency.

**Alternatives rejected**: feature-level assignee (Q3=B, already rejected in spec — often empty); a live
per-sprint Jira query (redundant; the canvas already holds the child data).

---

## R7 — PI window & estimation conventions: reuse `piSchedule`, state the convention

**Decision**: Reuse `parsePiDateRange(piName)` for **start/end** dates and `daysRemainingInPi(piName, today)`
for days-left (both exist). State the **story-point ≈ one day of work** convention and the time-in-status
heuristic as plain prompt text; do not encode them as settings.

**Rationale**: `piSchedule.ts` already parses the PI name's embedded range and is pure (today injected). The
spec's follow-up added *both ends of the window* (FR-5.3) — `parsePiDateRange` already returns both. Point-as-days
is an org convention (spec A10), best stated in the prompt so the assistant converts point totals to
day-estimates against the remaining days; it is not a per-team stored value in this release.

**Alternatives rejected**: a new schedule source (redundant); a stored per-team point-to-days ratio
(out of scope; the convention is a stated 1:1 for now).

---

## R8 — Prompt guardrails & risk instruction: mirror the existing canvas prompts

**Decision**: `reallocationPrompt.ts` instructs the assistant to (a) produce a re-allocation plan grouped by
person, honoring that a person may only take work matching a role they hold and using the remaining PI days,
and (b) produce an explicit risk assessment; and to **reason only from the data/constraints given and invent
nothing** — echoing the guardrail language already used in `canvasAiAssist.ts` (`PROMPT_INSTRUCTIONS`).

**Rationale**: Consistency with the shipped accelerator's proven "do NOT invent values" framing; the
additional-details text is injected verbatim as operator rules the assistant must honor (FR-4.2).

**Alternatives rejected**: a terse prompt (loses the role-constraint and risk requirements that are the point);
a JSON-output instruction (this is one-way narrative — Q1=A — not an ingest).

---

## Resolved unknowns summary

| Unknown (from Technical Context / spec) | Resolution |
|-----------------------------------------|------------|
| Time-in-status source (spec A11) | `statuscategorychangedate` system field on existing fetch; days-in-status computed purely; graceful "unknown" fallback (R3) |
| Where roles persist | Existing roster member, optional `roleCapabilities`, no migration (R1) |
| Additional-details persistence home | Dedicated scope-keyed store via `teamScopedStorage` (R4) |
| Panel vs new kind | Separate copy-out panel; reuse gate + clipboard (R5) |
| Which items belong to the target sprint | Overlay-derived resolved box per child story (R6) |
| PI start/end + point-as-days | Reuse `parsePiDateRange`/`daysRemainingInPi`; convention stated in prompt (R7) |

No new dependencies. No server change. One new Jira field on an existing request.
