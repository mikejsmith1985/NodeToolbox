# Contract: Work Re-Allocation Prompt (Part 2)

The contract for assembling the copy-out prompt and the `WorkReallocationPanel` behavior. One-way: **no
ingest, no overlay/Jira write** (Q1=A, FR-7).

## Pure builders

```ts
// reallocationModel.ts
export function buildReallocationContext(
  nodes: readonly CanvasNode[],
  targetContainerId: string,
  targetSprintTitle: string,
  rosterMembers: readonly StandupRosterMember[],   // already active-team filtered
  piName: string,
  todayIso: string,                                // injected → deterministic
): ReallocationContext;

// reallocationPrompt.ts
export function buildReallocationPrompt(
  context: ReallocationContext,
  additionalDetails: string,
): string;
```

Both are pure and deterministic (`todayIso` injected) → <10ms unit tests, no clock/network.

## Generated prompt — required content (FR-6)

The prompt string MUST contain, in a legible, copyable layout:

1. **Framing & goal** — plan how to move work across the team to maximize the chance of completing the
   **named target sprint**, using the remaining PI time.
2. **PI runway** — PI name, **start and end dates**, and days remaining (FR-5.3). When the PI name carries no
   parseable range, say so rather than emitting blanks.
3. **Estimation conventions** (FR-5.4) — a **story point ≈ one day of work**; **time-in-status** is a soft
   progress signal (longer in an active status ⇒ likely nearer done or stalled), not a guarantee.
4. **Roster with roles** (FR-3) — every active-team member with their role set (Developer / Internal Tester /
   External Tester), including members carrying **no** target-sprint work (spare capacity).
5. **Per-person target-sprint work** (FR-5) — for each person, their items: key · summary · points · raw
   status name (+ category) · days-in-status. Plus explicit **Unassigned** and **off-roster assignee** buckets.
6. **Additional details** (FR-4.2) — the operator's free text **verbatim**, labeled as constraints the
   assistant MUST honor (e.g. "ESI only has two devs who can work it").
7. **Output instruction** (FR-6.2) — return (a) a **re-allocation plan grouped by person**, moving work only to
   someone who holds a **role that matches** the work, and (b) an explicit **risk assessment** for completing
   the sprint (role bottlenecks, overloaded people, unstaffed testing, unassigned/blocked work).
8. **Guardrails** (FR-6.3) — reason ONLY from the data and constraints given; do **not** invent people, roles,
   assignments, sprints, points, or statuses.

The builder MUST NOT itself classify a dev/internal-test/external-test phase for an item — it passes the raw
status and lets the assistant infer (spec A8; clarify session).

## Panel behavior (`WorkReallocationPanel`)

| Aspect | Contract |
|--------|----------|
| Gate | Renders `null` unless `useAiAssistStore` is unlocked (FR-7.2), mirroring `AiSuggestionPanel`. |
| Target sprint | A `<select>` of the canvas's **sprint** containers; defaults to the highest-priority / earliest sprint; operator-changeable (FR-6.1). |
| Additional details | A textarea bound to `useReallocationDetailsStore`; edits persist (FR-4.3). |
| Prompt preview | Read-only preview of the assembled prompt, rebuilt reactively as target sprint / details / roster / canvas change. |
| Copy | A **Copy prompt** button reusing `AiSuggestionPanel`'s exported `copyToClipboard` (incl. the non-secure-context fallback) (FR-6.4). |
| Ingest | **None.** No paste-back field, no accept/reject, no apply — the panel makes no state change beyond the persisted details text (FR-7.1, SC-6). |
| Additive | Lives beside `AiSuggestionPanel`; does not alter any existing analysis (FR-7.3, SC-8). |

## Empty & degraded states (FR-8)

| Condition | Panel message |
|-----------|---------------|
| No roster for the active team | "Add a team roster (with roles) to plan re-allocation" → points to Roster settings. |
| No sprint containers on the canvas | "Define a sprint on the canvas first" → no target to plan. |
| Target sprint has no assigned work | "No assigned work in <sprint>" → nothing to re-allocate. |
| Roster exists but no member has any role | Warn that role-aware reasoning is degraded → points to the roster role editor (FR-8.2). |
| PI name has no parseable date range | Prompt states the runway is unknown; still generates. |

## Acceptance (maps to spec scenarios & SCs)

- Unlocked + sprint with assigned child work → prompt contains roster+roles, per-person items (status +
  days-in-status + points), PI start/end, point-as-days, verbatim details; zero invented entities. *(SC-3)*
- Typed constraint appears verbatim and framed as a rule. *(SC-4)*
- Details persist across close/reopen. *(FR-4.3)*
- Copy changes nothing on overlay/Jira; no ingest control exists. *(SC-6)*
- Prompt explicitly requests plan **and** risk assessment. *(SC-5)*
- In-progress items carry days-in-status; PI window shows both ends; convention stated. *(SC-9)*
- Locked → panel renders nothing; existing analyses behave identically. *(SC-7, SC-8)*
