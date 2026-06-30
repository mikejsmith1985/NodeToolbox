// drift.ts — Detects when a saved template references Jira fields/options that no longer exist.
// Pure (no I/O). Used to flag a template for review instead of creating a malformed issue (FR-7.3).

import type { FieldDescriptor } from './templateTypes.ts';
import type { JiraTemplate, TemplateFieldEntry } from './templateTypes.ts';

export interface TemplateDrift {
  /** Field ids in the template that are no longer offered by the issue type. */
  missingFieldIds: string[];
  /** Field ids whose selected option id is no longer a valid allowed value. */
  invalidOptionFieldIds: string[];
}

const OPTION_FIELD_TYPES = new Set(['choice', 'multiChoice', 'components', 'versions']);

/** Collects the option ids referenced by a field entry's value (handles single and array). */
function collectSelectedOptionIds(entry: TemplateFieldEntry): string[] {
  const values = Array.isArray(entry.value) ? entry.value : [entry.value];
  return values
    .map((value) => {
      if (typeof value === 'string') {
        return value;
      }
      if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
        return (value as { id: string }).id;
      }
      return null;
    })
    .filter((id): id is string => id !== null);
}

/**
 * Compares a template against the current field descriptors for its issue type and reports any
 * drift: fields that vanished, or selected options that are no longer valid.
 */
export function findTemplateDrift(template: JiraTemplate, descriptors: FieldDescriptor[]): TemplateDrift {
  const descriptorById = new Map(descriptors.map((descriptor) => [descriptor.fieldId, descriptor]));
  const missingFieldIds: string[] = [];
  const invalidOptionFieldIds: string[] = [];

  for (const entry of template.fields) {
    const descriptor = descriptorById.get(entry.fieldId);
    if (!descriptor) {
      missingFieldIds.push(entry.fieldId);
      continue;
    }
    if (OPTION_FIELD_TYPES.has(entry.fieldType) && descriptor.allowedValues) {
      const allowedIds = new Set(descriptor.allowedValues.map((option) => option.id));
      const hasInvalidOption = collectSelectedOptionIds(entry).some((id) => !allowedIds.has(id));
      if (hasInvalidOption) {
        invalidOptionFieldIds.push(entry.fieldId);
      }
    }
  }

  return { missingFieldIds, invalidOptionFieldIds };
}

/** True when a template has any drift and must be reviewed before use. */
export function isTemplateStale(drift: TemplateDrift): boolean {
  return drift.missingFieldIds.length > 0 || drift.invalidOptionFieldIds.length > 0;
}
