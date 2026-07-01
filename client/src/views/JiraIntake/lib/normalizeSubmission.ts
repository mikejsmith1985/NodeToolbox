// normalizeSubmission.ts — Turns one raw parsed row into a validated IntakeSubmission. Pure (no
// I/O). Accepts both the flat spreadsheet shape (submitterEmail, summary) and the nested/dotted
// JSON shape (submitter.email, fields.summary), preserves unknown columns, and records — never
// throws — errors for missing required core fields. See data-model.md §1 and research.md R2.

import type { IntakeSubmission } from './intakeTypes.ts';

/** Flat column names that belong to the known contract (everything else becomes an `extra`). */
const KNOWN_FLAT_KEYS = new Set([
  'id', 'submittedAt', 'status',
  'submitterDisplayName', 'submitterEmail', 'submitter.displayName', 'submitter.email',
  'summary', 'description', 'acceptanceCriteria', 'issueType', 'priority',
  'fields.summary', 'fields.description', 'fields.acceptanceCriteria', 'fields.issueType', 'fields.priority',
]);

/** Reads a nested value like row.submitter.email when the row carries actual nested objects. */
function readNested(row: Record<string, unknown>, path: string[]): string {
  let current: unknown = row;
  for (const segment of path) {
    if (current === null || typeof current !== 'object') {
      return '';
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === 'string' ? current : current == null ? '' : String(current);
}

/**
 * Returns the first non-empty value for a field, checking (in order) the flat column, the
 * dotted column, and a genuinely nested object. Trims surrounding whitespace; inner characters
 * (including Unicode/smart quotes) are left untouched.
 */
function readField(row: Record<string, unknown>, flatKey: string, nestedPath: string[]): string {
  const dottedKey = nestedPath.join('.');
  const candidates: string[] = [];

  const flatValue = row[flatKey];
  if (typeof flatValue === 'string') { candidates.push(flatValue); }
  else if (flatValue != null && typeof flatValue !== 'object') { candidates.push(String(flatValue)); }

  const dottedValue = row[dottedKey];
  if (typeof dottedValue === 'string') { candidates.push(dottedValue); }
  else if (dottedValue != null && typeof dottedValue !== 'object') { candidates.push(String(dottedValue)); }

  candidates.push(readNested(row, nestedPath));

  for (const candidate of candidates) {
    if (candidate.trim() !== '') {
      return candidate.trim();
    }
  }
  return '';
}

/** Collects any columns outside the known contract so downstream consumers keep them (FR-5.2). */
function collectExtras(row: Record<string, unknown>): Record<string, string> {
  const extras: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (KNOWN_FLAT_KEYS.has(key) || key === 'submitter' || key === 'fields') {
      continue;
    }
    if (typeof value === 'string') { extras[key] = value; }
    else if (value != null && typeof value !== 'object') { extras[key] = String(value); }
  }
  return extras;
}

/**
 * Normalizes one raw row to a submission. Blank required fields (`id`, `summary`) are recorded in
 * `parseErrors` so the queue can flag the row rather than silently creating a bad issue.
 */
export function normalizeSubmission(row: Record<string, unknown>, rowIndex: number): IntakeSubmission {
  const id = readField(row, 'id', ['id']);
  const summary = readField(row, 'summary', ['fields', 'summary']);

  const parseErrors: string[] = [];
  if (id === '') { parseErrors.push('Missing submission id'); }
  if (summary === '') { parseErrors.push('Missing required field: summary'); }

  return {
    id,
    submittedAt: readField(row, 'submittedAt', ['submittedAt']),
    status: readField(row, 'status', ['status']) || 'New',
    submitter: {
      displayName: readField(row, 'submitterDisplayName', ['submitter', 'displayName']),
      email: readField(row, 'submitterEmail', ['submitter', 'email']),
    },
    fields: {
      summary,
      description: readField(row, 'description', ['fields', 'description']),
      acceptanceCriteria: readField(row, 'acceptanceCriteria', ['fields', 'acceptanceCriteria']),
      issueType: readField(row, 'issueType', ['fields', 'issueType']),
      priority: readField(row, 'priority', ['fields', 'priority']),
    },
    extras: collectExtras(row),
    rowIndex,
    parseErrors,
  };
}
