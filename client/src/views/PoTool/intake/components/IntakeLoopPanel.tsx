// IntakeLoopPanel.tsx — The Epic Intake as a pure copy-and-paste loop: the next prompt is always on screen, the PO
// copies it out and pastes the answer back, Toolbox checks DENP by itself in between, and the next prompt appears —
// until every question is answered and only Create is left (GH #387 feedback: "I didn't have to do anything other
// than copy paste").
//
// It asks nothing of the PO directly. Anything wrong or missing in an answer is asked again in the next prompt, and
// anything still unanswered after the last try gets a safe, flagged default (intakeDefaults.ts).

import { useRef, useState } from 'react';

import { useCopyFeedback } from '../../../../hooks/useCopyFeedback.ts';
import compositionStyles from '../../FeatureCompositionTab.module.css';
import { applyClassifyOutcome } from '../ai/intakeClassifyApply.ts';
import { buildClassifyRequests, parseClassifyReply } from '../ai/intakeClassifyRound.ts';
import { applyResolveOutcome, buildResolveRequests, parseResolveReply } from '../ai/intakeResolveRound.ts';
import { runDuplicateSearch } from '../duplicateSearch.ts';
import { DECISION_SLOTS, type EpicIntake, type IngestRejection } from '../epicIntakeModel.ts';
import { listAvailableActions } from '../intakeChecklist.ts';
import { applySafeDefaults } from '../intakeDefaults.ts';
import styles from '../EpicIntakeWorkspace.module.css';
import IntakeCreatePanel from './IntakeCreatePanel.tsx';
import type { IntakeJiraDeps } from './IntakeTurnPanel.tsx';

interface IntakeLoopPanelProps {
  intake: EpicIntake;
  onChange: (intake: EpicIntake) => void;
  jiraDeps: IntakeJiraDeps;
  nowIso: () => string;
}

/** The one prompt on screen now: its text, what it asks about, and which part of the round it is. */
interface LoopPrompt {
  text: string;
  itemIds: string[];
  partIndex: number;
  partCount: number;
  isSorting: boolean;
}

/** The sorting prompt comes first; the match-label-and-draft prompt follows once DENP has been checked. */
function readNextPrompt(intake: EpicIntake): LoopPrompt | null {
  const [sortingRequest] = buildClassifyRequests(intake);
  if (sortingRequest !== undefined) {
    return { ...sortingRequest, isSorting: true };
  }
  const [resolveRequest] = buildResolveRequests(intake);
  return resolveRequest === undefined ? null : { ...resolveRequest, isSorting: false };
}

/** True when some Enrollment item has never been checked against DENP — checked automatically, never on a click. */
function hasUncheckedItems(intake: EpicIntake): boolean {
  return listAvailableActions(intake, true).hasSearchWork && intake.items.some((item) => item.searchStatus === 'notRun');
}

function describeProblems(rejected: readonly IngestRejection[]): string[] {
  return rejected.map((rejection) => (rejection.itemId ? `${rejection.itemId}: ${rejection.reason}` : rejection.reason));
}

/**
 * The per-field problems an answer caused — a kind that is not a kind, terms that could not be used — which are
 * recorded on each decision as a new failed attempt rather than in the round's log.
 */
function listFieldProblems(before: EpicIntake, after: EpicIntake, askedItemIds: readonly string[]): string[] {
  const problems: string[] = [];
  for (const itemId of askedItemIds) {
    const beforeItem = before.items.find((item) => item.id === itemId);
    const afterItem = after.items.find((item) => item.id === itemId);
    if (beforeItem === undefined || afterItem === undefined) continue;
    for (const slot of DECISION_SLOTS) {
      const beforeDecision = beforeItem.decisions[slot];
      const afterDecision = afterItem.decisions[slot];
      const hasNewFailure = afterDecision.state === 'open' && beforeDecision.state === 'open' && afterDecision.aiAttempts > beforeDecision.aiAttempts;
      if (hasNewFailure && afterDecision.lastRejection) problems.push(`${itemId} ${slot}: ${afterDecision.lastRejection}`);
    }
  }
  return problems;
}

/** Applies one pasted answer to the prompt it answered, then fills anything exhausted with a safe default. */
function applyAnswer(intake: EpicIntake, prompt: LoopPrompt, answerText: string, nowIso: string): { updated: EpicIntake; problems: string[] } {
  const position = { partIndex: prompt.partIndex, partCount: prompt.partCount };
  const applied = prompt.isSorting
    ? applyClassifyOutcome(intake, parseClassifyReply(answerText, intake, prompt.itemIds), prompt.itemIds, position, nowIso)
    : applyResolveOutcome(intake, parseResolveReply(answerText, intake, prompt.itemIds), prompt.itemIds, position, nowIso);
  const roundRecord = applied.roundHistory[applied.roundHistory.length - 1];
  const problems = [...describeProblems(roundRecord?.rejected ?? []), ...listFieldProblems(intake, applied, prompt.itemIds)];
  return { updated: applySafeDefaults(applied, true), problems: [...new Set(problems)] };
}

/**
 * Runs the DENP check, reporting progress. It is started straight from reading an answer — so the PO never clicks
 * for it — and a failed check leaves those items "not checked" with one retry, never an endless automatic loop.
 */
