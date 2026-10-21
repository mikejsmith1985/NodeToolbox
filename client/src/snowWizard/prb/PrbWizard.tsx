// PrbWizard.tsx — The "Turn a problem into Jira work" job: find a ServiceNow problem, choose where the work goes,
// choose for each of the Defect, SL story and QE story whether to make it new, use one already in Jira or leave it out,
// check the new ones' drafts, and create them on one Epic with every story linked to the Defect.

import { useMemo } from 'react';

import GuidedFlowShell, { type GuidedFlowStep } from '../../components/GuidedFlow/GuidedFlowShell.tsx';
import type { WizardJobProps } from '../shell/wizardJobProps.ts';
import { loadJiraUrl } from '../shell/wizardSettings.ts';
import shellStyles from '../shell/WizardShell.module.css';
import { readKeptRoles, readNewRoles } from './prbJiraPlan.ts';
import { PrbChooseStep, PrbConfirmStep, PrbDraftsStep, PrbFindStep, PrbPlaceStep, PrbResultStep } from './PrbSteps.tsx';
import { readActiveStepIds, readNeighbourStep, readPrbStepGate, usePrbWizardState, type PrbStepId, type PrbWizardState } from './usePrbWizardState.ts';

/** Each screen's heading, as a plain verb phrase. */
const STEP_TITLES: Record<PrbStepId, string> = {
  find: 'Find the problem',
  confirm: 'Check it is the right one',
  choose: 'Choose what to make',
  place: 'Choose where the new work goes',
  drafts: 'Check the new items',
  result: 'See what was made',
};

const CREATE_LABEL = 'Create';
const HOME_LABEL = 'Back to home';

function buildSteps(state: PrbWizardState): GuidedFlowStep[] {
  const activeStepIds = readActiveStepIds(state);
  const currentIndex = activeStepIds.indexOf(state.stepId);
  return activeStepIds.map((stepId, index) => ({
    id: stepId,
    title: STEP_TITLES[stepId],
    state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'todo',
  }));
}

function readNextLabel(state: PrbWizardState): string | undefined {
  if (state.stepId === 'result') return HOME_LABEL;
  return readNeighbourStep(state, 1) === 'result' ? CREATE_LABEL : undefined;
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
        <PrbConfirmStep problem={state.chosenProblem} existingWork={state.existingWork} jiraUrl={jiraUrl}
          onRetryCheck={() => actions.checkExistingWork(state.chosenProblem?.number ?? '')} />
      ) : null;
    case 'choose':
      return (
        <PrbChooseStep roleChoices={state.roleChoices} roleSearches={state.roleSearches} jiraUrl={jiraUrl} onChooseMode={actions.chooseRoleMode}
          onSearchTextChange={actions.changeRoleSearchText} onSearch={actions.runRoleSearch} onPickIssue={actions.pickExistingIssue} />
      );
    case 'place':
      return (
        <PrbPlaceStep projectList={state.projectList} projectKey={state.projectKey} epicSearchText={state.epicSearchText} epicSearch={state.epicSearch}
          chosenEpic={state.chosenEpic} onChooseProject={actions.chooseProject} onRetryProjects={actions.loadProjects}
          onEpicSearchTextChange={(epicSearchText) => actions.patchState({ epicSearchText })} onEpicSearch={actions.runEpicSearch}
          onChooseEpic={(chosenEpic) => actions.patchState({ chosenEpic })} />
      );
    case 'drafts':
      return <PrbDraftsStep drafts={state.drafts.filter((draft) => readNewRoles(state.roleChoices).includes(draft.role))} onEdit={actions.updateDraft} />;
    default:
      return (
        <PrbResultStep isCreating={state.isCreating} createResult={state.createResult} jiraUrl={jiraUrl}
          keptRoles={readKeptRoles(state.roleChoices)} onRetry={actions.retryRest} />
      );
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
        steps={buildSteps(state)}
        currentStepId={state.stepId}
        canGoNext={gate.canGoNext}
        nextBlockedReason={gate.blockedReason}
        nextLabel={readNextLabel(state)}
        onNext={isResultStep ? onExit : actions.goNext}
        onBack={actions.goBack}
        advancedAction={isResultStep ? undefined : <button type="button" className={shellStyles.secondaryButton} onClick={onExit}>{HOME_LABEL}</button>}
      >
        <PrbStepBody model={model} jiraUrl={jiraUrl} />
      </GuidedFlowShell>
    </section>
  );
}
