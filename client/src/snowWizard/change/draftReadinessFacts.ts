// draftReadinessFacts.ts — The facts a change still being built (or being edited) hands 039's shared readiness engine.
//
// Framework-first: the checks themselves are `buildChangeReadiness` (one engine for this step and RM Review —
// contracts/checks-and-coaching.md). Its gatherer `gatherChangeReadinessFacts` reads only a change that EXISTS, so a
// draft's facts are assembled here from the draft itself; a modify starts from what that gatherer read and lays the
// user's edits on top. Every assumption about what Create will add is the create path's own behaviour, named below.

import type { ChangeReadinessFacts, ReadinessAction, ReadinessCtask, ReadinessItem, ReadinessPrb } from '../../views/SnowHub/guided/changeReadiness.ts';
import { readBackoutSectionFromDescription } from '../../views/SnowHub/chgFormula/ctaskReviewRecord.ts';
import { readLocalDateTimeAsUtc } from '../../views/SnowHub/rcp/rcpNewChange.ts';
import { isRcpPeriodActive } from '../../views/SnowHub/rcp/rcpRules.ts';
import { DRAFT_ENVIRONMENTS, readChangeTextFields, readProductionEnvironmentKey, type CrgDraftState } from './changeDraft.ts';
import type { ChangeWizardMode, ChangeWizardStepId } from './changeWizardSteps.ts';
import { evaluateDraftRcp } from './draftChangePlan.ts';
import { isExistingTaskEdited, type ExistingTaskLink } from './modifyTasks.ts';

/** Everything the facts are built from. */
export interface DraftReadinessInput {
  mode: ChangeWizardMode;
  draft: CrgDraftState;
  /** The verdict of the AI review on the AI step; null when it was not run. */
  riskReview: { isReady: boolean } | null;
  isRcpRulesEnabled: boolean;
  todayIso: string;
  /** Files chosen on the Evidence step; they are attached to every change once it exists. */
  evidenceFileNames: readonly string[];
  /** Where each PRB the chosen issues mention stands; null when the scan failed. */
  prbRows: readonly ReadinessPrb[] | null;
  prbFailureReason?: string;
  /** Modify only: what ServiceNow holds for the change, as 039's gatherer read it. */
  existingFacts?: ChangeReadinessFacts | null;
  /** Modify only: which cards are the change's own tasks, so an untouched one is judged as ServiceNow holds it. */
  existingTaskLinks?: readonly ExistingTaskLink[];
}

type DraftEnvironment = CrgDraftState['relEnvironment'];

const IMPLEMENTATION_TASK_TYPE = 'implementation';

/** The environment whose window and configuration item the change is judged on: Production first, else the first on. */
function readJudgedEnvironment(draft: CrgDraftState): DraftEnvironment | null {
  const productionKey = readProductionEnvironmentKey(draft);
  const judgedEnvironment = DRAFT_ENVIRONMENTS.find(({ key, stateKey }) => (productionKey ? key === productionKey : draft[stateKey].isEnabled));
  return judgedEnvironment ? draft[judgedEnvironment.stateKey] : null;
}

/** The planned window of the judged environment, as instants. */
function readDraftWindow(draft: CrgDraftState): ChangeReadinessFacts['plannedWindow'] {
  const judgedEnvironment = readJudgedEnvironment(draft);
  return {
    plannedStartUtc: judgedEnvironment ? readLocalDateTimeAsUtc(judgedEnvironment.plannedStartDate) : null,
    plannedEndUtc: judgedEnvironment ? readLocalDateTimeAsUtc(judgedEnvironment.plannedEndDate) : null,
  };
}

/** The configuration item the change will carry: the environment's own when set, else the change's. */
function readDraftConfigItem(draft: CrgDraftState) {
  const judgedEnvironment = readJudgedEnvironment(draft);
  return judgedEnvironment?.configItem.sysId ? judgedEnvironment.configItem : draft.chgBasicInfo.configItem;
}

/**
 * One staged task as it will be created: create stamps the change's configuration item on it, and a task with no
 * dates of its own takes the change's window (ctaskParentDefaults.resolveCtaskPlannedWindow).
 */
function readStagedCtask(task: CrgDraftState['changeTasks'][number], hasChangeConfigItem: boolean, hasChangeWindow: boolean): ReadinessCtask {
  return {
    number: task.shortDescription || task.name,
    isImplementation: (task.changeTaskType ?? '').toLowerCase() === IMPLEMENTATION_TASK_TYPE,
    isConfigItemMatching: hasChangeConfigItem,
    hasBackoutPlan: readBackoutSectionFromDescription(task.description) !== '',
    hasPlannedDates: (task.plannedStartDate !== '' && task.plannedEndDate !== '') || hasChangeWindow,
  };
}

/** The restricted-change-period verdicts for a draft, judged from what is typed (rcpNewChange). */
function readDraftRcpChecks(draft: CrgDraftState, isRcpActive: boolean, todayIso: string): ChangeReadinessFacts['rcpChecks'] {
  if (!isRcpActive) return [];
  return evaluateDraftRcp(draft, todayIso)?.results ?? [];
}

