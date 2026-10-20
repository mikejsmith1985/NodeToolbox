// PrbWizard.tsx — The "Turn a problem into Jira work" job: find a ServiceNow problem, choose where the work goes,
// check three drafts, and create a Defect, an SL story and a QE story on one Epic, stories linked to the Defect.

import { useMemo } from 'react';

import GuidedFlowShell, { type GuidedFlowStep } from '../../components/GuidedFlow/GuidedFlowShell.tsx';
import type { WizardJobProps } from '../shell/wizardJobProps.ts';
import { loadJiraUrl } from '../shell/wizardSettings.ts';
import shellStyles from '../shell/WizardShell.module.css';
import { PrbConfirmStep, PrbDraftsStep, PrbFindStep, PrbPlaceStep, PrbResultStep } from './PrbSteps.tsx';
import { PRB_STEP_IDS, readPrbStepGate, usePrbWizardState, type PrbStepId } from './usePrbWizardState.ts';

/** Each screen's heading, as a plain verb phrase. */
const STEP_TITLES: Record<PrbStepId, string> = {
  find: 'Find the problem',
  confirm: 'Check it is the right one',
  place: 'Choose where the work goes',
  drafts: 'Check the three items',
  result: 'See what was made',
};

const CREATE_LABEL = 'Create all';
const HOME_LABEL = 'Back to home';

function buildSteps(currentStepId: PrbStepId): GuidedFlowStep[] {
  const currentIndex = PRB_STEP_IDS.indexOf(currentStepId);
  return PRB_STEP_IDS.map((stepId, index) => ({
    id: stepId,
    title: STEP_TITLES[stepId],
    state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo',
  }));
}

function readNextLabel(stepId: PrbStepId): string | undefined {
  if (stepId === 'drafts') return CREATE_LABEL;
  return stepId === 'result' ? HOME_LABEL : undefined;
}

type PrbWizardModel = ReturnType<typeof usePrbWizardState>;

/** Draws the screen for the current step. */
function PrbStepBody({ model, jiraUrl }: { model: PrbWizardModel; jiraUrl: string }) {
  const { state, actions } = model;
  switch (state.stepId) {
    case 'find':
      return (
        <PrbFindStep searchText={state.problemSearchText} problemSearch={state.problemSearch} chosenProblem={state.chosenProblem}
          onSearchTextChange={(problemSearchText) => actions.patchState({ problemSearchText })} onSearch={actions.runProblemSearch} onChoose={actions.chooseProblem} />
      );
    case 'confirm':
      return state.chosenProblem ? (
        <PrbConfirmStep problem={state.chosenProblem} existingWork={state.existingWork} isNewSetConfirmed={state.isNewSetConfirmed} jiraUrl={jiraUrl}
          onConfirmNewSet={(isNewSetConfirmed) => actions.patchState({ isNewSetConfirmed })} onRetryCheck={() => actions.checkExistingWork(state.chosenProblem?.number ?? '')} />
      ) : null;
    case 'place':
      return (
        <PrbPlaceStep projectList={state.projectList} projectKey={state.projectKey} epicSearchText={state.epicSearchText} epicSearch={state.epicSearch}
          chosenEpic={state.chosenEpic} onChooseProject={actions.chooseProject} onRetryProjects={actions.loadProjects}
          onEpicSearchTextChange={(epicSearchText) => actions.patchState({ epicSearchText })} onEpicSearch={actions.runEpicSearch}
          onChooseEpic={(chosenEpic) => actions.patchState({ chosenEpic })} />
      );
    case 'drafts':
      return <PrbDraftsStep drafts={state.drafts} onEdit={actions.updateDraft} />;
    default:
      return <PrbResultStep isCreating={state.isCreating} createResult={state.createResult} jiraUrl={jiraUrl} onRetry={actions.retryRest} />;
  }
}

/** The "Turn a problem into Jira work" job, one decision per screen inside the shared guided-flow frame. */
export default function PrbWizard({ onExit }: WizardJobProps) {
  const model = usePrbWizardState();
  const jiraUrl = useMemo(() => loadJiraUrl(), []);
  const { state, actions } = model;
  const gate = readPrbStepGate(state);
  const isResultStep = state.stepId === 'result';
  return (
    <section aria-label="Turn a problem into Jira work">
      <GuidedFlowShell
        steps={buildSteps(state.stepId)}
        currentStepId={state.stepId}
        canGoNext={gate.canGoNext}
        nextBlockedReason={gate.blockedReason}
        nextLabel={readNextLabel(state.stepId)}
        onNext={isResultStep ? onExit : actions.goNext}
        onBack={actions.goBack}
        advancedAction={isResultStep ? undefined : <button type="button" className={shellStyles.secondaryButton} onClick={onExit}>{HOME_LABEL}</button>}
      >
        <PrbStepBody model={model} jiraUrl={jiraUrl} />
      </GuidedFlowShell>
    </section>
  );
}
