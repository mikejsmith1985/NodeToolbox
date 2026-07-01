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

## Step 5 — Where to write it (STANDARD connectors only)

> Confirmed: Power Automate's **HTTP action and Confluence/Jira/ServiceNow connectors are premium**
> and unavailable in this tenant, and elevated access / app registrations are a no-go. So the store
> must be written with a **standard** connector, and Toolbox ingests an **exported file** (no
> server-side API/auth needed).

Pick one (both are standard, license-free):

- **Excel Online (Business) → "Add a row into a table"** *(recommended)* — one workbook in
  SharePoint/OneDrive with a table whose columns are the fields below; one row per submission.
  Easiest for Toolbox to parse.
- **SharePoint → "Create item"** — an intake list with a column per field. Also fine; you'd use the
  list's built-in **Export to Excel/CSV** to get the file.

Columns / fields to write per submission:

| Column | Example |
|--------|---------|
| `id` | `2921ea40-6eff-47a5-aecf-ae3b6d7b76aa` (unique — used for dedup) |
| `submittedAt` | ISO 8601 |
| `status` | `New` |
| `submitterDisplayName` | `Michael Smith` |
| `submitterEmail` | `Michael_Smith3@hcsc.com` (→ Jira reporter) |
| `summary` / `description` / `acceptanceCriteria` / `issueType` / `priority` | the form values |

(Nested JSON like the sample record is also fine if you write a JSON/CSV file — Toolbox accepts
either nested or flat columns.)

## Definition of done for Phase 1

- Clicking **New Request** opens the form; submitting appends a row with the fields above and
  `status=New`.
- You can **download/export the store as Excel or CSV** (Excel download, or SharePoint → Export).
  That file is what you'll drag into Toolbox.

## Hand-off to Phase 2

Once the above works, the Toolbox importer (`spec.md`) will: accept the **drag-and-dropped
Excel/CSV**, parse rows newest-first, map fields per the intake template, create the Jira issue
(reporter = submitter when resolvable, else integration account + submitter recorded in the
description), and track processed `id`s locally so re-imports never double-create. Triage stays in
Jira for now; a configurable review queue is built for later team-wide use. A live SharePoint pull
(browser-relay, your session — no app registration) is a possible v2.
