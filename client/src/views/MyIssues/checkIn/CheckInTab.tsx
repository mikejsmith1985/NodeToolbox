// CheckInTab.tsx — Preparing the status message you are about to send someone.
//
// The persona picker at the top of My Issues already answers "whose work?". This tab takes that
// answer, gathers the detail a status conversation needs, and produces the thing that was always the
// actual output: a short message to paste into a chat window.
//
// What it is NOT is a report on a person. The plate is shown so the sender can see what is being
// asked about before they ask it, and the message is fully editable before it goes anywhere. Nothing
// here writes to Jira and nothing sends itself — the send is a human pressing paste.

import { useMemo, useState } from 'react';

import { ReportAiPanel } from '../../ReportsHub/ReportAiPanel.tsx';
import { useCopyFeedback } from '../../../hooks/useCopyFeedback.ts';
import { buildCheckInPrompt, parseCheckInReply, type CheckInReply } from './checkInPrompt.ts';
import { buildCheckInMessage, describeCheckInMessage } from './checkInMessage.ts';
import { useCheckInIssues } from './useCheckInIssues.ts';
import type { CheckInIssue } from './checkInModel.ts';
import type { ReportSubject } from '../myIssuesRoleLens.ts';
import styles from '../MyIssuesView.module.css';

interface CheckInTabProps {
  /** Whoever the persona picker is pointed at. */
  subject: ReportSubject;
  /** Roster member identifiers, for a team subject. */
  memberIdentifiers: string[];
  /** How to name the person in the message. */
  subjectName: string;
}

/** How one issue's timing reads in the plate, in the plainest terms that are still true. */
function describeTiming(issue: CheckInIssue): string {
  const parts: string[] = [];
  if (issue.daysInStage !== null) {
    parts.push(`${issue.daysInStage}d at this stage`);
  }
  if (issue.daysPastDue !== null && issue.daysPastDue > 0) {
    parts.push(`overdue ${issue.daysPastDue}d`);
  } else if (issue.dueDateIso !== null) {
    parts.push(`due ${issue.dueDateIso}`);
  }
  if (issue.comments.length === 0) {
    // Worth stating: an item with no comments at all is the one nobody has said anything about.
    parts.push('no comments');
  }
  return parts.join(' · ');
}

/** The check-in workspace: the plate, the gated prompt round trip, and the message to send. */
export default function CheckInTab({ subject, memberIdentifiers, subjectName }: CheckInTabProps) {
  const { issues, isLoading, error, reload } = useCheckInIssues(subject, memberIdentifiers);
  const [reply, setReply] = useState<CheckInReply | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [editedMessage, setEditedMessage] = useState<string | null>(null);
  const { hasCopied, confirmCopy } = useCopyFeedback();

  const prompt = useMemo(() => buildCheckInPrompt(subjectName, issues), [subjectName, issues]);

  // The edited text wins once it exists: the sender's own wording is the whole point of showing it.
  const messageText = editedMessage ?? (reply === null ? '' : buildCheckInMessage(reply, issues));

  function handleIngest(responseText: string): void {
    try {
      const parsedReply = parseCheckInReply(responseText, issues.map((issue) => issue.issueKey));
      setReply(parsedReply);
      // A fresh reply replaces an edit, because the edit was of a message that no longer exists.
      setEditedMessage(null);
      setIngestError(null);
    } catch (caughtError) {
      setIngestError(caughtError instanceof Error ? caughtError.message : 'That reply could not be read.');
    }
  }

  return (
    <div className={styles.settingsSection}>
      <div className={styles.toolbar}>
        <h3 className={styles.settingsSectionTitle}>{`Status check-in — ${subjectName}`}</h3>
        <button className={styles.refreshButton} type="button" onClick={reload} disabled={isLoading}>
          {isLoading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      <p className={styles.expandHint}>
        {'Gathers what '}
        {subjectName}
        {' has open — how long each item has sat where it is, when it was last touched, what it '}
        {'delivers, and the latest comments — then drafts a short message you can send them to confirm '}
        {'where things actually are. Nothing is written to Jira and nothing sends itself.'}
      </p>

      {error ? <p className={styles.errorMessage}>{error}</p> : null}

      {!isLoading && issues.length === 0 && error === null ? (
        <p className={styles.emptyIssueList}>
          {subjectName}
          {' has no open assigned work, so there is nothing to check in on.'}
        </p>
      ) : null}

      {issues.length > 0 ? (
        <>
          <p className={styles.countLabel}>{`${issues.length} open item(s), most pressing first`}</p>
          <ul className={styles.compactList} aria-label="Work to check in on">
            {issues.map((issue) => (
              <li className={styles.compactRow} key={issue.issueKey}>
                <strong>{issue.issueKey}</strong>
                {` — ${issue.summary}`}
                <span className={styles.statusBadge}>{issue.status}</span>
                <span className={styles.cardMeta}>{describeTiming(issue)}</span>
                {issue.featureKey ? (
                  <span className={styles.cardMeta}>
                    {issue.featureSummary ? `${issue.featureKey} — ${issue.featureSummary}` : issue.featureKey}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>

          <ReportAiPanel
            title="Draft the check-in message"
            prompt={prompt}
            ingestLabel="Read the reply"
            onIngest={handleIngest}
            error={ingestError}
            hint="optional · advisory only, writes nothing to Jira and sends nothing"
          >
            {reply === null ? null : (
              <div className={styles.settingsSection}>
                <p className={styles.countLabel}>{describeCheckInMessage(reply)}</p>
                {/* Editable before it is sent. The sender is putting this in front of a colleague, and
                    their own wording will always beat a drafted one. */}
                <label className={styles.settingsSectionTitle} htmlFor="check-in-message">
                  Message to send
                </label>
                <textarea
                  className={styles.detailTextarea}
                  id="check-in-message"
                  rows={14}
                  value={messageText}
                  onChange={(changeEvent) => setEditedMessage(changeEvent.target.value)}
                />
                <div className={styles.detailActionRow}>
                  <button
                    className={styles.panePrimaryButton}
                    type="button"
                    onClick={() => confirmCopy(messageText)}
                  >
                    {hasCopied ? '✓ Copied!' : 'Copy message'}
                  </button>
                  {editedMessage === null ? null : (
                    <button
                      className={styles.pillButton}
                      type="button"
                      onClick={() => setEditedMessage(null)}
                    >
                      Reset to the draft
                    </button>
                  )}
                </div>
              </div>
            )}
          </ReportAiPanel>
        </>
      ) : null}
    </div>
  );
}
