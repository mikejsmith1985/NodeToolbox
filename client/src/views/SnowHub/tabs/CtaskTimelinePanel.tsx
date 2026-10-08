// CtaskTimelinePanel.tsx — Plans a change's CTASK timeline with AI Assist and writes each task's planned dates.
//
// A CTASK's planned start and end must follow the real order of operations. The assistant reads every task and
// decides the order and minutes; Toolbox holds it to Implementation → Technical Checkout → Business Checkout,
// dates the tasks back to back from the change's planned start, and writes the dates when the owner says so.

import { useMemo, useState } from 'react';

import { fetchReviewedCtasks, saveCtaskPlannedDates } from '../chgFormula/ctaskReviewApi.ts';
import type { ReviewedCtask } from '../chgFormula/ctaskReviewRecord.ts';
import {
  buildCtaskTimelinePrompt,
  isTimelinePastWindow,
  parseCtaskTimelineReply,
  scheduleCtaskTimeline,
  type ChangeWindow,
  type ScheduledCtask,
} from '../chgFormula/ctaskTimeline.ts';
import { useAiAssist } from '../hooks/useAiAssist.ts';
import { AiAssistPromptModal, type AiAssistPromptSession } from './AiAssistPromptModal.tsx';
import styles from './CreateChgTab.module.css';

interface CtaskTimelinePanelProps {
  changeSysId: string;
  /** The change's planned window (UTC, as the Modify form holds it) the tasks are dated within. */
  changeWindow: ChangeWindow;
}

/** "2026-10-10T05:00" as "2026-10-10 05:00". */
function formatFormDateTime(formDateTimeUtc: string): string {
  return formDateTimeUtc.replace('T', ' ');
}

/** "1 CTASK", "2 CTASKs". */
function countTasks(taskCount: number): string {
  return `${taskCount} ${taskCount === 1 ? 'CTASK' : 'CTASKs'}`;
}

/** The proposed timeline, the warnings it carries, and the button that writes it. */
function ProposedTimeline({ schedule, missingNumbers, isPastWindow, isWriting, onWrite }: {
  schedule: readonly ScheduledCtask[];
  missingNumbers: readonly string[];
  isPastWindow: boolean;
  isWriting: boolean;
  onWrite: () => void;
}) {
  return (
    <div className={styles.environmentCard}>
      <ul className={styles.riskFindingList}>
        {schedule.map((entry) => (
          <li className={styles.riskFindingItem} key={entry.ctask.number}>
            {`${entry.ctask.number} · ${formatFormDateTime(entry.startUtc)} → ${formatFormDateTime(entry.endUtc)} (${entry.minutes} min) — `
              + entry.ctask.shortDescription}
          </li>
        ))}
      </ul>
      {isPastWindow ? <p className={styles.errorText}>This timeline runs past the change&apos;s planned end — widen the window or shorten the tasks.</p> : null}
      {missingNumbers.length > 0 ? <p className={styles.errorText}>{`The reply left out ${missingNumbers.join(', ')} — it is not dated.`}</p> : null}
      <button className={styles.primaryButton} disabled={isWriting} onClick={onWrite} type="button">
        {isWriting ? 'Writing…' : 'Write CTASK dates to ServiceNow'}
      </button>
    </div>
  );
}

