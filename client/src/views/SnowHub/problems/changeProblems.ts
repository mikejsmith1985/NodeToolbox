// changeProblems.ts — Finds the ServiceNow problems (PRBs) a change's Jira issues mention, and links them to it.
//
// A fix delivered by a change often answers a known problem, but nothing tied the two together: the PRB number
// sat in a Jira summary, description, comment or the ServiceNow reference field, and the problem never pointed at
// the change that fixes it. This reads the change's Jira issues for PRB numbers, looks each up in ServiceNow, and
// links it to the change through the problem's own Change request field (rfc) — so the change's Problems list
// shows it.

import { jiraGet } from '../../../services/jiraApi.ts';
import { resolveConfiguredFieldIds } from '../../../services/jiraFieldMapping.ts';
import { snowFetch } from '../../../services/snowApi.ts';
import { normalizeRichTextToPlainText } from '../../../utils/richTextPlainText.ts';

/** A ServiceNow reference: the record's id and the name it shows. */
export interface ProblemReference {
  sysId: string;
  displayName: string;
}

/** One problem as the panel shows it, with the change it is already linked to (empty when none). */
export interface ChangeProblem {
  sysId: string;
  number: string;
  shortDescription: string;
  stateLabel: string;
  linkedChange: ProblemReference;
}

/** A PRB number and the Jira issues that mention it. */
export interface PrbMention {
  prbNumber: string;
  issueKeys: string[];
}

/** A PRB found in the change's Jira issues, with its ServiceNow record — null when ServiceNow has no such problem. */
export interface ChangeProblemRow extends PrbMention {
  problem: ChangeProblem | null;
}

/** A Jira issue as the scan reads it. */
interface ScannedIssue {
  key: string;
  fields: Record<string, unknown>;
}

// A PRB number: "PRB" and 7–10 digits — the same shape the Sync Monitor recognises.
const PRB_NUMBER_PATTERN = /\bPRB\d{7,10}\b/gi;
const PROBLEM_TABLE_PATH = '/api/now/table/problem';
const PROBLEM_FIELDS = 'sys_id,number,short_description,state,rfc';
// The Jira fields a PRB number can sit in, besides the ServiceNow reference field.
const SCANNED_TEXT_FIELDS = 'summary,description,comment';

/** Every PRB number in the text, upper-cased, once each, in the order they appear. */
export function findPrbNumbers(text: string): string[] {
  return [...new Set((text.match(PRB_NUMBER_PATTERN) ?? []).map((prbNumber) => prbNumber.toUpperCase()))];
}

/** All the text of one issue a PRB number can sit in: summary, description, comments and the reference fields. */
function readIssueText(issue: ScannedIssue, snowReferenceFieldIds: readonly string[]): string {
  const commentBlock = issue.fields.comment as { comments?: Array<{ body?: unknown }> } | undefined;
  return [
    normalizeRichTextToPlainText(issue.fields.summary),
    normalizeRichTextToPlainText(issue.fields.description),
    ...(commentBlock?.comments ?? []).map((comment) => normalizeRichTextToPlainText(comment.body)),
    ...snowReferenceFieldIds.map((fieldId) => normalizeRichTextToPlainText(issue.fields[fieldId])),
  ].join('\n');
}

/** Each PRB the issues mention, with the issues that mention it, PRBs in number order. */
export function collectPrbMentions(issues: readonly ScannedIssue[], snowReferenceFieldIds: readonly string[]): PrbMention[] {
  const issueKeysByPrb = new Map<string, string[]>();
  for (const issue of issues) {
    for (const prbNumber of findPrbNumbers(readIssueText(issue, snowReferenceFieldIds))) {
      issueKeysByPrb.set(prbNumber, [...(issueKeysByPrb.get(prbNumber) ?? []), issue.key]);
    }
  }
  return [...issueKeysByPrb.entries()]
    .sort(([firstPrb], [secondPrb]) => firstPrb.localeCompare(secondPrb))
    .map(([prbNumber, issueKeys]) => ({ prbNumber, issueKeys }));
}

/** The ServiceNow reference field ids this instance uses, as the field mapping resolves them. */
function readSnowReferenceFieldIds(): string[] {
  try {
    return resolveConfiguredFieldIds('snowRefFieldId', window.localStorage);
  } catch {
    return [];
  }
}

