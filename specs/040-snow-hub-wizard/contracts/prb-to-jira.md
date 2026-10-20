# Contract: Problem → Jira (P3)

## Steps

1. **Find the problem** — search by number or words (existing PRB reader); results show number, short description, state.
2. **Is this the one?** — full PRB detail; existing Wizard-created items (label search) shown if any.
3. **Where does the work go?** — pick ONE Jira project from Jira's own project list (last choice remembered as `snowWizard:prbProject`); then pick the Epic from a Jira search of open Epics. All three items go in that project.
4. **Check the three items** — Defect, SL Story, QE Story drafts, each editable (summary, description).
5. **Create all** → result with three key links.

## `prbJiraPlan.ts` (pure)

`buildPrbJiraDrafts(prb, epicKey, projectKey): PrbJiraDraft[3]` — Defect summary `<PRB> — <short description>`;
SL summary `SL: <short description>`; QE summary `QE: <short description>`; all descriptions carry the PRB number and a
link back to it; label `prb-<PRB number lowercased>` on all three.

## `prbJiraCreate.ts`

Sequential: Defect → SL → QE, each with the Epic link (field resolved **by name** through the existing field-mapping
service — the `fieldMappingBoundary` ratchet forbids new `customfield_*` literals), then `Relates` link each Story →
Defect. Before creating: JQL `labels = "prb-<n>"` returns existing keys by role; only missing roles are created, only
missing links are made (idempotent retry). Issue type names resolved live from the project's create metadata.

## Invariants

- Never two Defects for one PRB unless the user explicitly confirms "create another set".
- A failed Epic link or issue link is reported per item and retried, never silently dropped.
- Toolbox's existing PRB Generator is unchanged.
