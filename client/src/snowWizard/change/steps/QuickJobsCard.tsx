// QuickJobsCard.tsx — Short cuts on a loaded change: "Just the task schedule" and "Just the test evidence", for when that
// is the last thing a change needs and walking every modify step would be busywork (owner, GH #475).
//
// The schedule short cut is the tasks step itself (cards, the AI timing round, the timeline) plus one save that re-dates
// every task and writes the duration block; it is held, like the tasks step, until every task is timed and fits the
// window. The evidence short cut is the same sweep card the last step uses.

import { useState } from 'react';

import { readEnabledPlanEnvironments } from '../changeDraft.ts';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';
import type { EvidenceSweepReport } from '../evidenceSweep.ts';
import { saveQuickSchedule } from '../quickSchedule.ts';
import { listTaskProblems } from '../taskCards.ts';
import { listTimelineOverruns, listUntimedTaskProblems } from '../taskTimeline.ts';
import type { TemplateLibrary } from '../useTemplateLibrary.ts';
import EvidenceSweepCard from './EvidenceSweepCard.tsx';
import TasksStep from './TasksStep.tsx';

/** The short cuts need the job's template library too, for the tasks step's saved tasks. */
export interface QuickJobsCardProps extends ChangeStepProps {
  library: TemplateLibrary;
}

type QuickJob = 'schedule' | 'evidence' | null;
type SaveState = { kind: 'idle' } | { kind: 'working' } | { kind: 'done'; summary: string } | { kind: 'failed'; message: string };

/** The tasks, the timing round, and one button that saves just the schedule. */
function QuickSchedule(props: QuickJobsCardProps) {
  const { crg, session } = props;
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' });
  const changeNumber = session.modify?.changeNumber ?? '';
  const changeSysId = session.modify?.changeSysId ?? '';
  const blockers = [
    ...listTaskProblems(crg.state.changeTasks, readEnabledPlanEnvironments(crg.state), 'modify'),
    ...listUntimedTaskProblems(crg.state), ...listTimelineOverruns(crg.state),
    ...(changeSysId === '' ? ['Look the change up again, so its tasks can be saved.'] : []),
  ];

  async function save() {
    setSaveState({ kind: 'working' });
    try {
      const summary = await saveQuickSchedule({
        changeNumber, changeSysId, tasks: crg.state.changeTasks, links: session.modify?.existingTasks ?? [],
        implementationPlan: crg.state.chgPlanningContent.implementationPlan,
      });
      setSaveState({ kind: 'done', summary });
    } catch (saveError) {
      setSaveState({ kind: 'failed', message: saveError instanceof Error ? saveError.message : String(saveError) });
    }
  }

  return (
    <section aria-label="Just the task schedule">
      <TasksStep {...props} />
      <div className={styles.card}>
        {blockers.length > 0 ? <p className={styles.errorText}>{`Before saving: ${blockers[0]}`}</p> : null}
        <div className={styles.buttonRow}>
          <button type="button" className={styles.actionButton} disabled={blockers.length > 0 || saveState.kind === 'working'} onClick={() => { void save(); }}>
            {`Save the task schedule to ${changeNumber}`}
          </button>
        </div>
        {saveState.kind === 'working' ? <p className={styles.hint} role="status">Saving the tasks and their dates…</p> : null}
        {saveState.kind === 'done' ? <p className={styles.successText} role="status">{`✅ ${saveState.summary}`}</p> : null}
        {saveState.kind === 'failed' ? <p className={styles.errorText} role="alert">{`Not saved: ${saveState.message}`}</p> : null}
      </div>
    </section>
  );
}

/** The short-cut choice, and the short cut chosen. */
export default function QuickJobsCard(props: QuickJobsCardProps) {
  const { crg, session, updateSession } = props;
  const [quickJob, setQuickJob] = useState<QuickJob>(null);
  const changeNumber = session.modify?.changeNumber ?? '';
  const recordSweep = (report: EvidenceSweepReport) => updateSession({ evidenceResults: { ...session.evidenceResults, ...report.results } });
  const pick = (job: Exclude<QuickJob, null>) => setQuickJob((currentJob) => (currentJob === job ? null : job));
  return (
    <div>
      <div className={styles.card}>
        <h3 className={styles.cardTitle}>⚡ Just one thing left to do?</h3>
        <p className={styles.hint}>Do it here and skip the other steps. Or press Next to walk through the whole change.</p>
        <div className={styles.buttonRow}>
          <button type="button" className={quickJob === 'schedule' ? styles.actionButton : styles.secondaryButton} aria-pressed={quickJob === 'schedule'} onClick={() => pick('schedule')}>
            ⏱️ Just the task schedule
          </button>
          <button type="button" className={quickJob === 'evidence' ? styles.actionButton : styles.secondaryButton} aria-pressed={quickJob === 'evidence'} onClick={() => pick('evidence')}>
            📎 Just the test evidence
          </button>
        </div>
      </div>
      {quickJob === 'schedule' ? <QuickSchedule {...props} /> : null}
      {quickJob === 'evidence' ? <EvidenceSweepCard changeNumbers={[changeNumber]} issueKeys={[...crg.state.selectedIssueKeys]} onSwept={recordSweep} /> : null}
    </div>
  );
}
