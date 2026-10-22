// TaskTimelineSection.tsx — "Time the tasks with AI" on the tasks step: one copy-and-paste round that gives every task
// its three estimates and says how it runs, then each change's tasks laid out inside its window.
//
// The estimates go on the cards through the same writer the cards use, so the duration block on every task, the change's
// implementation plan and the task dates all come from one set of numbers. How each task runs — one after another, on
// stand-by for the whole window, alongside another task, not before a time — is the AI's first answer and the user's to
// change in the table (GH #475). Nothing is written to ServiceNow here.

import { formatMinutes } from '../../../views/SnowHub/ctaskDurations.ts';
import type { CtaskTemplate, TaskTimelinePlacement } from '../../../views/SnowHub/hooks/useCrgState.ts';
import styles from '../ChangeWizard.module.css';
import type { CrgHook } from '../changeDraft.ts';
import PromptRound from '../PromptRound.tsx';
import {
  buildEnvironmentTimelines, buildTaskTimelinePrompt, describeTaskTiming, listTimelineOverruns, readTaskTimelineReply, type EnvironmentTimeline,
} from '../taskTimeline.ts';
import { readTaskPlacement } from '../taskPlacement.ts';
import { buildTaskTemplateData } from '../templateSave.ts';

// The select's value for "alongside" carries the partner's title after this prefix.
const ALONGSIDE_VALUE_PREFIX = 'alongside:';

/** "22:00" from "2026-10-24T22:00", with the date when it differs from the window's first day. */
function formatTableClock(formDateTime: string, windowStartDate: string): string {
  const [datePart, timePart] = formDateTime.split('T');
  return datePart === windowStartDate.split('T')[0] ? timePart : `${datePart} ${timePart}`;
}

/** The select's value for a placement. */
function readRunValue(placement: TaskTimelinePlacement): string {
  return placement.runMode === 'alongside' ? `${ALONGSIDE_VALUE_PREFIX}${placement.alongsideTaskTitle ?? ''}` : placement.runMode;
}

/** A placement from the select's value, keeping the task's "not before" time. */
function readPlacementFromRunValue(runValue: string, notBeforeTime: string | undefined): TaskTimelinePlacement {
  const withTime = notBeforeTime ? { notBeforeTime } : {};
  if (runValue.startsWith(ALONGSIDE_VALUE_PREFIX)) return { runMode: 'alongside', alongsideTaskTitle: runValue.slice(ALONGSIDE_VALUE_PREFIX.length), ...withTime };
  return { runMode: runValue === 'wholeWindow' ? 'wholeWindow' : 'inOrder', ...withTime };
}

/** How one task runs: picked from the other tasks on this change, plus an optional earliest start. */
function RunsControl({ card, otherTitles, onChange }: { card: CtaskTemplate; otherTitles: string[]; onChange: (placement: TaskTimelinePlacement) => void }) {
  const placement = readTaskPlacement(card);
  const taskTitle = card.shortDescription.trim() || card.name;
  return (
    <div>
      <select
        className={styles.selectField}
        aria-label={`How “${taskTitle}” runs`}
        value={readRunValue(placement)}
        onChange={(changeEvent) => onChange(readPlacementFromRunValue(changeEvent.target.value, placement.notBeforeTime))}
      >
        <option value="inOrder">After the task before it</option>
        <option value="wholeWindow">Stand-by for the whole window</option>
        {otherTitles.map((otherTitle) => <option key={otherTitle} value={`${ALONGSIDE_VALUE_PREFIX}${otherTitle}`}>{`At the same time as “${otherTitle}”`}</option>)}
      </select>
      <label className={styles.hint}>
        {'Not before '}
        <input
          type="time"
          aria-label={`“${taskTitle}” starts no earlier than`}
          value={placement.notBeforeTime ?? ''}
          onChange={(changeEvent) => onChange({ ...placement, notBeforeTime: changeEvent.target.value || undefined })}
        />
      </label>
    </div>
  );
}

