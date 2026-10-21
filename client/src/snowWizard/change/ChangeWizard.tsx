// ChangeWizard.tsx — The "Make or change a change" job: choose a new change or an existing one, then walk one step per screen to Create or Save.
//
// Everything about the change itself runs through Toolbox's own useCrgState (contracts/change-wizard.md), under this
// job's own draft slot; this file only orders the steps, gates Next, and wires each step to the draft and session.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import GuidedFlowShell, { type GuidedFlowStep } from '../../components/GuidedFlow/GuidedFlowShell.tsx';
import { isReady, type ReadinessItem } from '../../views/SnowHub/guided/changeReadiness.ts';
import { useCrgState } from '../../views/SnowHub/hooks/useCrgState.ts';
import { useSnowChoiceOptions } from '../../views/SnowHub/hooks/useSnowChoiceOptions.ts';
import { readRcpRulesEnabled } from '../../views/SnowHub/rcp/rcpApprovalEmail.ts';
import { isRcpPeriodActive, readCentralTodayIso } from '../../views/SnowHub/rcp/rcpRules.ts';
import type { WizardJobProps } from '../shell/wizardJobProps.ts';
import { useWizardJobStore, type WizardJob, type WizardJobKind } from '../shell/wizardJobStore.ts';
import {
  DRAFT_ENVIRONMENTS, buildEnvironmentValueByKey, hasProductionEnvironment, readDetailsGaps, readEnabledPlanEnvironments,
  readEnvironmentProblems, readPlanningGaps, type CrgDraftState, type CrgHook,
} from './changeDraft.ts';
import {
  buildChangeStorageKey, createChangeWizardSession, markStepReviewed, useChangeWizardSessionStore,
  type ChangeStepProps, type ChangeWizardSession, type StepMoveOptions,
} from './changeWizardSession.ts';
import {
  buildShellSteps, deriveChangeWizardStep, evaluateStepCompletion, listChangeWizardStepIds, readPaperworkNeed, readStepTitle,
  resolveResumeStep, type ChangeWizardMode, type ChangeWizardProgress, type ChangeWizardStepId, type PaperworkNeed,
} from './changeWizardSteps.ts';
import { aiDraftPromptFor } from './aiDraft.ts';
import { describeCreatedChangesForPrompt } from './createdChanges.ts';
import { buildCtaskEnvironmentPlan, listTaskLabelsByEnvironment, type CtaskEnvironmentPlan, type PlanEnvironmentKey } from './ctaskEnvironmentPlan.ts';
import type { JiraEvidenceAttachment } from './jiraEvidence.ts';
import { useDefaultJiraEvidenceTicks, useJiraEvidenceChoiceStore, useTickedJiraEvidence } from './jiraEvidenceChoiceStore.ts';
import { listEditedSteps, readStepValues } from './modifyDiff.ts';
import SaveTemplateControl from './SaveTemplateControl.tsx';
import StartingPointNotice from './StartingPointNotice.tsx';
import AiDraftStep from './steps/AiDraftStep.tsx';
import AiEnhanceStep from './steps/AiEnhanceStep.tsx';
import ChecksStep from './steps/ChecksStep.tsx';
import ChooseModeStep from './steps/ChooseModeStep.tsx';
import CreateNowStep from './steps/CreateNowStep.tsx';
import CreateResultStep from './steps/CreateResultStep.tsx';
import DetailsStep from './steps/DetailsStep.tsx';
import EnvironmentsStep from './steps/EnvironmentsStep.tsx';
import EvidenceStep from './steps/EvidenceStep.tsx';
import PlanningStep from './steps/PlanningStep.tsx';
import ProductionPaperworkStep from './steps/ProductionPaperworkStep.tsx';
import ScopeStep from './steps/ScopeStep.tsx';
import TasksStep from './steps/TasksStep.tsx';
import WhichChangeStep from './steps/WhichChangeStep.tsx';
import { listTaskProblems } from './taskCards.ts';
import TemplatesScreen from './TemplatesScreen.tsx';
import { useDraftReadiness } from './useDraftReadiness.ts';
import { useImplementationBackout } from './useImplementationBackout.ts';
import { useFinishRunner, type FinishRunner } from './useFinishRunner.ts';
import { useStartingPoint, type ChangeStartingPoint, type StartingPointHandle } from './useStartingPoint.ts';
import { useTemplateLibrary, type TemplateLibrary } from './useTemplateLibrary.ts';
import shellStyles from '../shell/WizardShell.module.css';

