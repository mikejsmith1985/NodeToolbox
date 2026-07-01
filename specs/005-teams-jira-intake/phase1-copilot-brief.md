# Copilot brief — Teams "New Request" form → Excel (Power Automate)

> **How to use:** paste the **"Prompt for Copilot"** block below into Microsoft Copilot (Copilot in
> Power Automate, or M365 Copilot with the Power Automate skill). Then use the **manual steps** and
> **reference material** to fill any gaps Copilot leaves. Everything here uses **standard, license-free**
> connectors only — **no Premium (no HTTP action, no Confluence/Jira connectors), no admin/elevated
> access, no app registration.**

---

## 0. One-time setup you do first (before Copilot)

Create the destination Excel workbook so the flow has a table to write to:

1. In your OneDrive for Business (or a SharePoint document library you can edit), create a workbook
   named e.g. **`Jira-Intake.xlsx`**.
2. Add these **exact column headers** in row 1 (11 columns):

   `id | submittedAt | status | submitterDisplayName | submitterEmail | summary | description | acceptanceCriteria | issueType | priority | project`

3. Select those headers → **Insert → Table** (check "My table has headers"). Rename the table to
   **`Submissions`** (Table Design → Table Name).
4. Save. This table is what Power Automate's "Add a row into a table" action targets.

> Keeping these column names exact means the file drops straight into NodeToolbox with no mapping guesswork.

> **About the `project` column:** it holds a **friendly project name** (e.g. `Cleanup Crew`), not a
> Jira project key. NodeToolbox maps each project name to a real Jira project key in its Intake
> settings (e.g. `Cleanup Crew` → `ENCUC`). Leave it blank and the row uses NodeToolbox's default
> project. It is optional on the form; add options as more projects start submitting. (The word
> "project" is used consistently across the Teams form, this column, and NodeToolbox.)

