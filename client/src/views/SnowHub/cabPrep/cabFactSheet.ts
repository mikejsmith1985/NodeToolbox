// cabFactSheet.ts — Everything the board could ask about, gathered in one place.
//
// The model is given facts and a question list; it is never asked to find either. That split is what
// keeps the answers checkable: every claim in the pack traces to a CHG field or an issue key that is
// written out here verbatim, so a director's follow-up can be answered from the same page.
//
// It also states what is MISSING. A fact sheet that silently omits an empty backout plan produces a
// confident answer about a backout plan that does not exist, which is the single worst thing this
// feature could do.
//
// Pure. The caller gathers the state; this shapes it.

/** One Jira issue in the change's scope, reduced to what a board asks about. */
export interface CabScopedIssue {
  key: string;
  summary: string;
  issueType: string;
  status: string;
  assignee: string | null;
  storyPoints: number | null;
  /** True when Jira's own status category says the work is finished. */
  isComplete: boolean;
}

/** The ServiceNow change, as the CHG tab holds it. */
export interface CabChangeFacts {
  changeNumber: string;
  shortDescription: string;
  description: string;
  justification: string;
  riskImpactAnalysis: string;
  implementationPlan: string;
  backoutPlan: string;
  testPlan: string;
  /** The planning dropdowns, already resolved to their display labels. */
  assessment: Record<string, string>;
  /** Planned windows per environment, in the order they run. */
  environments: Array<{ name: string; plannedStart: string; plannedEnd: string }>;
  /** CTASK names, which are often the only written record of the execution steps. */
  changeTaskNames: string[];
}

/** The gathered pack, plus an honest account of what was not there to gather. */
export interface CabFactSheet {
  change: CabChangeFacts;
  scopedIssues: CabScopedIssue[];
  /** Field names that are empty, so the prompt can forbid answering from them. */
  missingChangeFields: string[];
  /** Scoped issues that are not finished — the answer to "is the scope real". */
  unfinishedIssueKeys: string[];
  /** Scoped issues carrying no estimate, which weakens any duration claim. */
  unestimatedIssueKeys: string[];
}

/** The CHG fields a board reliably asks about, with the label it would use. */
const REQUIRED_CHANGE_FIELDS: Array<{ key: keyof CabChangeFacts; label: string }> = [
  { key: 'shortDescription', label: 'Short description' },
  { key: 'description', label: 'Description' },
  { key: 'justification', label: 'Justification' },
  { key: 'riskImpactAnalysis', label: 'Risk and impact analysis' },
  { key: 'implementationPlan', label: 'Implementation plan' },
  { key: 'backoutPlan', label: 'Backout plan' },
  { key: 'testPlan', label: 'Test plan' },
];

/** True when a CHG field holds nothing a board could read. */
function isFieldEmpty(fieldValue: unknown): boolean {
  return typeof fieldValue !== 'string' || fieldValue.trim() === '';
}

/**
 * Builds the fact sheet, and names every gap in it.
 *
 * The gaps are the point. A board asks "how do we back this out" whether or not a backout plan was
 * written, and a pack that answers smoothly from an empty field has invented the reassurance. Naming
 * the field as missing lets the prompt forbid that, and lets the operator see what to go and fill in
 * BEFORE the meeting — which is more useful than any answer.
 */
export function buildCabFactSheet(
  change: CabChangeFacts,
  scopedIssues: readonly CabScopedIssue[],
): CabFactSheet {
  const missingChangeFields = REQUIRED_CHANGE_FIELDS
    .filter((field) => isFieldEmpty(change[field.key]))
    .map((field) => field.label);

  return {
    change,
    scopedIssues: [...scopedIssues],
    missingChangeFields,
    // Both read from Jira rather than asserted: "everything is done" is the claim a board most often
    // catches out, and the issue list either supports it or does not.
    unfinishedIssueKeys: scopedIssues.filter((issue) => !issue.isComplete).map((issue) => issue.key),
    unestimatedIssueKeys: scopedIssues.filter((issue) => issue.storyPoints === null).map((issue) => issue.key),
  };
}

