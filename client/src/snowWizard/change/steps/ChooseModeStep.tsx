// ChooseModeStep.tsx — The change job's first screen: the recommended quick start (an old change or a template), a new
// change, or change an existing one — plus any job to continue and the way to "Your templates".

import { useId, useState } from 'react';

import type { CrgTemplate } from '../../../views/SnowHub/hooks/useCrgState.ts';
import styles from '../../shell/WizardShell.module.css';
import type { WizardJob } from '../../shell/wizardJobStore.ts';
import ownStyles from '../ChangeWizard.module.css';

interface ChooseModeStepProps {
  /** In-progress jobs of this kind, offered to continue or start again. */
  resumableJobs: readonly WizardJob[];
  /** Saved change templates, offered as a starting point. */
  templates: readonly CrgTemplate[];
  onChooseNew: () => void;
  onChooseExisting: () => void;
  onContinue: (job: WizardJob) => void;
  onStartAgain: (job: WizardJob) => void;
  /** Copies an old change into a new change — into the one already open, when there is one. */
  onStartFromChange: (changeNumber: string) => void;
  /** Throws away the open new change and starts a fresh one from an old change. */
  onStartFreshFromChange: (changeNumber: string) => void;
  onStartFromTemplate: (templateId: string) => void;
  onOpenTemplates: () => void;
  onExit: () => void;
}

/** What each resumable job is called. */
const JOB_NAMES: Readonly<Record<string, string>> = { newChange: 'Your new change', modifyChange: 'Your change edit' };
const MINUTES_PER_HOUR = 60;
const MILLISECONDS_PER_MINUTE = 60_000;
// A ServiceNow change number: "CHG" and its digits.
const CHANGE_NUMBER_PATTERN = /^CHG\d+$/;

/** "5 minutes ago" / "3 hours ago" for the resume card. */
function describeAge(updatedAt: number): string {
  const minutesAgo = Math.max(0, Math.round((Date.now() - updatedAt) / MILLISECONDS_PER_MINUTE));
  return minutesAgo < MINUTES_PER_HOUR ? `${minutesAgo} minute(s) ago` : `${Math.round(minutesAgo / MINUTES_PER_HOUR)} hour(s) ago`;
}

/** The change number as ServiceNow writes it. */
function normalizeChangeNumber(typedNumber: string): string {
  return typedNumber.trim().toUpperCase();
}

