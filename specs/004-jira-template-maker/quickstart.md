# Quickstart — Jira Template Maker (validation guide)

End-to-end scenarios that prove the feature works. These are the **proof gate** (Article X):
all must pass against a live Jira before the PR merges. They map to the spec's acceptance
scenarios and Success Criteria.

## Prerequisites

- NodeToolbox running locally with the client built (`npm run build` / dev server per repo
  scripts).
- Jira configured (base URL + PAT/credentials) so `/jira-proxy` reaches a real instance with at
  least one project the user can create issues in.
- Confluence configured (base URL + API token) so `/confluence-proxy` reaches the shared ART
  database (id available; default locked id `684163133`).
- Confirm the Jira flavor (research.md D1): Server/DC (default) vs Cloud.

## Run

- Client unit + component tests: `cd client && npx vitest run src/views/JiraTemplateMaker`
- Full client suite (regression): `cd client && npx vitest run`
- Typecheck: `cd client && npx tsc --noEmit`
- Manual: open NodeToolbox → the **Jira Template Maker** view.

## Scenarios

### S1 — Dependent pickers constrain choices *(FR-1; AS-1,2,3; SC-4)*
1. Open the view; pick a project.
2. **Expect**: the issue-type picker lists only that project's issue types.
3. Pick an issue type.
4. **Expect**: the field picker lists only fields on that issue type; unsupported types (e.g.
   cascading select) appear marked **unsupported** and cannot be added.
5. Add a dropdown field (e.g. Priority); open its value control.
6. **Expect**: only that field's real `allowedValues` are offered; free typing is rejected.

### S2 — Labels are case-sensitive and deduped *(FR-3; AS-4,5; SC-5)*
1. Add the Labels field; enter `Ops`, `Ops`, `ops`; save the template.
2. **Expect**: the saved template holds `Ops` and `ops` once each (no duplicate `Ops`).
3. Create an issue from it.
4. **Expect**: the created Jira issue's labels are exactly `Ops` and `ops`; no duplicates.

### S3 — Rich-text formatting round-trips *(FR-2.3; AS-6; Q3=A)*
1. Add Description; format text with bold, a bullet list, and a link.
2. Save and create the issue.
3. **Expect**: the created Jira issue renders that same formatting (wiki markup on Server/DC).

### S4 — Fixed vs prompt-at-launch *(FR-2.5, FR-5.1; AS-9,10)*
1. Build a template: Summary = prompt-at-launch (with a default), Priority/Components/Labels =
   fixed. Save.
2. Launch it.
3. **Expect**: only Summary is asked (pre-filled with its default); fixed values apply with no
   re-entry; one confirm creates the issue.
4. Build a second template with **zero** prompt fields; launch.
5. **Expect**: a single confirmed action creates the issue with no value entry (SC-3, < 10s).

### S5 — Required-field guard *(FR-5.2; AS-8; SC-2)*
1. Build a template omitting a required field; attempt create.
2. **Expect**: the user is told exactly which required field is missing; **no** issue is created.

### S6 — Global sharing & reuse *(FR-4; AS-7; SC-6)*
1. Save a template as User A.
2. As User B (or a fresh client/profile against the same Confluence store), open the view.
3. **Expect**: User A's template is listed (author shown); launching it requires **0** re-entry
   of fixed values and creates exactly one issue with no stray links (FR-5.4).

### S7 — Metadata-unavailable resilience *(FR-7.2; AS-11; SC-7)*
1. Temporarily misconfigure Jira (or simulate a proxy error).
2. Open a picker.
3. **Expect**: a clear, non-technical error; **no** stale or guessed choices shown.

### S8 — Template drift *(FR-7.3)*
1. Save a template using a custom dropdown option; remove that option in Jira.
2. Reload the library and try to launch the template.
3. **Expect**: the template is flagged for review; launch is blocked rather than creating a
   malformed issue.

### S9 — Concurrent edit safety *(template-store merge)*
1. Two users load the library; both edit different templates; both save.
2. **Expect**: both edits survive (3-way merge by template id); no silent overwrite. Editing the
   **same** template on both sides surfaces a conflict rather than last-writer-win.

## Pass criteria

All of S1–S9 behave as described, `vitest` + `tsc` are green, and a created issue is verified
directly in Jira (Article X — not just an HTTP 200).