const CHANGE_JOB_KINDS: readonly WizardJobKind[] = ['newChange', 'modifyChange'];
// "Skip — nothing to change": every pre-filled step of a modify, and the two optional steps of a new change.
const MODIFY_SKIPPABLE_STEPS = new Set<ChangeWizardStepId>(['scope', 'aiDraft', 'details', 'planning', 'environments', 'aiEnhance', 'evidence', 'tasks']);
const CREATE_SKIPPABLE_STEPS = new Set<ChangeWizardStepId>(['aiEnhance', 'evidence']);
const EDITED_MARK = ' (edited)';

/** The mode a job kind runs in. */
function readJobMode(jobKind: WizardJobKind): ChangeWizardMode {
  return jobKind === 'modifyChange' ? 'modify' : 'create';
}

/** Everything a step needs beyond the shared step props. */
interface StepExtras {
  choiceOptions: ReturnType<typeof useSnowChoiceOptions>['choiceOptions'];
  ctaskEnvironmentPlan: CtaskEnvironmentPlan;
  items: ReadinessItem[] | null;
  paperworkNeed: PaperworkNeed;
  runner: FinishRunner;
  editedStepIds: ChangeWizardStepId[];
  evidenceFiles: File[];
  setEvidenceFiles: (files: File[]) => void;
  jiraEvidence: JiraEvidenceAttachment[];
  jobId: string;
  onExit: () => void;
  /** The job's one template library, shared by every part that saves a template. */
  library: TemplateLibrary;
  /** The changes already made in ServiceNow, one line each with their task numbers, for the AI prompts. */
  createdChangeLines: readonly string[];
}

/** The screen for one step. */
function renderStep(stepId: ChangeWizardStepId, stepProps: ChangeStepProps, extras: StepExtras): ReactElement {
  const withChoices = { ...stepProps, choiceOptions: extras.choiceOptions };
  const stepScreens: Record<ChangeWizardStepId, () => ReactElement> = {
    whichChange: () => <WhichChangeStep {...stepProps} onExit={extras.onExit} />,
    scope: () => <ScopeStep {...stepProps} />,
    aiDraft: () => <AiDraftStep {...withChoices} buildPrompt={aiDraftPromptFor(extras.createdChangeLines)} />,
    details: () => <DetailsStep {...withChoices} />,
    planning: () => <PlanningStep {...withChoices} />,
    environments: () => <EnvironmentsStep {...withChoices} />,
    aiEnhance: () => <AiEnhanceStep {...stepProps} items={extras.items} createdChangeLines={extras.createdChangeLines} />,
    evidence: () => <EvidenceStep {...stepProps} jobId={extras.jobId} evidenceFiles={extras.evidenceFiles} onEvidenceFilesChange={extras.setEvidenceFiles} />,
    tasks: () => <TasksStep {...stepProps} library={extras.library} />,
    createChanges: () => <CreateNowStep {...stepProps} runner={extras.runner} taskNamesByEnvironment={readTaskNamesByEnvironment(stepProps.crg.state)} />,
    checks: () => <ChecksStep {...stepProps} items={extras.items} createdChangeLines={extras.createdChangeLines} />,
    paperwork: () => <ProductionPaperworkStep {...stepProps} paperworkNeed={extras.paperworkNeed} />,
    finish: () => <CreateResultStep {...stepProps} runner={extras.runner} taskNamesByEnvironment={readTaskNamesByEnvironment(stepProps.crg.state)} editedStepIds={extras.editedStepIds} evidenceFileCount={extras.evidenceFiles.length + extras.jiraEvidence.length} />,
  };
  return stepScreens[stepId]();
}

