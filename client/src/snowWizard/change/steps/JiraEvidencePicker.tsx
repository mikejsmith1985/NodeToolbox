// JiraEvidencePicker.tsx — On "Add proof": the files already attached to the change's Jira issues, each with a tick (all that fit start ticked, as Toolbox gathers everything).
//
// The ticks are remembered in the job (jiraEvidenceChoiceStore), so a resumed job keeps them. A tick that would make
// the set too big for ServiceNow is refused here, with the limit stated, before anything is downloaded.

import { useEffect, useEffectEvent, useState } from 'react';

import { formatByteSize, MAX_ATTACHABLE_BUNDLE_BYTES } from '../../../views/SnowHub/testEvidence/evidenceBundle.ts';
import styles from '../ChangeWizard.module.css';
import {
  describeFileType, listJiraEvidence, sumJiraEvidenceBytes, type JiraEvidenceAttachment, type JiraEvidenceListing,
} from '../jiraEvidence.ts';
import { recordDefaultJiraTicks, useJiraEvidenceChoiceStore, type JiraEvidenceChoice } from '../jiraEvidenceChoiceStore.ts';

/** What the picker needs: whose ticks, which issues, and how much the local files already weigh. */
export interface JiraEvidencePickerProps {
  jobId: string;
  issueKeys: readonly string[];
  localBytes: number;
}

/** The last look at Jira, for the issue list it was made for. */
interface LookResult {
  keysText: string;
  listing: JiraEvidenceListing | null;
  problem: string;
}

/** The choice after one file is ticked or unticked. */
function toggleInChoice(choice: JiraEvidenceChoice, evidence: JiraEvidenceAttachment, isTicking: boolean): JiraEvidenceChoice {
  const attachmentId = evidence.attachment.attachmentId;
  const otherTicked = choice.tickedAttachments.filter((tickedEvidence) => tickedEvidence.attachment.attachmentId !== attachmentId);
  const otherUnticked = choice.untickedAttachmentIds.filter((untickedId) => untickedId !== attachmentId);
  return isTicking
    ? { tickedAttachments: [...otherTicked, evidence], untickedAttachmentIds: otherUnticked }
    : { tickedAttachments: otherTicked, untickedAttachmentIds: [...otherUnticked, attachmentId] };
}

/** Looks at Jira for the issues' files once per issue list, ticking them as soon as they arrive. */
function useJiraLook(jobId: string, issueKeys: readonly string[], localBytes: number) {
  const keysText = issueKeys.join(' ');
  const [lookResult, setLookResult] = useState<LookResult | null>(null);
  const [notice, setNotice] = useState('');
  const [lookCount, setLookCount] = useState(0);
  // Reads the local files' size at the moment the list arrives; adding a local file later must not re-tick anything.
  const tickArrivedListing = useEffectEvent((listing: JiraEvidenceListing) => recordDefaultJiraTicks(jobId, listing, localBytes));
  useEffect(() => {
    if (keysText === '') return undefined;
    let isCancelled = false;
    listJiraEvidence(keysText.split(' '))
      .then((listing) => {
        if (isCancelled) return;
        const leftOutForSize = tickArrivedListing(listing);
        setNotice(leftOutForSize.length > 0 ? `Some files were left unticked because together they are more than ServiceNow takes (${formatByteSize(MAX_ATTACHABLE_BUNDLE_BYTES)}): ${leftOutForSize.join(', ')}.` : '');
        setLookResult({ keysText, listing, problem: '' });
      })
      .catch((lookError: unknown) => {
        if (!isCancelled) setLookResult({ keysText, listing: null, problem: lookError instanceof Error ? lookError.message : String(lookError) });
      });
    return () => { isCancelled = true; };
  }, [keysText, lookCount]);
  const currentResult = lookResult?.keysText === keysText ? lookResult : null;
  const lookAgain = () => { setLookResult(null); setLookCount((previousCount) => previousCount + 1); };
  return { currentResult, notice, setNotice, lookAgain, hasIssues: keysText !== '' };
}

