// IntakeTurnPanel.tsx — Whatever the current step needs, and only that: a copy-out / paste-back request when it is the
// assistant's turn, the Check DENP or Create button when it is Toolbox's, or the PO's own questions and drafts.

import { useRef, useState } from 'react';

import PoAiPanel from '../../ai/PoAiPanel.tsx';
import compositionStyles from '../../FeatureCompositionTab.module.css';
import { applyClassifyOutcome } from '../ai/intakeClassifyApply.ts';
import { buildClassifyRequests, parseClassifyReply } from '../ai/intakeClassifyRound.ts';
import { applyDraftOutcome, buildDraftRequest, parseDraftReply } from '../ai/intakeDraftRound.ts';
import { applyMatchOutcome, buildMatchRequest, parseMatchReply } from '../ai/intakeMatchRound.ts';
import { runDuplicateSearch, type DuplicateSearchDeps } from '../duplicateSearch.ts';
import type { EpicCreateDeps } from '../epicCreate.ts';
import type { EpicIntake, IngestRejection } from '../epicIntakeModel.ts';
import { handStepToPo, listOpenDecisions, type IntakeNextStep } from '../intakeChecklist.ts';
import styles from '../EpicIntakeWorkspace.module.css';
import IntakeCreatePanel from './IntakeCreatePanel.tsx';
import IntakeDraftReview from './IntakeDraftReview.tsx';
import IntakeQuestionList from './IntakeQuestionList.tsx';
import type { CreateMetaFieldsResponse } from '../../../../types/jira.ts';

/** The Jira calls the intake makes, injected so the whole mode can be exercised without Jira. */
export interface IntakeJiraDeps {
  search: DuplicateSearchDeps;
  create: EpicCreateDeps;
  loadCreateFields: (projectKey: string, issueTypeId: string) => Promise<CreateMetaFieldsResponse>;
}

interface IntakeTurnPanelProps {
  intake: EpicIntake;
  nextStep: IntakeNextStep;
  isAiUnlocked: boolean;
  onChange: (intake: EpicIntake) => void;
  jiraDeps: IntakeJiraDeps;
  nowIso: () => string;
}

/** What the current assistant request asked about, captured when it is built so its answer is checked against it. */
interface AskedRequest {
  itemIds: string[];
  partIndex: number;
  partCount: number;
}

function describeRejections(rejected: readonly IngestRejection[]): string[] {
  return rejected.map((rejection) => (rejection.itemId ? `${rejection.itemId}: ${rejection.reason}` : rejection.reason));
}

/** The copy-out / paste-back panel for whichever request the step needs. Renders nothing when locked. */
function AssistantTurn({ intake, nextStep, onChange, nowIso }: IntakeTurnPanelProps) {
  const askedRef = useRef<AskedRequest>({ itemIds: [], partIndex: 0, partCount: 1 });
  const [partIndex, setPartIndex] = useState(0);
  const isSorting = nextStep.step === 'sortNotes' || nextStep.step === 'decideOwners';
  const classifyRequests = isSorting ? buildClassifyRequests(intake) : [];
  const selectedPart = Math.min(partIndex, Math.max(classifyRequests.length - 1, 0));

  function buildPrompt(): string {
    const request = isSorting ? classifyRequests[selectedPart] : nextStep.step === 'match' ? buildMatchRequest(intake) : buildDraftRequest(intake);
    askedRef.current = { itemIds: request.itemIds, partIndex: isSorting ? selectedPart : 0, partCount: isSorting ? classifyRequests.length : 1 };
    return request.text;
  }

  function ingest(replyText: string): { acceptedCount: number; errors: string[] } {
    const asked = askedRef.current;
    const now = nowIso();
    if (isSorting) {
      const outcome = parseClassifyReply(replyText, intake, asked.itemIds);
      onChange(applyClassifyOutcome(intake, outcome, asked.itemIds, { partIndex: asked.partIndex, partCount: asked.partCount }, now));
      return { acceptedCount: outcome.accepted.length, errors: describeRejections(outcome.rejected) };
    }
    const outcome = nextStep.step === 'match' ? parseMatchReply(replyText, intake, asked.itemIds) : parseDraftReply(replyText, asked.itemIds);
    const applied = nextStep.step === 'match'
      ? applyMatchOutcome(intake, outcome as ReturnType<typeof parseMatchReply>, asked.itemIds, now)
      : applyDraftOutcome(intake, outcome as ReturnType<typeof parseDraftReply>, asked.itemIds, now);
    onChange(applied);
    return { acceptedCount: outcome.accepted.length, errors: describeRejections(outcome.rejected) };
  }

  return (
    <div>
      {classifyRequests.length > 1 ? (
        <label className={compositionStyles.fieldLabel}>
          Part
          <select className={compositionStyles.selectInput} value={selectedPart} onChange={(changeEvent) => setPartIndex(Number(changeEvent.target.value))}>
            {classifyRequests.map((request) => <option key={request.partIndex} value={request.partIndex}>{`Part ${request.partIndex + 1} of ${request.partCount}`}</option>)}
          </select>
        </label>
      ) : null}
      <PoAiPanel
        // Keyed by the kind of request, not by every ingest, so the rejections from the last paste stay on screen.
        key={`${isSorting ? 'sort' : nextStep.step}-${selectedPart}`}
        title="Help with this step"
        buildPrompt={buildPrompt}
        onIngest={ingest}
        helpText="Only the questions still open are asked. Answers are checked before anything is used, and nothing is written to Jira."
      />
      <div className={styles.intakeActions}>
        <button type="button" className={compositionStyles.secondaryButton} onClick={() => onChange(handStepToPo(intake, nextStep.step))}>
          Answer these myself
        </button>
      </div>
    </div>
  );
}

