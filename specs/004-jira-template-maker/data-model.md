# Data Model — Jira Template Maker (Phase 1)

Entities the feature introduces or consumes. Persisted shapes are TypeScript-shaped JSON in a
Confluence content property; Jira metadata shapes are read-only projections of createmeta.

## 1. Persisted entities (template store)

Stored as one JSON document under the Confluence content-property key
`nodetoolbox-jira-templates` on the shared ART database (see contracts/template-store.md).

### JiraTemplateStore (the whole document)
| Field | Type | Notes |
|-------|------|-------|
| `schemaVersion` | number | Starts at `1`; gate load on a known version (independent of the ART payload version). |
| `updatedAt` | ISO string | Stamped on save. |
| `templates` | `JiraTemplate[]` | The shared library. |

### JiraTemplate
| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Stable unique id (used as merge key). |
| `name` | string | Human label shown in the library (required, non-empty). |
| `description` | string | Optional free text describing the template. |
| `projectKey` | string | The bound project (one). |
| `projectId` | string | Jira project id (createmeta uses ids). |
| `issueTypeId` | string | The bound issue type (one). |
| `issueTypeName` | string | Cached display name for the library list. |
| `fields` | `TemplateFieldEntry[]` | Ordered; one per chosen field. |
| `authorName` | string | Recorded author (global sharing; anyone may edit). Resolved from `GET /rest/api/2/myself` display name; `unknown` if the lookup fails (research.md D8). |
| `createdAt` / `updatedAt` | ISO string | Audit. |

**Validation**: `name` non-empty; `projectKey`+`issueTypeId` present; every `fields[].fieldId`
must be unique within a template.

### TemplateFieldEntry
| Field | Type | Notes |
|-------|------|-------|
| `fieldId` | string | Jira field id (e.g. `summary`, `priority`, `customfield_10010`). |
| `fieldName` | string | Cached human name (shown as the primary label per FR-6.1). |
| `fieldType` | enum | Internal type: `text` \| `choice` \| `multiChoice` \| `labels` \| `user` \| `date` \| `datetime` \| `number` \| `components` \| `versions` (UI label: "Fix versions"). |
| `mode` | enum | `fixed` \| `promptAtLaunch` (FR-2.5). |
| `value` | type-dependent | Present when `mode=fixed`; the stored value. For `promptAtLaunch`, omitted (optional `defaultValue` allowed). |
| `defaultValue` | type-dependent | Optional pre-fill for a prompt-at-launch field. |

**Per-type value shape** (what `value`/`defaultValue` hold):
| fieldType | Shape | Created-payload mapping (REST v2) |
|-----------|-------|-----------------------------------|
| `text` | wiki-markup string | string |
| `choice` | `{ id }` (option id) | `{ id }` |
| `multiChoice` | `{ id }[]` | `[{ id }]` |
| `labels` | `string[]` (case-sensitive, deduped) | `string[]` |
| `user` | `{ accountIdOrName }` | `{ name }` (Server/DC) / `{ accountId }` (Cloud) |
| `date` | `YYYY-MM-DD` | string |
| `datetime` | ISO 8601 | string |
| `number` | number | number |
| `components` | `{ id }[]` | `[{ id }]` |
| `versions` | `{ id }[]` | `[{ id }]` |

**State / lifecycle**: a template is *draft* (in the wizard, unsaved) → *saved* (in the shared
library) → optionally *stale* (a referenced issue type/field/option no longer exists in
createmeta; flagged for review per FR-7.3, never silently used).

## 2. Launch-time (transient, not persisted)

### LaunchAnswers
A map `fieldId → value` collected at launch for every `promptAtLaunch` field, validated against
the same per-type rules before create. Combined with the template's `fixed` entries by
`lib/buildCreatePayload.ts` to produce the `POST /issue` body.

## 3. Jira metadata (read-only projections of createmeta)

Not persisted; derived per project+issuetype and cached in component state.

### CreateMetaProject → IssueTypeOption
| Field | Type | Source |
|-------|------|--------|
| `id` / `key` / `name` | string | `createmeta.projects[]` |
| `issueTypes` | `IssueTypeOption[]` | `projects[].issuetypes[]` (`{ id, name, subtask }`) |

### FieldDescriptor (internal model from `lib/fieldModel.ts`)
| Field | Type | Source / Notes |
|-------|------|----------------|
| `fieldId` | string | createmeta field key |
| `name` | string | `field.name` (human label) |
| `required` | boolean | `field.required` |
| `internalType` | enum | mapped from `field.schema` (`type`,`items`,`custom`) → the `fieldType` enum above |
| `isSupported` | boolean | false for cascading/dependent + unknown custom types → shown unaddable |
| `allowedValues` | `{ id, name }[]?` | `field.allowedValues` for choice/components/versions |
| `hasDefault` | boolean | createmeta `hasDefaultValue` (informational) |

**Mapping rules** (createmeta `schema` → `internalType`), pure & unit-tested:
- `schema.type=string` → `text`
- `schema.type=option` → `choice`; `schema.type=array & items=option` → `multiChoice`
- `schema.system=labels` or `schema.type=array & items=string & custom~labels` → `labels`
- `schema.type=user` → `user`; `array & items=user` → (multi-user; v1 may treat as unsupported)
- `schema.type=date` → `date`; `datetime` → `datetime`; `number` → `number`
- `schema.type=array & items=component` → `components`; `items=version` → `versions`
- `schema.type=option-with-child` (cascading) → `isSupported=false`
- anything unmatched → `isSupported=false`

## 4. Relationships

- `JiraTemplate` **1—1** project + issue type (bound, immutable after creation without re-scope).
- `JiraTemplate` **1—N** `TemplateFieldEntry`; each entry **references** one Jira field by id.
- `TemplateFieldEntry.value` for choice-like types **references** option ids that must still
  exist in live createmeta at launch (else the template is flagged stale).
- `JiraTemplateStore` **1—N** `JiraTemplate`; the store is one shared blob, merge-keyed by
  `JiraTemplate.id`.

## 5. Invariants (testable)

- **INV-1**: A choice/multiChoice/components/versions value only ever holds option ids that
  appear in the field's current `allowedValues` (SC-4: 0 invalid options).
- **INV-2**: Labels in a template are case-sensitively unique (`Ops` ≠ `ops`, no duplicate
  `Ops`); on create, labels already on the issue are not re-added (FR-3, SC-5).
- **INV-3**: Every required field for the issue type has a value (fixed or launch-supplied)
  before a create is attempted (FR-5.2).
- **INV-4**: The store never contains a physical Jira issue id as its "template" — only field
  definitions (FR-4.2).
- **INV-5**: Loading the store rejects an unknown `schemaVersion` rather than mis-parsing.