/** "Start from a template": a list of the saved templates and the button. Hidden while there are none. */
function TemplateStart({ templates, isBlocked, onStartFromTemplate }: { templates: readonly CrgTemplate[]; isBlocked: boolean; onStartFromTemplate: (templateId: string) => void }) {
  const pickerId = useId();
  const [chosenTemplateId, setChosenTemplateId] = useState('');
  if (templates.length === 0) return null;
  return (
    <div className={ownStyles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor={pickerId}>Your saved templates</label>
      <div className={ownStyles.buttonRow}>
        <select id={pickerId} className={ownStyles.selectField} value={chosenTemplateId} onChange={(changeEvent) => setChosenTemplateId(changeEvent.target.value)}>
          <option value="">Choose a template…</option>
          {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
        </select>
        <button type="button" className={styles.secondaryButton} disabled={chosenTemplateId === ''} onClick={() => onStartFromTemplate(chosenTemplateId)}>{isBlocked ? 'Use it on my open change' : 'Start from a template'}</button>
      </div>
    </div>
  );
}

/** The recommended way in: copy a change raised before (or a template), tweak it, save it as a template. */
function RecommendedStart({ templates, isBlocked, onStartFromChange, onStartFreshFromChange, onStartFromTemplate }: Pick<ChooseModeStepProps, 'templates' | 'onStartFromChange' | 'onStartFreshFromChange' | 'onStartFromTemplate'> & { isBlocked: boolean }) {
  const numberFieldId = useId();
  const [typedNumber, setTypedNumber] = useState('');
  const changeNumber = normalizeChangeNumber(typedNumber);
  const isNumberValid = CHANGE_NUMBER_PATTERN.test(changeNumber);
  return (
    <div className={`${styles.card} ${ownStyles.recommendedCard}`}>
      <span className={ownStyles.recommendedBadge}>Recommended</span>
      <p className={styles.connectionLine}>Fastest: start from a change you’ve raised before. Load it, tweak it, then save it as a template for next time.</p>
      {isBlocked ? <p className={styles.hint}>You have a new change open above. Copy an old change into it, or start a fresh change from it instead.</p> : null}
      <label className={styles.fieldLabel} htmlFor={numberFieldId}>Change number</label>
      <div className={ownStyles.buttonRow}>
        <input id={numberFieldId} className={ownStyles.inputField} value={typedNumber} placeholder="CHG0012345" onChange={(changeEvent) => setTypedNumber(changeEvent.target.value)} />
        <button type="button" className={styles.primaryButton} disabled={!isNumberValid} onClick={() => onStartFromChange(changeNumber)}>{isBlocked ? 'Copy it into my open change' : 'Start from an existing change'}</button>
        {isBlocked ? <button type="button" className={styles.secondaryButton} disabled={!isNumberValid} onClick={() => onStartFreshFromChange(changeNumber)}>Start a fresh change from it</button> : null}
      </div>
      {typedNumber.trim() !== '' && !isNumberValid ? <p className={styles.hint}>A change number looks like CHG0012345.</p> : null}
      <TemplateStart templates={templates} isBlocked={isBlocked} onStartFromTemplate={onStartFromTemplate} />
    </div>
  );
}

/** A card per job already under way, to continue or start again. */
function ResumableJobCards({ resumableJobs, onContinue, onStartAgain }: Pick<ChooseModeStepProps, 'resumableJobs' | 'onContinue' | 'onStartAgain'>) {
  return resumableJobs.map((job) => (
    <div key={job.jobId} className={styles.card}>
      <p className={styles.connectionLine}>{`${JOB_NAMES[job.kind] ?? 'Your change'} is waiting (last worked on ${describeAge(job.updatedAt)}).`}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.primaryButton} onClick={() => onContinue(job)}>Continue</button>
        <button type="button" className={styles.secondaryButton} onClick={() => onStartAgain(job)}>Start again</button>
      </div>
    </div>
  ));
}

/** The first screen of the change job. */
export default function ChooseModeStep(props: ChooseModeStepProps) {
  // Only one new change is open at a time, so a quick start then copies into it (or starts fresh, discarding it).
  const hasWaitingNewChange = props.resumableJobs.some((job) => job.kind === 'newChange');
  return (
    <section aria-labelledby="change-job-heading">
      <h2 id="change-job-heading" className={styles.cardTitle}>Make or change a change</h2>
      <ResumableJobCards resumableJobs={props.resumableJobs} onContinue={props.onContinue} onStartAgain={props.onStartAgain} />
      <RecommendedStart templates={props.templates} isBlocked={hasWaitingNewChange} onStartFromChange={props.onStartFromChange} onStartFreshFromChange={props.onStartFreshFromChange} onStartFromTemplate={props.onStartFromTemplate} />
      <div className={styles.choiceGrid}>
        <button type="button" className={styles.choiceCard} onClick={props.onChooseNew}>
          <span className={styles.choiceTitle}>New change</span>
          <span className={styles.choiceDescription}>Start from blank: raise a change for a release, one per environment.</span>
        </button>
        <button type="button" className={styles.choiceCard} onClick={props.onChooseExisting}>
          <span className={styles.choiceTitle}>Change an existing one</span>
          <span className={styles.choiceDescription}>Load a change by its number and fix what needs fixing.</span>
        </button>
      </div>
      <div className={ownStyles.buttonRow}>
        <button type="button" className={styles.secondaryButton} onClick={props.onOpenTemplates}>Manage templates</button>
        <button type="button" className={styles.secondaryButton} onClick={props.onExit}>Back to home</button>
      </div>
    </section>
  );
}