/** The Check DENP button with a running count. Only failed or unchecked items are searched again. */
function CheckDenpTurn({ intake, onChange, jiraDeps }: IntakeTurnPanelProps) {
  const [checkedCount, setCheckedCount] = useState<number | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const pendingCount = listOpenDecisions(intake, false).filter((openDecision) => openDecision.slot === 'candidateSearch').length;

  async function handleCheck(): Promise<void> {
    setRunError(null);
    setCheckedCount(0);
    try {
      let progressCount = 0;
      const searched = await runDuplicateSearch(intake, jiraDeps.search, (progressIntake) => {
        progressCount += 1;
        setCheckedCount(progressCount);
        onChange(progressIntake);
      });
      onChange(searched);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckedCount(null);
    }
  }

  return (
    <div className={styles.intakeActions}>
      <button type="button" className={compositionStyles.primaryButton} disabled={checkedCount !== null} onClick={() => { void handleCheck(); }}>
        {checkedCount === null ? `Check ${intake.targetProjectKey}` : `Checked ${checkedCount} of ${pendingCount}`}
      </button>
      {runError ? <span className={compositionStyles.errorBanner}>{runError}</span> : null}
    </div>
  );
}

/** Renders the panel for the current step and whose turn it is. */
export default function IntakeTurnPanel(props: IntakeTurnPanelProps) {
  const { intake, nextStep, isAiUnlocked, onChange, jiraDeps, nowIso } = props;
  if (nextStep.turn === 'done') {
    return null;
  }
  const stepQuestions = listOpenDecisions(intake, isAiUnlocked).filter((openDecision) => openDecision.step === nextStep.step && openDecision.turn === 'po');
  if (nextStep.turn === 'ai' && isAiUnlocked) {
    // Questions already handed to the PO in this step are shown alongside the request, not held back behind it.
    return (
      <>
        <AssistantTurn {...props} />
        <IntakeQuestionList intake={intake} questions={stepQuestions} onChange={onChange} nowIso={nowIso} />
      </>
    );
  }
  if (nextStep.turn === 'toolbox') {
    return nextStep.step === 'create'
      ? <IntakeCreatePanel intake={intake} onChange={onChange} createDeps={jiraDeps.create} loadCreateFields={jiraDeps.loadCreateFields} />
      : <CheckDenpTurn {...props} />;
  }
  if (nextStep.step === 'draft') {
    const draftItemIds = stepQuestions.map((question) => question.itemId).filter((itemId): itemId is string => itemId !== null);
    return <IntakeDraftReview intake={intake} itemIds={draftItemIds} onChange={onChange} nowIso={nowIso} />;
  }
  return <IntakeQuestionList intake={intake} questions={stepQuestions} onChange={onChange} nowIso={nowIso} />;
}
