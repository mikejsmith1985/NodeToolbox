// prefillUrl.ts — Builds a Jira Data Center "CreateIssueDetails" prefill URL from a template.
// Pure (no I/O). The resulting link opens Jira's native create screen pre-populated, so a
// NON-Toolbox user can create the issue under their own Jira session. Field params use the Jira
// field id as the key and the type-appropriate value; hand-mapped params (manualUrlParams) are a
// fallback for anything the API can't map. Prompt-at-launch fields contribute only a default (if
// set) — otherwise they're left blank for the user to fill in Jira.

import type { JiraTemplate, TemplateFieldEntry } from './templateTypes.ts';

// The classic Jira Server/Data Center servlet that pre-fills the create-issue screen.
const CREATE_ISSUE_DETAILS_PATH = '/secure/CreateIssueDetails!init.jspa';

/** Reads an option id from a `{ id }` object or a bare string. */
function readOptionId(value: unknown): string | null {
  if (typeof value === 'string' && value) {
    return value;
  }
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return null;
}

/** The value a field contributes to the URL: its fixed value, or a prompt field's default. */
function effectiveValue(entry: TemplateFieldEntry): unknown {
  return entry.mode === 'fixed' ? entry.value : entry.defaultValue;
}

/** Appends one field's parameter(s) to the query, by field type. */
function appendFieldParams(params: URLSearchParams, entry: TemplateFieldEntry): void {
  const value = effectiveValue(entry);
  if (value === undefined || value === null || value === '') {
    return;
  }
  switch (entry.fieldType) {
    case 'text':
    case 'date':
    case 'datetime':
      params.append(entry.fieldId, String(value));
      break;
    case 'number':
      params.append(entry.fieldId, String(value));
      break;
    case 'user': {
      const userName = typeof value === 'string' ? value : (value as { name?: string } | null)?.name;
      if (userName) {
        params.append(entry.fieldId, userName);
      }
      break;
    }
    case 'choice': {
      const optionId = readOptionId(value);
      if (optionId) {
        params.append(entry.fieldId, optionId);
      }
      break;
    }
    case 'multiChoice':
    case 'components':
    case 'versions': {
      if (Array.isArray(value)) {
        for (const optionValue of value) {
          const optionId = readOptionId(optionValue);
          if (optionId) {
            params.append(entry.fieldId, optionId);
          }
        }
      }
      break;
    }
    case 'labels': {
      if (Array.isArray(value)) {
        for (const label of value) {
          params.append(entry.fieldId, String(label));
        }
      }
      break;
    }
    default:
      break;
  }
}

export interface BuildPrefillUrlInput {
  baseUrl: string;
  template: JiraTemplate;
}

/**
 * Builds the shareable CreateIssueDetails prefill URL for a template. Returns an empty string
 * when the base URL or project id is missing (the caller can show a "share link unavailable" hint).
 */
export function buildPrefillUrl({ baseUrl, template }: BuildPrefillUrlInput): string {
  if (!baseUrl || !template.projectId) {
    return '';
  }
  const params = new URLSearchParams();
  params.append('pid', template.projectId);
  if (template.issueTypeId) {
    params.append('issuetype', template.issueTypeId);
  }
  for (const entry of template.fields) {
    appendFieldParams(params, entry);
  }
  for (const manualParam of template.manualUrlParams ?? []) {
    if (manualParam.param.trim()) {
      params.append(manualParam.param.trim(), manualParam.value);
    }
  }
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  return `${normalizedBaseUrl}${CREATE_ISSUE_DETAILS_PATH}?${params.toString()}`;
}
