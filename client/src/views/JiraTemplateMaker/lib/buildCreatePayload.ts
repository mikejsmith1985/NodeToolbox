// buildCreatePayload.ts — Turns a template + launch answers into a POST /issue request body.
// Pure (no I/O). Maps each supported field type to the Jira REST v2 (Server/DC) shape per
// data-model.md §1. Fields whose resolved value is empty are omitted so optional unset fields
// are not sent.

import type { CreateIssueRequest } from '../../../types/jira.ts';
import { dedupeLabels } from './labels.ts';
import type { JiraTemplate, TemplateFieldEntry } from './templateTypes.ts';

export interface BuildCreatePayloadInput {
  template: JiraTemplate;
  /** fieldId → value supplied at launch for prompt-at-launch fields. */
  launchAnswers: Record<string, unknown>;
}

/** Extracts an option id from either a `{ id }` object or a bare string id. */
function toOptionReference(value: unknown): { id: string } | null {
  if (typeof value === 'string' && value) {
    return { id: value };
  }
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return { id: (value as { id: string }).id };
  }
  return null;
}

/** Maps an array of option-like values to an array of `{ id }` references. */
function toOptionReferenceArray(value: unknown): Array<{ id: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(toOptionReference).filter((reference): reference is { id: string } => reference !== null);
}

/** Resolves the value to send for one field, or undefined when it should be omitted. */
function resolveFieldValue(entry: TemplateFieldEntry, launchAnswers: Record<string, unknown>): unknown {
  const rawValue = entry.mode === 'fixed'
    ? entry.value
    : (launchAnswers[entry.fieldId] ?? entry.defaultValue);

  switch (entry.fieldType) {
    case 'text':
      return typeof rawValue === 'string' && rawValue.length > 0 ? rawValue : undefined;
    case 'number':
      return typeof rawValue === 'number' ? rawValue : undefined;
    case 'date':
    case 'datetime':
      return typeof rawValue === 'string' && rawValue.length > 0 ? rawValue : undefined;
    case 'choice':
      return toOptionReference(rawValue) ?? undefined;
    case 'multiChoice':
    case 'components':
    case 'versions': {
      const references = toOptionReferenceArray(rawValue);
      return references.length > 0 ? references : undefined;
    }
    case 'labels': {
      const labels = Array.isArray(rawValue) ? dedupeLabels(rawValue as string[]) : [];
      return labels.length > 0 ? labels : undefined;
    }
    case 'user': {
      const userName = typeof rawValue === 'string'
        ? rawValue
        : (rawValue as { name?: string } | null)?.name;
      return userName ? { name: userName } : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Builds the Jira create-issue request body. Always sets project and issue type by id, then
 * adds each templated field whose resolved value is present.
 */
export function buildCreatePayload({ template, launchAnswers }: BuildCreatePayloadInput): CreateIssueRequest {
  // Identify the project by key (works on Cloud + DC; the modern createmeta flow does not
  // surface a numeric project id). Jira accepts either { id } or { key } here.
  const fields: Record<string, unknown> = {
    project: { key: template.projectKey },
    issuetype: { id: template.issueTypeId },
  };

  for (const entry of template.fields) {
    const resolvedValue = resolveFieldValue(entry, launchAnswers);
    if (resolvedValue !== undefined) {
      fields[entry.fieldId] = resolvedValue;
    }
  }

  return { fields };
}