/** Reads each issue with the fields a PRB can sit in. An issue Jira cannot return is skipped, not fatal. */
async function fetchIssuesForScan(issueKeys: readonly string[], snowReferenceFieldIds: readonly string[]): Promise<ScannedIssue[]> {
  const fieldList = [SCANNED_TEXT_FIELDS, ...snowReferenceFieldIds].join(',');
  const readResults = await Promise.allSettled(issueKeys.map((issueKey) =>
    jiraGet<ScannedIssue>(`/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=${fieldList}`)));
  return readResults.flatMap((readResult) => (readResult.status === 'fulfilled' && readResult.value ? [readResult.value] : []));
}

/** A Table API field as text: its display value when present, else its stored value. */
function readDisplayText(fieldValue: unknown): string {
  if (typeof fieldValue === 'string') return fieldValue;
  if (typeof fieldValue !== 'object' || fieldValue === null) return '';
  const tableField = fieldValue as { display_value?: unknown; value?: unknown };
  return String(tableField.display_value ?? tableField.value ?? '');
}

/** A Table API reference field as id and name. */
function readReference(fieldValue: unknown): ProblemReference {
  if (typeof fieldValue !== 'object' || fieldValue === null) return { sysId: '', displayName: '' };
  const tableField = fieldValue as { display_value?: unknown; value?: unknown };
  return { sysId: String(tableField.value ?? ''), displayName: String(tableField.display_value ?? '') };
}

/** The problems with these numbers, each with the change it is linked to. */
export async function fetchProblemsByNumber(prbNumbers: readonly string[]): Promise<ChangeProblem[]> {
  if (prbNumbers.length === 0) {
    return [];
  }
  const problemQuery = encodeURIComponent(prbNumbers.join(','));
  const replyData = await snowFetch<{ result?: unknown }>(
    `${PROBLEM_TABLE_PATH}?sysparm_query=numberIN${problemQuery}&sysparm_display_value=all&sysparm_fields=${PROBLEM_FIELDS}`,
    { method: 'GET' },
  );
  if (!Array.isArray(replyData?.result)) {
    return [];
  }
  return replyData.result.map((problemRecord: Record<string, unknown>) => ({
    sysId: readReference(problemRecord.sys_id).sysId,
    number: readDisplayText(problemRecord.number),
    shortDescription: readDisplayText(problemRecord.short_description),
    stateLabel: readDisplayText(problemRecord.state),
    linkedChange: readReference(problemRecord.rfc),
  }));
}

/** Points a problem at the change that fixes it, through its Change request field. */
export async function linkProblemToChange(problemSysId: string, changeSysId: string): Promise<void> {
  await snowFetch(`${PROBLEM_TABLE_PATH}/${problemSysId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rfc: changeSysId }),
  });
}

/** Every PRB the issues mention, each paired with its ServiceNow problem (null when ServiceNow has none). */
export async function scanIssuesForProblems(issueKeys: readonly string[]): Promise<ChangeProblemRow[]> {
  const snowReferenceFieldIds = readSnowReferenceFieldIds();
  const mentions = collectPrbMentions(await fetchIssuesForScan(issueKeys, snowReferenceFieldIds), snowReferenceFieldIds);
  const problems = await fetchProblemsByNumber(mentions.map((mention) => mention.prbNumber));
  return mentions.map((mention) => ({
    ...mention,
    problem: problems.find((problem) => problem.number.toUpperCase() === mention.prbNumber) ?? null,
  }));
}

/**
 * Links a newly created change to every PRB its issues mention that is not linked to a change already. A PRB
 * linked elsewhere is left alone — a problem holds one change, and moving it is the owner's call.
 */
export async function linkProblemsToNewChange(
  changeSysId: string,
  issueKeys: readonly string[],
): Promise<{ linkedNumbers: string[]; skipped: Array<{ prbNumber: string; reason: string }> }> {
  const linkedNumbers: string[] = [];
  const skipped: Array<{ prbNumber: string; reason: string }> = [];
  for (const row of await scanIssuesForProblems(issueKeys)) {
    if (!row.problem) {
      skipped.push({ prbNumber: row.prbNumber, reason: 'not found in ServiceNow' });
    } else if (row.problem.linkedChange.sysId !== '' && row.problem.linkedChange.sysId !== changeSysId) {
      skipped.push({ prbNumber: row.prbNumber, reason: `already linked to ${row.problem.linkedChange.displayName || 'another change'}` });
    } else {
      await linkProblemToChange(row.problem.sysId, changeSysId);
      linkedNumbers.push(row.prbNumber);
    }
  }
  return { linkedNumbers, skipped };
}
