// TaskTimelineSection.tsx — "Time the tasks with AI" on the tasks step: one copy-and-paste round that gives every task
// its three estimates, then each change's tasks laid out back to back inside its window.
//
// The estimates go on the cards through the same writer the cards use, so the duration block on every task, the change's
// implementation plan and the task dates all come from one set of numbers. Nothing is written to ServiceNow here.

import { formatMinutes } from '../../../views/SnowHub/ctaskDurations.ts';
import styles from '../ChangeWizard.module.css';
import type { CrgHook } from '../changeDraft.ts';
import PromptRound from '../PromptRound.tsx';
import {
  buildEnvironmentTimelines, buildTaskTimelinePrompt, describeTaskTiming, listTimelineOverruns, readTaskTimelineReply, type EnvironmentTimeline,
} from '../taskTimeline.ts';
import { buildTaskTemplateData } from '../templateSave.ts';

/** "22:00" from "2026-10-24T22:00", with the date when it differs from the window's first day. */
function formatTableClock(formDateTime: string, windowStartDate: string): string {
  const [datePart, timePart] = formDateTime.split('T');
  return datePart === windowStartDate.split('T')[0] ? timePart : `${datePart} ${timePart}`;
}

/** One change's tasks in the order they run, with their planned start and end. */
function TimelineTable({ timeline }: { timeline: EnvironmentTimeline }) {
  const windowLength = timeline.windowMinutes === null ? 'no window yet' : formatMinutes(timeline.windowMinutes);
  return (
    <div>
      <h4 className={styles.cardTitle}>{`The ${timeline.label} change — window ${windowLength}`}</h4>
      <table className={styles.gridTable} aria-label={`${timeline.label} task timeline`}>
        <thead><tr><th>Task</th><th>Starts</th><th>Ends</th><th>Timing</th></tr></thead>
        <tbody>
          {timeline.schedule.map((scheduled) => (
            <tr key={scheduled.card.id}>
              <td>{scheduled.card.shortDescription}</td>
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
  const timelines = buildEnvironmentTimelines(state).filter((timeline) => timeline.schedule.length > 0);
  const overruns = listTimelineOverruns(state);

  /** Puts the reply's estimates on the cards it timed; the message says what was read. */
  function handleReadReply(replyText: string): string {
    const timingReply = readTaskTimelineReply(replyText, state.changeTasks);
    for (const card of state.changeTasks) {
      const durationEstimates = timingReply.estimatesByTaskId[card.id];
      if (durationEstimates) actions.updateChangeTask(card.id, { ...buildTaskTemplateData(card), durationEstimates });
    }
    return timingReply.message;
  }

  return (
    <section className={styles.card} aria-label="Time the tasks with AI">
      <h3 className={styles.cardTitle}>⏱️ Time the tasks with AI</h3>
      <p className={styles.hint}>
        Every task needs how long it takes to do, to check, and to back out. The AI works it out from the tasks and the Jira
        work; the tasks then run one after another inside each change&apos;s window.
      </p>
      <PromptRound promptText={buildTaskTimelinePrompt(state)} copyLabel="Copy the timing prompt" readButtonLabel="Read the timings" onReadReply={handleReadReply} />
      {timelines.map((timeline) => <TimelineTable key={timeline.label} timeline={timeline} />)}
      {overruns.map((overrun) => <p key={overrun} className={styles.errorText}>{overrun}</p>)}
    </section>
  );
}
