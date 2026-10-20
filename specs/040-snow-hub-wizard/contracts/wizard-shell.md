# Contract: Wizard Shell

Built on 039's `components/GuidedFlow/GuidedFlowShell` (shared; built there if 039 has not shipped it).

## Screens

- **Home**: three large choices — *Make or change a change*, *Turn a problem into Jira work*, *Review a change* — and a
  resume card per in-progress job.
- **Connect**: two rows (ServiceNow, Jira), each `not connected → connecting → connected as <name>`; numbered
  instructions with one action button each ("Open Jira"). Jobs are disabled until both read live.
- **ConnectionBanner**: on every screen; turns amber on `expired` with the one action that fixes it; the current step is
  kept.

## Step rules (every wizard)

| Rule | Check |
|---|---|
| One kind of decision per screen | review checklist in quickstart |
| Header "Step N of M — <plain verb phrase>" | component test |
| **Next** is the single primary button; disabled with the reason shown beneath it | component test |
| **Back** never loses entries | component test |
| No internal field names (`u_*`, `cmdb_ci`, `customfield_*`) in any visible text | a test scans rendered copy (pattern of `poToolWithoutAi.test.tsx`) |
| Exact-match values come from `<select>`s fed by the system's own list | review |
| Each step ≤ 7 visible inputs; anything optional sits under "More options" | review |

## Resume

`wizardJobStore` (zustand + browser storage) holds `WizardJob`s; on open, an in-progress job offers **Continue** /
**Start again**. `stepId` is re-derived from the job's data so resume cannot skip a prerequisite.
