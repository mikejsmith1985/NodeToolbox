// evidenceUpload.ts — Attaches the chosen test evidence (local files and ticked Jira files) to each change once it exists, refusing an over-size set before upload.
//
// Framework-first: Toolbox's Test Evidence pieces do the work — `createZipArchive` bundles, `planEvidenceBundle` lays
// the Jira files out by issue with Toolbox's MANIFEST.txt, `buildEvidenceArchiveName` names, `attachFileToChange`
// uploads (and checks the stored size), `MAX_ATTACHABLE_BUNDLE_BYTES` is the limit.

import { snowFetch } from '../../services/snowApi.ts';
import {
  buildEvidenceArchiveName, formatByteSize, MAX_ATTACHABLE_BUNDLE_BYTES, planEvidenceBundle, type EvidenceIssue,
} from '../../views/SnowHub/testEvidence/evidenceBundle.ts';
import { attachFileToChange } from '../../views/SnowHub/testEvidence/snowAttachmentUpload.ts';
import { createZipArchive, type ZipArchiveEntry } from '../../views/SnowHub/testEvidence/zipArchive.ts';
import { downloadJiraEvidence, sumJiraEvidenceBytes, type DownloadedJiraEvidence, type JiraEvidenceAttachment, type JiraEvidenceDownload } from './jiraEvidence.ts';

/** What the result screen shows for a change whose evidence went on. */
export const EVIDENCE_ATTACHED = 'attached';

/** Everything chosen as evidence: files from this computer and ticked files from Jira. */
export interface EvidenceSet {
  localFiles: readonly File[];
  jiraAttachments: readonly JiraEvidenceAttachment[];
}

/** Per change number "attached" or why not, plus a plain sentence for each Jira file that could not be fetched. */
export interface EvidenceAttachOutcome {
  results: Record<string, string>;
  problems: string[];
}

/** Optional extras for an attach run. */
export interface EvidenceAttachOptions {
  now?: Date;
  onProgress?: (message: string) => void;
}

const NO_DOWNLOAD: JiraEvidenceDownload = { downloaded: [], problems: [] };
const NOTHING_FETCHED_REASON ='The ticked files could not be fetched from Jira, so nothing was attached.';

/** Why the chosen files cannot be attached (too big for ServiceNow), or null when they can. `extraBytes` is the ticked Jira files. */
export function checkEvidenceSize(files: readonly File[], extraBytes = 0): string | null {
  const totalBytes = files.reduce((runningTotal, file) => runningTotal + file.size, extraBytes);
  if (totalBytes <= MAX_ATTACHABLE_BUNDLE_BYTES) return null;
  return `These files add up to ${formatByteSize(totalBytes)}, but ServiceNow takes at most `
    + `${formatByteSize(MAX_ATTACHABLE_BUNDLE_BYTES)} per change. Remove some files.`;
}

/** The record id of a change, found by its number. */
async function fetchChangeSysId(changeNumber: string): Promise<string> {
  const changeQuery = encodeURIComponent(`number=${changeNumber}`);
  const reply = await snowFetch<{ result?: Array<{ sys_id?: string }> }>(
    `/api/now/table/change_request?sysparm_query=${changeQuery}&sysparm_fields=sys_id&sysparm_limit=1`,
    { method: 'GET' },
  );
  const changeSysId = reply?.result?.[0]?.sys_id ?? '';
  if (changeSysId === '') throw new Error(`ServiceNow has no change ${changeNumber}.`);
  return changeSysId;
}