/** One file row: a tick with the issue and file name, then its size and type. */
function FileRow({ evidence, isTicked, onToggle }: { evidence: JiraEvidenceAttachment; isTicked: boolean; onToggle: (isTicking: boolean) => void }) {
  return (
    <li>
      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={isTicked} onChange={(changeEvent) => onToggle(changeEvent.target.checked)} />
        {`${evidence.issueKey}: ${evidence.attachment.filename}`}
      </label>
      <p className={styles.hint}>{`${formatByteSize(evidence.attachment.sizeBytes)} · ${describeFileType(evidence.attachment.filename)}`}</p>
    </li>
  );
}

/** The list of files with their ticks, plus the totals and anything Jira could not show. */
function FileList({ listing, choice, onToggle }: { listing: JiraEvidenceListing; choice: JiraEvidenceChoice | undefined; onToggle: (evidence: JiraEvidenceAttachment, isTicking: boolean) => void }) {
  const tickedIds = new Set((choice?.tickedAttachments ?? []).map((evidence) => evidence.attachment.attachmentId));
  const tickedBytes = sumJiraEvidenceBytes(choice?.tickedAttachments ?? []);
  return (
    <>
      {listing.attachments.length === 0
        ? <p className={styles.hint}>Your Jira issues have no files attached.</p>
        : <p className={styles.hint}>Ticked files go on the change. Untick any you do not want.</p>}
      <ul className={styles.itemList} aria-label="Files on your Jira issues">
        {listing.attachments.map((evidence) => (
          <FileRow key={evidence.attachment.attachmentId} evidence={evidence} isTicked={tickedIds.has(evidence.attachment.attachmentId)} onToggle={(isTicking) => onToggle(evidence, isTicking)} />
        ))}
      </ul>
      {listing.attachments.length > 0 ? <p className={styles.hint}>{`${tickedIds.size} of ${listing.attachments.length} files ticked (${formatByteSize(tickedBytes)}). ServiceNow takes up to ${formatByteSize(MAX_ATTACHABLE_BUNDLE_BYTES)} per change.`}</p> : null}
      {listing.issuesWithoutFiles.length > 0 ? <p className={styles.hint}>{`No files on: ${listing.issuesWithoutFiles.join(', ')}.`}</p> : null}
      {listing.missingKeys.length > 0 ? <p className={styles.noticeText}>{`Jira could not find: ${listing.missingKeys.join(', ')}.`}</p> : null}
    </>
  );
}

/** The Jira files card on the evidence step. */
export default function JiraEvidencePicker({ jobId, issueKeys, localBytes }: JiraEvidencePickerProps) {
  const choice = useJiraEvidenceChoiceStore((state) => state.choices[jobId]);
  const { currentResult, notice, setNotice, lookAgain, hasIssues } = useJiraLook(jobId, issueKeys, localBytes);

  function toggleFile(evidence: JiraEvidenceAttachment, isTicking: boolean) {
    const currentChoice = choice ?? { tickedAttachments: [], untickedAttachmentIds: [] };
    const nextBytes = sumJiraEvidenceBytes(currentChoice.tickedAttachments) + evidence.attachment.sizeBytes + localBytes;
    if (isTicking && nextBytes > MAX_ATTACHABLE_BUNDLE_BYTES) {
      setNotice(`Adding ${evidence.attachment.filename} would make ${formatByteSize(nextBytes)}, but ServiceNow takes at most ${formatByteSize(MAX_ATTACHABLE_BUNDLE_BYTES)} per change. Untick something else first.`);
      return;
    }
    setNotice('');
    useJiraEvidenceChoiceStore.getState().saveChoice(jobId, toggleInChoice(currentChoice, evidence, isTicking));
  }

  return (
    <div className={styles.card}>
      <h3 className={styles.cardTitle}>Files already on your Jira issues</h3>
      {!hasIssues ? <p className={styles.hint}>Pick Jira issues on the first step to see their files here.</p> : null}
      {hasIssues && currentResult === null ? <p className={styles.hint} role="status">Looking for files on your Jira issues…</p> : null}
      {currentResult?.problem ? (
        <>
          <p className={styles.errorText} role="alert">{`Could not look at Jira: ${currentResult.problem}`}</p>
          <div className={styles.buttonRow}><button type="button" className={styles.secondaryButton} onClick={lookAgain}>Look again</button></div>
        </>
      ) : null}
      {currentResult?.listing ? <FileList listing={currentResult.listing} choice={choice} onToggle={toggleFile} /> : null}
      {notice ? <p className={styles.noticeText} role="alert">{notice}</p> : null}
    </div>
  );
}