/** Each environment's tasks as the cards stand now. */
function readTaskNamesByEnvironment(draft: CrgDraftState) {
  return listTaskLabelsByEnvironment(draft.changeTasks, readEnabledPlanEnvironments(draft));
}

/** The done-when facts for the draft in hand. */
function buildProgress(crg: CrgHook, session: ChangeWizardSession, items: ReadinessItem[] | null, paperworkNeed: PaperworkNeed): ChangeWizardProgress {
  return {
    mode: session.mode,
    isChangeLoaded: session.modify !== null,
    selectedIssueCount: crg.state.selectedIssueKeys.size,
    detailsGaps: readDetailsGaps(crg.state),
    planningGaps: readPlanningGaps(crg.state),
    environmentProblems: readEnvironmentProblems(crg.state),
    taskProblems: listTaskProblems(crg.state.changeTasks, readEnabledPlanEnvironments(crg.state), session.mode),
    reviewedStepIds: session.reviewedStepIds,
    isChecksSatisfied: session.areChecksAcknowledged || (items ? isReady(items) : session.wereChecksReady),
    paperworkNeed,
    isPaperworkDone: session.isPaperworkDone,
    areChangesCreated: haveAllChangesBeenCreated(crg, session),
  };
}

/** A new change: every environment switched on already has its change in ServiceNow. */
function haveAllChangesBeenCreated(crg: CrgHook, session: ChangeWizardSession): boolean {
  const enabledEnvironments = readEnabledPlanEnvironments(crg.state);
  const createdLabels = new Set(session.createdChanges.map((createdChange) => createdChange.environmentLabel));
  return enabledEnvironments.length > 0 && enabledEnvironments.every((environmentLabel) => createdLabels.has(environmentLabel));
}

/** Whether the last step has already run (so its button now leads home). */
function hasFinishAttempt(session: ChangeWizardSession, runner: FinishRunner): boolean {
  // A new change's changes were made earlier; only saving the finished work to them ends the job.
  if (session.mode === 'create') return Boolean(session.hasSavedChanges);
  return runner.phase.kind === 'done' || session.createdChanges.length > 0 || session.failureText !== null;
}

/** "Create in ServiceNow": Next makes the changes, then moves on once they all exist. */
function readCreateNowGate(runner: FinishRunner, progress: ChangeWizardProgress) {
  if (runner.phase.kind === 'working') return { canGoNext: false, nextBlockedReason: runner.phase.message, nextLabel: 'Working…' };
  if (progress.areChangesCreated) return { canGoNext: true, nextLabel: undefined };
  return { canGoNext: true, nextLabel: 'Create them in ServiceNow' };
}

/** The Next button on the last step: run the write, or go home once it has run. */
function readFinishGate(session: ChangeWizardSession, runner: FinishRunner, progress: ChangeWizardProgress) {
  if (runner.phase.kind === 'working') return { canGoNext: false, nextBlockedReason: runner.phase.message, nextLabel: 'Working…' };
  if (runner.phase.kind === 'conflicts') return { canGoNext: false, nextBlockedReason: 'Choose what to do about the values changed in ServiceNow.', nextLabel: 'Save the change' };
  if (hasFinishAttempt(session, runner)) return { canGoNext: true, nextLabel: 'Back to home' };
  const firstUnfinishedStepId = deriveChangeWizardStep({ ...progress, reviewedStepIds: [...progress.reviewedStepIds, 'finish'] });
  const nextLabel = session.mode === 'modify' ? 'Save the change' : 'Save to ServiceNow';
  if (firstUnfinishedStepId !== 'finish') return { canGoNext: false, nextBlockedReason: `Finish “${readStepTitle(firstUnfinishedStepId, session.mode)}” first.`, nextLabel };
  return { canGoNext: true, nextLabel };
}

/** The shell's steps, with a modify's edited steps marked. */
function markEditedSteps(shellSteps: GuidedFlowStep[], editedStepIds: readonly ChangeWizardStepId[]): GuidedFlowStep[] {
  return shellSteps.map((shellStep) => (editedStepIds.includes(shellStep.id as ChangeWizardStepId) ? { ...shellStep, title: `${shellStep.title}${EDITED_MARK}` } : shellStep));
}

