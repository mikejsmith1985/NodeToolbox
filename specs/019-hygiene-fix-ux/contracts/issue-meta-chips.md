# Contract — Semantic Chip Vocabulary (`components/IssueMeta/`)

The single visual vocabulary for issue facts. Any surface that renders one of these facts MUST use these components
(hygiene workspace + issue detail panel in this feature; other views adopt the same components opportunistically).

## Components & props

| Component | Props | Renders |
|---|---|---|
| `StatusChip` | `statusName: string`, `statusCategoryKey?: string` | pill: category tone + status name text |
| `PriorityBadge` | `priorityName: string` | direction glyph + name, tone per vocabulary |
| `IssueTypeIcon` | `issueTypeName: string`, `showLabel?: boolean` (default true) | icon + name |
| `AssigneeAvatar` | `displayName: string \| null` | initials circle + FULL name; distinct unassigned treatment |
| `AgeBadge` | `ageDays: number`, `staleDaysThreshold: number` | "{N}d" + graded tone (bands from threshold T / 2T) |

## Behavioral requirements

1. Text label always present — color/icon never the sole signal (spec NFR-002).
2. Unknown inputs degrade to neutral tone with the raw name shown; components never render empty or throw.
3. Tones derive from the app token palette with explicit light- and dark-theme values (NFR-004 contrast).
4. Components are pure presentational functions of props — no fetching, no store reads.
5. Layout survives A/A+/A++ text sizes and narrow widths: chips wrap, never clip (NFR-001; GH #160 rules — no
   zoom-compensating widths, fixed floors only).

## Test hooks

- `issueMetaVocabulary.ts` mapping functions are exported pure and unit-tested exhaustively (every tone branch,
  unknown fallbacks, initials derivation incl. "Lastname, Firstname (CTR)" and single-token names).
- Components carry `data-tone` attributes so tests assert semantics, not raw colors.
