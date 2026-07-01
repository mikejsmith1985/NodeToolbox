// mapSharePointItem.ts — Turns a SharePoint List item (keyed by internal field names) into the flat
// display-keyed RawRow the file path produces, so the existing normalizeSubmission is reused
// verbatim (no SheetJS on this path). Pure (no I/O). See spec 007 data-model + research R5.

import type { RawRow } from './parseSubmissions.ts';

/** The intake contract's display column names, in queue-display order. */
export const INTAKE_DISPLAY_COLUMNS = [
  'id', 'submittedAt', 'status', 'submitterDisplayName', 'submitterEmail',
  'summary', 'description', 'acceptanceCriteria', 'issueType', 'priority', 'project',
] as const;

/**
 * Maps one SharePoint item to a flat RawRow using the display→internal field map. Each expected
 * display column is read via its resolved internal name; absent/blank values become ''.
 */
export function mapSharePointItem(item: Record<string, unknown>, fieldMap: Map<string, string>): RawRow {
  const row: RawRow = {};
  for (const displayName of INTAKE_DISPLAY_COLUMNS) {
    const internalName = fieldMap.get(displayName);
    if (!internalName) {
      continue;
    }
    const value = item[internalName];
    row[displayName] = value === null || value === undefined ? '' : String(value);
  }
  return row;
}
