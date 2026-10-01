# Quickstart validation: Release Document (038)

Automated (every run): `cd client && npx vitest run src/views/SprintDashboard/releaseDocument` and the full suite;
`npx tsc -b`; eslint on changed files.

Live (production, per CLAUDE.md "validation happens in production"):

| # | Steps | Expect |
|---|---|---|
| V-01 | Team Dashboard → CUC → Release Doc; paste a parent page link; pick an unreleased version | Title preview e.g. `2026Oct14` |
| V-02 | Pull from Jira | Every ENCUC issue with the version listed under its DASP/DENP Epic; orphans under "No Epic" (compare count with a Jira search) |
| V-03 | Add two deployment steps (one "PR: To be created"); Save | Page created under the parent; links clickable |
| V-04 | Change an item's status in Jira; Pull; Save | Status updated; both deployment steps unchanged |
| V-05 | Give an Epic a different fixVersion from a child | "Release check" flags it on Toolbox and the page |
| V-06 | Add a Note to an item; move the item to another version in Jira; Sync all | Item and its note appear only on the new release's page |
| V-07 | Release a version in Jira; Sync all | Its page untouched; report says skipped/not listed |
| V-08 | Transformers team (ENFCT children, DENP Epics) | Same results as V-02 |
