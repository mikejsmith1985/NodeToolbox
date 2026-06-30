// requiredFields.ts — Pure pre-create validation: which required fields still lack a value.
// Given the issue type's field descriptors and the about-to-send payload fields, returns the
// human names of required fields that are missing, so the UI can block create and name them.

import type { FieldDescriptor } from './templateTypes.ts';

/**
 * Returns the names of required fields absent from the create payload. project/issuetype are
 * always set by the payload builder and are not field descriptors, so they are never reported.
 */
export function findMissingRequiredFields(
  descriptors: FieldDescriptor[],
  payloadFields: Record<string, unknown>,
): string[] {
  return descriptors
    .filter((descriptor) => descriptor.required && payloadFields[descriptor.fieldId] === undefined)
    .map((descriptor) => descriptor.name);
}