/** Which environment's change each task goes on, from the ticks on each card. */
function buildTaskPlan(draft: CrgDraftState): CtaskEnvironmentPlan {
  return buildCtaskEnvironmentPlan(draft.changeTasks, readEnabledPlanEnvironments(draft));
}

/** The job's session from the store, and the way to change it. */
function useJobSession(job: WizardJob) {
  const storedSession = useChangeWizardSessionStore((state) => state.sessions[job.jobId]);
  const session = useMemo(() => storedSession ?? createChangeWizardSession(readJobMode(job.kind)), [storedSession, job.kind]);
  const updateSession = useCallback((update: Partial<ChangeWizardSession>) => useChangeWizardSessionStore.getState().updateSession(job.jobId, update), [job.jobId]);
  return { session, updateSession };
}

/** Toolbox's draft forgets environment ticks on reload; a resumed job puts them back once. */
function useRestoreEnvironments(crg: CrgHook, session: ChangeWizardSession) {
  const hasRestoredRef = useRef(false);
  const { updateEnvironment } = crg.actions;
  const savedEnvironments = session.enabledEnvironments;
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;
    for (const { key, label } of DRAFT_ENVIRONMENTS) if (savedEnvironments.includes(label)) updateEnvironment(key, { isEnabled: true });
  }, [savedEnvironments, updateEnvironment]);
}

/** The draft with the session's remembered environment ticks put back — what the job looks like once restored. */
function applySavedEnvironments(draft: CrgDraftState, savedEnvironments: readonly PlanEnvironmentKey[]): CrgDraftState {
  const restoredDraft = { ...draft };
  for (const { stateKey, label } of DRAFT_ENVIRONMENTS) {
    if (savedEnvironments.includes(label)) restoredDraft[stateKey] = { ...draft[stateKey], isEnabled: true };
  }
  return restoredDraft;
}

/** Moves between steps, remembering the step and the environments on every move. */
function useStepNavigation(job: WizardJob, crg: CrgHook, session: ChangeWizardSession, updateSession: (update: Partial<ChangeWizardSession>) => void, progress: ChangeWizardProgress) {
  const [currentStepId, setCurrentStepId] = useState<ChangeWizardStepId>(session.currentStepId);
  const [hasResolvedResume, setHasResolvedResume] = useState(false);
  // React's "adjust state while rendering" pattern: a resumed job never lands ahead of a missing prerequisite.
  if (!hasResolvedResume) {
    setHasResolvedResume(true);
    setCurrentStepId(resolveResumeStep(session.currentStepId, progress));
  }
  const goToStep = (stepId: ChangeWizardStepId, extraUpdate: Partial<ChangeWizardSession> = {}) => {
    setCurrentStepId(stepId);
    updateSession({ ...extraUpdate, currentStepId: stepId, enabledEnvironments: readEnabledPlanEnvironments(crg.state) });
    useWizardJobStore.getState().recordStep(job.kind, stepId, Date.now());
  };
  return { currentStepId, goToStep };
}