function useDuplicateCheck(props: IntakeLoopPanelProps): { checkedCount: number | null; runError: string | null; runCheck: (intakeToCheck: EpicIntake) => void } {
  const { onChange, jiraDeps } = props;
  const [checkedCount, setCheckedCount] = useState<number | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const isRunningRef = useRef(false);

  async function checkDenp(intakeToCheck: EpicIntake): Promise<void> {
    if (isRunningRef.current) return;
    isRunningRef.current = true;
    setRunError(null);
    setCheckedCount(0);
    try {
      let progressCount = 0;
      const searched = await runDuplicateSearch(intakeToCheck, jiraDeps.search, (progressIntake) => {
        progressCount += 1;
        setCheckedCount(progressCount);
        onChange(progressIntake);
      });
      onChange(applySafeDefaults(searched, true));
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error));
    } finally {
      isRunningRef.current = false;
      setCheckedCount(null);
    }
  }

  return { checkedCount, runError, runCheck: (intakeToCheck) => { void checkDenp(intakeToCheck); } };
}

/** The prompt to copy, the box to paste the answer into, and the one button that reads it. */
function PromptStep({ prompt, promptNumber, onAnswer }: { prompt: LoopPrompt; promptNumber: number; onAnswer: (answerText: string) => void }) {
  const [answerText, setAnswerText] = useState('');
  const { hasCopied, confirmCopy } = useCopyFeedback();
  const partNote = prompt.partCount > 1 ? ` (part ${prompt.partIndex + 1} of ${prompt.partCount})` : '';
  return (
    <section className={compositionStyles.panel} aria-label={`Prompt ${promptNumber}`}>
      <h3 className={compositionStyles.panelTitle}>Prompt {promptNumber}{partNote}</h3>
      <p className={compositionStyles.panelSubtitle}>Copy this, paste it into your assistant, then paste the whole answer below.</p>
      <textarea aria-label="Prompt to copy" className={compositionStyles.textAreaTall} readOnly value={prompt.text} />
      <div className={styles.intakeActions}>
        <button type="button" className={compositionStyles.primaryButton} onClick={() => confirmCopy(prompt.text)}>{hasCopied ? '✓ Copied' : 'Copy prompt'}</button>
      </div>
      <textarea aria-label="Paste the answer here" className={compositionStyles.textAreaTall} value={answerText} onChange={(changeEvent) => setAnswerText(changeEvent.target.value)} />
      <div className={styles.intakeActions}>
        <button type="button" className={compositionStyles.primaryButton} disabled={answerText.trim() === ''} onClick={() => { onAnswer(answerText); setAnswerText(''); }}>
          Read the answer
        </button>
      </div>
    </section>
  );
}

/** The whole loop: the next prompt, the automatic DENP check, or — once everything is answered — Create. */
export default function IntakeLoopPanel(props: IntakeLoopPanelProps) {
  const { intake, onChange, jiraDeps, nowIso } = props;
  const [problems, setProblems] = useState<string[]>([]);
  const prompt = readNextPrompt(intake);
  const { checkedCount, runError, runCheck } = useDuplicateCheck(props);
  const actions = listAvailableActions(intake, true);
  const isCheckDue = (prompt === null || !prompt.isSorting) && hasUncheckedItems(intake);
  const hasFailedCheck = runError !== null || intake.items.some((item) => item.searchStatus === 'failed' && item.decisions.duplicate.state === 'open');

  function handleAnswer(answerText: string): void {
    if (prompt === null) return;
    const { updated, problems: answerProblems } = applyAnswer(intake, prompt, answerText, nowIso());
    setProblems(answerProblems);
    onChange(updated);
    // Sorting done and items waiting for DENP: check straight away, so the next prompt already knows what exists.
    if (readNextPrompt(updated)?.isSorting !== true && hasUncheckedItems(updated)) {
      runCheck(updated);
    }
  }

  if (checkedCount !== null) {
    return <p className={compositionStyles.infoBanner} role="status">Checking {intake.targetProjectKey} for Epics that already exist… {checkedCount} checked</p>;
  }
  if (isCheckDue) {
    // Only reached when an intake is resumed part-way: in a live run the check starts from the answer itself.
    return (
      <div className={styles.intakeActions}>
        <button type="button" className={compositionStyles.primaryButton} onClick={() => runCheck(intake)}>Check {intake.targetProjectKey} now</button>
      </div>
    );
  }
  return (
    <div className={styles.intakeWorkspace}>
      {problems.length > 0 ? (
        <div className={compositionStyles.warningBanner} role="status">
          <strong>Some answers could not be used — they are asked again in the next prompt:</strong>
          <ul>{problems.map((problem, index) => <li key={`${index}-${problem}`}>{problem}</li>)}</ul>
        </div>
      ) : null}
      {hasFailedCheck ? (
        <div className={compositionStyles.errorBanner} role="status">
          The {intake.targetProjectKey} check could not finish{runError ? `: ${runError}` : ''}.
          <button type="button" className={compositionStyles.secondaryButton} onClick={() => runCheck(intake)}>Try the check again</button>
        </div>
      ) : null}
      {prompt !== null ? (
        <PromptStep key={`${prompt.isSorting ? 'sort' : 'resolve'}-${intake.roundHistory.length}`} prompt={prompt} promptNumber={intake.roundHistory.length + 1} onAnswer={handleAnswer} />
      ) : null}
      {prompt === null && actions.hasCreateWork ? (
        <IntakeCreatePanel intake={intake} isAiUnlocked onChange={onChange} nowIso={nowIso} createDeps={jiraDeps.create} loadCreateFields={jiraDeps.loadCreateFields} />
      ) : null}
    </div>
  );
}
