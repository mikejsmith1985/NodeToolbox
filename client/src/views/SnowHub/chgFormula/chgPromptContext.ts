// chgPromptContext.ts — The change record's own facts and the team's delivery path, as prompt text.
//
// Both AI Assist prompts (the one that drafts a change and the one that checks it) need to know what the
// record already says — its environments and dates, category, owner, CTASKs — so the drafted text agrees
// with the record instead of contradicting it, and so the check can hold the text against the record.
// Both also need the team's delivery path, which the ServiceNow record cannot express: it only knows the
// REL / PRD / PFIX changes, not the Dev and INT testing that must come before them.

import { describeEstimatesForPrompt, type DurationEstimates } from '../ctaskDurations.ts';
import { readTeamStandards, type TeamStandard } from './teamStandardsStore.ts';

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
  /** One line per change task: its minutes and who it is assigned to. */
  changeTaskLines: readonly string[];
  /** The record's risk level ("Moderate"), when it has one — several card fields apply only at Moderate/High. */
  riskLabel?: string;
  /**
   * The Jira stories the change delivers — summary, description and acceptance criteria — when they are known.
   * The Enhance prompt writes the fields from these; the risk check needs them too, or it asks the owner for
   * facts the stories already state.
   */
  jiraSourceText?: string;
  /** The names of the files attached to the change (test evidence, approvals), when the change exists. */
  attachmentFileNames?: readonly string[];
  /** The CTASK estimates added up — the change's implementation, validation and backout durations. */
  durationEstimates?: DurationEstimates;
}

/**
 * The planning answers are the owner's own statements about the change. Without this, the assistant asked for
 * facts the record already held — "what is the affected population?" beside an Impact of "> 250 users".
 */
const RECORD_ANSWERS_ARE_FACTS_RULE =
  'The planning assessment answers are the owner\'s own answers — treat them as facts (for example, the Impact '
  + 'band states the affected population). Do not ask for what they, or any other record fact above, already say.';

/**
 * Who deploys is already on the record: each change task names its assignee and group. Without this, the
 * assistant asked "who will deploy, validate and back out?" beside tasks that already said so.
 */
const TASK_ASSIGNEES_ARE_THE_TEAM_RULE =
  'The change task assignees and groups are the people who deploy, validate and back out this change — name them '
  + 'where the Formula Card asks who does the work. Do not ask who they are.';

/**
 * The change owner is the change's Assigned to person. Without this, the check asked for a validation owner, a
 * decision-maker and escalation contacts beside a record that already names the accountable person.
 */
const CHANGE_OWNER_RULE =
  'The change owner (the change\'s Assigned to) is accountable for this change: unless the text names someone else, '
  + 'they are the validation owner, the decision-maker and the technical escalation contact.';

/**
 * Release Management attaches the release's test evidence to the change before approval. Without this, the check
 * asked for test results the attached evidence already holds.
 */
const ATTACHED_EVIDENCE_RULE =
  'Attached test evidence documents the test results — do not ask for results it holds.';

/** The files on the change and the rule that they count, or nothing when no file is known. */
function renderAttachments(attachmentFileNames: readonly string[] | undefined): string[] {
  if (!attachmentFileNames || attachmentFileNames.length === 0) {
    return [];
  }
  return [renderFactList('Files attached to the change', attachmentFileNames, ''), ATTACHED_EVIDENCE_RULE];
}

/** The team's standing answers, then the change's estimated durations when its CTASKs carry them. */
function renderTeamStandards(durationEstimates: DurationEstimates | undefined): string[] {
  const durationLine = durationEstimates ? describeDurationFacts(durationEstimates) : '';
  return ['', ...buildTeamStandardLines(readTeamStandards()), ...(durationLine ? [durationLine] : [])];
}

/** A change task's people as one phrase for the prompt — and plainly what is missing when they are not set. */
export function describeTaskPeople(assignedToName: string, assignmentGroupName: string): string {
  const assigneeText = assignedToName.trim();
  const groupText = assignmentGroupName.trim();
  if (assigneeText === '' && groupText === '') {
    return 'no assignee or group';
  }
  const assigneePart = assigneeText === '' ? 'no assignee' : `assigned to ${assigneeText}`;
  return `${assigneePart} (${groupText === '' ? 'no group' : `group: ${groupText}`})`;
}

/**
 * The standing answers, stated to the assistant as facts in every risk-check, fix and re-check prompt: the ones
 * the team keeps in Admin Hub, then the duration rule, which is always worked out from the CTASK estimates.
 */
export function buildTeamStandardLines(standards: readonly TeamStandard[]): string[] {
  return [
    'Team standards (facts for every change — never ask about them):',
    ...standards.map((standard) => `- ${standard.fieldName}: ${standard.answer}`),
    '- Implementation, Validation and Backout Duration, and Recovery Time: calculate them from the estimated '
      + 'durations below and the timed steps in the plans — never ask for them.',
  ];
}

/** The change's estimated durations as one fact line for the prompt, or '' when no CTASK carries an estimate. */
export function describeDurationFacts(estimates: DurationEstimates): string {
  const estimatesText = describeEstimatesForPrompt(estimates);
  if (estimatesText === '') {
    return '';
  }
  const recoveryText = estimates.backoutMinutes ? `; recovery time ${estimates.backoutMinutes} min` : '';
  return `Estimated durations (the CTASK estimates added up): ${estimatesText}${recoveryText}.`;
}

/**
 * More of the record for a prompt to cover — a change's tasks, when an existing change is checked with them.
 * Each risk-check builder takes one optionally; left out, the prompt is exactly the change-only prompt.
 */
export interface ExtraPromptPart {
  /** What the assistant is shown: the extra records and the rule they are judged by. */
  contextLines: readonly string[];
  /** Extra gaps for a fix or re-check round to work on. */
  gapLines?: readonly string[];
  /** Extra reply lines or markers the assistant must answer with. */
  replyLines: readonly string[];
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

/** The Jira work behind the change as given facts, or nothing when none is known. */
function renderJiraSource(jiraSourceText: string | undefined): string[] {
  const trimmedSource = (jiraSourceText ?? '').trim();
  return trimmedSource === ''
    ? []
    : ['', 'Jira work this change delivers (the source the fields were written from — what it states counts as given):', trimmedSource];
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
    renderFactLine('Change owner (Assigned to)', context.changeOwnerLabel),
    ...(context.riskLabel !== undefined ? [renderFactLine('Risk', context.riskLabel)] : []),
    renderFactList('Environments', context.environmentLines, '(none enabled)'),
    renderFactList('Planning assessment', context.assessmentLines, '(not answered)'),
    renderFactList('Change tasks', context.changeTaskLines, '(none)'),
    ...renderAttachments(context.attachmentFileNames),
    RECORD_ANSWERS_ARE_FACTS_RULE,
    TASK_ASSIGNEES_ARE_THE_TEAM_RULE,
    CHANGE_OWNER_RULE,
    ...renderTeamStandards(context.durationEstimates),
    ...renderJiraSource(context.jiraSourceText),
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
