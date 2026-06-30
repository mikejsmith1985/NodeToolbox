// templateTypes.ts — Persisted and in-memory shapes for the Jira Template Maker.
// These describe templates stored in the shared Confluence content property and the
// internal field model derived from Jira createmeta. No I/O lives here.

/** Internal field type the tool knows how to render and serialize (Q1=B supported set). */
export type TemplateFieldType =
  | 'text'
  | 'choice'
  | 'multiChoice'
  | 'labels'
  | 'user'
  | 'date'
  | 'datetime'
  | 'number'
  | 'components'
  | 'versions';

/** How a templated field supplies its value at launch time. */
export type FieldEntryMode = 'fixed' | 'promptAtLaunch';

/** A normalized allowed option for choice/components/versions fields. */
export interface AllowedOption {
  id: string;
  label: string;
}

/**
 * The internal description of a single Jira field for a project+issue type, mapped from
 * createmeta. `isSupported` is false for field types this release cannot handle (e.g.
 * cascading selects); such fields are shown in the picker but cannot be added.
 */
export interface FieldDescriptor {
  fieldId: string;
  name: string;
  required: boolean;
  /** null when the field type is unsupported. */
  internalType: TemplateFieldType | null;
  isSupported: boolean;
  allowedValues?: AllowedOption[];
  hasDefault: boolean;
}

/**
 * A manual URL parameter the user maps by hand for the shareable prefill link, used when the
 * API can't supply the right field name or value automatically (e.g. an unsupported field type).
 */
export interface ManualUrlParam {
  /** The URL query parameter name (e.g. a field id like `customfield_10010` or `labels`). */
  param: string;
  /** The raw value to assign to it. */
  value: string;
}

/** One field captured in a template, with its value or prompt mode. */
export interface TemplateFieldEntry {
  fieldId: string;
  fieldName: string;
  fieldType: TemplateFieldType;
  mode: FieldEntryMode;
  /** Present when mode === 'fixed'. Shape depends on fieldType (see data-model.md §1). */
  value?: unknown;
  /** Optional pre-fill for a prompt-at-launch field. */
  defaultValue?: unknown;
}

/** A reusable, globally-shared issue template bound to one project + issue type. */
export interface JiraTemplate {
  id: string;
  name: string;
  description: string;
  projectKey: string;
  /** Numeric Jira project id, needed for the prefill URL's `pid` parameter. */
  projectId: string;
  issueTypeId: string;
  issueTypeName: string;
  fields: TemplateFieldEntry[];
  /** Hand-mapped URL parameters appended to the shareable prefill link (manual fallback). */
  manualUrlParams?: ManualUrlParam[];
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

/** The whole template library document stored under one Confluence content-property key. */
export interface JiraTemplateStore {
  schemaVersion: number;
  updatedAt: string;
  templates: JiraTemplate[];
}

/** Current store schema version; load rejects unknown versions (INV-5). */
export const JIRA_TEMPLATE_STORE_SCHEMA_VERSION = 1;
