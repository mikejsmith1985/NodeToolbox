// snowFieldValues.ts — Reads ServiceNow Table API fields (plain text, choice values, references).
//
// The change builder hook exported these, so every module that reads a ServiceNow record imported the hook. When the
// hook began to import those modules in turn (to date a new change's CTASKs), the two formed an import cycle. Kept
// here, with no import of the hook, the readers are shared without one.

import type { SnowReference } from './useCrgState.ts';

// What an empty or missing field reads as.
const EMPTY_VALUE = '';
const EMPTY_SNOW_REFERENCE: SnowReference = { sysId: '', displayName: '' };

/**
 * Extracts a human-readable string from a SNow field.
 * With sysparm_display_value=all, SNow wraps all fields as { value, display_value }.
 * Text fields use display_value; choice fields also use display_value for the label.
 */
export function extractStringValue(field: unknown): string {
  if (!field) return EMPTY_VALUE;
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field !== null) {
    const snowField = field as Record<string, unknown>;
    if ('display_value' in snowField) return String(snowField.display_value ?? EMPTY_VALUE);
    if ('value' in snowField) return String(snowField.value ?? EMPTY_VALUE);
  }
  return EMPTY_VALUE;
}

/**
 * Extracts the stored SNow value for choice fields. Choice dropdowns submit the internal
 * value (not the display label), so cloned CHGs must populate state with the same value.
 */
export function extractChoiceValue(field: unknown): string {
  if (!field) return EMPTY_VALUE;
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field !== null) {
    const snowField = field as Record<string, unknown>;
    const internalValue = String(snowField.value ?? EMPTY_VALUE).trim();
    if (internalValue) return internalValue;

    const displayValue = String(snowField.display_value ?? EMPTY_VALUE).trim();
    if (displayValue) return displayValue;
  }
  return EMPTY_VALUE;
}

/**
 * Extracts a SnowReference (sys_id + display name) from a SNow reference field.
 * SNow returns { value: sys_id, display_value: displayName } for reference fields
 * when sysparm_display_value=all is included in the request.
 */
export function extractSnowReference(field: unknown): SnowReference {
  if (typeof field === 'string') {
    return { sysId: EMPTY_VALUE, displayName: field };
  }
  if (!field || typeof field !== 'object') return { ...EMPTY_SNOW_REFERENCE };
  const snowField = field as Record<string, unknown>;
  const sysId = String(snowField.value ?? EMPTY_VALUE);
  const displayName = String(snowField.display_value ?? EMPTY_VALUE);
  if (!sysId && !displayName) return { ...EMPTY_SNOW_REFERENCE };
  return { sysId, displayName };
}
