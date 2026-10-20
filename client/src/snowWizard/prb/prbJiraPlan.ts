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

/** A link that opens the problem record on the given ServiceNow instance. */
export function buildPrbRecordLink(instanceOrigin: string, prbNumber: string): string {
  const cleanOrigin = instanceOrigin.trim().replace(/\/+$/, '');
  return `${cleanOrigin}${PROBLEM_PAGE_PATH}${encodeURIComponent(`number=${prbNumber.trim()}`)}`;
}

// ── Drafts ──

function buildSummary(role: PrbJiraRole, prb: PrbSource): string {
  const shortDescription = prb.shortDescription.trim();
  if (role === 'defect') return `${prb.number} — ${shortDescription}`;
  return `${role === 'sl' ? 'SL' : 'QE'}: ${shortDescription}`;
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
