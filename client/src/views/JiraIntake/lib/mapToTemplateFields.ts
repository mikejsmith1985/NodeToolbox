// mapToTemplateFields.ts — Maps a submission's core values to a Jira create-issue `fields` object
// per the intake configuration. Pure (no I/O). Reuses the Template Maker's wiki-markup serializer
// for rich-text fields. See contracts/intake-contracts.md §B and data-model.md §2.
//
// Framework-First note (Article VII): the Template Maker's buildCreatePayload resolves choice
// fields by option *id*, but intake core values arrive as option *names* from the Teams card
// (e.g. "Highest"). Intake therefore builds the fields map directly — reusing serializeWikiMarkup
// for text — rather than round-tripping names through an id-based builder.

import { serializeWikiMarkup, type WikiDoc } from '../../JiraTemplateMaker/lib/wikiMarkup.ts';
import type { IntakeConfig, IntakeFieldMapping, IntakeSubmission } from './intakeTypes.ts';

/** Converts plain (possibly multi-line) text into wiki markup: one paragraph per non-empty line. */
function plainTextToWikiMarkup(text: string): string {
  const doc: WikiDoc = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => ({ type: 'paragraph', spans: [{ text: line }] }));
  return serializeWikiMarkup(doc);
}

/** Resolves the raw value for one mapping: a fixed constant when set, else the submission value. */
function resolveRawValue(submission: IntakeSubmission, mapping: IntakeFieldMapping): unknown {
  if (mapping.fixedValue !== undefined) {
    return mapping.fixedValue;
  }
  return submission.fields[mapping.coreField];
}

/** Coerces a raw value into the Jira payload shape for the mapping's transform, or undefined. */
function coerceValue(rawValue: unknown, mapping: IntakeFieldMapping): unknown {
  // Non-string fixed values (e.g. a components array) pass through untouched.
  if (typeof rawValue !== 'string') {
    return rawValue ?? undefined;
  }
  const trimmed = rawValue.trim();
  if (trimmed === '') {
    return undefined;
  }
  switch (mapping.transform) {
    case 'wikiMarkup':
      return plainTextToWikiMarkup(trimmed);
    case 'choiceByName':
      // Priorities and named select options are accepted by-name on Jira Data Center.
      return { name: trimmed };
    case 'raw':
    default:
      return trimmed;
  }
}

/**
 * Builds the mapped Jira `fields` object (without project/issuetype/reporter, which the create
 * hook adds). Fields whose resolved value is empty are omitted so unset optionals are not sent.
 */
export function mapSubmissionToFields(submission: IntakeSubmission, config: IntakeConfig): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const mapping of config.fieldMappings) {
    const value = coerceValue(resolveRawValue(submission, mapping), mapping);
    if (value !== undefined) {
      fields[mapping.jiraFieldId] = value;
    }
  }
  return fields;
}
