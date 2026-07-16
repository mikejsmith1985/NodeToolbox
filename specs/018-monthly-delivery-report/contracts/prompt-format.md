# Contract: Prompt Artifact Format

**Feature**: `018-monthly-delivery-report`
The single output of a run (FR-013–FR-015). Plain text, paste-ready for a chat-style AI agent. Structure below is
binding; exact instruction WORDING may be tuned post-launch without a spec change (spec A6) as long as every
structural element remains.

## Structure

```text
You are reviewing one month of software delivery data for several agile teams.

For EACH team below, provide a bulleted analysis answering:
"What was accomplished? Provide a summary of the achievement focusing on what was
delivered that benefited the business or major technical improvement."

Rules:
- One section per team, in the order given, each starting with the team name as a heading.
- Bullets only — no paragraphs. Lead each bullet with the business benefit or technical
  improvement, not the ticket number.
- Use the Feature groupings to describe initiative-level accomplishments; roll individual
  stories/tasks up into their Feature's story where possible.
- Work under "Delivered to Production" is live; work under "Delivered to External Test" is
  complete and in final verification — describe it as such, never as live.
- A team marked "No recorded deliveries this month." gets exactly one bullet saying so.
- A team marked "DATA UNAVAILABLE" gets exactly one bullet stating the data could not be
  collected — do not guess at what the team did.

════════════════════════════════════════
MONTHLY DELIVERY DATA — {Month YYYY} (covered month: {YYYY-MM})
Generated: {ISO timestamp} · Trigger: {scheduled|manual}
════════════════════════════════════════

=== Team: {teamName} ===

-- Delivered to Production --
Feature {FEAT-KEY} — {feature summary}:
- {ISSUE-KEY}: {issue summary} (reached production {YYYY-MM-DD})
No Feature:
- {ISSUE-KEY}: {issue summary} (reached production {YYYY-MM-DD})

-- Delivered to External Test --
Feature {FEAT-KEY} — {feature summary}:
- {ISSUE-KEY}: {issue summary} (reached external test {YYYY-MM-DD})

=== Team: {teamName with nothing delivered} ===

No recorded deliveries this month.

=== Team: {teamName whose collection failed} ===

DATA UNAVAILABLE: {reason, e.g. "Jira search failed: 401"}
```

## Binding rules

1. Instructions block first, data second, separated by the metadata banner — an agent must be able to act on a
   single paste (FR-015).
2. Every configured team appears exactly once, in config order (SC-004).
3. Buckets appear in fixed order: Production, then External Test. A bucket with no records is omitted for teams
   that have records in the other bucket; a team with no records in either bucket uses the
   "No recorded deliveries this month." line instead of empty buckets (FR-014).
4. Feature groups sort by Feature key; "No Feature" is always last. Issue lines sort by issue key.
   (Deterministic output → snapshot-testable prompt builder.)
5. Issue line format is fixed: `- KEY: summary (reached <bucket phrase> YYYY-MM-DD)`.
6. Error teams show the DATA UNAVAILABLE line with a short reason — never fabricated data (FR-014, FR-018).
7. Plain text only: no markdown tables, no HTML — bullets (`-`) and the shown delimiters only.
