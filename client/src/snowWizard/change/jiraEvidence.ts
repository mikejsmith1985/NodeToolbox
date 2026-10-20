// jiraEvidence.ts — The files already attached to the change's Jira issues: list them, tick them like Toolbox, download the ticked ones.
//
// Framework-first: Toolbox's Test Evidence pieces do the Jira work — `loadReleaseAttachments` lists every issue's
// attachments in one search, `planEvidenceBundle` puts them in Toolbox's order, `downloadAttachmentBytes` fetches the
// bytes through `/jira-proxy` (which, inside the Wizard, is the Jira tab). Toolbox gathers every attachment, so every
// file that fits under ServiceNow's limit starts ticked.

import { downloadAttachmentBytes, loadReleaseAttachments } from '../../views/SnowHub/testEvidence/evidenceAttachmentFetch.ts';
import { MAX_ATTACHABLE_BUNDLE_BYTES, planEvidenceBundle, type EvidenceAttachment } from '../../views/SnowHub/testEvidence/evidenceBundle.ts';

/** One file on one Jira issue, kept as plain data so a job can remember it. */
export interface JiraEvidenceAttachment {
  issueKey: string;
  issueSummary: string;
  attachment: EvidenceAttachment;
}

/** What the change's Jira issues hold. */
export interface JiraEvidenceListing {
  attachments: JiraEvidenceAttachment[];
  /** Issues that have no files at all. */
  issuesWithoutFiles: string[];
  /** Keys Jira did not return (deleted, moved, or not visible to this user). */
  missingKeys: string[];
}

/** Which files start ticked, and the names of any left out only because they would not fit. */
export interface TickChoice {
  tickedIds: string[];
  leftOutForSize: string[];
}

/** One file that arrived, with its bytes. */
export interface DownloadedJiraEvidence {
  evidence: JiraEvidenceAttachment;
  bytes: Uint8Array;
}

/** What a download run produced: the files that arrived, and a plain sentence for each that did not. */
export interface JiraEvidenceDownload {
  downloaded: DownloadedJiraEvidence[];
  problems: string[];
}

/** Planning needs a change number, but only the order of its entries is used here. */
const ORDER_ONLY_CHANGE_NUMBER = 'listing';
const UNKNOWN_FILE_TYPE = 'File';

/** Lists every file on the given issues, in Toolbox's order (issue, then file name). No issues costs no request. */
export async function listJiraEvidence(issueKeys: readonly string[]): Promise<JiraEvidenceListing> {
  if (issueKeys.length === 0) return { attachments: [], issuesWithoutFiles: [], missingKeys: [] };
  const { issues, missingKeys } = await loadReleaseAttachments(issueKeys);
  const plan = planEvidenceBundle({ changeNumber: ORDER_ONLY_CHANGE_NUMBER, issues, generatedAt: new Date() });
  const summaryByKey = new Map(issues.map((evidenceIssue) => [evidenceIssue.key, evidenceIssue.summary]));
  return {
    attachments: plan.entries.map((entry) => ({ issueKey: entry.issueKey, issueSummary: summaryByKey.get(entry.issueKey) ?? '', attachment: entry.attachment })),
    issuesWithoutFiles: plan.issuesWithoutAttachments,
    missingKeys,
  };
}

/** The total size of some Jira files. */
export function sumJiraEvidenceBytes(attachments: readonly JiraEvidenceAttachment[]): number {
  return attachments.reduce((runningTotal, evidence) => runningTotal + evidence.attachment.sizeBytes, 0);
}

/**
 * Ticks every file the user has not unticked, in list order, while the set still fits ServiceNow's limit together with
 * the `otherBytes` already chosen (local files). A file that would not fit is left unticked and named.
 */
export function chooseDefaultTicks(attachments: readonly JiraEvidenceAttachment[], untickedIds: readonly string[], otherBytes: number): TickChoice {
  const untickedIdSet = new Set(untickedIds);
  const tickChoice: TickChoice = { tickedIds: [], leftOutForSize: [] };
  let runningBytes = otherBytes;
  for (const evidence of attachments) {
    if (untickedIdSet.has(evidence.attachment.attachmentId)) continue;
    if (runningBytes + evidence.attachment.sizeBytes > MAX_ATTACHABLE_BUNDLE_BYTES) {
      tickChoice.leftOutForSize.push(evidence.attachment.filename);
      continue;
    }
    runningBytes += evidence.attachment.sizeBytes;
    tickChoice.tickedIds.push(evidence.attachment.attachmentId);
  }
  return tickChoice;
}

/** The kind of file in plain words, from its ending ("PDF", "PNG"), or "File" when it has none. */
export function describeFileType(filename: string): string {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === filename.length - 1) return UNKNOWN_FILE_TYPE;
  return filename.slice(dotIndex + 1).toUpperCase();
}

/**
 * Downloads the files one at a time (as Toolbox does — parallel downloads through one Jira tab invite rate limits),
 * reporting progress. Never throws: a file that fails becomes one plain sentence and the rest still come.
 */
export async function downloadJiraEvidence(attachments: readonly JiraEvidenceAttachment[], onProgress?: (message: string) => void): Promise<JiraEvidenceDownload> {
  const outcome: JiraEvidenceDownload = { downloaded: [], problems: [] };
  for (let fileIndex = 0; fileIndex < attachments.length; fileIndex += 1) {
    const evidence = attachments[fileIndex];
    onProgress?.(`Getting file ${fileIndex + 1} of ${attachments.length} from Jira: ${evidence.attachment.filename}…`);
    try {
      outcome.downloaded.push({ evidence, bytes: await downloadAttachmentBytes(evidence.attachment.contentUrl) });
    } catch (downloadError) {
      const reason = downloadError instanceof Error ? downloadError.message : String(downloadError);
      outcome.problems.push(`Could not get ${evidence.attachment.filename} from ${evidence.issueKey} in Jira (${reason}). It was left out; the other files were still attached.`);
    }
  }
  return outcome;
}