/** The local files as zip entries, at the top of the zip (as before Jira files were offered). */
async function readLocalEntries(files: readonly File[]): Promise<ZipArchiveEntry[]> {
  return Promise.all(files.map(async (file) => ({ path: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
}

/** The downloaded Jira files laid out exactly as Toolbox's Test Evidence does: one folder per issue, plus MANIFEST.txt. */
function buildJiraEntries(downloaded: readonly DownloadedJiraEvidence[], changeNumbers: readonly string[], now: Date): ZipArchiveEntry[] {
  if (downloaded.length === 0) return [];
  const issuesByKey = new Map<string, EvidenceIssue>();
  for (const { evidence } of downloaded) {
    const evidenceIssue = issuesByKey.get(evidence.issueKey) ?? { key: evidence.issueKey, summary: evidence.issueSummary, attachments: [] };
    evidenceIssue.attachments.push(evidence.attachment);
    issuesByKey.set(evidence.issueKey, evidenceIssue);
  }
  const plan = planEvidenceBundle({ changeNumber: changeNumbers.join(', '), issues: [...issuesByKey.values()], generatedAt: now });
  const bytesById = new Map(downloaded.map((download) => [download.evidence.attachment.attachmentId, download.bytes]));
  return [
    ...plan.entries.map((entry) => ({ path: entry.archivePath, bytes: bytesById.get(entry.attachment.attachmentId) ?? new Uint8Array() })),
    { path: plan.manifestPath, bytes: new TextEncoder().encode(plan.manifestText) },
  ];
}

/** The same reason for every change. */
function giveEveryChange(changeNumbers: readonly string[], reason: string): Record<string, string> {
  return Object.fromEntries(changeNumbers.map((changeNumber) => [changeNumber, reason]));
}

/** Uploads one zip to each change. Never throws: each change gets "attached" or why it failed. */
async function uploadToEachChange(archiveBytes: Uint8Array, changeNumbers: readonly string[], options: EvidenceAttachOptions & { now: Date }): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  for (const changeNumber of changeNumbers) {
    options.onProgress?.(`Putting the evidence on ${changeNumber}…`);
    try {
      await attachFileToChange(await fetchChangeSysId(changeNumber), buildEvidenceArchiveName(changeNumber, options.now), archiveBytes);
      results[changeNumber] = EVIDENCE_ATTACHED;
    } catch (attachError) {
      results[changeNumber] = attachError instanceof Error ? attachError.message : String(attachError);
    }
  }
  return results;
}

/**
 * Attaches the evidence to each change: refuses an over-size set before fetching anything, downloads the ticked Jira
 * files one by one (a failed one is left out and named; the rest still go), zips everything once, and uploads it to
 * every change. Never throws.
 */
export async function attachAllEvidenceToChanges(evidence: EvidenceSet, changeNumbers: readonly string[], options: EvidenceAttachOptions = {}): Promise<EvidenceAttachOutcome> {
  const hasEvidence = evidence.localFiles.length > 0 || evidence.jiraAttachments.length > 0;
  if (!hasEvidence || changeNumbers.length === 0) return { results: {}, problems: [] };
  const sizeProblem = checkEvidenceSize(evidence.localFiles, sumJiraEvidenceBytes(evidence.jiraAttachments));
  if (sizeProblem) return { results: giveEveryChange(changeNumbers, sizeProblem), problems: [] };
  const now = options.now ?? new Date();
  const download = evidence.jiraAttachments.length === 0 ? NO_DOWNLOAD : await downloadJiraEvidence(evidence.jiraAttachments, options.onProgress);
  const zipEntries = [...await readLocalEntries(evidence.localFiles), ...buildJiraEntries(download.downloaded, changeNumbers, now)];
  if (zipEntries.length === 0) return { results: giveEveryChange(changeNumbers, NOTHING_FETCHED_REASON), problems: download.problems };
  const results = await uploadToEachChange(createZipArchive(zipEntries), changeNumbers, { ...options, now });
  return { results, problems: download.problems };
}

/** Attaches local files only (the original entry point), returning each change's result. */
export async function attachEvidenceToChanges(files: readonly File[], changeNumbers: readonly string[], now: Date = new Date()): Promise<Record<string, string>> {
  const outcome = await attachAllEvidenceToChanges({ localFiles: files, jiraAttachments: [] }, changeNumbers, { now });
  return outcome.results;
}
