# Phase 1 — Build the Teams intake (Power Automate)

> Phase 1 is built **outside this repo**, in your Microsoft 365 tenant. This guide is the
> reference for what to build so it produces the **submission-record contract** the Toolbox
> importer (Phase 2, `spec.md` FR-5) expects. Build it, prove it works, then send back **one real
> stored record** to finalize the Phase-2 reader.

## Goal

A non-Toolbox user clicks **New Request** in a Teams intake channel, fills an Adaptive Card form,
and submits. Power Automate writes a submission record to the **bridge store** (Confluence first;
SharePoint list as a fallback). Toolbox later reads the store and creates the Jira issue.

```
Intake channel ──"New Request" button──► Adaptive Card form ──submit──► Power Automate
   └─ stamps submitter identity ──► writes submission record (Status=New) to the STORE
        └─ Toolbox reads the store ──► maps fields ──► creates Jira issue ──► Status=Imported (+ jiraKey)
```

## Step 1 — Launcher card (posted once to the channel)

- Create a flow that posts an **Adaptive Card** to the intake channel containing a single
  **"New Request"** button (`Action.Submit`, or `Action.ShowCard` to reveal the form inline).
- Pin/announce it so users always have a button to click (no DMs).

## Step 2 — The request form (Adaptive Card, core fields)

Keep v1 minimal so the Toolbox-side mapping stays simple:

| Field id | Control | Notes |
|----------|---------|-------|
| `summary` | `Input.Text` (required) | Issue summary |
| `description` | `Input.Text` multiline | Details |
| `issueType` | `Input.ChoiceSet` | Your common types (Story, Bug, …) |
| `priority` | `Input.ChoiceSet` | Highest…Lowest |
| *(optional)* 1–2 custom | as needed | Only if you need them in v1 |

Use the **"Post adaptive card and wait for a response"** action (or a card with `Action.Submit`).

## Step 3 — Stamp the submitter (do NOT ask the user to type it)

In the flow, read the triggering user's identity and capture **display name + email/UPN**
(Power Automate exposes this automatically). This is what Toolbox resolves to the Jira reporter.

## Step 4 — Write the submission record to the store

Write **exactly this shape** (extra fields are fine; these are required):

```json
{
  "id": "<unique guid>",
  "submittedAt": "<ISO 8601 timestamp>",
  "status": "New",
  "submitter": { "displayName": "Jane Doe", "email": "jane.doe@corp.com" },
  "fields": {
    "summary": "...",
    "description": "...",
    "issueType": "Story",
    "priority": "High"
  }
}
```

- `id` — unique per submission (e.g. a guid). **Used for dedup** so Toolbox never double-creates.
- `status` — set to `New`. Toolbox flips it to `Imported` and writes back the created `jiraKey`,
  so the store must allow that field to be **updated**.
- `submitter` — drives the Jira **reporter** (fallback: integration account + recorded in the
  description if the email doesn't match a Jira user).
- `fields` — the core values; Toolbox **maps** these to real Jira fields via the intake template.

## Step 5 — Where to write it

**Try Confluence first** (Toolbox already reads/writes it via API token — Rovo-independent):
- Power Automate **HTTP action** to Confluence Cloud, **Basic auth** = base64(`email:apiToken`).
- Append each record to a Confluence page/Database that Toolbox can read, keeping `status`
  updatable.
- **This is the step to validate.** If your tenant blocks Power Automate → Confluence, stop and
  tell us — we pivot the store to a **SharePoint list** (which adds a new Toolbox reader).

## Definition of done for Phase 1

- Clicking **New Request** opens the form; submitting writes a record with the shape above.
- The record lands in the store with `status=New` and a populated `submitter`.
- You can **send back one real stored record** (the actual JSON/row). That sample finalizes the
  Phase-2 reader contract before the Toolbox importer is built.

## Hand-off to Phase 2

Once the above works, the Toolbox importer (`spec.md`) will: read `New` records newest-first,
map fields per the intake template, create the Jira issue (reporter = submitter when resolvable),
then mark the record `Imported` with its `jiraKey`. Triage stays in Jira for now; a configurable
review queue is built for later team-wide use.
