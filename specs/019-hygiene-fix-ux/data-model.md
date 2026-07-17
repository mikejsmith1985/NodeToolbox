# Data Model — Hygiene Fix Workspace (019)

Phase 1 output. All models are client-side; nothing is persisted.

## Semantic vocabulary (pure mappings)

```ts
type ChipTone = 'neutral' | 'progress' | 'success' | 'warning' | 'danger';

// status.statusCategory.key → tone
'new' (to-do)        → neutral
'indeterminate'      → progress
'done'               → success
unknown/missing      → neutral (label still shown — never invent a state)

// priority name (case-insensitive) → { tone, direction }
highest | blocker    → danger,  up-double
high | critical      → warning, up
medium               → neutral, flat
low                  → progress, down
lowest               → progress, down-double
unknown              → neutral, flat (name still shown)

// issue type name → { icon, tone }
bug | defect         → 🐞 danger
story                → 📗 success
task                 → ✅ progress
spike                → 🔬 neutral
feature | epic       → ⚡ warning
sub-task             → 🔹 neutral
unknown              → 📄 neutral

// age (days since update) with configured stale threshold T
age < T              → comfortable (neutral)
T ≤ age ≤ 2T         → warning
age > 2T             → overdue (danger)
```

**Invariants**: every chip renders its text label (color is never the sole signal); unknown inputs degrade to
neutral + label, never to hidden.

## AssigneeIdentity

| Field | Source | Rule |
|---|---|---|
| fullDisplayName | `assignee.displayName` | rendered whole — never truncated or first-token shortened (standing rule) |
| initials | derived | first letter of the first two name tokens, commas stripped ("Katkar, Rahul (CTR)" → "KR"); single-token names use first two letters |
| unassigned | `assignee == null` | renders a distinct "Unassigned" treatment, not an empty avatar |

## StructuredBlock (description rendering)

```ts
type StructuredBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'heading'; text: string }        // bold run-in lead ("Day one:", "*Steps:*")
  | { kind: 'listItem'; text: string; level: 1 | 2 };
```

- Produced by `parseStructuredText(rawDescription)`; input is first normalized by the existing plain-text machinery.
- Degradation rule: any line not matching a structure becomes a paragraph — output is never emptier than today's
  flattened rendering.

## IssueContext (detail-panel blocks)

| Block | Source field | Empty behavior |
|---|---|---|
| Linked issues | `issue.fields.issuelinks[]` → link type name + direction, other issue's key / summary / status | block omitted entirely |
| Labels | `issue.fields.labels[]` | omitted |
| Fix versions | `issue.fields.fixVersions[].name` | omitted |
| Sprint | existing sprint field parsing | omitted |
| Feature link / PI | existing resolved fields (hygiene field config) | omitted |
| Acceptance criteria | existing resolved AC text (prop already supported by the panel) | omitted |
| Description | `StructuredBlock[]` | plain-text fallback |

**Rule**: no empty placeholder boxes, ever (explicit spec rejection of Jira's dashed "There are no links" rows).

## CleanupSession (ephemeral)

```ts
interface CleanupSession {
  orderedKeys: string[];                      // finding issue keys, filtered-list order at session start
  cursorIndex: number;                        // 0-based; clamped to orderedKeys bounds
  outcomeByKey: Record<string, 'fixed' | 'commented' | 'skipped'>;  // untouched = key absent
}
```

**State transitions**

| Event | Effect |
|---|---|
| Start session | orderedKeys ← current filtered findings; cursorIndex ← 0; outcomes empty |
| Next / Previous (→ / ←, buttons) | cursorIndex ± 1, clamped; never changes outcomes |
| Fix applied on current finding | outcomeByKey[key] ← 'fixed' (overwrites a prior 'skipped') |
| Comment posted on current finding | outcomeByKey[key] ← 'commented' unless already 'fixed' |
| Skip (S, button) | outcomeByKey[key] ← 'skipped' unless already fixed/commented; advances cursor |
| Escape / End session | summary computed: fixed / commented / skipped counts + untouched = orderedKeys − outcomes |
| Filter or list changes mid-session | session ends (fresh list ⇒ fresh session; spec: nothing persists) |

**Invariants**: outcome precedence fixed > commented > skipped (an acted-on finding never downgrades); summary
buckets always sum to orderedKeys.length; keyboard events originating in text inputs never mutate the session.