/** One change job, from its first step to its result. */
function ChangeJob({ job, startingPoint, onExit }: { job: WizardJob; startingPoint: ChangeStartingPoint | null; onExit: () => void }) {
  const mode = readJobMode(job.kind);
  const crg = useCrgState({ storageKey: buildChangeStorageKey(job.jobId) });
  const startingPointHandle = useStartingPoint(crg, startingPoint);
  const { session, updateSession } = useJobSession(job);
  const { choiceOptions } = useSnowChoiceOptions();
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const jiraEvidence = useTickedJiraEvidence(job.jobId, crg.state.selectedIssueKeys);
  const hasJiraEvidenceChoice = useJiraEvidenceChoiceStore((state) => Boolean(state.choices[job.jobId]));
  useRestoreEnvironments(crg, session);
  const library = useTemplateLibrary();
  const ctaskEnvironmentPlan = useMemo(() => buildTaskPlan(crg.state), [crg.state]);
  const editedStepIds = session.modify ? listEditedSteps(session.modify.loadedStepValues, readStepValues(crg.state)) : [];
  const stepIds = listChangeWizardStepIds(mode);
  const paperworkNeed = readPaperworkNeed({ hasProduction: hasProductionEnvironment(crg.state), isRcpActive: isRcpPeriodActive(readRcpRulesEnabled(), readCentralTodayIso()) });
  // A resumed job is judged as it will be once its environment ticks are back.
  const restoredCrg = { ...crg, state: applySavedEnvironments(crg.state, session.enabledEnvironments) };
  const navigationProgress = buildProgress(restoredCrg, session, null, paperworkNeed);
  const { currentStepId, goToStep } = useStepNavigation(job, crg, session, updateSession, navigationProgress);
  useImplementationBackout(crg);
  const isChecking = stepIds.indexOf(currentStepId) >= stepIds.indexOf('aiEnhance');
  const issueKeys = useMemo(() => [...crg.state.selectedIssueKeys].sort(), [crg.state.selectedIssueKeys]);
  useDefaultJiraEvidenceTicks(job.jobId, issueKeys, isChecking);
  const jiraEvidenceFileNames = useMemo(() => jiraEvidence.map((evidence) => evidence.attachment.filename), [jiraEvidence]);
  const { items } = useDraftReadiness(crg.state, session, isChecking, jiraEvidenceFileNames);
  const progress = buildProgress(crg, session, items, paperworkNeed);
  const runner = useFinishRunner({
    crg, session, updateSession, ctaskEnvironmentPlan, environmentValueByKey: buildEnvironmentValueByKey(choiceOptions.u_environment ?? []),
    evidenceFiles, jiraEvidence, hasJiraEvidenceChoice, selectedIssueKeys: [...crg.state.selectedIssueKeys], editedStepIds, onFinished: () => useWizardJobStore.getState().finishJob(job.kind, Date.now()),
  });
  useRememberChecksVerdict(items, session, updateSession);
  const createdChangeLines = useMemo(() => describeCreatedChangesForPrompt(session.createdChanges, session.createdTasks), [session.createdChanges, session.createdTasks]);
  return (
    <ChangeJobShell
      job={job} crg={crg} session={session} updateSession={updateSession} progress={progress} currentStepId={currentStepId} goToStep={goToStep}
      startingPoint={startingPointHandle}
      extras={{ choiceOptions, ctaskEnvironmentPlan, items, paperworkNeed, runner, editedStepIds, evidenceFiles, setEvidenceFiles, jiraEvidence, jobId: job.jobId, onExit, library, createdChangeLines }}
    />
  );
}

/** Keeps the last checks verdict in the session, so a resumed job knows it. */
function useRememberChecksVerdict(items: ReadinessItem[] | null, session: ChangeWizardSession, updateSession: (update: Partial<ChangeWizardSession>) => void) {
  useEffect(() => {
    if (items === null) return;
    const isAllReady = isReady(items);
    if (isAllReady !== session.wereChecksReady) updateSession({ wereChecksReady: isAllReady });
  }, [items, session.wereChecksReady, updateSession]);
}

interface ChangeJobShellProps {
  job: WizardJob;
  crg: CrgHook;
  session: ChangeWizardSession;
  updateSession: (update: Partial<ChangeWizardSession>) => void;
  progress: ChangeWizardProgress;
  currentStepId: ChangeWizardStepId;
  goToStep: (stepId: ChangeWizardStepId, extraUpdate?: Partial<ChangeWizardSession>) => void;
  startingPoint: StartingPointHandle;
  extras: StepExtras;
}

/** The frame's top-right buttons: "Save as template" once the change has details, "Manage templates", and "Save and leave". */
function JobFrameActions({ crg, library, isTemplateReady, onManageTemplates, onExit }: { crg: CrgHook; library: TemplateLibrary; isTemplateReady: boolean; onManageTemplates: () => void; onExit: () => void }) {
  return (
    <>
      {isTemplateReady ? <SaveTemplateControl draft={crg.state} library={library} /> : null}
      <button type="button" className={shellStyles.secondaryButton} onClick={onManageTemplates}>Manage templates</button>
      <button type="button" className={shellStyles.secondaryButton} onClick={onExit}>Save and leave</button>
    </>
  );
}

