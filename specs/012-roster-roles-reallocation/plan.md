# Implementation Plan: Role-Aware Roster + Canvas Work Re-Allocation Plan

**Branch**: `feature/012-roster-roles-reallocation` | **Date**: 2026-07-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/012-roster-roles-reallocation/spec.md`

## Summary

Give the Feature Canvas's people-blind AI accelerator a role-aware second opinion on staffing a sprint. Two
coupled parts, both **reuse-first** (no new dependency, no server change):

- **Part 1 — Role-aware roster (enabling enhancement).** Extend the existing team-scoped roster
  (`useStandupRosterStore`) so each member carries three independent capability flags — **Developer**,
  **Internal Tester**, **External Tester** — editable and visible in the existing `RosterTab`. Fully manual;
  never gated. Distinct from the existing free-text `roleName` label (kept as-is).

- **Part 2 — Canvas "Work Re-Allocation Plan" AI assist.** A new, passphrase-gated, **copy-out only** panel
  (`WorkReallocationPanel`) beside the existing `AiSuggestionPanel`. The operator picks **one target sprint**
  (a canvas sprint container); the panel assembles the active-team roster (with roles), that sprint's child
  work grouped by assignee (key, summary, points, raw status name + category, **time-in-status**), the PI
  **start/end window**, the **story-point ≈ one day** convention, and a persisted **additional-details**
  constraints box — into a single prompt the operator copies into Copilot. Copilot returns a documented
  re-allocation plan + explicit risk assessment. **No ingest, no overlay/Jira write.**

**Technical approach** (from research):

- **Roles on the roster**: add an optional `roleCapabilities: { canDevelop; canInternalTest; canExternalTest }`
  to `StandupRosterMember`/`StandupRosterMemberDraft`, validated in `isStandupRosterMember`, preserved in
  `createRosterMember`/`upsertRosterMembersInList`, with a new `setRosterMemberRoles(memberId, caps)` mutator
  (mirrors `removeRosterMember`). Absent capabilities = all false (back-compatible with existing localStorage).
  `RosterTab`'s "Current roster" cards gain three toggle checkboxes + role chips.
- **Target-sprint work assembly** (pure): a new `reallocationModel.ts` resolves each child story's box
  (`node.storyPlacements[storyKey] ?? node.containerId`) and collects the child stories whose box is the
  selected sprint container, grouped by assignee, with unassigned / not-on-roster flags. Reuses `CanvasNode` +
  `CanvasChildStory` — no new canvas fetch except the one status-age field below.
- **Time-in-status** (the one cross-cutting data thread): add `statuscategorychangedate` to the blueprint
  child-story fetch field list, carry it onto `BlueprintStoryNode` → `CanvasChildStory.statusChangedIso`, and
  derive whole days-in-status in the pure prompt builder (today injected). Cheap single field, **no changelog
  fetch**; degrades gracefully to "unknown" when absent. (See research R3.)
- **PI window**: reuse `parsePiDateRange(piName)` (start/end) + `daysRemainingInPi(piName, today)` — both
  already exist in `piSchedule.ts`. No new schedule source.
- **Prompt builder** (pure, `reallocationPrompt.ts`): assembles roster+roles, per-person target-sprint work,
  PI window, point-as-days convention, verbatim additional-details, and the plan+risk instruction with the
  same "reason only from the data; do not invent" guardrails as the existing canvas prompts. Deterministic
  (today injected) → <10ms unit tests.
- **Additional-details persistence**: a small `useReallocationDetailsStore` keyed exactly like the overlay —
  `tbxReallocationDetails:<teamProfileId>:<deriveScopeKey(projectKey, piName)>` (reusing `overlayStorage`'s
  `deriveScopeKey`, its own prefix) — so a per-team, per-PI canvas keeps its own constraints. Isolated from the
  overlay serialization (no overlay migration). (See research R4.)
- **Panel**: `WorkReallocationPanel` reuses `AiSuggestionPanel`'s `copyToClipboard` (incl. the non-secure
  fallback) and the `useAiAssistStore` gate; renders a target-sprint `<select>`, the additional-details
  textarea, a read-only prompt preview, and Copy — **no paste-back/ingest section**. Honest empty states
  (no roster / no sprints / no assigned work / no roles).

## Technical Context

**Language/Version**: TypeScript ~5.x, React 19 (client SPA). Backend unchanged.

**Primary Dependencies**: **None new.** Reuses `useStandupRosterStore` + `teamScopedStorage`,
`filterRosterMembersByActiveTeam`, the Feature Canvas overlay + `CanvasNode`/`CanvasChildStory`
(`nodeMapping`, `canvasTypes`), `piSchedule` (`parsePiDateRange`, `daysRemainingInPi`), the blueprint
child-story fetch (`blueprintHierarchy.ts`), the `AiSuggestionPanel` copy helper + `useAiAssistStore` gate.

**Storage**: localStorage only. Roles ride on the existing roster localStorage entry (team-scoped). The
additional-details box is a small new localStorage entry keyed by canvas scope (via `teamScopedStorage`). No
server change; no new persisted server entity. The assembled prompt is transient (copy-out).

**Testing**: Vitest + `@testing-library/react` + `user-event`. Colocated sibling tests. Pure logic
(`reallocationModel` target-sprint grouping + role/assignee flags; `reallocationPrompt` string assembly;
days-in-status math) unit-first (<10ms, `today` injected). Component tests for the role editor in `RosterTab`
and for `WorkReallocationPanel` (target-sprint select, additional-details persistence, copy, empty states,
gate-locked → renders nothing). Store tests for the roles mutator + persistence round-trip.

**Target Platform**: Desktop web browser (SPA).

**Project Type**: Web — React SPA (`client/`). Frontend-only; no server change.

**Performance Goals**: Prompt assembly is over one sprint's child items (tens, low-hundreds at most) — trivial.
The only network delta is one extra field on an existing search (`statuscategorychangedate`), no new request.

**Constraints**:
- **One-way copy-out** — the analysis never ingests a reply and never writes the overlay or Jira (SC-6).
- **Additive** — existing canvas AI analyses are untouched; a separate panel guarantees it (SC-8).
- **Manual parity for roles** — role capabilities are settable/usable with AI locked; only plan generation is
  gated (SC-7).
- **Honesty about status** — pass raw status name + category; do not invent a dev/test phase; time-in-status
  is a soft heuristic (spec A8/A11).
- **Minimal footprint** — no new dependency; reuse roster store, overlay/node model, PI schedule, gate, copy.

**Scale/Scope**: Active team's roster (typically <30 people) × one target sprint's child items; single operator.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Article | Gate | Status |
|---------|------|--------|
| III — Branching | Feature branch; PR to main | ✅ On `feature/012-roster-roles-reallocation` |
| IV — Code Quality | Self-documenting names, functions <40 lines, doc/purpose comments | ✅ New pure modules + panel decompose into small units; enforced in implementation |
| V — Testing | TDD; fast mocked units; real-events UX | ✅ Pure model/prompt/days-in-status unit-first; RTL for role editor + panel |
| VI — Documentation | CHANGELOG is source of truth; no ad-hoc docs | ✅ CHANGELOG entry at implementation; only `specs/012-*` pipeline artifacts here |
| VII — Framework-First | Don't rebuild what the codebase provides | ✅ **Reuse-only** — roster store, overlay/node model, `piSchedule`, AI gate + copy helper; the only new data is one Jira field |
| VIII — Release | Local pipeline only | ✅ N/A until release (`scripts/local-release.ps1`) |
| IX — Vault | No secret in conversation/file/log | ✅ No secrets handled |
| X — Verification | Evidence, not "it compiles" | ✅ `quickstart.md` defines behavioral checks (set roles, generate prompt, verify contents, no-write, empty states) |
| XI — Output Restraint | ≤1 dashboard artifact; no phase narration | ✅ No dashboard artifact involved |

**Framework-First note (Article VII)**: No new abstraction or dependency. Roles extend the *existing* roster
member schema; work assembly reads the *existing* `CanvasNode`/`storyPlacements`; the PI window reuses the
*existing* `piSchedule`; the panel reuses the *existing* `useAiAssistStore` gate and `copyToClipboard`. Two
deliberate **non-reuse** decisions, each justified in research: (a) a **separate** panel rather than a new
`AiSuggestionKind` in `AiSuggestionPanel` — the re-allocation flow has no ingest/accept-reject and needs a
target-sprint selector + persisted free-text, so folding it into the ingest-shaped panel would complicate the
untouched analyses (protects SC-8); (b) a **dedicated** additional-details store rather than a field on the
overlay model — avoids overlay serialization/migration for an AI-only concern. The one genuinely new signal
(time-in-status via `statuscategorychangedate`) is a documented gap: Jira exposes no ready field for
"time in current status" without a heavier changelog read. No custom-vs-framework tension remains; the
Complexity Tracking table is not required.

**Result: PASS (initial and post-design).**

## Project Structure

### Documentation (this feature)

```text
specs/012-roster-roles-reallocation/
├── plan.md              # This file
├── spec.md              # Feature spec (Q1=A,Q2=A,Q3=A + clarify: raw-status, one-sprint, PI window/point-day/time-in-status)
├── research.md          # Phase 0 — decisions + rationale
├── data-model.md        # Phase 1 — role capabilities + assembled planning context entities
├── quickstart.md        # Phase 1 — behavioral validation guide
├── contracts/
│   ├── roster-roles.md       # Roster member role-capability schema + store mutator + UI contract
│   └── reallocation-prompt.md # Prompt-input assembly + generated-prompt shape + panel behavior
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
client/src/views/SprintDashboard/
├── hooks/useStandupRosterStore.ts   # +roleCapabilities on member/draft; validate/preserve; +setRosterMemberRoles mutator
└── RosterTab.tsx                    # +role toggles (three checkboxes) + role chips on Current-roster cards

