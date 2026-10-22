// evidenceSweep.ts — One button's work: sweep Jira for every test-evidence file the change's work holds, zip them, attach
// the zip, and report each step in plain numbers (owner, GH #475: "it still wants me to attach it manually").
//
// The change's own stories often carry no files: the results sit on their sub-tasks (the SL / QE test task) or on a
// linked test issue. So the sweep reads the issues, their sub-tasks and their linked issues in one search. Framework-
// first: Toolbox's Test Evidence pieces list (loadReleaseAttachmentsByJql), order (planEvidenceBundle), size-check
// (chooseDefaultTicks) and the Wizard's attachAllEvidenceToChanges zips and uploads, confirming the stored size.

import { loadReleaseAttachmentsByJql } from '../../views/SnowHub/testEvidence/evidenceAttachmentFetch.ts';
import { planEvidenceBundle, type EvidenceIssue } from '../../views/SnowHub/testEvidence/evidenceBundle.ts';
import { attachAllEvidenceToChanges, EVIDENCE_ATTACHED } from './evidenceUpload.ts';
import { chooseDefaultTicks, type JiraEvidenceAttachment } from './jiraEvidence.ts';

/** What one sweep found, zipped and attached. */
export interface EvidenceSweepReport {
  /** The change's own issues the sweep started from. */
  startingIssueKeys: string[];
  /** Every issue the sweep looked at: the change's issues, their sub-tasks and their linked issues. */
  sweptIssueKeys: string[];
  /** The files found, by issue, in Toolbox's order. */
  foundFiles: JiraEvidenceAttachment[];
  /** Files left out only because the zip would pass ServiceNow's size limit. */
  leftOutForSize: string[];
  /** True when linked issues could not be searched and only the issues and their sub-tasks were. */
  wereLinksSkipped: boolean;
  zippedFileCount: number;
  archiveByteSize: number;
  /** Per change: "attached" or why not. */
  results: Record<string, string>;
  /** The zip's file name as ServiceNow recorded it, per change it went on. */
  attachedFileNames: Record<string, string>;
  /** Files Jira would not hand over, in plain sentences. */
  problems: string[];
}

/** Keys as a quoted JQL list entry. */
function quoteKeys(issueKeys: readonly string[]): string {
  return issueKeys.map((issueKey) => `"${issueKey.replace(/"/g, '')}"`).join(',');
}

/** The search for the issues and their sub-tasks, and — unless asked not to — every issue linked to them. */
export function buildEvidenceSweepJql(issueKeys: readonly string[], shouldIncludeLinks: boolean): string {
  const keyList = quoteKeys(issueKeys);
  const clauses = [`key in (${keyList})`, `parent in (${keyList})`];
  if (shouldIncludeLinks) clauses.push(...issueKeys.map((issueKey) => `issue in linkedIssues(${quoteKeys([issueKey])})`));
  return clauses.join(' OR ');
}

/** The issues the sweep reaches; a Jira without the linkedIssues() search falls back to the issues and their sub-tasks. */
async function searchSweepIssues(issueKeys: readonly string[]): Promise<{ issues: EvidenceIssue[]; wereLinksSkipped: boolean }> {
  try {
    return { issues: (await loadReleaseAttachmentsByJql(buildEvidenceSweepJql(issueKeys, true))).issues, wereLinksSkipped: false };
  } catch {
    return { issues: (await loadReleaseAttachmentsByJql(buildEvidenceSweepJql(issueKeys, false))).issues, wereLinksSkipped: true };
  }
}

/** Every file the swept issues hold, in Toolbox's order (issue, then file name). */
function listFoundFiles(issues: readonly EvidenceIssue[]): JiraEvidenceAttachment[] {
  const plan = planEvidenceBundle({ changeNumber: 'sweep', issues: [...issues], generatedAt: new Date() });
  const summaryByKey = new Map(issues.map((evidenceIssue) => [evidenceIssue.key, evidenceIssue.summary]));
  return plan.entries.map((entry) => ({ issueKey: entry.issueKey, issueSummary: summaryByKey.get(entry.issueKey) ?? '', attachment: entry.attachment }));
}

/** An empty report: nothing found, nothing attached. */
function buildEmptyReport(issueKeys: readonly string[]): EvidenceSweepReport {
  return {
    startingIssueKeys: [...issueKeys], sweptIssueKeys: [], foundFiles: [], leftOutForSize: [], wereLinksSkipped: false,
    zippedFileCount: 0, archiveByteSize: 0, results: {}, attachedFileNames: {}, problems: [],
  };
}

/**
 * Sweeps Jira from the change's issues, then zips every file that fits and attaches the zip to each change. Throws only
 * when Jira cannot be searched at all; everything after that is reported, never thrown.
 */
export async function runEvidenceSweep(issueKeys: readonly string[], changeNumbers: readonly string[], onProgress?: (message: string) => void): Promise<EvidenceSweepReport> {
  const report = buildEmptyReport(issueKeys);
  if (issueKeys.length === 0) return report;
  onProgress?.(`Sweeping Jira: ${issueKeys.length} ${issueKeys.length === 1 ? 'issue' : 'issues'}, their sub-tasks and linked issues…`);
  const { issues, wereLinksSkipped } = await searchSweepIssues(issueKeys);
  const foundFiles = listFoundFiles(issues);
  const tickChoice = chooseDefaultTicks(foundFiles, [], 0);
  const tickedIds = new Set(tickChoice.tickedIds);
  Object.assign(report, { sweptIssueKeys: issues.map((evidenceIssue) => evidenceIssue.key), foundFiles, leftOutForSize: tickChoice.leftOutForSize, wereLinksSkipped });
  const filesToZip = foundFiles.filter((evidence) => tickedIds.has(evidence.attachment.attachmentId));
  if (filesToZip.length === 0 || changeNumbers.length === 0) return report;
  const outcome = await attachAllEvidenceToChanges({ localFiles: [], jiraAttachments: filesToZip }, changeNumbers, { onProgress });
  return {
    ...report, results: outcome.results, problems: outcome.problems, attachedFileNames: outcome.attachedFileNames ?? {},
    zippedFileCount: outcome.zippedFileCount ?? 0, archiveByteSize: outcome.archiveByteSize ?? 0,
  };
}

/** The changes the zip went on. */
export function listAttachedChanges(report: EvidenceSweepReport): string[] {
  return Object.entries(report.results).filter(([, result]) => result === EVIDENCE_ATTACHED).map(([changeNumber]) => changeNumber);
}

/** The files found, grouped by issue, as "ABC-1: a.png, b.xlsx" lines. */
export function describeFilesByIssue(report: EvidenceSweepReport): string[] {
  const fileNamesByIssue = new Map<string, string[]>();
  for (const evidence of report.foundFiles) {
    fileNamesByIssue.set(evidence.issueKey, [...(fileNamesByIssue.get(evidence.issueKey) ?? []), evidence.attachment.filename]);
  }
  return [...fileNamesByIssue.entries()].map(([issueKey, fileNames]) => `${issueKey}: ${fileNames.join(', ')}`);
}
