// chgPromptContext.ts — The change record's own facts and the team's delivery path, as prompt text.
//
// Both AI Assist prompts (the one that drafts a change and the one that checks it) need to know what the
// record already says — its environments and dates, category, owner, CTASKs — so the drafted text agrees
// with the record instead of contradicting it, and so the check can hold the text against the record.
// Both also need the team's delivery path, which the ServiceNow record cannot express: it only knows the
// REL / PRD / PFIX changes, not the Dev and INT testing that must come before them.

/** The facts about the change that the wizard already holds, already turned into readable labels. */
export interface ChgPromptContext {
  categoryLabel: string;
  changeTypeLabel: string;
  isExpedited: boolean;
  configItemLabel: string;
  assignmentGroupLabel: string;
  changeOwnerLabel: string;
  /** One line per environment, e.g. "REL: Enabled — start → end — Config Item: X". */
  environmentLines: readonly string[];
  /** One line per planning-assessment answer, e.g. "Impact: 3 - Low". */
  assessmentLines: readonly string[];
  /** One line per change task, with its implementation / validation / backout minutes. */
  changeTaskLines: readonly string[];
}

/** How every release moves to production. The Test Plan must be written against this path. */
export const DELIVERY_PATH_STEPS: readonly string[] = [
  '1. First, deploy to Dev and test there.',
  '2. Next, deploy to INT and test there.',
  '3. Then raise a change (CHG) to deploy to REL and test there.',
  '4. Only after REL testing passes, deploy to PROD (production) under its own change.',
];

/**
 * The one rule that keeps drafted text honest. The Formula Card asks for names, times, counts and record
 * numbers that the Jira issues and the record often do not contain; a plausible-looking invented answer
 * is worse than a visible gap, because a reviewer cannot tell it apart from a real one.
 */
export const CONFIRM_PLACEHOLDER_RULE =
  'Never invent names, dates, times, counts, record numbers, URLs or test results. Where the Formula Card asks '
  + 'for a fact that is not given here, write [CONFIRM: <what is needed>] in its place so the owner can fill it in.';

// Shown in place of a record fact nobody has filled in yet — stated plainly so the gap is visible.
const NOT_SET_LABEL = '(not set)';

/** A labelled record fact, or the plain "not set" marker when the field is empty. */
function renderFactLine(label: string, value: string): string {
  const trimmedValue = value.trim();
  return `${label}: ${trimmedValue === '' ? NOT_SET_LABEL : trimmedValue}`;
}

/** A labelled list of record facts, or one line saying there are none. */
function renderFactList(label: string, lines: readonly string[], emptyText: string): string {
  return lines.length === 0 ? `${label}: ${emptyText}` : [`${label}:`, ...lines.map((line) => `  ${line}`)].join('\n');
}

/**
 * The record facts, the delivery path and the no-invention rule, as one block for either prompt. The
 * facts come first so the model reads the record before it reads anything it is asked to write.
 */
export function buildChgContextText(context: ChgPromptContext): string {
  return [
    'Change record facts (the drafted text must agree with these; do not contradict them):',
    renderFactLine('Category', context.categoryLabel),
    renderFactLine('Change type', context.changeTypeLabel),
    `Expedited: ${context.isExpedited ? 'Yes' : 'No'}`,
    renderFactLine('Configuration item', context.configItemLabel),
    renderFactLine('Assignment group', context.assignmentGroupLabel),
    renderFactLine('Change owner', context.changeOwnerLabel),
    renderFactList('Environments', context.environmentLines, '(none enabled)'),
    renderFactList('Planning assessment', context.assessmentLines, '(not answered)'),
    renderFactList('Change tasks', context.changeTaskLines, '(none)'),
    '',
    'Delivery and testing path every release follows:',
    ...DELIVERY_PATH_STEPS,
    'This change covers the environment(s) marked Enabled above. Its Test Plan must name the Dev and INT testing '
      + 'already done (and the REL results, when this change is for PROD), then the testing performed in this '
      + "change's own environment.",
    '',
    CONFIRM_PLACEHOLDER_RULE,
  ].join('\n');
}
