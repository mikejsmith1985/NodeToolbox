// TestEvidenceSection.tsx — Bundling a release's Jira attachments into one zip on the change.
//
// It lives beside a loaded CHG, like CAB preparation, because evidence is gathered AFTER the
// change exists: QE attaches its reports to the Jira issues as testing finishes, and someone then
// has to get all of it onto the change before the board reads it. This does that in one action.
//
// The release is named two ways, and they add up: a fix version picked from Jira's own list (the
// normal case — GH #377 showed a change whose text names no keys at all), plus an editable key
// list seeded from the keys the change does name, for the odd story outside the fix version.

import { useEffect, useState } from 'react';

import type { ChangeRequest } from '../../../types/snow.ts';
import { fetchPiWindowFixVersions } from '../../ArtView/piPlan/piPlanReleaseSchedule.ts';
import { readJiraKeysFromChange, readRejectedIssueKeys, readTypedIssueKeys } from '../cabPrep/cabScopeSource.ts';
import { downloadAttachmentBytes, loadReleaseAttachments, loadReleaseAttachmentsByJql } from './evidenceAttachmentFetch.ts';
import {
  formatByteSize,
  MAX_ATTACHABLE_BUNDLE_BYTES,
  planEvidenceBundle,
  type EvidenceBundlePlan,
  type EvidenceIssue,
} from './evidenceBundle.ts';
import { attachFileToChange } from './snowAttachmentUpload.ts';
import {
  buildReleaseJql,
  listSelectableVersions,
  readDefaultProjectKey,
  rememberProjectKey,
  type SelectableVersion,
} from './testEvidenceScope.ts';
import { createZipArchive, type ZipArchiveEntry } from './zipArchive.ts';

/** What the host tab provides: the loaded change and its class vocabulary. */
export interface TestEvidenceSectionProps {
  loadedChange: ChangeRequest;
  /** The host tab's CSS module, so this section looks like the tab it sits in. */
  styles: Record<string, string>;
}

/** A zip that has been built once and can be attached or downloaded without rebuilding. */
interface BuiltArchive {
  fileName: string;
  bytes: Uint8Array;
}

/** Everything one scan of the release found, before it is planned into a bundle. */
interface ScopedIssuesOutcome {
  issues: EvidenceIssue[];
  missingKeys: string[];
  notes: string[];
}

const SECTION_TITLE = 'Attach test evidence';
const PROJECT_FIELD_ID = 'test-evidence-project-key';
const FIX_VERSION_FIELD_ID = 'test-evidence-fix-version';
const SCOPE_FIELD_ID = 'test-evidence-scope-keys';
const ZIP_MIME_TYPE = 'application/zip';
const NO_SCOPE_MESSAGE = 'Pick a fix version, or enter at least one Jira key.';

/** Copies bytes into a standalone ArrayBuffer, which is what a Blob part is typed to accept. */
function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const standaloneBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(standaloneBuffer).set(bytes);
  return standaloneBuffer;
}

/** Offers the built zip to the browser as a download, without asking a server to do it. */
function downloadArchiveInBrowser(archive: BuiltArchive): void {
  const archiveBlob = new Blob([copyToArrayBuffer(archive.bytes)], { type: ZIP_MIME_TYPE });
  const objectUrl = URL.createObjectURL(archiveBlob);
  const downloadLink = document.createElement('a');
  downloadLink.href = objectUrl;
  downloadLink.download = archive.fileName;
  downloadLink.click();
  URL.revokeObjectURL(objectUrl);
}

/** Describes a plan in one line: how many files, from how many issues, weighing how much. */
function describePlan(plan: EvidenceBundlePlan, issueCount: number): string {
  return `${plan.fileCount} file(s) across ${issueCount} issue(s), ${formatByteSize(plan.totalBytes)} in total.`;
}

/**
 * Reads the release: the fix version's issues (paged), plus any typed keys not already in it.
 *
 * The two sources add up rather than compete, because the CHG Generator's own pattern is "pull a
 * fix version, then add one story by key". A key both name is counted once.
 */
