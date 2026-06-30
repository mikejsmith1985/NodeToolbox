// fieldModel.ts — Maps Jira createmeta field descriptors to the tool's internal field model.
// Pure (no I/O): given one createmeta field, classify its type and whether the tool supports it.

import type { CreateMetaField } from '../../../types/jira.ts';
import type { AllowedOption, FieldDescriptor, TemplateFieldType } from './templateTypes.ts';

// Jira schema item types that resolve an array field to a known internal type.
const ARRAY_ITEM_TYPE_MAP: Record<string, TemplateFieldType> = {
  option: 'multiChoice',
  component: 'components',
  version: 'versions',
};

// Jira scalar schema types that map directly to an internal type. Anything choice-like
// (priority/option/etc.) is funneled to 'choice' separately below.
const SCALAR_TYPE_MAP: Record<string, TemplateFieldType> = {
  string: 'text',
  user: 'user',
  date: 'date',
  datetime: 'datetime',
  number: 'number',
};

/** Normalizes a createmeta allowedValues list to { id, label } using name or value. */
function normalizeAllowedValues(field: CreateMetaField): AllowedOption[] | undefined {
  if (!Array.isArray(field.allowedValues)) {
    return undefined;
  }
  return field.allowedValues.map((option) => ({
    id: option.id,
    label: option.name ?? option.value ?? option.id,
  }));
}

/**
 * Resolves the internal field type for a createmeta schema, or null when the tool does not
 * support the field (e.g. cascading selects, or any unrecognized type). Guard clauses keep
 * the unsupported path explicit rather than guessing.
 */
function resolveInternalType(field: CreateMetaField): TemplateFieldType | null {
  const schema = field.schema;
  if (!schema) {
    return null;
  }

  // The labels system field is an array of strings but has dedicated handling.
  if (schema.system === 'labels') {
    return 'labels';
  }

  // Cascading/dependent selects are out of scope for this release.
  if (schema.type === 'option-with-child') {
    return null;
  }

  if (schema.type === 'array') {
    if (schema.items === 'string') {
      // A custom labels-style multi-string field also maps to labels.
      return 'labels';
    }
    return ARRAY_ITEM_TYPE_MAP[schema.items ?? ''] ?? null;
  }

  // Single-select choice fields surface as a dropdown of allowedValues.
  if (schema.type === 'option' || schema.type === 'priority') {
    return 'choice';
  }

  return SCALAR_TYPE_MAP[schema.type] ?? null;
}

/**
 * Maps one Jira createmeta field to a FieldDescriptor the wizard can render.
 * Unsupported types are flagged (isSupported=false, internalType=null) so the field picker
 * can show them as visible-but-not-addable instead of silently hiding them.
 */
export function mapCreateMetaField(fieldId: string, field: CreateMetaField): FieldDescriptor {
  const internalType = resolveInternalType(field);
  const isSupported = internalType !== null;
  return {
    fieldId,
    name: field.name,
    required: Boolean(field.required),
    internalType,
    isSupported,
    allowedValues: normalizeAllowedValues(field),
    hasDefault: Boolean(field.hasDefaultValue),
  };
}

/** Maps an entire issue type's createmeta fields map to descriptors, sorted required-first. */
export function mapCreateMetaFields(fields: Record<string, CreateMetaField>): FieldDescriptor[] {
  return Object.entries(fields)
    .map(([fieldId, field]) => mapCreateMetaField(fieldId, field))
    .sort((left, right) => {
      if (left.required !== right.required) {
        return left.required ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
}
