// NewChangeTimelineSection.tsx — Plans a new change's CTASK timeline with AI Assist before it is created.
//
// The order of operations is planned over the tasks the change will get: the staged ones plus the Implementation
// and Technical Checkout ServiceNow creates itself. The plan is kept with the draft; on create, each change's real
// tasks are matched to it and dated back to back from that environment's planned start.

import { useState } from 'react';

import {
  buildPlannedTasks,
  readTimelinePlanFromReply,
  toFormUtcFromApi,
  type CtaskTimelinePlanStep,
} from '../chgFormula/createdCtaskTimeline.ts';
import { buildCtaskTimelinePrompt } from '../chgFormula/ctaskTimeline.ts';
import { formatSnowDateTimeForApi, type useCrgState } from '../hooks/useCrgState.ts';
import { AiAssistPromptModal, type AiAssistPromptSession } from './AiAssistPromptModal.tsx';
import styles from './CreateChgTab.module.css';

// The change builder's state, as the hook returns it.
type CrgState = ReturnType<typeof useCrgState>['state'];
type TimelineState = Pick<CrgState, 'changeTasks' | 'reconcileAutoCtasks' | 'ctaskTimelinePlan' | 'relEnvironment' | 'prdEnvironment' | 'pfixEnvironment'>;

interface NewChangeTimelineSectionProps {
  state: TimelineState;
  isAiAssistUnlocked: boolean;
  /** Keeps the plan with the draft, for create to date each new change's tasks from. */
  onSetPlan: (plan: CtaskTimelinePlanStep[]) => void;
}

/** The first enabled environment's window, in UTC — the window the plan is described against. */
function readPlanningWindow(state: TimelineState): { startUtc: string; endUtc: string } {
  const enabledEnvironment = [state.prdEnvironment, state.pfixEnvironment, state.relEnvironment]
    .find((environment) => environment.isEnabled && environment.plannedStartDate);
  return {
    startUtc: toFormUtcFromApi(formatSnowDateTimeForApi(enabledEnvironment?.plannedStartDate ?? '')),
    endUtc: toFormUtcFromApi(formatSnowDateTimeForApi(enabledEnvironment?.plannedEndDate ?? '')),
  };
}

/** The AI Assist planning round for a new change's CTASK timeline, and the plan once it is made. */
export function NewChangeTimelineSection({ state, isAiAssistUnlocked, onSetPlan }: NewChangeTimelineSectionProps) {
  const [promptSession, setPromptSession] = useState<AiAssistPromptSession | null>(null);
  if (!isAiAssistUnlocked) {
    return null;
  }

  const handleOpenPlanning = () => {
    const plannedTasks = buildPlannedTasks(
      state.changeTasks.map((changeTask) => ({ label: changeTask.shortDescription || changeTask.name, description: changeTask.description })),
      !state.reconcileAutoCtasks,
    );
    setPromptSession({
      instructions: 'Copy this prompt into AI Assist to plan the order of operations, then paste its reply below — each '
        + 'new change\'s CTASKs are dated from it, back to back from that change\'s planned start.',
      promptText: buildCtaskTimelinePrompt(plannedTasks, readPlanningWindow(state)),
      applyButtonLabel: 'Use this timeline',
      applyReply: (replyText) => {
        const plan = readTimelinePlanFromReply(replyText, plannedTasks);
        if (plan.length === 0) {
          return { statusMessage: 'No "CTASK… | minutes" lines were found in the pasted reply.', wasApplied: false };
        }
        onSetPlan(plan);
        return { statusMessage: `Timeline planned for ${plan.length} tasks — they are dated when the change is created.`, wasApplied: true };
      },
    });
  };

  return (
    <div className={styles.clonePanel}>
      <h4 className={styles.panelSectionTitle}>CTASK timeline</h4>
      <p className={styles.panelHint}>
        Plans the order of operations — Implementation → Review Technical Checkout → Review Business Checkout — so each
        CTASK is created with planned start and end dates. Without a plan, tasks are dated from their own estimates.
      </p>
      {state.ctaskTimelinePlan.length > 0 ? (
        <p className={styles.successText}>
          {`Planned: ${state.ctaskTimelinePlan.map((step) => `${step.taskLabel} (${step.minutes} min)`).join(' → ')}`}
        </p>
      ) : null}
      <div className={styles.buttonRow}>
        <button className={styles.aiAssistButton} onClick={handleOpenPlanning} type="button">
          ✦ Plan the CTASK timeline with AI Assist
        </button>
      </div>
      {promptSession ? (
        <AiAssistPromptModal key={promptSession.promptText} onClose={() => setPromptSession(null)} session={promptSession} />
      ) : null}
    </div>
  );
}