> ⚠️ **The Table accumulates — never recreate it.** Every submission appends **one row** to the
> **same** `Submissions` table, so over time the workbook holds all requests. When you later add a
> column, **do not** delete and rebuild the sheet/table (that resets it to a plain sheet with a
> single row and breaks the flow's table reference). Use the safe steps in **Section 6** instead.

---

## 1. Prompt for Copilot (paste this)

```
Help me build a Power Automate cloud flow using only STANDARD (non-premium) connectors — do not
use the HTTP action or any premium connector.

Goal: In Microsoft Teams, people click a "New Request" button and fill out a short Adaptive Card
form to request a Jira issue. When they submit, append one row to an Excel table.

Details:
- Post a persistent Adaptive Card to a specific Teams channel that contains a "New Request" button.
- When a user submits the form, capture their identity (display name and email) automatically from
  the Teams response — do NOT ask them to type it.
- The form collects: Summary (single line, required), Description (multi-line), Acceptance Criteria
  (multi-line), Issue Type (dropdown: Story, Bug, Task, Spike), Priority (dropdown: Highest, High,
  Medium, Low, Lowest), and an optional Project (dropdown of project names, may be left unset).
- On submit, use the Excel Online (Business) action "Add a row into a table" targeting the workbook
  "Jira-Intake.xlsx" and table "Submissions", writing these columns:
    id                   = a new GUID
    submittedAt          = current UTC time in ISO 8601
    status               = the literal text "New"
    submitterDisplayName = the responder's display name
    submitterEmail       = the responder's email
    summary, description, acceptanceCriteria, issueType, priority = the matching form inputs
    project              = the selected Project (a project name; leave blank if none was chosen)
- After writing the row, reply in the Teams thread confirming the request was received.

Use the Teams "Post adaptive card and wait for a response" action for the form so the responder's
identity is available. Keep everything on standard connectors.
```

---

## 2. Field → Excel column mapping (give these to Copilot / use when wiring the action)

| Excel column | Value / Power Automate expression |
|--------------|-----------------------------------|
| `id` | expression: `guid()` |
| `submittedAt` | expression: `utcNow()` |
| `status` | static text: `New` |
| `submitterDisplayName` | the Adaptive Card **responder**'s display name (dynamic content) |
| `submitterEmail` | the Adaptive Card **responder**'s email/UPN (dynamic content) |
| `summary` | form input `summary` |
| `description` | form input `description` |
| `acceptanceCriteria` | form input `acceptanceCriteria` |
| `issueType` | form input `issueType` |
| `priority` | form input `priority` |
| `project` | form input `project` (a project name; blank when none chosen) |

> The "Post adaptive card and wait for a response" action exposes the **responder** (who submitted)
> and the **submitted values**. Map responder → the two submitter columns; map inputs → the rest.
> The `project` column receives the **project** input — NodeToolbox translates the project name to
> the right Jira project key, so send the project name as-is (do not convert it to a key here).

---

## 3. Ready-to-paste Adaptive Card (the form)

Use this JSON in the card action. The `id` on each input is what you reference for the columns above.

```json
{
  "type": "AdaptiveCard",
  "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
  "version": "1.4",
  "body": [
    { "type": "TextBlock", "text": "New Jira Request", "weight": "Bolder", "size": "Medium" },
    { "type": "Input.Text", "id": "summary", "label": "Summary", "isRequired": true, "errorMessage": "Summary is required" },
    { "type": "Input.Text", "id": "description", "label": "Description", "isMultiline": true },
    { "type": "Input.Text", "id": "acceptanceCriteria", "label": "Acceptance Criteria", "isMultiline": true },
    { "type": "Input.ChoiceSet", "id": "issueType", "label": "Issue Type", "value": "Story",
      "choices": [
        { "title": "Story", "value": "Story" },
        { "title": "Bug", "value": "Bug" },
        { "title": "Task", "value": "Task" },
        { "title": "Spike", "value": "Spike" }
      ] },
    { "type": "Input.ChoiceSet", "id": "priority", "label": "Priority", "value": "Medium",
      "choices": [
        { "title": "Highest", "value": "Highest" },
        { "title": "High", "value": "High" },
        { "title": "Medium", "value": "Medium" },
        { "title": "Low", "value": "Low" },
        { "title": "Lowest", "value": "Lowest" }
      ] },
    { "type": "Input.ChoiceSet", "id": "project", "label": "Project (optional)", "isRequired": false,
      "placeholder": "Select a project",
      "choices": [
        { "title": "Cleanup Crew", "value": "Cleanup Crew" }
      ] }
  ],
  "actions": [ { "type": "Action.Submit", "title": "Submit request" } ]
}
```

> Add one `choices` entry per project as more projects start submitting. The value must match the
> project name you map in NodeToolbox Intake settings. Leaving Project unset writes a blank
> `project` cell, and NodeToolbox uses its default project for that row.

> Optional "launcher": if you'd rather have a persistent **New Request** button that opens this
> form, post a small card with an `Action.ShowCard` wrapping the body above, or a button that starts
> the flow. Copilot can set this up either way — the important part is the fields + the Excel write.

---

## 4. Manual step outline (if Copilot needs help finishing)

1. **New flow** → trigger: a way to present the card in the channel (e.g. a scheduled/manual post of
   the launcher card, or "For a selected message"). Simplest reliable pattern: **Post adaptive card
   and wait for a response** (Teams, standard) into the intake channel.
2. Paste the Adaptive Card JSON (section 3).
3. Add **Excel Online (Business) → Add a row into a table**; pick `Jira-Intake.xlsx` and table
   `Submissions`; map columns per section 2 (use `guid()` and `utcNow()` in the Expression tab).
4. Add **Post message in a chat or channel** (Teams) to confirm receipt.
5. Save and test.

---

## 5. Acceptance test (Phase-1 "done")

- Clicking the button/card opens the form; submitting **appends one row** to the `Submissions`
  table — and **previous rows remain** (the table grows over time).
- `id` is a unique GUID, `submittedAt` is a timestamp, `status` = `New`, and
  `submitterDisplayName`/`submitterEmail` are populated automatically (not typed).
- You can **download `Jira-Intake.xlsx`** (File → Download a copy) — and the download contains
  **all** rows, on a sheet with the `Submissions` table intact. That file is what you drag into
  NodeToolbox. NodeToolbox imports **every** row it finds, so a download with only one row means the
  workbook itself has only one row (see Section 6 — usually a rebuilt/reset table).

Then send me the downloaded **`.xlsx`** (or the header row + a couple of sample rows).

---

## 6. Adding or changing a column later — WITHOUT breaking the flow

> This is the safe way to extend the schema (e.g. the `project` column was added this way). The
> failure mode to avoid: deleting the sheet/table and starting over, which **resets the workbook to
> one row and detaches the flow's table reference** — the exact symptom of "the export only has one
> row."

**Do this (safe):**

1. Open `Jira-Intake.xlsx` in **Excel Online** (the same file the flow writes to — not a copy).
2. Click any cell **inside** the existing `Submissions` table.
3. Type the new header in the **first empty column immediately to the right of the table** — Excel
   auto-extends the table to include it (the new column joins `Submissions`; the table name and all
   existing rows are preserved). Do **not** Insert → Table again.
4. **Save.** Confirm under **Table Design** the table is still named **`Submissions`** and still
   contains all prior rows.
5. In Power Automate, open the flow → the **"Add a row into a table"** action. Re-select the
   **File** and **Table** (`Jira-Intake.xlsx` / `Submissions`) so the action refreshes its column
   list, then **map the new column** to its form input. Save.
6. If you added a form field, also add the matching input to the Adaptive Card (Section 3).
7. **Test:** submit once; confirm a **new** row is appended (total row count goes **up**, not back to
   one) and the new column is populated.

**Do NOT:**

- ❌ Delete the worksheet/table and recreate it (loses rows, renames the sheet to `Sheet1`, breaks
  the flow's table binding).
- ❌ Rename the `Submissions` table (the flow targets it by name).
- ❌ Edit a downloaded copy and expect the flow to use it — always edit the live workbook the flow
  points at.

**If the table was already rebuilt/reset** (download shows `Sheet1` and one row): re-add the
`Submissions` table (Insert → Table, name it `Submissions`), then in the flow's "Add a row into a
table" action re-select the file + table and re-map every column. Past rows that were lost cannot be
recovered, but new submissions will accumulate again.
