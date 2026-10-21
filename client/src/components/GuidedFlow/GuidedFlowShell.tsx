// GuidedFlowShell.tsx — The shared frame around every guided, one-step-at-a-time flow: step header, progress strip, and Back / Skip / Next.

import { useEffect, useId, useRef, type ReactNode } from 'react';

import styles from './GuidedFlowShell.module.css';
import { pointToFirstMissingField } from './missingField.ts';

// ── Types ──

/** Where a single step stands: finished, being worked on now, or still ahead. */
export type GuidedFlowStepState = 'done' | 'current' | 'todo';

/** One step in a guided flow, as the caller describes it. */
export interface GuidedFlowStep {
  id: string;
  title: string;
  state: GuidedFlowStepState;
}

/** A named group of steps ("① Pick"), so a long flow reads as a few stages. */
export interface GuidedFlowPhase {
  label: string;
  stepIds: string[];
}

/** Everything the shell needs; the caller owns all state, the shell only draws it. */
export interface GuidedFlowShellProps {
  steps: GuidedFlowStep[];
  currentStepId: string;
  canGoNext: boolean;
  nextBlockedReason?: string;
  nextLabel?: string;
  isSkippable?: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip?: () => void;
  advancedAction?: ReactNode;
  /** Groups the strip into stages. Absent ⇒ one plain strip, as before. */
  phases?: GuidedFlowPhase[];
  /** Makes each finished step's chip a button that goes to it. Absent ⇒ chips are labels only, as before. */
  onStepSelect?: (stepId: string) => void;
  /** Offers "Show me" beside a blocked Next, pointing to the first field still needed. Absent ⇒ no link, as before. */
  shouldOfferShowMe?: boolean;
  children: ReactNode;
}

// ── Copy ──

const DEFAULT_NEXT_LABEL = 'Next';
const BACK_LABEL = 'Back';
const SKIP_LABEL = 'Skip — nothing to change';
const STEPS_STRIP_LABEL = 'Steps';

/** Words shown beside each step so its state never depends on colour alone. */
const STEP_STATE_TEXT: Record<GuidedFlowStepState, string> = {
  done: 'Done',
  current: 'Current',
  todo: 'To do',
};

/** The small mark at the start of each step chip — a tick when done, otherwise the step number. */
function readStepMark(stepState: GuidedFlowStepState, stepNumber: number): string {
  return stepState === 'done' ? '✓' : String(stepNumber);
}

// ── Focus ──

/**
 * Moves keyboard and screen-reader focus to the step heading whenever the step changes, so people
 * using assistive technology hear the new step. It deliberately does nothing on first display,
 * because grabbing focus when a page opens is disorienting.
 */
function useFocusHeadingOnStepChange(currentStepId: string) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousStepIdRef = useRef(currentStepId);
  useEffect(() => {
    if (previousStepIdRef.current === currentStepId) return;
    previousStepIdRef.current = currentStepId;
    headingRef.current?.focus();
  }, [currentStepId]);
  return headingRef;
}

// ── Pieces ──

/** One step's chip: its number, title and state in words — a button to it when it is finished and the flow allows. */
function StepChip({ step, stepNumber, onStepSelect }: { step: GuidedFlowStep; stepNumber: number; onStepSelect?: (stepId: string) => void }) {
  const chipContent = (
    <>
      <span className={styles.stepMark} aria-hidden="true">{readStepMark(step.state, stepNumber)}</span>
      <span className={styles.stepTitle}>{step.title}</span>
      <span className={styles.stepStateText}>{STEP_STATE_TEXT[step.state]}</span>
    </>
  );
  const isSelectable = Boolean(onStepSelect) && step.state === 'done';
  return (
    <li className={`${styles.stepChip} ${styles[`step_${step.state}`] ?? ''}`} aria-current={step.state === 'current' ? 'step' : undefined}>
      {isSelectable
        ? <button type="button" className={styles.stepChipButton} title={`Go to “${step.title}”`} onClick={() => onStepSelect?.(step.id)}>{chipContent}</button>
        : chipContent}
    </li>
  );
}

