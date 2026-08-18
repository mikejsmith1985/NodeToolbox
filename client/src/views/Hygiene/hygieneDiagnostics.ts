// hygieneDiagnostics.ts — A copyable account of what a hygiene scan actually did.
//
// Hygiene numbers get disputed, and the dispute is almost always one of two things: the build on the
// machine is not the build that fixed it, or the scan never saw the field it is being judged on.
// Neither is visible from the screen, so each round of "it still isn't showing" costs a screenshot,
// a guess, and a release. This report answers both in text a person can paste into an issue.
//
// It is deliberately raw. Formatted values are the thing under suspicion, so the report prints what
// Jira returned for each field rather than what the UI made of it.

import type { HygieneFieldConfig, HygieneFinding } from './checks/hygieneChecks.ts';

/** Beyond this many findings the report stops listing and says how many it left out. */
const MAX_LISTED_FINDINGS = 50;

/** Shown where a field holds nothing, so "absent" never looks like "the report is broken". */
const ABSENT_VALUE_TEXT = '(none)';

export interface HygieneDiagnosticsInput {
  /** The running build, or null when the version endpoint could not be reached. */
  appVersion: string | null;
  /** The exact JQL scope the scan ran within. */
  scopeJql: string;
  scannedIssueCount: number | null;
  totalMatchingCount: number | null;
  isTruncated: boolean;
  fieldConfig: HygieneFieldConfig;
  findings: readonly HygieneFinding[];
  /** The check ids the enterprise rules currently have switched on. */
  enabledCheckIds: readonly string[];
}

/** Reads one Jira field as raw text, or the absent marker. */
function readRawFieldText(issueFields: Record<string, unknown>, fieldId: string): string {
  const rawValue = issueFields[fieldId];
  if (rawValue === null || rawValue === undefined || rawValue === '') return ABSENT_VALUE_TEXT;
  return typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue);
}

/** Reads the first configured field in a family as raw text. */
function readFirstConfiguredRawText(issueFields: Record<string, unknown>, fieldIds: readonly string[]): string {
  for (const fieldId of fieldIds) {
    const fieldText = readRawFieldText(issueFields, fieldId);
    if (fieldText !== ABSENT_VALUE_TEXT) return fieldText;
  }
  return ABSENT_VALUE_TEXT;
}

/** One line per finding: what it is, what dates it carried, and which checks fired on it. */
function describeFinding(finding: HygieneFinding, fieldConfig: HygieneFieldConfig): string {
  const issueFields = finding.issue.fields as unknown as Record<string, unknown>;
  const statusName = finding.issue.fields.status?.name ?? ABSENT_VALUE_TEXT;
  const statusCategoryKey = finding.issue.fields.status?.statusCategory?.key ?? ABSENT_VALUE_TEXT;

  return [
    `  ${finding.issue.key}`,
    `type=${finding.issue.fields.issuetype?.name ?? ABSENT_VALUE_TEXT}`,
    `status=${statusName}[${statusCategoryKey}]`,
    `duedate=${readRawFieldText(issueFields, 'duedate')}`,
    `targetStart=${readFirstConfiguredRawText(issueFields, fieldConfig.targetStartFieldIds)}`,
    `targetEnd=${readFirstConfiguredRawText(issueFields, fieldConfig.targetEndFieldIds)}`,
    `flags=[${finding.flags.map((flag) => flag.checkId).join(' ') || 'none'}]`,
  ].join('  ');
}

/**
 * Builds the plain-text diagnostics report for one hygiene scan.
 *
 * Pure and clock-free so it can be asserted on directly; the caller supplies the version it read
 * from the server and the state the scan produced.
 */
export function buildHygieneDiagnosticsReport(input: HygieneDiagnosticsInput): string {
  const listedFindings = input.findings.slice(0, MAX_LISTED_FINDINGS);
  const coverageText = input.isTruncated
    ? `${input.scannedIssueCount ?? 0} of ${input.totalMatchingCount ?? 0} — CAPPED, every count below is a floor`
    : `${input.scannedIssueCount ?? 0} of ${input.totalMatchingCount ?? input.scannedIssueCount ?? 0}`;

  const reportLines = [
    '── NodeToolbox hygiene diagnostics ──',
    `App version: ${input.appVersion ?? 'unknown'}`,
    `Scope JQL: ${input.scopeJql || '(none)'}`,
    `Issues scanned: ${coverageText}`,
    `Enabled checks: ${input.enabledCheckIds.join(', ') || '(none)'}`,
    '',
    'Resolved field ids:',
    `  targetStart: ${input.fieldConfig.targetStartFieldIds.join(', ') || '(none)'}`,
    `  targetEnd:   ${input.fieldConfig.targetEndFieldIds.join(', ') || '(none)'}`,
    `  programIncrement: ${input.fieldConfig.programIncrementFieldIds.join(', ') || '(none)'}`,
    `  acceptanceCriteria: ${input.fieldConfig.acceptanceCriteriaFieldIds.join(', ') || '(none)'}`,
    '',
    `Findings (${listedFindings.length} of ${input.findings.length} findings listed):`,
    ...listedFindings.map((finding) => describeFinding(finding, input.fieldConfig)),
  ];

  return reportLines.join('\n');
}
