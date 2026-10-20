// evidenceUpload.ts — Attaches the chosen test evidence to each change once it exists, refusing an over-size set before upload.
//
// Framework-first: Toolbox's Test Evidence pieces do the work — `createZipArchive` bundles, `buildEvidenceArchiveName`
// names, `attachFileToChange` uploads (and checks the stored size), `MAX_ATTACHABLE_BUNDLE_BYTES` is the limit.

import { snowFetch } from '../../services/snowApi.ts';
import { buildEvidenceArchiveName, formatByteSize, MAX_ATTACHABLE_BUNDLE_BYTES } from '../../views/SnowHub/testEvidence/evidenceBundle.ts';
import { attachFileToChange } from '../../views/SnowHub/testEvidence/snowAttachmentUpload.ts';
import { createZipArchive } from '../../views/SnowHub/testEvidence/zipArchive.ts';

/** What the result screen shows for a change whose evidence went on. */
export const EVIDENCE_ATTACHED = 'attached';

/** Why the chosen files cannot be attached (too big for ServiceNow), or null when they can. */
export function checkEvidenceSize(files: readonly File[]): string | null {
  const totalBytes = files.reduce((runningTotal, file) => runningTotal + file.size, 0);
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

/** The chosen files as one zip, read once for every change. */
async function bundleEvidence(files: readonly File[]): Promise<Uint8Array> {
  const entries = await Promise.all(files.map(async (file) => ({ path: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })));
  return createZipArchive(entries);
}

/**
 * Attaches the evidence bundle to each change. Never throws: each change gets "attached" or the reason it failed,
 * so one refused upload does not hide the others.
 */
export async function attachEvidenceToChanges(files: readonly File[], changeNumbers: readonly string[], now: Date = new Date()): Promise<Record<string, string>> {
  if (files.length === 0 || changeNumbers.length === 0) return {};
  const archiveBytes = await bundleEvidence(files);
  const results: Record<string, string> = {};
  for (const changeNumber of changeNumbers) {
    try {
      await attachFileToChange(await fetchChangeSysId(changeNumber), buildEvidenceArchiveName(changeNumber, now), archiveBytes);
      results[changeNumber] = EVIDENCE_ATTACHED;
    } catch (attachError) {
      results[changeNumber] = attachError instanceof Error ? attachError.message : String(attachError);
    }
  }
  return results;
}
