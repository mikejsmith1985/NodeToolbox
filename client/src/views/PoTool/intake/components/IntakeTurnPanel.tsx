// IntakeTurnPanel.tsx — Everything the PO can do right now, each in its own labelled section: the assistant request,
// Check DENP, the PO's questions, drafts to review, and Create. Items move forward independently, so an item ready
// for DENP is never held back by another item's open question (GH #387 feedback).

import { useRef, useState } from 'react';

import PoAiPanel from '../../ai/PoAiPanel.tsx';
import compositionStyles from '../../FeatureCompositionTab.module.css';
import { applyClassifyOutcome } from '../ai/intakeClassifyApply.ts';
import { buildClassifyRequests, parseClassifyReply } from '../ai/intakeClassifyRound.ts';
import { applyDraftOutcome, buildDraftRequest, parseDraftReply } from '../ai/intakeDraftRound.ts';
import { applyMatchOutcome, buildMatchRequest, parseMatchReply } from '../ai/intakeMatchRound.ts';
import { runDuplicateSearch, type DuplicateSearchDeps } from '../duplicateSearch.ts';
import type { EpicCreateDeps } from '../epicCreate.ts';
import type { EpicIntake, IngestRejection, IntakeStepId } from '../epicIntakeModel.ts';
import { handStepToPo, listAvailableActions, listOpenDecisions } from '../intakeChecklist.ts';
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

const SORTING_STEPS = new Set<IntakeStepId>(['sortNotes', 'decideOwners']);

function describeRejections(rejected: readonly IngestRejection[]): string[] {
  return rejected.map((rejection) => (rejection.itemId ? `${rejection.itemId}: ${rejection.reason}` : rejection.reason));
}

/** A titled block, so every kind of action is easy to find on a long page. */
function ActionSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={compositionStyles.panel} aria-label={title}>
      <h3 className={compositionStyles.panelTitle}>{title}</h3>
      {children}
    </section>
  );
}

// ── Assistant ──

interface AssistantTurnProps extends IntakeTurnPanelProps {
  assistantStep: IntakeStepId;
}

/** The copy-out / paste-back panel for the earliest request the assistant can answer. Renders nothing when locked. */
function AssistantTurn({ intake, assistantStep, onChange, nowIso }: AssistantTurnProps) {
  const askedRef = useRef<AskedRequest>({ itemIds: [], partIndex: 0, partCount: 1 });
  const [partIndex, setPartIndex] = useState(0);
  const isSorting = SORTING_STEPS.has(assistantStep);
  const classifyRequests = isSorting ? buildClassifyRequests(intake) : [];
  const selectedPart = Math.min(partIndex, Math.max(classifyRequests.length - 1, 0));

  function buildPrompt(): string {
    const request = isSorting ? classifyRequests[selectedPart] : assistantStep === 'match' ? buildMatchRequest(intake) : buildDraftRequest(intake);
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
    const outcome = assistantStep === 'match' ? parseMatchReply(replyText, intake, asked.itemIds) : parseDraftReply(replyText, asked.itemIds);
    const applied = assistantStep === 'match'
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
        key={`${isSorting ? 'sort' : assistantStep}-${selectedPart}`}
        title="Help with this step"
        buildPrompt={buildPrompt}
        onIngest={ingest}
        helpText="Only the questions still open are asked. Answers are checked before anything is used, and nothing is written to Jira."
      />
      <div className={styles.intakeActions}>
        <button type="button" className={compositionStyles.secondaryButton} onClick={() => onChange(handStepToPo(intake, assistantStep))}>
          Answer these myself
        </button>
      </div>
    </div>
  );
}

// ── Check DENP ──

/** The Check DENP button with a running count. Only items that are ready — or failed before — are searched. */
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
      <span className={styles.intakeCount}>{pendingCount} Enrollment item(s) ready to check for an existing Epic.</span>
      {runError ? <span className={compositionStyles.errorBanner}>{runError}</span> : null}
    </div>
  );
}

// ── The panel ──

/** Renders every action available now. Sections appear and disappear as items move forward. */
export default function IntakeTurnPanel(props: IntakeTurnPanelProps) {
  const { intake, isAiUnlocked, onChange, jiraDeps, nowIso } = props;
  const actions = listAvailableActions(intake, isAiUnlocked);
  return (
    <div className={styles.intakeWorkspace}>
      {actions.assistantStep !== null && isAiUnlocked ? (
        <ActionSection title="Ask for help">
          <AssistantTurn {...props} assistantStep={actions.assistantStep} />
        </ActionSection>
      ) : null}
      {actions.poQuestions.length > 0 ? (
        <ActionSection title={`Questions for you (${actions.poQuestions.length})`}>
          <IntakeQuestionList intake={intake} questions={actions.poQuestions} onChange={onChange} nowIso={nowIso} />
        </ActionSection>
      ) : null}
      {actions.hasSearchWork ? (
        <ActionSection title={`Check ${intake.targetProjectKey}`}>
          <CheckDenpTurn {...props} />
        </ActionSection>
      ) : null}
      {actions.draftReviewItemIds.length > 0 ? (
        <ActionSection title={`Drafts to review (${actions.draftReviewItemIds.length})`}>
          <IntakeDraftReview intake={intake} itemIds={actions.draftReviewItemIds} onChange={onChange} nowIso={nowIso} />
        </ActionSection>
      ) : null}
      {actions.hasCreateWork ? (
        <IntakeCreatePanel intake={intake} onChange={onChange} createDeps={jiraDeps.create} loadCreateFields={jiraDeps.loadCreateFields} />
      ) : null}
    </div>
  );
}