/** The guided frame around the current step, or the templates screen while it is open over the job. */
function ChangeJobShell(props: ChangeJobShellProps) {
  const [isManagingTemplates, setIsManagingTemplates] = useState(false);
  const { crg, extras } = props;
  if (isManagingTemplates) {
    // The job stays as it is underneath; "Back" returns to the same step.
    const useTemplateHere = (templateId: string) => {
      const chosenTemplate = extras.library.templates.find((template) => template.id === templateId);
      if (chosenTemplate) crg.actions.applyTemplate(chosenTemplate, extras.library.ctaskTemplates);
      setIsManagingTemplates(false);
    };
    return <TemplatesScreen library={extras.library} draftInHand={crg.state} useLabel="Use it on this change" onUseTemplate={useTemplateHere} onBack={() => setIsManagingTemplates(false)} />;
  }
  return <ChangeJobFrame {...props} onManageTemplates={() => setIsManagingTemplates(true)} />;
}

/** The guided frame itself, around the current step. */
function ChangeJobFrame({ crg, session, updateSession, progress, currentStepId, goToStep, startingPoint, extras, onManageTemplates }: ChangeJobShellProps & { onManageTemplates: () => void }) {
  const stepIds = listChangeWizardStepIds(session.mode);
  const currentIndex = stepIds.indexOf(currentStepId);
  const isFinishStep = currentStepId === 'finish';
  const completion = evaluateStepCompletion(currentStepId, progress);
  const finishGate = isFinishStep ? readFinishGate(session, extras.runner, progress)
    : currentStepId === 'createChanges' ? readCreateNowGate(extras.runner, progress) : null;
  const moveForward = () => goToStep(stepIds[currentIndex + 1] ?? 'finish', { reviewedStepIds: markStepReviewed(session.reviewedStepIds, currentStepId) });
  // Opened from a fix button: Next goes straight back to where the fix was asked for (GH #468).
  const returnStepId = session.returnToStepId && session.returnToStepId !== currentStepId ? session.returnToStepId : null;
  const returnLabel = returnStepId ? `Back to “${readStepTitle(returnStepId, session.mode)}”` : undefined;
  const moveToStep = (stepId: ChangeWizardStepId, options?: StepMoveOptions) => goToStep(stepId, { returnToStepId: options?.shouldReturnHere ? currentStepId : null });

  function handleNext() {
    if (returnStepId) {
      goToStep(returnStepId, { reviewedStepIds: markStepReviewed(session.reviewedStepIds, currentStepId), returnToStepId: null });
      return;
    }
    if (currentStepId === 'createChanges' && !progress.areChangesCreated) {
      if (session.createdChanges.length > 0) extras.runner.retryMissing();
      else extras.runner.startCreate();
      return;
    }
    if (!isFinishStep) {
      if (currentStepId === 'scope' && session.mode === 'create' && crg.state.generatedShortDescription.trim() === '') crg.actions.generateDocs();
      moveForward();
      return;
    }
    if (hasFinishAttempt(session, extras.runner)) extras.onExit();
    else if (session.mode === 'modify') extras.runner.startSave();
    else extras.runner.startSaveCreated();
  }

  const isSkippable = (session.mode === 'modify' ? MODIFY_SKIPPABLE_STEPS : CREATE_SKIPPABLE_STEPS).has(currentStepId);
  return (
    <GuidedFlowShell
      steps={markEditedSteps(buildShellSteps(session.mode, currentStepId, progress), extras.editedStepIds)}
      currentStepId={currentStepId}
      canGoNext={finishGate ? finishGate.canGoNext : completion.canGoNext}
      nextBlockedReason={finishGate ? finishGate.nextBlockedReason : completion.blockedReason}
      nextLabel={returnLabel ?? finishGate?.nextLabel}
      isSkippable={isSkippable}
      onNext={handleNext}
      onBack={() => goToStep(stepIds[Math.max(0, currentIndex - 1)], { returnToStepId: null })}
      onSkip={returnStepId ? handleNext : moveForward}
      advancedAction={<JobFrameActions crg={crg} library={extras.library} isTemplateReady={currentIndex >= stepIds.indexOf('details')} onManageTemplates={onManageTemplates} onExit={extras.onExit} />}
    >
      <StartingPointNotice startingPoint={startingPoint} />
      {session.mode === 'create' && session.createdChanges.length > 0 && (currentStepId === 'environments' || currentStepId === 'tasks')
        ? <p className={shellStyles.hint}>These changes are already in ServiceNow. Edits here are saved to them on the last step, but a newly ticked environment or a new task is not added.</p>
        : null}
      {returnStepId ? <p className={shellStyles.hint}>{`Fix it here, then press “${returnLabel}” — no need to go through the other steps again.`}</p> : null}
      {renderStep(currentStepId, { crg, session, updateSession, goToStep: moveToStep }, extras)}
    </GuidedFlowShell>
  );
}