/** The CTASK timeline: plan it with AI Assist, see it, write it. */
export function CtaskTimelinePanel({ changeSysId, changeWindow }: CtaskTimelinePanelProps) {
  const { isUnlocked } = useAiAssist();
  const [ctasks, setCtasks] = useState<ReviewedCtask[]>([]);
  const [plannedReply, setPlannedReply] = useState<string | null>(null);
  const [promptSession, setPromptSession] = useState<AiAssistPromptSession | null>(null);
  const [isWriting, setIsWriting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const hasWindow = changeWindow.startUtc !== '' && changeWindow.endUtc !== '';


  const plannedTimeline = useMemo(() => {
    if (plannedReply === null) {
      return null;
    }
    const { entries, missingNumbers } = parseCtaskTimelineReply(plannedReply, ctasks);
    const schedule = scheduleCtaskTimeline(entries, ctasks, changeWindow.startUtc);
    return { schedule, missingNumbers, isPastWindow: isTimelinePastWindow(schedule, changeWindow.endUtc) };
  }, [plannedReply, ctasks, changeWindow]);

  // The tasks are read when planning starts, not when the panel shows — saving a change must not touch them.
  const handleOpenPlanning = async () => {
    setErrorMessage('');
    let loadedTasks: ReviewedCtask[];
    try {
      loadedTasks = await fetchReviewedCtasks(changeSysId);
    } catch (loadError) {
      setErrorMessage(loadError instanceof Error ? `Could not read the CTASKs: ${loadError.message}` : 'Could not read the CTASKs.');
      return;
    }
    if (loadedTasks.length === 0) {
      setErrorMessage('This change has no CTASKs to schedule.');
      return;
    }
    setCtasks(loadedTasks);
    setPlannedReply(null);
    setPromptSession({
      instructions: 'Copy this prompt into AI Assist to plan the order of operations, then paste its reply below — '
        + 'Toolbox dates each CTASK back to back from the change\'s planned start.',
      promptText: buildCtaskTimelinePrompt(loadedTasks, changeWindow),
      applyButtonLabel: 'Use this timeline',
      applyReply: (replyText) => {
        if (parseCtaskTimelineReply(replyText, loadedTasks).entries.length === 0) {
          return { statusMessage: 'No "CTASK… | minutes" lines were found in the pasted reply.', wasApplied: false };
        }
        setPlannedReply(replyText);
        setStatusMessage('');
        return { statusMessage: 'Timeline captured — check it below, then write the dates.', wasApplied: true };
      },
    });
  };

  const handleWrite = async () => {
    if (!plannedTimeline) {
      return;
    }
    setIsWriting(true);
    const failedNumbers: string[] = [];
    for (const entry of plannedTimeline.schedule) {
      try {
        await saveCtaskPlannedDates(entry.ctask, entry.startUtc, entry.endUtc);
      } catch {
        failedNumbers.push(entry.ctask.number);
      }
    }
    setErrorMessage(failedNumbers.length > 0 ? `ServiceNow did not accept the dates for ${failedNumbers.join(', ')}.` : '');
    setStatusMessage(`Wrote planned dates to ${countTasks(plannedTimeline.schedule.length - failedNumbers.length)}.`);
    setIsWriting(false);
  };

  return (
    <div className={styles.clonePanel}>
      <h4 className={styles.panelSectionTitle}>CTASK timeline</h4>
      <p className={styles.panelHint}>
        Sets each CTASK&apos;s planned start and end in the order of operations: Implementation → Review Technical Checkout
        → Review Business Checkout, back to back from the change&apos;s planned start.
      </p>
      {!hasWindow ? <p className={styles.errorText}>Set the change&apos;s planned start and end first — the timeline is dated within them.</p> : null}
      {hasWindow && !isUnlocked ? <p className={styles.panelHint}>Unlock AI Assist to plan the timeline.</p> : null}
      {hasWindow && isUnlocked ? (
        <div className={styles.buttonRow}>
          <button className={styles.aiAssistButton} onClick={() => void handleOpenPlanning()} type="button">
            ✦ Plan the CTASK timeline with AI Assist
          </button>
        </div>
      ) : null}
      {plannedTimeline ? (
        <ProposedTimeline
          isPastWindow={plannedTimeline.isPastWindow}
          isWriting={isWriting}
          missingNumbers={plannedTimeline.missingNumbers}
          onWrite={() => void handleWrite()}
          schedule={plannedTimeline.schedule}
        />
      ) : null}
      {statusMessage ? <p className={styles.successText} role="status">{statusMessage}</p> : null}
      {errorMessage ? <p className={styles.errorText} role="alert">{errorMessage}</p> : null}
      {promptSession ? (
        <AiAssistPromptModal key={promptSession.promptText} onClose={() => setPromptSession(null)} session={promptSession} />
      ) : null}
    </div>
  );
}