/** Shows every step with its number, title and state in words — grouped into stages when the flow names them. */
function GuidedFlowStepsStrip({ steps, phases, onStepSelect }: { steps: GuidedFlowStep[]; phases?: GuidedFlowPhase[]; onStepSelect?: (stepId: string) => void }) {
  const numberedSteps = steps.map((step, index) => ({ step, stepNumber: index + 1 }));
  if (!phases || phases.length === 0) {
    return (
      <ol className={styles.stepsStrip} aria-label={STEPS_STRIP_LABEL}>
        {numberedSteps.map(({ step, stepNumber }) => <StepChip key={step.id} step={step} stepNumber={stepNumber} onStepSelect={onStepSelect} />)}
      </ol>
    );
  }
  return (
    <div className={styles.phaseStrip} role="group" aria-label={STEPS_STRIP_LABEL}>
      {phases.map((phase) => {
        const phaseSteps = numberedSteps.filter(({ step }) => phase.stepIds.includes(step.id));
        if (phaseSteps.length === 0) return null;
        const isCurrentPhase = phaseSteps.some(({ step }) => step.state === 'current');
        return (
          <div key={phase.label} className={`${styles.phaseGroup} ${isCurrentPhase ? styles.phaseCurrent : ''}`}>
            <span className={styles.phaseLabel}>{phase.label}</span>
            <ol className={styles.stepsStrip} aria-label={phase.label}>
              {phaseSteps.map(({ step, stepNumber }) => <StepChip key={step.id} step={step} stepNumber={stepNumber} onStepSelect={onStepSelect} />)}
            </ol>
          </div>
        );
      })}
    </div>
  );
}

interface NavigationBarProps {
  isFirstStep: boolean;
  canGoNext: boolean;
  nextBlockedReason?: string;
  nextLabel: string;
  shouldShowSkip: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip?: () => void;
  /** "Show me": points to the first field still needed; absent ⇒ no link. */
  onShowMe?: () => void;
}

/** The button row: Back on the left, then optional Skip, then the single primary Next with its reason beneath. */
function GuidedFlowNavigationBar(props: NavigationBarProps) {
  const reasonId = useId();
  const shouldShowReason = !props.canGoNext && Boolean(props.nextBlockedReason);
  return (
    <div className={styles.navigationBar}>
      {props.isFirstStep ? <span /> : (
        <button type="button" className={styles.secondaryButton} onClick={props.onBack}>{BACK_LABEL}</button>
      )}
      <div className={styles.forwardGroup}>
        <div className={styles.forwardButtons}>
          {props.shouldShowSkip ? (
            <button type="button" className={styles.secondaryButton} onClick={props.onSkip}>{SKIP_LABEL}</button>
          ) : null}
          <button
            type="button"
            className={styles.primaryButton}
            disabled={!props.canGoNext}
            aria-describedby={shouldShowReason ? reasonId : undefined}
            onClick={props.onNext}
          >
            {props.nextLabel}
          </button>
        </div>
        {shouldShowReason ? (
          <p id={reasonId} className={styles.blockedReason}>
            {props.nextBlockedReason}
            {props.onShowMe ? <> <button type="button" className={styles.showMeButton} onClick={props.onShowMe}>Show me</button></> : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── Shell ──

/**
 * The frame every guided flow sits in. It shows "Step N of M — <what to do>", a strip of all the
 * steps, the caller's step content, and the Back / Skip / Next buttons. It keeps no state of its own,
 * so going Back never loses what someone typed — the caller holds the entries.
 */
export default function GuidedFlowShell(props: GuidedFlowShellProps) {
  const headingRef = useFocusHeadingOnStepChange(props.currentStepId);
  const stepBodyRef = useRef<HTMLDivElement>(null);
  const currentIndex = Math.max(0, props.steps.findIndex((step) => step.id === props.currentStepId));
  const currentStep = props.steps[currentIndex];
  return (
    <section className={styles.shell}>
      <header className={styles.shellHeader}>
        <GuidedFlowStepsStrip steps={props.steps} phases={props.phases} onStepSelect={props.onStepSelect} />
        {props.advancedAction ? <div className={styles.advancedSlot}>{props.advancedAction}</div> : null}
      </header>
      <h2 ref={headingRef} tabIndex={-1} className={styles.stepHeading}>
        {`Step ${currentIndex + 1} of ${props.steps.length} — ${currentStep?.title ?? ''}`}
      </h2>
      <div ref={stepBodyRef} className={styles.stepBody}>{props.children}</div>
      <GuidedFlowNavigationBar
        isFirstStep={currentIndex === 0}
        canGoNext={props.canGoNext}
        nextBlockedReason={props.nextBlockedReason}
        nextLabel={props.nextLabel ?? DEFAULT_NEXT_LABEL}
        shouldShowSkip={Boolean(props.isSkippable && props.onSkip)}
        onNext={props.onNext}
        onBack={props.onBack}
        onSkip={props.onSkip}
        onShowMe={props.shouldOfferShowMe ? () => { pointToFirstMissingField(stepBodyRef.current); } : undefined}
      />
    </section>
  );
}