async function loadScopedIssues(projectKey: string, fixVersion: string, scopeKeysText: string): Promise<ScopedIssuesOutcome> {
  const typedKeys = readTypedIssueKeys(scopeKeysText);
  const rejectedEntries = readRejectedIssueKeys(scopeKeysText);
  const notes: string[] = [];

  let releaseIssues: EvidenceIssue[] = [];
  if (fixVersion !== '') {
    const releaseOutcome = await loadReleaseAttachmentsByJql(buildReleaseJql(projectKey, fixVersion));
    releaseIssues = releaseOutcome.issues;
    if (releaseOutcome.isTruncated) {
      notes.push(`Only the first ${releaseIssues.length} of ${releaseOutcome.totalMatchingCount} issues in ${fixVersion} were read.`);
    }
  }

  const releaseKeys = new Set(releaseIssues.map((releaseIssue) => releaseIssue.key));
  const extraKeys = typedKeys.filter((typedKey) => !releaseKeys.has(typedKey));
  const extraOutcome = await loadReleaseAttachments(extraKeys);

  // Said out loud rather than dropped: an entry that vanished is one nobody knows is absent.
  if (rejectedEntries.length > 0) {
    notes.push(`Ignored, not a Jira key: ${rejectedEntries.join(', ')}.`);
  }

  return { issues: [...releaseIssues, ...extraOutcome.issues], missingKeys: extraOutcome.missingKeys, notes };
}

