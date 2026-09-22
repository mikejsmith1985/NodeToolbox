// IntakeTurnPanel.tsx — Everything the PO can do right now besides the review table, each in its own labelled section:
// asking for help, placing stray lines, Check DENP, and Create. Kind, owner, match, label and draft are not asked
// here — they are pre-filled in the review table, where the PO changes only what they disagree with (GH #387).

import { useRef, useState } from 'react';

import PoAiPanel from '../../ai/PoAiPanel.tsx';
import compositionStyles from '../../FeatureCompositionTab.module.css';
import { applyClassifyOutcome } from '../ai/intakeClassifyApply.ts';
import { buildClassifyRequests, parseClassifyReply } from '../ai/intakeClassifyRound.ts';
import { applyResolveOutcome, buildResolveRequests, parseResolveReply } from '../ai/intakeResolveRound.ts';
import { runDuplicateSearch, type DuplicateSearchDeps } from '../duplicateSearch.ts';
import type { EpicCreateDeps } from '../epicCreate.ts';
import type { EpicIntake, IngestRejection, IntakeStepId } from '../epicIntakeModel.ts';
import { handStepToPo, listAvailableActions, listOpenDecisions, type OpenDecision } from '../intakeChecklist.ts';
import styles from '../EpicIntakeWorkspace.module.css';
import IntakeCreatePanel from './IntakeCreatePanel.tsx';
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

/** One part of a request, with the text the PO copies out. */
interface StepRequest extends AskedRequest {
  text: string;
}

/** What one pasted answer did: the updated intake, how many answers were used, and what was not. */
interface IngestResult {
  updated: EpicIntake;
  acceptedCount: number;
  rejected: readonly IngestRejection[];
}

/** The requests for this step: the sorting request (sort + owners), or the resolve request (match, label, draft). */
function buildStepRequests(intake: EpicIntake, isSorting: boolean): StepRequest[] {
  return isSorting ? buildClassifyRequests(intake) : buildResolveRequests(intake);
}

/** Applies one pasted answer through the round it was asked in, and reports what was used and what was not. */
function ingestStepReply(intake: EpicIntake, replyText: string, asked: AskedRequest, isSorting: boolean, nowIso: string): IngestResult {
  const position = { partIndex: asked.partIndex, partCount: asked.partCount };
  const updated = isSorting
    ? applyClassifyOutcome(intake, parseClassifyReply(replyText, intake, asked.itemIds), asked.itemIds, position, nowIso)
    : applyResolveOutcome(intake, parseResolveReply(replyText, intake, asked.itemIds), asked.itemIds, position, nowIso);
  // Both rounds record the full picture — including per-field problems found while applying — in the round's audit
  // line, so that line (not the parser's first pass) is what the PO is shown.
  const roundRecord = updated.roundHistory[updated.roundHistory.length - 1];
  return { updated, acceptedCount: roundRecord?.acceptedCount ?? 0, rejected: roundRecord?.rejected ?? [] };
}

/** Lets the PO pick which part of a long request to copy, when it had to be split. */
function PartSelector({ requests, selectedPart, onSelect }: { requests: readonly AskedRequest[]; selectedPart: number; onSelect: (partIndex: number) => void }) {
  if (requests.length < 2) {
    return null;
  }
  return (
    <label className={compositionStyles.fieldLabel}>
      Part
      <select className={compositionStyles.selectInput} value={selectedPart} onChange={(changeEvent) => onSelect(Number(changeEvent.target.value))}>
        {requests.map((request) => <option key={request.partIndex} value={request.partIndex}>{`Part ${request.partIndex + 1} of ${request.partCount}`}</option>)}
      </select>
    </label>
  );
}

/** The copy-out / paste-back panel for the earliest request the assistant can answer. Renders nothing when locked. */
function AssistantTurn({ intake, assistantStep, onChange, nowIso }: AssistantTurnProps) {
  const askedRef = useRef<AskedRequest>({ itemIds: [], partIndex: 0, partCount: 1 });
  const [partIndex, setPartIndex] = useState(0);
  const isSorting = SORTING_STEPS.has(assistantStep);
  const requests = buildStepRequests(intake, isSorting);
  const selectedPart = Math.min(partIndex, Math.max(requests.length - 1, 0));

  function buildPrompt(): string {
    const request = requests[selectedPart];
    if (request === undefined) return '';
    askedRef.current = { itemIds: request.itemIds, partIndex: request.partIndex, partCount: request.partCount };
    return request.text;
  }

  function ingest(replyText: string): { acceptedCount: number; errors: string[] } {
    const result = ingestStepReply(intake, replyText, askedRef.current, isSorting, nowIso());
    onChange(result.updated);
    return { acceptedCount: result.acceptedCount, errors: describeRejections(result.rejected) };
  }

  return (
    <div>
      <PartSelector requests={requests} selectedPart={selectedPart} onSelect={setPartIndex} />
      <PoAiPanel
        // Keyed by the kind of request, not by every ingest, so the rejections from the last paste stay on screen.
        key={`${isSorting ? 'sort' : 'resolve'}-${selectedPart}`}
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

/** Only the stray-line questions are asked here; every item's own choices live in the review table. */
function isLinePlacementQuestion(openDecision: OpenDecision): boolean {
  return openDecision.slot === 'lineCoverage';
}

/** Renders every action available now. Sections appear and disappear as items move forward. */
export default function IntakeTurnPanel(props: IntakeTurnPanelProps) {
  const { intake, isAiUnlocked, onChange, jiraDeps, nowIso } = props;
  const actions = listAvailableActions(intake, isAiUnlocked);
  const lineQuestions = actions.poQuestions.filter(isLinePlacementQuestion);
  return (
    <div className={styles.intakeWorkspace}>
      {actions.assistantStep !== null && isAiUnlocked ? (
        <ActionSection title="Ask for help">
          <AssistantTurn {...props} assistantStep={actions.assistantStep} />
        </ActionSection>
      ) : null}
      {lineQuestions.length > 0 ? (
        <ActionSection title="Lines to place">
          <IntakeQuestionList intake={intake} questions={lineQuestions} onChange={onChange} nowIso={nowIso} />
        </ActionSection>
      ) : null}
      {actions.hasSearchWork ? (
        <ActionSection title={`Check ${intake.targetProjectKey}`}>
          <CheckDenpTurn {...props} />
        </ActionSection>
      ) : null}
      {actions.hasCreateWork ? (
        <IntakeCreatePanel intake={intake} isAiUnlocked={isAiUnlocked} onChange={onChange} nowIso={nowIso}
          createDeps={jiraDeps.create} loadCreateFields={jiraDeps.loadCreateFields} />
      ) : null}
    </div>
  );
}
