# Contract: Inline Field Editing

Covers FR-005/006 (render), FR-008 (edit-what-we-can-write), FR-009 (read-only remainder), FR-010 (immediate reflect
+ error handling), FR-011 (dead-simple layout). **Governing rule: the editors add control shape only; every WRITE
delegates to an existing `featureReviewFixes.ts` function.**

## `IssueDetailPanel` — new optional `fieldEditing` capability (additive, default-off)

New optional prop, e.g.:
```ts
fieldEditing?: {
  editMeta: FeatureReviewEditMeta;        // from fetchFeatureReviewEditMeta(key)
  onFieldSaved: (fieldKey: string) => void; // host triggers refetch (FR-010)
}
```
- **Omitted (every current caller: hygiene, AgileHub, …)** ⇒ panel renders exactly as today. Byte-identical. No
  regression. (017 optional-prop precedent.)
- **Provided (QuickLookup)** ⇒ the currently read-only fields (summary, assignee, priority/single-selects, fix
  versions, issue links, labels) render an inline editor from `IssueFieldEditors/`, gated per-field by what `editMeta`
  says is settable. Story points and status keep their existing editors. Description stays read-only regardless.

## `IssueFieldEditors/` control family

Each editor is a small controlled component: displays the current value, reveals an input on activate, Save/Cancel,
shows saving/confirmed/error inline.

| Editor | Reads options from | Save delegates to |
|--------|--------------------|-------------------|
| `TextFieldEditor` (summary; issue-link key) | — | `saveFeatureReviewSimpleField` / `saveFeatureReviewIssueLinkField` |
| `SelectFieldEditor` (priority, single-selects, fix versions) | `readFeatureReviewSelectOptions(editMeta)` / `fetchFeatureReviewFixVersions` | `saveFeatureReviewOptionField` / `saveFeatureReviewFixVersion` |
| `AssigneeFieldEditor` | `searchFeatureReviewUsers(query)` | `saveFeatureReviewUserField` |
| `LabelsFieldEditor` | `editMeta` labels allowed values | `saveFeatureReviewSimpleField` (array set); **read-only fallback if editMeta lacks a settable labels field** |

**`fieldEditorPayloads.ts`** (pure, red-first): maps an editor's selected value → the exact Jira write payload each
writer expects (mirrors the `buildStoryPointsPayload` / editmeta-option-matching logic already in
`featureReviewFixes.ts`). This is the unit-tested core; the writers themselves are unchanged.

## Save semantics (FR-010)

- Each field saves **individually** on its own Save (no batched "save all"; that batching is FeatureReview's UX, not
  ours).
- On success: optimistic in-place update **then** `onFieldSaved` → host `refetch()` reconciles; a Toast confirms
  (reuse `ToastProvider`). No full reload; popup stays open; user keeps their place.
- On failure: readable inline error on that field; the field reverts to its prior value; the rest of the panel is
  unaffected.

## Read-only remainder (FR-009)

- Description (structure-preserving render, not editable), attachments, watchers, votes, worklogs, and any field with
  no settable editmeta entry render read-only. The **key link** (`lookup-and-fetch.md`) is the escape hatch.

## Layout (FR-011)

- Primary fields (status, assignee, priority, story points) sit near the top, reachable/editable without scrolling on
  a typical issue. Inherits `IssueDetailPanel`'s existing grouping + `IssueMeta` chips (label always beside color).