/** Renders the evidence-bundling affordance for one loaded change. */
export function TestEvidenceSection({ loadedChange, styles }: TestEvidenceSectionProps) {
  // Null means "use the keys the change names". No reset effect: the host mounts this section with
  // the change number as its React key, so a different change starts every piece of state clean.
  const [editedScopeKeys, setEditedScopeKeys] = useState<string | null>(null);
  const [projectKey, setProjectKey] = useState(() => readDefaultProjectKey(window.localStorage));
  const [fixVersion, setFixVersion] = useState('');
  const [versionOptions, setVersionOptions] = useState<SelectableVersion[]>([]);
  const [versionStatus, setVersionStatus] = useState<string | null>(null);
  const [plan, setPlan] = useState<EvidenceBundlePlan | null>(null);
  const [scannedIssueCount, setScannedIssueCount] = useState(0);
  const [missingKeys, setMissingKeys] = useState<string[]>([]);
  const [scanStatus, setScanStatus] = useState<string | null>(null);
  const [builtArchive, setBuiltArchive] = useState<BuiltArchive | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isBusy, setBusy] = useState(false);

  const seededScopeKeys = readJiraKeysFromChange(
    loadedChange.shortDescription ?? '',
    loadedChange.description ?? '',
  ).join(' ');
  const scopeKeysText = editedScopeKeys ?? seededScopeKeys;

  // The fix-version list follows the project key. Cancelled on change so a slow answer for the
  // previous project cannot land on top of the current one. The list and status are cleared in
  // the change handler, not here, so this effect only ever writes state from the async answer.
  useEffect(() => {
    if (projectKey === '') {
      return undefined;
    }
    let isCancelled = false;
    fetchPiWindowFixVersions(projectKey)
      .then((rawVersions) => {
        if (isCancelled) return;
        const options = listSelectableVersions(rawVersions);
        setVersionOptions(options);
        setVersionStatus(options.length === 0 ? `No fix versions found for ${projectKey}.` : null);
      })
      .catch((caughtError: unknown) => {
        if (isCancelled) return;
        setVersionOptions([]);
        setVersionStatus(caughtError instanceof Error ? caughtError.message : `Could not read fix versions for ${projectKey}.`);
      });
    return () => { isCancelled = true; };
  }, [projectKey]);

  function changeProjectKey(rawValue: string): void {
    const nextProjectKey = rawValue.trim().toUpperCase();
    setProjectKey(nextProjectKey);
    setFixVersion('');
    // The old project's versions must not stay selectable while the new project's are loading.
    setVersionOptions([]);
    setVersionStatus(null);
    rememberProjectKey(window.localStorage, nextProjectKey);
  }

  /** Reads the attachment list of every issue in scope and plans the bundle, fetching no bytes yet. */
  async function findAttachments(): Promise<void> {
    setResultMessage(null);
    setErrorMessage(null);
    if (fixVersion === '' && readTypedIssueKeys(scopeKeysText).length === 0) {
      setErrorMessage(NO_SCOPE_MESSAGE);
      return;
    }
    setBusy(true);
    setScanStatus(null);
    // A new scan invalidates a zip built from the old one.
    setBuiltArchive(null);
    try {
      const outcome = await loadScopedIssues(projectKey, fixVersion, scopeKeysText);
      const nextPlan = planEvidenceBundle({
        changeNumber: loadedChange.number,
        releaseLabel: fixVersion !== '' ? fixVersion : loadedChange.shortDescription,
        issues: outcome.issues,
        generatedAt: new Date(),
      });
      setPlan(nextPlan);
      setScannedIssueCount(outcome.issues.length);
      setMissingKeys(outcome.missingKeys);
      setScanStatus([describePlan(nextPlan, outcome.issues.length), ...outcome.notes].join(' '));
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : 'Could not read those issues.');
    } finally {
      setBusy(false);
    }
  }

  /** Fetches every planned attachment and zips it with the manifest — once; later calls reuse it. */
  async function buildArchive(currentPlan: EvidenceBundlePlan): Promise<BuiltArchive> {
    if (builtArchive !== null) {
      return builtArchive;
    }
    const zipEntries: ZipArchiveEntry[] = [];
    for (let entryIndex = 0; entryIndex < currentPlan.entries.length; entryIndex += 1) {
      const entry = currentPlan.entries[entryIndex];
      setProgressMessage(`Downloading ${entryIndex + 1} of ${currentPlan.entries.length} — ${entry.issueKey} ${entry.attachment.filename}`);
      // Sequential on purpose: thirty parallel downloads through one proxy is how a Jira rate
      // limit turns half a bundle into errors.
      const fileBytes = await downloadAttachmentBytes(entry.attachment.contentUrl);
      zipEntries.push({ path: entry.archivePath, bytes: fileBytes });
    }
    zipEntries.push({ path: currentPlan.manifestPath, bytes: new TextEncoder().encode(currentPlan.manifestText) });
    setProgressMessage('Building the zip…');
    const archive = { fileName: currentPlan.archiveName, bytes: createZipArchive(zipEntries) };
    setBuiltArchive(archive);
    return archive;
  }

  /** Runs one build-then-act flow with shared busy, progress and error handling. */
  async function runArchiveAction(action: (archive: BuiltArchive) => Promise<string>): Promise<void> {
    if (plan === null) {
      return;
    }
    setBusy(true);
    setResultMessage(null);
    setErrorMessage(null);
    try {
      const archive = await buildArchive(plan);
      setResultMessage(await action(archive));
    } catch (caughtError) {
      setErrorMessage(caughtError instanceof Error ? caughtError.message : 'The evidence bundle could not be built.');
    } finally {
      setProgressMessage(null);
      setBusy(false);
    }
  }

  function attachToChange(): void {
    void runArchiveAction(async (archive) => {
      setProgressMessage(`Attaching ${archive.fileName} to ${loadedChange.number}…`);
      const attached = await attachFileToChange(loadedChange.sysId, archive.fileName, archive.bytes);
      return `Attached ${attached.fileName} (${formatByteSize(attached.sizeBytes)}) to ${loadedChange.number}.`;
    });
  }

  function downloadArchive(): void {
    void runArchiveAction(async (archive) => {
      downloadArchiveInBrowser(archive);
      return `Downloaded ${archive.fileName} (${formatByteSize(archive.bytes.length)}).`;
    });
  }

  const hasFiles = plan !== null && plan.fileCount > 0;
  const canAttach = hasFiles && !plan.isTooLargeToAttach && !isBusy;

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{SECTION_TITLE}</h3>
      </div>
      <div className={styles.sectionBody}>
        <p>
          Gathers every file attached to the release&apos;s Jira issues into one zip and attaches it to{' '}
          {loadedChange.number} as the release&apos;s test evidence. Nothing is changed in Jira.
        </p>

        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor={PROJECT_FIELD_ID}>Project key</label>
          <input
            className={styles.input}
            id={PROJECT_FIELD_ID}
            onChange={(changeEvent) => changeProjectKey(changeEvent.target.value)}
            placeholder="ENCUC"
            value={projectKey}
          />
        </div>
        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor={FIX_VERSION_FIELD_ID}>Fix version</label>
          {/* A dropdown from Jira's own list, never a text box: a typo would scan cleanly and find nothing. */}
          <select
            className={styles.input}
            disabled={versionOptions.length === 0}
            id={FIX_VERSION_FIELD_ID}
            onChange={(changeEvent) => setFixVersion(changeEvent.target.value)}
            value={fixVersion}
          >
            <option value="">Select fix version…</option>
            {versionOptions.map((versionOption) => (
              <option key={versionOption.name} value={versionOption.name}>{versionOption.label}</option>
            ))}
          </select>
          {versionStatus !== null ? <p className={styles.mutedText} role="status">{versionStatus}</p> : null}
        </div>

        <div className={styles.fieldGroup}>
          <label className={styles.fieldLabel} htmlFor={SCOPE_FIELD_ID}>Jira issues</label>
          <p className={styles.mutedText}>
            Added to the fix version&apos;s issues, or the whole scope when no fix version is picked.
            Seeded from the keys the change text names.
          </p>
          <textarea
            className={styles.input}
            id={SCOPE_FIELD_ID}
            onChange={(changeEvent) => setEditedScopeKeys(changeEvent.target.value)}
            placeholder="ENCUC-2213 ENCUC-2358"
            rows={2}
            value={scopeKeysText}
          />
        </div>

        <div className={styles.buttonRow}>
          <button className={styles.secondaryButton} disabled={isBusy} onClick={() => void findAttachments()} type="button">
            Find attachments
          </button>
          <button
            className={styles.primaryButton}
            disabled={!canAttach}
            onClick={attachToChange}
            title={plan?.isTooLargeToAttach ? `Over the ${formatByteSize(MAX_ATTACHABLE_BUNDLE_BYTES)} attach limit — download it instead` : undefined}
            type="button"
          >
            Attach to {loadedChange.number}
          </button>
          <button className={styles.secondaryButton} disabled={!hasFiles || isBusy} onClick={downloadArchive} type="button">
            Download zip
          </button>
        </div>

        {scanStatus !== null ? <p role="status">{scanStatus}</p> : null}
        {progressMessage !== null ? <p className={styles.loadingText} role="status">{progressMessage}</p> : null}
        {resultMessage !== null ? <p role="status">{resultMessage}</p> : null}
        {errorMessage !== null ? <p className={styles.errorText} role="alert">{errorMessage}</p> : null}

        {plan !== null && plan.isTooLargeToAttach ? (
          <p className={styles.errorText} role="alert">
            {`This bundle is ${formatByteSize(plan.totalBytes)}, over the ${formatByteSize(MAX_ATTACHABLE_BUNDLE_BYTES)} the relay can attach in one go. Download it and attach it in ServiceNow by hand.`}
          </p>
        ) : null}
        {missingKeys.length > 0 ? (
          <p role="alert">{`Not found in Jira: ${missingKeys.join(', ')}.`}</p>
        ) : null}
        {plan !== null && plan.issuesWithoutAttachments.length > 0 ? (
          <p className={styles.mutedText}>{`No attachments on: ${plan.issuesWithoutAttachments.join(', ')}.`}</p>
        ) : null}

        {plan !== null && scannedIssueCount > 0 ? (
          <table className={styles.dataTable}>
            <thead>
              <tr><th>Issue</th><th>File</th><th>Size</th><th>Added by</th></tr>
            </thead>
            <tbody>
              {plan.entries.map((entry) => (
                <tr key={`${entry.issueKey}/${entry.attachment.attachmentId}`}>
                  <td>{entry.issueKey}</td>
                  <td>{entry.attachment.filename}</td>
                  <td>{formatByteSize(entry.attachment.sizeBytes)}</td>
                  <td>{entry.attachment.authorName ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}
