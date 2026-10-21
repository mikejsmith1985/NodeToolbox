// prbJiraPlan.ts — Turns one ServiceNow problem into the three Jira drafts (Defect, SL Story, QE Story) the user reviews.

// ── Types ──

/** The three pieces of Jira work one problem becomes. */
export type PrbJiraRole = 'defect' | 'sl' | 'qe';

/** The roles in the order they are created: the Defect first, so the stories have something to link to. */
export const PRB_JIRA_ROLES: readonly PrbJiraRole[] = ['defect', 'sl', 'qe'];

/** What the drafts need to know about the problem. */
export interface PrbSource {
  number: string;
  shortDescription: string;
  description: string;
  /** A web link back to the problem record in ServiceNow. */
  link: string;
}

/** One editable draft. The issue type is the name looked for in Jira's own list when it is created. */
export interface PrbJiraDraft {
  role: PrbJiraRole;
  projectKey: string;
  epicKey: string;
  issueTypeName: 'Defect' | 'Story';
  summary: string;
  description: string;
  labels: string[];
  /** True when the problem had no description, so the screen can point at the gap to fill. */
  isSourceDescriptionMissing: boolean;
}

/** One Jira issue that already exists and can stand in for one of the three items. */
export interface PrbExistingIssue {
  key: string;
  summary: string;
  issueTypeName: string;
  statusName: string;
  labels: string[];
  /** Keys of every issue this one is already linked to. */
  linkedKeys: string[];
}

/** What the user wants for one item: a new issue, one already in Jira (null until picked), or none at all. */
export type PrbRoleChoice =
  | { mode: 'new' }
  | { mode: 'existing'; issue: PrbExistingIssue | null }
  | { mode: 'skip' };

/** The user's choice for each of the three items. */
export type PrbRoleChoices = Record<PrbJiraRole, PrbRoleChoice>;

/** The three ways an item can be handled, as the choose screen offers them. */
export type PrbRoleMode = PrbRoleChoice['mode'];

// ── Copy ──

/** Put where the problem's own description would go when it has none. */
export const MISSING_DESCRIPTION_TEXT = 'The problem record has no description yet — add what you know here.';

/** Plain words for each role, used on screens and in the drafts. */
export const PRB_ROLE_NAMES: Record<PrbJiraRole, string> = {
  defect: 'Defect',
  sl: 'SL story',
  qe: 'QE story',
};

const ROLE_PURPOSE_TEXT: Record<PrbJiraRole, string> = {
  defect: 'Fix the problem described below.',
  sl: 'SL work to deliver the fix for this problem.',
  qe: 'QE work to prove the fix for this problem.',
};

const LABEL_PREFIX = 'prb-';
const PROBLEM_PAGE_PATH = '/problem.do?sysparm_query=';

// ── Labels and links ──

/** The label every item for one problem carries, e.g. `prb-prb0012345` — how a retry finds what already exists. */
export function buildPrbLabel(prbNumber: string): string {
  return `${LABEL_PREFIX}${prbNumber.trim().toLowerCase()}`;
}

/** The second label naming which of the three an item is, so a retry never mistakes an edited summary for another role. */
export function buildPrbRoleLabel(prbNumber: string, role: PrbJiraRole): string {
  return `${buildPrbLabel(prbNumber)}-${role}`;
}

/** Which role an existing item plays, read from its labels; null when it carries no role label. */
export function readRoleFromLabels(labels: readonly string[], prbNumber: string): PrbJiraRole | null {
  return PRB_JIRA_ROLES.find((role) => labels.includes(buildPrbRoleLabel(prbNumber, role))) ?? null;
}

/** True when the issue already carries the label naming it as this role for this problem. */
export function hasPrbRoleLabel(issue: PrbExistingIssue, prbNumber: string, role: PrbJiraRole): boolean {
  return issue.labels.includes(buildPrbRoleLabel(prbNumber, role));
}

// ── Choices ──

/** The starting choices: an item Jira already holds for the problem is used, everything else is made new. */
export function buildDefaultRoleChoices(foundIssues: Partial<Record<PrbJiraRole, PrbExistingIssue>>): PrbRoleChoices {
  const readChoice = (role: PrbJiraRole): PrbRoleChoice => {
    const foundIssue = foundIssues[role];
    return foundIssue ? { mode: 'existing', issue: foundIssue } : { mode: 'new' };
  };
  return { defect: readChoice('defect'), sl: readChoice('sl'), qe: readChoice('qe') };
}

/** The items the user wants made new, in creation order. */
export function readNewRoles(choices: PrbRoleChoices): PrbJiraRole[] {
  return PRB_JIRA_ROLES.filter((role) => choices[role].mode === 'new');
}

/** The items that end up in Jira one way or another (made new or already there), in creation order. */
export function readKeptRoles(choices: PrbRoleChoices): PrbJiraRole[] {
  return PRB_JIRA_ROLES.filter((role) => choices[role].mode !== 'skip');
}

/** A link that opens the problem record on the given ServiceNow instance. */
export function buildPrbRecordLink(instanceOrigin: string, prbNumber: string): string {
  const cleanOrigin = instanceOrigin.trim().replace(/\/+$/, '');
  return `${cleanOrigin}${PROBLEM_PAGE_PATH}${encodeURIComponent(`number=${prbNumber.trim()}`)}`;
}

// ── Drafts ──

/** The bracketed tag each summary opens with (owner's naming: "[DEV]", "[SL]", "[QE]", no colon after). */
const SUMMARY_TAGS: Record<PrbJiraRole, string> = { defect: '[DEV]', sl: '[SL]', qe: '[QE]' };

function buildSummary(role: PrbJiraRole, prb: PrbSource): string {
  const shortDescription = prb.shortDescription.trim();
  if (role === 'defect') return `${SUMMARY_TAGS.defect} ${prb.number} — ${shortDescription}`;
  return `${SUMMARY_TAGS[role]} ${shortDescription}`;
}

function buildDescription(role: PrbJiraRole, prb: PrbSource): string {
  const problemText = prb.description.trim() || MISSING_DESCRIPTION_TEXT;
  return [
    ROLE_PURPOSE_TEXT[role],
    '',
    `ServiceNow problem: ${prb.number} — ${prb.shortDescription.trim()}`,
    `Problem record: ${prb.link}`,
    '',
    problemText,
  ].join('\n');
}

function buildDraft(role: PrbJiraRole, prb: PrbSource, epicKey: string, projectKey: string): PrbJiraDraft {
  return {
    role,
    projectKey,
    epicKey,
    issueTypeName: role === 'defect' ? 'Defect' : 'Story',
    summary: buildSummary(role, prb),
    description: buildDescription(role, prb),
    labels: [buildPrbLabel(prb.number), buildPrbRoleLabel(prb.number, role)],
    isSourceDescriptionMissing: prb.description.trim() === '',
  };
}

/**
 * Builds the three drafts for one problem: a Defect named after the problem, an SL Story and a QE Story.
 * All three go in the same project and Epic, carry the problem number and its link, and share its label.
 */
export function buildPrbJiraDrafts(prb: PrbSource, epicKey: string, projectKey: string): PrbJiraDraft[] {
  return PRB_JIRA_ROLES.map((role) => buildDraft(role, prb, epicKey, projectKey));
}
