// GuidedFlowShell.tsx — The shared frame around every guided, one-step-at-a-time flow: step header, progress strip, and Back / Skip / Next.

import { useEffect, useId, useRef, type ReactNode } from 'react';

import styles from './GuidedFlowShell.module.css';

// ── Types ──

/** Where a single step stands: finished, being worked on now, or still ahead. */
export type GuidedFlowStepState = 'done' | 'current' | 'todo';

/** One step in a guided flow, as the caller describes it. */
export interface GuidedFlowStep {
  id: string;
  title: string;
  state: GuidedFlowStepState;
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

/** Shows every step with its number, title and state in words. */
function GuidedFlowStepsStrip({ steps }: { steps: GuidedFlowStep[] }) {
  return (
    <ol className={styles.stepsStrip} aria-label={STEPS_STRIP_LABEL}>
      {steps.map((step, index) => (
        <li
          key={step.id}
          className={`${styles.stepChip} ${styles[`step_${step.state}`] ?? ''}`}
          aria-current={step.state === 'current' ? 'step' : undefined}
        >
          <span className={styles.stepMark} aria-hidden="true">
            {readStepMark(step.state, index + 1)}
          </span>
          <span className={styles.stepTitle}>{step.title}</span>
          <span className={styles.stepStateText}>{STEP_STATE_TEXT[step.state]}</span>
        </li>
      ))}
    </ol>
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
        {shouldShowReason ? <p id={reasonId} className={styles.blockedReason}>{props.nextBlockedReason}</p> : null}
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
  const currentIndex = Math.max(0, props.steps.findIndex((step) => step.id === props.currentStepId));
  const currentStep = props.steps[currentIndex];
  return (
    <section className={styles.shell}>
      <header className={styles.shellHeader}>
        <GuidedFlowStepsStrip steps={props.steps} />
        {props.advancedAction ? <div className={styles.advancedSlot}>{props.advancedAction}</div> : null}
      </header>
      <h2 ref={headingRef} tabIndex={-1} className={styles.stepHeading}>
        {`Step ${currentIndex + 1} of ${props.steps.length} — ${currentStep?.title ?? ''}`}
      </h2>
      <div className={styles.stepBody}>{props.children}</div>
      <GuidedFlowNavigationBar
        isFirstStep={currentIndex === 0}
        canGoNext={props.canGoNext}
        nextBlockedReason={props.nextBlockedReason}
        nextLabel={props.nextLabel ?? DEFAULT_NEXT_LABEL}
        shouldShowSkip={Boolean(props.isSkippable && props.onSkip)}
        onNext={props.onNext}
        onBack={props.onBack}
        onSkip={props.onSkip}
      />
    </section>
  );
}