/** One issue as a prompt line: everything a board would ask about it, on one row. */
function describeScopedIssue(issue: CabScopedIssue): string {
  return `  - ${issue.key} [${issue.issueType}] ${issue.summary}`
    + ` | status: ${issue.status}${issue.isComplete ? '' : ' (NOT COMPLETE)'}`
    + ` | owner: ${issue.assignee ?? 'unassigned'}`
    + ` | points: ${issue.storyPoints ?? 'unestimated'}`;
}

/** A CHG long-form field, or an explicit statement that it is empty. */
function describeChangeField(label: string, fieldValue: string): string[] {
  if (isFieldEmpty(fieldValue)) {
    return [`${label}: (EMPTY — nothing was written in this field)`];
  }
  return [`${label}:`, fieldValue.trim()];
}

/**
 * Renders the fact sheet as the text block a prompt embeds.
 *
 * Verbatim, and unsummarised. Anything condensed here is a fact the model would then have to
 * reconstruct, and reconstruction is where a plausible invention gets in.
 */
export function formatCabFactSheet(factSheet: CabFactSheet): string {
  const { change } = factSheet;

  const assessmentLines = Object.entries(change.assessment)
    .map(([fieldLabel, fieldValue]) => `  - ${fieldLabel}: ${fieldValue || '(not set)'}`);

  const environmentLines = change.environments.length === 0
    ? ['  (no environment windows are configured)']
    : change.environments.map((environment) =>
      `  - ${environment.name}: ${environment.plannedStart || '(no start)'} → ${environment.plannedEnd || '(no end)'}`);

  return [
    `CHANGE: ${change.changeNumber || '(not yet created)'}`,
    '',
    ...describeChangeField('SHORT DESCRIPTION', change.shortDescription),
    '',
    ...describeChangeField('DESCRIPTION', change.description),
    '',
    ...describeChangeField('JUSTIFICATION', change.justification),
    '',
    ...describeChangeField('RISK AND IMPACT ANALYSIS', change.riskImpactAnalysis),
    '',
    ...describeChangeField('IMPLEMENTATION PLAN', change.implementationPlan),
    '',
    ...describeChangeField('BACKOUT PLAN', change.backoutPlan),
    '',
    ...describeChangeField('TEST PLAN', change.testPlan),
    '',
    'PLANNING ASSESSMENT:',
    ...(assessmentLines.length > 0 ? assessmentLines : ['  (nothing assessed)']),
    '',
    'PLANNED WINDOWS:',
    ...environmentLines,
    '',
    'CHANGE TASKS:',
    ...(change.changeTaskNames.length === 0
      ? ['  (no change tasks staged)']
      : change.changeTaskNames.map((taskName) => `  - ${taskName}`)),
    '',
    `SCOPED JIRA ISSUES (${factSheet.scopedIssues.length}):`,
    ...(factSheet.scopedIssues.length === 0
      ? ['  (no issues are in scope)']
      : factSheet.scopedIssues.map((issue) => describeScopedIssue(issue))),
    '',
    'WHAT IS MISSING — do not answer any question from these, say the field is empty:',
    factSheet.missingChangeFields.length === 0
      ? '  (every change field carries content)'
      : `  Empty change fields: ${factSheet.missingChangeFields.join(', ')}`,
    factSheet.unfinishedIssueKeys.length === 0
      ? '  Every scoped issue is complete.'
      : `  NOT COMPLETE: ${factSheet.unfinishedIssueKeys.join(', ')}`,
    factSheet.unestimatedIssueKeys.length === 0
      ? '  Every scoped issue is estimated.'
      : `  UNESTIMATED: ${factSheet.unestimatedIssueKeys.join(', ')}`,
  ].join('\n');
}