/** The facts for a change that does not exist yet. */
function buildNewChangeFacts(input: DraftReadinessInput, isRcpActive: boolean): ChangeReadinessFacts {
  const { draft } = input;
  const configItem = readDraftConfigItem(draft);
  const plannedWindow = readDraftWindow(draft);
  const isProduction = readProductionEnvironmentKey(draft) !== null;
  return {
    change: { changeNumber: '', stateLabel: '', ownerName: draft.chgBasicInfo.assignedTo.displayName, configItemName: configItem.displayName },
    textFields: readChangeTextFields(draft),
    isProduction,
    plannedWindow,
    riskReview: input.riskReview,
    isRcpActive,
    rcpChecks: readDraftRcpChecks(draft, isRcpActive, input.todayIso),
    // Create makes the planned outage with every Production change (useCrgState createOutageForProductionChange).
    outageCount: isProduction ? 1 : 0,
    ctasks: draft.changeTasks.map((task) => readStagedCtask(task, configItem.sysId !== '', plannedWindow?.plannedStartUtc !== null)),
    // Create links every mentioned PRB that holds no change yet (linkProblemsToNewChange); one held elsewhere stays.
    prbs: input.prbRows?.map((row) => (row.linkStatus === 'unlinked' ? { ...row, linkStatus: 'thisChange' as const } : row)) ?? null,
    attachmentFileNames: [...input.evidenceFileNames],
    failureReasons: input.prbRows === null && input.prbFailureReason ? { prbs: input.prbFailureReason } : {},
  };
}

/**
 * A modify's tasks: an untouched task the change already has, as ServiceNow judged it; an edited or new card, as the
 * save will write it (the change's configuration item, and a window inside the change's). Tasks ServiceNow lists that
 * are not on any card are kept as they are.
 */
function readModifyCtasks(input: DraftReadinessInput, existingCtasks: ChangeReadinessFacts['ctasks']): ChangeReadinessFacts['ctasks'] {
  if (existingCtasks === null) return null;
  const { draft } = input;
  const links = input.existingTaskLinks ?? [];
  const hasChangeConfigItem = readDraftConfigItem(draft).sysId !== '';
  const hasChangeWindow = readDraftWindow(draft)?.plannedStartUtc !== null;
  const linkedNumbers = new Set(links.map((link) => link.number));
  const cardCtasks = draft.changeTasks.map((task) => {
    const link = links.find((existingLink) => existingLink.taskId === task.id);
    const untouchedCtask = link && !isExistingTaskEdited(task, link) ? existingCtasks.find((ctask) => ctask.number === link.number) : undefined;
    return untouchedCtask ?? readStagedCtask(task, hasChangeConfigItem, hasChangeWindow);
  });
  return [...existingCtasks.filter((ctask) => !linkedNumbers.has(ctask.number)), ...cardCtasks];
}

/** The facts for an existing change: what ServiceNow holds, with the user's unsaved edits laid on top. */
function buildExistingChangeFacts(input: DraftReadinessInput, existingFacts: ChangeReadinessFacts): ChangeReadinessFacts {
  const { draft } = input;
  const attachedFileNames = existingFacts.attachmentFileNames;
  return {
    ...existingFacts,
    ctasks: readModifyCtasks(input, existingFacts.ctasks),
    change: existingFacts.change === null ? null : {
      ...existingFacts.change,
      ownerName: draft.chgBasicInfo.assignedTo.displayName || existingFacts.change.ownerName,
      configItemName: readDraftConfigItem(draft).displayName || existingFacts.change.configItemName,
    },
    textFields: readChangeTextFields(draft),
    plannedWindow: readDraftWindow(draft),
    riskReview: input.riskReview,
    attachmentFileNames: attachedFileNames === null && input.evidenceFileNames.length === 0
      ? null : [...(attachedFileNames ?? []), ...input.evidenceFileNames],
  };
}

/** The facts the shared readiness engine judges, for the draft in hand. */
export function buildDraftReadinessFacts(input: DraftReadinessInput): ChangeReadinessFacts {
  const isRcpActive = isRcpPeriodActive(input.isRcpRulesEnabled, input.todayIso);
  if (input.mode === 'modify' && input.existingFacts) return buildExistingChangeFacts(input, input.existingFacts);
  return buildNewChangeFacts(input, isRcpActive);
}

// The plan texts live on "How will it go?"; every other text on "Tell us about the change".
const PLANNING_TEXT_FIELDS = new Set(['implementationPlan', 'testPlan', 'backoutPlan']);

const STEP_FOR_ENGINE_SCREEN: Readonly<Record<string, ChangeWizardStepId>> = {
  changeDetails: 'details', schedule: 'environments', riskCheck: 'aiEnhance',
  // Task backout plans come from the change's own backout plan (useImplementationBackout), written on "How will it go?".
  riskCheckFixRound: 'planning',
  rcpChecklist: 'paperwork', ctaskTimeline: 'tasks', problems: 'scope', testEvidence: 'evidence',
  // One-click fixes Toolbox runs on an existing change; in the wizard each goes to the step that holds its data.
  createPlannedOutage: 'environments', setCtaskConfigItems: 'details', linkProblems: 'scope',
};

/** The wizard step that fixes a readiness item, from the engine's own action. */
export function resolveFixStepId(action: ReadinessAction): ChangeWizardStepId {
  if (action.kind === 'fixNow') return STEP_FOR_ENGINE_SCREEN[action.fixId] ?? 'details';
  if (action.stepId === 'changeText') return action.focusField && PLANNING_TEXT_FIELDS.has(action.focusField) ? 'planning' : 'details';
  return STEP_FOR_ENGINE_SCREEN[action.stepId] ?? 'details';
}

/** True for a check the AI can close by rewriting text ("Fix all with AI" handles these together). */
export function isWritingCheck(item: ReadinessItem): boolean {
  return item.action?.kind === 'openStep' && Boolean(item.action.focusField);
}