interface ChangeLandingProps {
  resumableJobs: readonly WizardJob[];
  openJob: (jobKind: WizardJobKind, startingPoint?: ChangeStartingPoint | null) => void;
  startAgain: (job: WizardJob) => void;
  onExit: () => void;
}

/**
 * The screens before a job opens: the choice of how to start, and "Your templates". It owns the one template library
 * for these screens and is gone once a job opens, so the job's own "Save as template" never races it.
 */
function ChangeLanding({ resumableJobs, openJob, startAgain, onExit }: ChangeLandingProps) {
  const library = useTemplateLibrary();
  const [isShowingTemplates, setIsShowingTemplates] = useState(false);

  function startFromTemplate(templateId: string) {
    const chosenTemplate = library.templates.find((template) => template.id === templateId);
    if (chosenTemplate) openJob('newChange', { kind: 'template', template: chosenTemplate, ctaskTemplates: library.ctaskTemplates });
  }

  if (isShowingTemplates) return <TemplatesScreen library={library} onUseTemplate={startFromTemplate} onBack={() => setIsShowingTemplates(false)} />;
  return (
    <ChooseModeStep resumableJobs={resumableJobs} templates={library.templates} onChooseNew={() => openJob('newChange')} onChooseExisting={() => openJob('modifyChange')}
      onContinue={(job) => openJob(job.kind)} onStartAgain={startAgain} onExit={onExit} onOpenTemplates={() => setIsShowingTemplates(true)}
      onStartFromChange={(changeNumber) => openJob('newChange', { kind: 'existingChange', changeNumber })} onStartFromTemplate={startFromTemplate} />
  );
}

/** The "Make or change a change" job. */
export default function ChangeWizard({ onExit }: WizardJobProps) {
  const jobs = useWizardJobStore((state) => state.jobs);
  const [activeJob, setActiveJob] = useState<WizardJob | null>(null);
  const [startingPoint, setStartingPoint] = useState<ChangeStartingPoint | null>(null);
  const resumableJobs = CHANGE_JOB_KINDS.map((jobKind) => jobs[jobKind]).filter((job): job is WizardJob => job?.status === 'inProgress');

  function openJob(jobKind: WizardJobKind, nextStartingPoint: ChangeStartingPoint | null = null) {
    const mode = readJobMode(jobKind);
    const { job } = useWizardJobStore.getState().startJob(jobKind, mode === 'modify' ? 'whichChange' : 'scope', Date.now());
    useChangeWizardSessionStore.getState().ensureSession(job.jobId, mode);
    setStartingPoint(nextStartingPoint);
    setActiveJob(job);
  }

  function startAgain(job: WizardJob) {
    useWizardJobStore.getState().discardJob(job.kind);
    useChangeWizardSessionStore.getState().removeSession(job.jobId);
    openJob(job.kind);
  }

  if (!activeJob) return <ChangeLanding resumableJobs={resumableJobs} openJob={openJob} startAgain={startAgain} onExit={onExit} />;
  return <ChangeJob key={activeJob.jobId} job={activeJob} startingPoint={startingPoint} onExit={onExit} />;
}
