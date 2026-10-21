// ChooseModeStep.tsx — The change job's first screen: three big choices (New change, Finish one I started, Fix an
// existing change), each opening only what belongs to it.

import { useId, useState } from 'react';

import type { CrgTemplate } from '../../../views/SnowHub/hooks/useCrgState.ts';
import type { CreatedChangeSummary } from '../createOutcome.ts';
import type { PlanEnvironmentKey } from '../ctaskEnvironmentPlan.ts';
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
  /** Picks up changes already in ServiceNow (one per environment) and finishes them — nothing new is created. */
  onFinishCreatedChanges: (createdChanges: CreatedChangeSummary[]) => void;
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

const FINISH_ENVIRONMENTS: readonly PlanEnvironmentKey[] = ['REL', 'PRD', 'PFIX'];

/**
 * "Finish changes you already created": the change number for each environment that has one. Every typed number must
 * look like a change number, and at least one is needed.
 */
function FinishCreatedStart({ isBlocked, onFinishCreatedChanges }: { isBlocked: boolean } & Pick<ChooseModeStepProps, 'onFinishCreatedChanges'>) {
  const [typedNumbers, setTypedNumbers] = useState<Partial<Record<PlanEnvironmentKey, string>>>({});
  const filledChanges = FINISH_ENVIRONMENTS
    .map((environmentLabel) => ({ environmentLabel, changeNumber: normalizeChangeNumber(typedNumbers[environmentLabel] ?? '') }))
    .filter((createdChange) => createdChange.changeNumber !== '');
  const isValid = filledChanges.length > 0 && filledChanges.every((createdChange) => CHANGE_NUMBER_PATTERN.test(createdChange.changeNumber));
  return (
    <details className={styles.card}>
      <summary className={styles.connectionLine}>Finish changes you already created</summary>
      <p className={styles.hint}>Already made the changes in ServiceNow? Type each one&apos;s number. The Wizard fills your picks back in from them and saves your finished work to them — it never creates new ones.</p>
      {FINISH_ENVIRONMENTS.map((environmentLabel) => (
        <label key={environmentLabel} className={styles.fieldLabel}>
          {`${environmentLabel} change number`}
          <input className={ownStyles.inputField} value={typedNumbers[environmentLabel] ?? ''} placeholder={environmentLabel === 'PFIX' ? 'Only if you have one' : 'CHG0012345'}
            onChange={(changeEvent) => setTypedNumbers({ ...typedNumbers, [environmentLabel]: changeEvent.target.value })} />
        </label>
      ))}
      <div className={ownStyles.buttonRow}>
        <button type="button" className={styles.primaryButton} disabled={!isValid} onClick={() => onFinishCreatedChanges(filledChanges)}>
          {isBlocked ? 'Use them in my open change' : 'Finish these changes'}
        </button>
      </div>
    </details>
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

/** The three ways in, in the words the user would use. Only one panel is open at a time. */
type FirstChoice = 'new' | 'finish' | null;

/** "New change": start blank, copy a change raised before, or start from a template. */
function NewChangePanel(props: ChooseModeStepProps & { waitingJob: WizardJob | undefined }) {
  const { waitingJob } = props;
  return (
    <div className={styles.card} aria-label="New change">
      {waitingJob ? (
        <p className={styles.hint}>You already have a new change open. Finish it under “Finish one I started”, or use the buttons here.</p>
      ) : null}
      <div className={ownStyles.buttonRow}>
        <button type="button" className={styles.secondaryButton} onClick={() => (waitingJob ? props.onStartAgain(waitingJob) : props.onChooseNew())}>
          {waitingJob ? 'Start blank (throws away the open one)' : 'Start blank'}
        </button>
      </div>
      <RecommendedStart templates={props.templates} isBlocked={Boolean(waitingJob)} onStartFromChange={props.onStartFromChange} onStartFreshFromChange={props.onStartFreshFromChange} onStartFromTemplate={props.onStartFromTemplate} />
    </div>
  );
}

/** "Finish one I started": the job under way, and changes already made in ServiceNow. */
function FinishPanel(props: ChooseModeStepProps & { waitingJob: WizardJob | undefined }) {
  return (
    <div className={styles.card} aria-label="Finish one I started">
      {props.resumableJobs.length === 0 ? <p className={styles.hint}>Nothing is waiting in this browser.</p> : null}
      <ResumableJobCards resumableJobs={props.resumableJobs} onContinue={props.onContinue} onStartAgain={props.onStartAgain} />
      <FinishCreatedStart isBlocked={Boolean(props.waitingJob)} onFinishCreatedChanges={props.onFinishCreatedChanges} />
    </div>
  );
}

/** One of the three big choices. */
function ChoiceCard({ title, description, isOpen, onChoose }: { title: string; description: string; isOpen?: boolean; onChoose: () => void }) {
  return (
    <button type="button" className={styles.choiceCard} aria-expanded={isOpen} onClick={onChoose}>
      <span className={styles.choiceTitle}>{title}</span>
      <span className={styles.choiceDescription}>{description}</span>
    </button>
  );
}

/**
 * The first screen of the change job: three big choices — New change, Finish one I started, Fix an existing change.
 * Everything else (old change, template, changes already in ServiceNow) sits inside the choice it belongs to, so
 * there is one question to answer first (owner feedback: too many ways in).
 */
export default function ChooseModeStep(props: ChooseModeStepProps) {
  const waitingJob = props.resumableJobs.find((job) => job.kind === 'newChange');
  // A job under way opens its panel straight away — it is almost always what the user came back for.
  const [openChoice, setOpenChoice] = useState<FirstChoice>(props.resumableJobs.length > 0 ? 'finish' : null);
  const toggleChoice = (choice: FirstChoice) => setOpenChoice(openChoice === choice ? null : choice);
  const waitingCount = props.resumableJobs.length;
  return (
    <section aria-labelledby="change-job-heading">
      <h2 id="change-job-heading" className={styles.cardTitle}>What do you want to do?</h2>
      <div className={styles.choiceGrid}>
        <ChoiceCard title="New change" description="Start blank, copy a change you raised before, or use a template." isOpen={openChoice === 'new'} onChoose={() => toggleChoice('new')} />
        <ChoiceCard title="Finish one I started" description={waitingCount > 0 ? `${waitingCount} waiting — pick up where you left off.` : 'Pick up a job, or changes already in ServiceNow.'} isOpen={openChoice === 'finish'} onChoose={() => toggleChoice('finish')} />
        <ChoiceCard title="Fix an existing change" description="Load a change by its number and fix what needs fixing." onChoose={props.onChooseExisting} />
      </div>
      {openChoice === 'new' ? <NewChangePanel {...props} waitingJob={waitingJob} /> : null}
      {openChoice === 'finish' ? <FinishPanel {...props} waitingJob={waitingJob} /> : null}
      <div className={ownStyles.buttonRow}>
        <button type="button" className={styles.secondaryButton} onClick={props.onOpenTemplates}>Manage templates</button>
        <button type="button" className={styles.secondaryButton} onClick={props.onExit}>Back to home</button>
      </div>
    </section>
  );
}
