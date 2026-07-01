// buildIntakeFields.ts — Builds the Jira create-issue `fields` object for one submission by
// convention (the Teams contract is fixed, so there is no per-field mapping to configure). Pure
// (no I/O). Issue type and priority come from the row (by name); Acceptance Criteria goes to the
// configured custom field; free text is serialized to wiki markup. See data-model.md.

import { serializeWikiMarkup, type WikiDoc } from '../../JiraTemplateMaker/lib/wikiMarkup.ts';
import { buildIntakeLabel } from './intakeLabel.ts';
import type { IntakeConfig, IntakeSubmission } from './intakeTypes.ts';

/** Converts plain (possibly multi-line) text into wiki markup: one paragraph per non-empty line. */
export function plainTextToWikiMarkup(text: string): string {
  const doc: WikiDoc = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => ({ type: 'paragraph', spans: [{ text: line }] }));
  return serializeWikiMarkup(doc);
}

/**
 * Builds the create-issue field payload (without reporter, which the create hook adds). Includes
 * project (the already-resolved key) + issue type; adds description, priority, and Acceptance
 * Criteria only when present.
 */
export function buildIntakeFields(
  submission: IntakeSubmission,
  config: IntakeConfig,
  projectKey: string,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    summary: submission.fields.summary.trim(),
  };

  const issueType = submission.fields.issueType.trim();
  if (issueType !== '') {
    fields.issuetype = { name: issueType };
  }

  const description = submission.fields.description.trim();
  if (description !== '') {
    fields.description = plainTextToWikiMarkup(description);
  }

  const priority = submission.fields.priority.trim();
  if (priority !== '') {
    fields.priority = { name: priority };
  }

  const acceptanceCriteria = submission.fields.acceptanceCriteria.trim();
  if (acceptanceCriteria !== '' && config.acceptanceCriteriaFieldId.trim() !== '') {
    fields[config.acceptanceCriteriaFieldId.trim()] = plainTextToWikiMarkup(acceptanceCriteria);
  }

  // Stamp the submission id as a dedup label so the created issue can be found on later runs,
  // making duplicate detection independent of the local ledger (feature 006). Omitted when the id
  // cannot form a valid label — such rows are flagged upstream and never created.
  const intakeLabel = buildIntakeLabel(submission.id);
  if (intakeLabel) {
    fields.labels = [intakeLabel];
  }

  return fields;
}
