// IntakeCreatePanel.tsx — Creates the reviewed Enrollment Epics in DENP. It first asks the Epic create screen what it
// requires, asks the PO once for anything the intake cannot supply, then — the Create click being the PO's single
// confirmation of the review table — creates one Epic at a time and shows Jira's own reason for any that fail
// (spec 037, contracts/epic-create.md, GH #387 feedback).

import { useEffect, useState } from 'react';

import { TransitionRequiredFields } from '../../../../components/TransitionRequiredFields/index.tsx';
import {
  areTransitionSelectionsComplete,
  type TransitionFieldSelection,
} from '../../../SprintDashboard/featureReviewFixes.ts';
import compositionStyles from '../../FeatureCompositionTab.module.css';
import { readItemDisplayTitle, type EpicIntake, type IntakeItem } from '../epicIntakeModel.ts';
import {
  readUnansweredEpicRequiredFields,
  runEpicCreates,
  type EpicCreateDeps,
  type EpicCreateScreenFields,
} from '../epicCreate.ts';
import { isItemCreatableAfterReview } from '../intakeChecklist.ts';
import { acceptReviewedDrafts } from '../intakePoAnswers.ts';
import styles from '../EpicIntakeWorkspace.module.css';
import type { CreateMetaFieldsResponse } from '../../../../types/jira.ts';

interface IntakeCreatePanelProps {
  intake: EpicIntake;
  /** Whether a draft can still come from a pasted answer — such an item waits for it rather than using the template. */
  isAiUnlocked: boolean;
  onChange: (intake: EpicIntake) => void;
  nowIso: () => string;
  createDeps: EpicCreateDeps;
  loadCreateFields: (projectKey: string, issueTypeId: string) => Promise<CreateMetaFieldsResponse>;
}

type ScreenState =
  | { status: 'loading' }
  | { status: 'ready'; screenFields: EpicCreateScreenFields }
  | { status: 'error'; reason: string };

/** Reads what the Epic create screen requires, once per Epic type. */
function useEpicCreateScreen(intake: EpicIntake, loadCreateFields: IntakeCreatePanelProps['loadCreateFields']): ScreenState {
  const [screenState, setScreenState] = useState<ScreenState>({ status: 'loading' });
  const epicTypeId = intake.epicType.state === 'resolved' ? intake.epicType.id : null;
  useEffect(() => {
    if (epicTypeId === null) return undefined;
    let isCurrent = true;
    loadCreateFields(intake.targetProjectKey, epicTypeId)
      .then((response) => { if (isCurrent) setScreenState({ status: 'ready', screenFields: readUnansweredEpicRequiredFields(response.values ?? []) }); })
      .catch((error: unknown) => { if (isCurrent) setScreenState({ status: 'error', reason: error instanceof Error ? error.message : String(error) }); });
    return () => { isCurrent = false; };
  }, [epicTypeId, intake.targetProjectKey, loadCreateFields]);
  return epicTypeId === null ? { status: 'error', reason: `The ${intake.targetProjectKey} Epic type has not been found yet — run Check DENP first.` } : screenState;
}

/** What the Create button says: in progress, retrying failures, or how many will be created. */
function describeCreateButton(isCreating: boolean, failedCount: number, readyCount: number): string {
  if (isCreating) return 'Creating…';
  return failedCount > 0 ? 'Retry the failed Epics' : `Create ${readyCount} Epic(s)`;
}

function describeCreation(item: IntakeItem): string {
  if (item.creation.state === 'created') return `created ${item.creation.key}`;
  return item.creation.state === 'failed' ? `failed — ${item.creation.reason}` : 'creating…';
}

/** Each Epic that has been attempted, with its new key or Jira's own reason for failing. */
function CreationResults({ intake }: { intake: EpicIntake }) {
  const attemptedItems = intake.items.filter((item) => item.creation.state !== 'notStarted');
  return (
    <ul className={compositionStyles.reviewList}>
      {attemptedItems.map((item) => (
        <li key={item.id} className={item.creation.state === 'failed' ? compositionStyles.outcomeFailed : compositionStyles.outcomeCreated}>
          {readItemDisplayTitle(item)}: {describeCreation(item)}
        </li>
      ))}
    </ul>
  );
}

interface CreateRun {
  isCreating: boolean;
  runError: string | null;
  runCreates: (screenFields: EpicCreateScreenFields) => Promise<void>;
}

/**
 * The Create click. It first records the PO's confirmation of every row the review table shows as "Create" (the
 * written draft, or the plain template), and only then writes anything to Jira.
 */
function useCreateRun({ intake, isAiUnlocked, onChange, nowIso, createDeps }: IntakeCreatePanelProps): CreateRun {
  const [isCreating, setIsCreating] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  async function runCreates(screenFields: EpicCreateScreenFields): Promise<void> {
    setIsCreating(true);
    setRunError(null);
    try {
      const confirmed = acceptReviewedDrafts(intake, isAiUnlocked, nowIso());
      onChange(confirmed);
      onChange(await runEpicCreates(confirmed, createDeps, onChange, screenFields));
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsCreating(false);
    }
  }

  return { isCreating, runError, runCreates };
}

/** The pre-flight questions, the Create button, and each Epic's result. */
export default function IntakeCreatePanel(props: IntakeCreatePanelProps) {
  const { intake, isAiUnlocked, onChange, loadCreateFields } = props;
  const screenState = useEpicCreateScreen(intake, loadCreateFields);
  const { isCreating, runError, runCreates } = useCreateRun(props);
  const readyItems = intake.items.filter((item) => isItemCreatableAfterReview(item, isAiUnlocked));
  const failedItems = intake.items.filter((item) => item.creation.state === 'failed');
  const selections = intake.batchRequiredFieldValues as Record<string, TransitionFieldSelection>;

  if (screenState.status !== 'ready') {
    return screenState.status === 'loading'
      ? <p className={compositionStyles.infoBanner}>Reading what the Epic create screen requires…</p>
      : <p className={compositionStyles.errorBanner}>{screenState.reason}</p>;
  }
  const { screenFields } = screenState;
  const isAnswered = areTransitionSelectionsComplete(screenFields.unanswered, selections);

  return (
    <section className={compositionStyles.panel} aria-label="Create Epics">
      <h3 className={compositionStyles.panelTitle}>Create {readyItems.length} Epic(s) in {intake.targetProjectKey}</h3>
      {screenFields.unanswered.length > 0 ? <p className={styles.intakeQuestionHint}>The Epic create screen needs these for every Epic:</p> : null}
      <TransitionRequiredFields
        requiredFields={screenFields.unanswered}
        selectionByFieldId={selections}
        isDisabled={isCreating}
        onSelectionChange={(fieldId, selection) => onChange({ ...intake, batchRequiredFieldValues: { ...intake.batchRequiredFieldValues, [fieldId]: selection } })}
      />
      <div className={styles.intakeActions}>
        <button type="button" className={compositionStyles.primaryButton} disabled={isCreating || !isAnswered || readyItems.length === 0} onClick={() => { void runCreates(screenFields); }}>
          {describeCreateButton(isCreating, failedItems.length, readyItems.length)}
        </button>
      </div>
      {runError ? <p className={compositionStyles.errorBanner}>{runError}</p> : null}
      <CreationResults intake={intake} />
    </section>
  );
}
