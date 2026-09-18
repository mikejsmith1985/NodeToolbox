// IntakeJourneyStrip.tsx — The Epic Intake progress strip: every step, where the intake is now, and the one thing to
// do next. It only renders what the engine derived, so it can never disagree with the rest of the page (FR-009).

import rewriteStyles from '../../rewrite/rewrite.module.css';
import { INTAKE_STEP_ORDER, type IntakeStepId } from '../epicIntakeModel.ts';
import type { IntakeNextStep } from '../intakeChecklist.ts';
import styles from '../EpicIntakeWorkspace.module.css';
import { INTAKE_STEP_LABELS } from './intakeLabels.ts';

interface IntakeJourneyStripProps {
  nextStep: IntakeNextStep;
}

type StepState = 'done' | 'current' | 'waiting';

function readStepState(step: IntakeStepId, nextStep: IntakeNextStep): StepState {
  if (nextStep.turn === 'done') return 'done';
  const stepIndex = INTAKE_STEP_ORDER.indexOf(step);
  const currentIndex = INTAKE_STEP_ORDER.indexOf(nextStep.step);
  if (stepIndex < currentIndex) return 'done';
  return stepIndex === currentIndex ? 'current' : 'waiting';
}

const STEP_MARKS: Record<StepState, (stepNumber: number) => string> = {
  done: () => '✓',
  current: (stepNumber) => String(stepNumber),
  waiting: (stepNumber) => String(stepNumber),
};

/** Shows the eight intake steps, the next action, and how many decisions are still open. */
export default function IntakeJourneyStrip({ nextStep }: IntakeJourneyStripProps) {
  return (
    <div>
      <ol className={rewriteStyles.journeyStrip} aria-label="Intake progress">
        {INTAKE_STEP_ORDER.map((step, index) => {
          const stepState = readStepState(step, nextStep);
          return (
            <li
              key={step}
              className={`${rewriteStyles.journeyStep} ${rewriteStyles[`journey_${stepState}`] ?? ''}`}
              aria-current={stepState === 'current' ? 'step' : undefined}
            >
              <span className={rewriteStyles.journeyMark}>{STEP_MARKS[stepState](index + 1)}</span>
              {INTAKE_STEP_LABELS[step]}
            </li>
          );
        })}
      </ol>
      <p className={rewriteStyles.journeyNextAction}>
        <strong>{nextStep.turn === 'done' ? 'Finished. ' : 'Do this next: '}</strong>
        {nextStep.nextAction}
        {nextStep.openCount > 0 ? <span className={styles.intakeCount}> ({nextStep.openCount} still open)</span> : null}
      </p>
    </div>
  );
}
