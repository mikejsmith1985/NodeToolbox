# Research — Hygiene Fix Workspace (019)

Phase 0 output. Every Technical Context unknown resolved; no NEEDS CLARIFICATION markers remain.

## 1. Where does linked-issue context come from?

- **Decision**: the `issuelinks` field on the issue payload — request it in the hygiene scan's base fields and read
  it straight off the finding's issue. No secondary fetch, no loading state for the links block.
- **Rationale**: the codebase already types `JiraIssueLink` (`types/jira.ts`) with `inwardIssue`/`outwardIssue`
  carrying `summary` + `status` — exactly what the spec needs (link type, key, summary, status chip). Impact
  Analysis and Business Helper already parse this shape; the sprint fetch already requests the field. NFR-003
  ("links must not delay initial render") is satisfied absolutely: there is nothing to wait for.
- **Alternatives considered**: per-issue `GET /issue/{key}?fields=issuelinks` on expand (adds latency, spinner
  states, and a failure mode for data we can get for free); Jira's remote-links API (different data, out of scope).

## 2. How is the semantic chip vocabulary structured?

- **Decision**: a pure mapping module (`issueMetaVocabulary.ts`) exporting fact → `{tone, icon, label}` lookups,
  consumed by five small presentational components (StatusChip, PriorityBadge, IssueTypeIcon, AssigneeAvatar,
  AgeBadge). Tones are semantic CSS classes layered on the existing token palette, with light/dark values; every
  chip always renders its text label (NFR-002 — color is never the only signal).
- **Rationale**: one vocabulary consumed everywhere is the only structure that satisfies the spec's "consistently
  wherever these facts appear" requirement — the project's agree-by-construction principle applied to presentation.
  Pure functions are unit-testable in the <10ms Article V budget.
- **Alternatives considered**: styling inline per view (guarantees drift — rejected on principle); adopting Atlassian
  Design tokens/components (new dependency; Art VII fails the necessity test — five chips do not justify a design
  system).

## 3. How are descriptions rendered with structure?

- **Decision**: a custom, zero-dependency `richTextStructured.ts`: normalize first through the existing
  `richTextPlainText` machinery (ADF/HTML/entities), then parse lines into `StructuredBlock[]` — paragraphs, bold
  run-in headings (Jira wiki `*bold*` and bare `Word:`-terminated lead lines like "Day one:"), and simple list items
  (`-`, `*`, `#`). Rendered by a `StructuredText` component. Unrecognized structure degrades to today's plain text.
- **Rationale (Art VII drift justification)**: nothing in the dependency tree renders rich text, and a markdown
  library would not parse Jira wiki syntax anyway — the gap is real, and the minimal custom piece targets exactly
  the structures visible in the reporter's screenshots (spec assumption bounds fidelity explicitly).
- **Alternatives considered**: `marked`/`markdown-it` + wiki→md conversion (new dependency plus a converter — more
  custom code, not less); Jira's `renderedFields` API expansion (returns HTML requiring sanitization — a security
  surface the plain parser avoids entirely).

## 4. How does the cleanup session hold state, and which keys drive it?

- **Decision**: `useHygieneSession` hook, plain component state: `{orderedKeys, cursorIndex, outcomeByKey}`.
  Outcomes only ever `fixed | commented | skipped` — untouched is the absence of an outcome (clarification #1).
  Keyboard: **← / →** previous/next, **S** skip, **Escape** exits the session. The listener attaches only while a
  session is active and ignores events originating in `input`/`textarea`/`select`/contenteditable so typing a
  comment never navigates.
- **Rationale**: ephemeral-by-spec means no store or persistence; a hook keeps it testable in isolation. Arrows are
  the least surprising traversal keys; `F1` is already the to-do hotkey and `Ctrl+Alt+Z` the AI gate — no overlap.
  `j/k` were considered and rejected: muscle-memory only for vim users, and single-letter nav keys colliding with
  future inline editing is a real risk; `S` for skip is mnemonic and guarded by the typing check.
- **Alternatives considered**: zustand store (over-engineering for view-lifetime state); URL cursor state (survives
  refresh — explicitly unwanted per spec edge case "re-entering starts a fresh session").

## 5. How do fix affordances become self-explanatory?

- **Decision**: extend the existing check-definition metadata with a human sentence per check ("Stale — no update in
  {N} days", "Missing story points — this team estimates in a dropdown") rendered above the existing fix controls,
  and give every fix input a visible label (the current bare "Choose…" placeholder becomes a labeled select whose
  options already come from editmeta).
- **Rationale**: the write paths (editmeta-aware, dropdown-capable) are already correct after GH #177 — this is
  purely presentation; changing behavior is explicitly out of scope in the spec.
- **Alternatives considered**: redesigning fix controls as a wizard (scope creep; the one-line explanation closes
  the comprehension gap the reporter described).

## 6. Age bands for the AgeBadge

- **Decision**: bands derive from the team's configured stale threshold **T** (the same `staleDaysThreshold` every
  other surface uses): `< T` comfortable, `T..2T` warning, `> 2T` overdue.
- **Rationale**: FR-005 requires consistency with the configured threshold; deriving both bands from T means a team
  that tunes its threshold retunes the visual heat automatically — no second knob to drift.
- **Alternatives considered**: fixed 7/14-day bands (would contradict a team's configured threshold — the exact
  input-drift mistake this project just eliminated).