client/src/views/ArtView/
└── blueprintHierarchy.ts            # +statuscategorychangedate in child fetch fields; carry statusChangedIso on BlueprintStoryNode

client/src/views/FeatureCanvas/
├── logic/canvasTypes.ts             # +statusChangedIso?: string | null on CanvasChildStory
├── canvas/nodeMapping.ts            # map statusChangedIso from blueprint child → CanvasChildStory
├── ai/
│   ├── reallocationModel.ts         # NEW (pure): resolve target-sprint child work, group by assignee, role/assignee flags, days-in-status
│   ├── reallocationPrompt.ts        # NEW (pure): assemble the copy-out prompt (roster+roles, per-person work, PI window, point=day, details, instruction)
│   ├── useReallocationDetailsStore.ts # NEW: persisted additional-details, scoped by canvas scope (teamScopedStorage)
│   └── WorkReallocationPanel.tsx     # NEW: gated copy-out panel (target-sprint select, details textarea, prompt preview, Copy); no ingest
└── FeatureCanvasView.tsx            # mount WorkReallocationPanel alongside AiSuggestionPanel behind the AI gate
```

**Structure Decision**: Part 1 lives entirely in the existing Team-Dashboard roster files (store + `RosterTab`)
because roles belong to the canonical people list, not the canvas. Part 2 lives under
`FeatureCanvas/ai/` beside the existing accelerator, as a **separate panel** with two **pure** helpers
(`reallocationModel` for target-sprint work assembly, `reallocationPrompt` for string building) isolated for
<10ms unit tests, plus a tiny scoped store for the persisted constraints box. The only edits outside those new
files are additive: one Jira field + one optional type field threaded from the blueprint fetch to
`CanvasChildStory`, and mounting the panel in `FeatureCanvasView`. This keeps the existing ingest-shaped
`AiSuggestionPanel` and every current analysis untouched (SC-8).

## Complexity Tracking

> Not required — Constitution Check passes with no violations. No new dependencies or abstractions; the change
> extends the roster schema, reuses the overlay/node model + PI schedule + AI gate, and adds one Jira field for
> the time-in-status signal.
