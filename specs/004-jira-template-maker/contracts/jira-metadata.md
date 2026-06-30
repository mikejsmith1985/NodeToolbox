# Contract — Jira metadata & issue creation

All calls go through the existing `/jira-proxy/*` route via `client/src/services/jiraApi.ts`
(`jiraGet`/`jiraPost`). The proxy injects auth server-side; the browser never sees credentials.
Paths below are the real Jira REST paths the client appends after `/jira-proxy`.

> Flavor note (research.md D1): default target is **Jira Server/DC**, REST v2, wiki-markup text.
> If confirmed Cloud, the createmeta and text shapes change as noted; the wrappers' signatures
> do not.

## C1 — List projects *(reused)*

- **Call**: `jiraGet<JiraProject[]>('/rest/api/2/project')`
- **Already used by** `JiraProjectPicker`. No new code.
- **Returns**: `[{ id, key, name }]`.

## C2 — Get create metadata *(new wrapper: `getCreateMeta`)*

- **Call (Server/DC)**:
  `jiraGet<CreateMetaResponse>('/rest/api/2/issue/createmeta?projectKeys={KEY}&expand=projects.issuetypes.fields')`
- **Call (Cloud alternative)**: `/rest/api/3/issue/createmeta/{projectId}/issuetypes` then
  `/rest/api/3/issue/createmeta/{projectId}/issuetypes/{issueTypeId}` (paged).
- **Response (relevant subset)**:
  ```jsonc
  {
    "projects": [{
      "id": "10000", "key": "ABC", "name": "Alpha",
      "issuetypes": [{
        "id": "10001", "name": "Task", "subtask": false,
        "fields": {
          "summary":  { "required": true,  "name": "Summary",
                        "schema": { "type": "string", "system": "summary" } },
          "priority": { "required": false, "name": "Priority",
                        "schema": { "type": "priority", "system": "priority" },
                        "allowedValues": [{ "id": "1", "name": "Highest" }, { "id": "2", "name": "High" }] },
          "labels":   { "required": false, "name": "Labels",
                        "schema": { "type": "array", "items": "string", "system": "labels" } },
          "customfield_10010": { "required": false, "name": "Team",
                        "schema": { "type": "option", "custom": "...:select" },
                        "allowedValues": [{ "id": "10100", "value": "Platform" }] }
        }
      }]
    }]
  }
  ```
- **Mapping**: `lib/fieldModel.ts` reduces each `fields[fieldId]` to a `FieldDescriptor`
  (data-model §3), classifying `isSupported`. Issue types come from `projects[0].issuetypes[]`.
- **Errors**: thrown by `jiraApi` as `Error` (status + Jira message). Caller shows a plain-language
  message and presents **no** guessed data (FR-7.2).
- **Note**: `allowedValues` option identity may use `id` (priority/components/versions) or
  `id`+`value` (custom selects). The model keys on `id`; `name`/`value` is the display label.

## C3 — Create issue *(new wrapper: `createIssue`)*

- **Call**: `jiraPost<CreateIssueResponse>('/rest/api/2/issue', { fields: { ... } })`
- **Request `fields` mapping** (per data-model §1 per-type table). Example:
  ```jsonc
  {
    "fields": {
      "project":   { "id": "10000" },
      "issuetype": { "id": "10001" },
      "summary":   "Weekly ops sweep",
      "description": "h3. Checklist\n* item one\n* item two",   // wiki markup (Server/DC)
      "priority":  { "id": "2" },
      "labels":    ["Ops", "ops"],                               // case-sensitive, deduped
      "components":[{ "id": "10020" }],
      "customfield_10010": { "id": "10100" }
    }
  }
  ```
- **Response**: `{ id, key, self }` → the client builds the open-in-Jira link from `key`
  (FR-5.3) using the configured base URL.
- **Reporter (FR-5.5)**: include `reporter` only when the template/launch set it
  (`{ name }` Server/DC, `{ accountId }` Cloud); when omitted, Jira assigns the integration
  account as reporter — surfaced to the user.
- **Pre-create validation (client, FR-5.2)**: every `required` `FieldDescriptor` must have a
  value (fixed or launch). Missing → block create, name the field(s), create nothing.
- **Errors**: Jira 400 with `errors{}` is surfaced field-by-field in plain language; no partial
  issue is created (create is a single atomic POST).

## C4 — Label dedupe rule (applied before C3)

- Within a template: collapse exact-duplicate labels (case-sensitive) to one (FR-3.2).
- On create: the create POST sets the issue's labels to the template's deduped set; because the
  issue is new there are no pre-existing labels to collide with, **but** if a future revision
  targets adding labels to an existing issue, the set is unioned case-sensitively so none are
  duplicated (FR-3.3). Reject labels Jira disallows (e.g. containing spaces) with a clear
  message before create (FR-3.4).

## Type additions (`client/src/types/jira.ts`)

New: `CreateMetaResponse`, `CreateMetaProject`, `CreateMetaIssueType`, `CreateMetaFieldSchema`,
`CreateMetaField`, `CreateIssueRequest`, `CreateIssueResponse`. (None exist today.)
