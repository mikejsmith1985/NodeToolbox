# Contract — Issue Context Panel (extended `IssueDetailPanel`)

## Header (replaces the plain STATUS/PRIORITY/ASSIGNEE text row)

One glanceable line: `IssueTypeIcon` + issue key link + `StatusChip` + `PriorityBadge` + `AssigneeAvatar` +
`AgeBadge` (age supplied by hygiene rows; omitted where the host has no age context). Existing created/updated
dates remain below.

## Context blocks (all omit-when-empty — no placeholder boxes)

| Block | Content | Source |
|---|---|---|
| Linked issues | per link: link relation ("links to", "is blocked by"), other key (Jira link), summary, `StatusChip` of the OTHER issue | `fields.issuelinks` on the already-loaded issue — no extra request |
| Labels | chip per label | `fields.labels` |
| Fix versions | chip per version name | `fields.fixVersions` |
| Sprint / Feature link / PI | compact rows | existing parsed fields (hygiene field config) |
| Acceptance criteria | distinct labeled block | existing `acceptanceCriteria` prop (hygiene passes resolved text) |
| Description | `StructuredText` rendering of `parseStructuredText(description)` | existing description field |

## Behavioral requirements

1. Every capability the panel had before remains: transitions, comments, story-point editing (regression gate
   FR-010).
2. Blocks with no data render nothing at all (explicit anti-pattern rejection).
3. If `issuelinks` is absent from the payload (host view didn't request it), the links block is simply omitted —
   never an error, never a fetch from inside the panel.
4. Description parsing failure degrades to current plain-text rendering (never blanker than today).
5. Fix affordances on hygiene findings: a one-sentence explanation per flagged check above the controls; every
   input labeled (no bare "Choose…").

## Data prerequisite

The hygiene scan's base field list adds `issuelinks` and `labels` so hygiene findings carry the context (sprint
fetch already requests `issuelinks`; DSU already requests both — precedent established).