/** One change's tasks in the order they run, with their planned start and end and how each one runs. */
function TimelineTable({ timeline, onPlacementChange }: { timeline: EnvironmentTimeline; onPlacementChange: (card: CtaskTemplate, placement: TaskTimelinePlacement) => void }) {
  const windowLength = timeline.windowMinutes === null ? 'no window yet' : formatMinutes(timeline.windowMinutes);
  const taskTitles = timeline.schedule.map((scheduled) => scheduled.card.shortDescription.trim()).filter((title) => title !== '');
  return (
    <div>
      <h4 className={styles.cardTitle}>{`The ${timeline.label} change — window ${windowLength}`}</h4>
      <table className={styles.gridTable} aria-label={`${timeline.label} task timeline`}>
        <thead><tr><th>Task</th><th>Runs</th><th>Starts</th><th>Ends</th><th>Timing</th></tr></thead>
        <tbody>
          {timeline.schedule.map((scheduled) => (
            <tr key={scheduled.card.id}>
              <td>{scheduled.card.shortDescription}</td>
              <td>
                <RunsControl
                  card={scheduled.card}
                  otherTitles={taskTitles.filter((title) => title !== scheduled.card.shortDescription.trim())}
                  onChange={(placement) => onPlacementChange(scheduled.card, placement)}
                />
              </td>
              <td>{formatTableClock(scheduled.plannedStartDate, timeline.plannedStartDate)}</td>
              <td>{formatTableClock(scheduled.plannedEndDate, timeline.plannedStartDate)}</td>
              <td>{describeTaskTiming(scheduled.card)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The timing round and the schedule it produces. */
export default function TaskTimelineSection({ crg }: { crg: CrgHook }) {
  const { state, actions } = crg;
  if (state.changeTasks.length === 0) return null;
  const allTimelines = buildEnvironmentTimelines(state);
  const timelines = allTimelines.filter((timeline) => timeline.schedule.length > 0);
  const overruns = listTimelineOverruns(state);

  /** Puts the reply's estimates and placements on the cards it timed; the message says what was read. */
  function handleReadReply(replyText: string): string {
    const timingReply = readTaskTimelineReply(replyText, state.changeTasks, allTimelines[0]?.plannedStartDate ?? '');
    for (const card of state.changeTasks) {
      const durationEstimates = timingReply.estimatesByTaskId[card.id];
      if (!durationEstimates) continue;
      const timelinePlacement = timingReply.placementsByTaskId[card.id] ?? card.timelinePlacement;
      actions.updateChangeTask(card.id, { ...buildTaskTemplateData(card), durationEstimates, ...(timelinePlacement ? { timelinePlacement } : {}) });
    }
    return timingReply.message;
  }

  /** Writes one task's new placement through the same writer the cards use. */
  function handlePlacementChange(card: CtaskTemplate, timelinePlacement: TaskTimelinePlacement): void {
    actions.updateChangeTask(card.id, { ...buildTaskTemplateData(card), timelinePlacement });
  }

  return (
    <section className={styles.card} aria-label="Time the tasks with AI">
      <h3 className={styles.cardTitle}>⏱️ Time the tasks with AI</h3>
      <p className={styles.hint}>
        Every task needs how long it takes to do, to check, and to back out. The AI works it out from the tasks, the Jira
        work and what you have told us, and says which tasks run at the same time, which are only on stand-by, and which
        must wait for a set time. Change any of that under “Runs”.
      </p>
      <PromptRound promptText={buildTaskTimelinePrompt(state)} copyLabel="Copy the timing prompt" readButtonLabel="Read the timings" onReadReply={handleReadReply} />
      {timelines.map((timeline) => <TimelineTable key={timeline.label} timeline={timeline} onPlacementChange={handlePlacementChange} />)}
      {overruns.map((overrun) => <p key={overrun} className={styles.errorText}>{overrun}</p>)}
    </section>
  );
}
