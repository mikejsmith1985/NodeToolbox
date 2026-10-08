// ExistingChgRiskCheck.tsx — Risk-checks an existing CHG and all its CTASKs in one pass, and fixes both (GH #395).
//
// The change builder's check → fix → check-again loop, run on a change that already exists: one prompt per
// round covers the change's text and every one of its tasks. Two CTASK rules hold — the task's CI is the
// change's, and an implementation task has a detailed backout plan. The CI rule is checked here with no AI at
// all and fixed with one click; backout plans are judged and rewritten by the assistant and then written to
// ServiceNow on request. Change-field fixes go into the Modify form and are saved with the change.

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { JiraIssue } from '../../../types/jira.ts';
import { fetchChangeJiraStories, findJiraKeysInChangeText } from '../chgFormula/changeJiraStories.ts';
import { describeTaskPeople, type ChgPromptContext } from '../chgFormula/chgPromptContext.ts';
import { buildChgGapFixPrompt, resolveFixableFields } from '../chgFormula/chgGapFixPrompt.ts';
import { buildChgRiskCheckPrompt, splitRiskCheckReply, type ChgTextFieldValues } from '../chgFormula/chgRiskCheckPrompt.ts';
import { fetchChangeAttachmentFileNames, fetchReviewedCtasks, saveCtaskFix } from '../chgFormula/ctaskReviewApi.ts';
import type { ReviewedCtask } from '../chgFormula/ctaskReviewRecord.ts';
import {
  buildCtaskCheckPart,
  buildCtaskFixPart,
  buildCtaskRecheckPart,
  parseCtaskBackoutReply,
} from '../chgFormula/ctaskReviewPrompt.ts';
import { checkCtaskRules, composeReviewWithRules, readCtaskFindingTarget } from '../chgFormula/ctaskReviewRules.ts';
import type { ChgTextFieldKey } from '../chgFormula/formulaCard.ts';
import {
  buildGapRecheckPrompt,
  countRecheckOutcome,
  isOpenFinding,
  isUnsettledFinding,
  mergeRecheckIntoReview,
} from '../chgFormula/gapFocus.ts';
import { parseRiskCheckReview, type RiskCheckFinding } from '../chgFormula/riskCheckReview.ts';
import { applyTeamStandards } from '../chgFormula/teamStandards.ts';
import { describeEstimatesForPrompt, readEstimatesFromText, rollUpEstimates, type DurationEstimates } from '../ctaskDurations.ts';
import { buildIssueDetailText, parseAiAssistChgResponse, useAiAssist } from '../hooks/useAiAssist.ts';
import type { SnowReference } from '../hooks/useCrgState.ts';
import { AiAssistPromptModal, type AiAssistPromptSession } from './AiAssistPromptModal.tsx';
import { RiskCheckReviewPanel } from './RiskCheckReviewPanel.tsx';
import styles from './CreateChgTab.module.css';

interface ExistingChgRiskCheckProps {
  changeSysId: string;
  /** The CI every task must match: the change's own. */
  changeConfigItem: SnowReference;
  /** The change's record facts; its task lines are filled in here from the tasks read. */
  promptContext: ChgPromptContext;
  fieldValues: ChgTextFieldValues;
  /** Writes rewritten change fields into the Modify form; returns how many were applied. */
  onApplyChangeFields: (fields: Partial<Record<ChgTextFieldKey, string>>) => number;
}

/** The review's open gaps, sorted by where each is fixed. */
interface OpenGaps {
  changeGaps: RiskCheckFinding[];
  backoutGaps: RiskCheckFinding[];
}

/** "1 task", "2 tasks". */
function pluralise(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** The open gaps an AI round can work on: change-field gaps and task backout gaps (CI gaps are fixed by button). */
function readOpenGaps(reviewText: string, isIncluded: (finding: RiskCheckFinding) => boolean = isOpenFinding): OpenGaps {
  const openFindings = parseRiskCheckReview(reviewText).findings.filter((finding) => isIncluded(finding));
  return {
    changeGaps: openFindings.filter((finding) => readCtaskFindingTarget(finding.field) === null),
    backoutGaps: openFindings.filter((finding) => readCtaskFindingTarget(finding.field)?.aspect === 'backoutPlan'),
  };
}

/**
 * The record facts with one line per task, so every round sees the tasks the change really has — and the Jira
 * stories the change names, so the check does not ask for what those stories already state.
 */
function withTaskLines(
  promptContext: ChgPromptContext,
  ctasks: readonly ReviewedCtask[],
  jiraStories: readonly JiraIssue[],
  attachmentFileNames: readonly string[],
): ChgPromptContext {
  return {
    ...promptContext,
    jiraSourceText: jiraStories.length > 0 ? buildIssueDetailText([...jiraStories]) : '',
    attachmentFileNames,
    changeTaskLines: ctasks.map((ctask) => describeTaskLine(ctask)),
    durationEstimates: readTaskDurationEstimates(ctasks),
  };
}

/** The change's durations: its tasks' estimates added up — what the duration card fields are settled from. */
function readTaskDurationEstimates(ctasks: readonly ReviewedCtask[]): DurationEstimates {
  return rollUpEstimates(ctasks.map((ctask) => readEstimatesFromText(ctask.description)));
}

/** One task as the prompt lists it: what it is, who does it, and its estimated minutes when it has them. */
function describeTaskLine(ctask: ReviewedCtask): string {
  const estimatesText = describeEstimatesForPrompt(readEstimatesFromText(ctask.description));
  return [
    `${ctask.number} — ${ctask.shortDescription} (${ctask.typeLabel || 'type not recorded'})`,
    describeTaskPeople(ctask.assignedTo.displayName, ctask.assignmentGroup.displayName),
    ...(estimatesText ? [estimatesText] : []),
  ].join(' — ');
}

/** Only the allowed change fields a reply rewrote, so a reply is never trusted with a field it was not shown. */
function pickChangeFields(replyText: string, allowedFieldKeys: readonly ChgTextFieldKey[]): Partial<Record<ChgTextFieldKey, string>> {
  const parsedFields = parseAiAssistChgResponse(replyText);
  return Object.fromEntries(allowedFieldKeys
    .filter((fieldKey) => Boolean(parsedFields[fieldKey]))
    .map((fieldKey) => [fieldKey, parsedFields[fieldKey] as string]));
}

/** The task rules as a short list: what fails first, then a count of what passes. */
function CtaskRuleSummary({ ruleFindings }: { ruleFindings: RiskCheckFinding[] }) {
  const failingFindings = ruleFindings.filter((finding) => isOpenFinding(finding));
  return (
    <>
      {failingFindings.length > 0 ? (
        <ul className={styles.riskFindingList}>
          {failingFindings.map((finding) => (
            <li className={styles.riskFindingItem} key={finding.field}>
              <strong className={styles.riskFindingField}>{finding.field}</strong>
              <span className={styles.riskFindingDetail}>{finding.detail}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className={styles.panelHint}>{`${ruleFindings.length - failingFindings.length} of ${ruleFindings.length} CTASK checks pass.`}</p>
    </>
  );
}

/** The backout plans a fix round produced, waiting to be written to their tasks. */
function PendingCtaskFixes({ pendingPlans, isWriting, onWrite }: {
  pendingPlans: ReadonlyMap<string, string>;
  isWriting: boolean;
  onWrite: () => void;
}) {
  if (pendingPlans.size === 0) {
    return null;
  }
  return (
    <div className={styles.environmentCard}>
      <h5 className={styles.panelSectionTitle}>CTASK fixes ready to write</h5>
      {[...pendingPlans.entries()].map(([ctaskNumber, backoutPlan]) => (
        <div key={ctaskNumber}>
          <strong className={styles.riskFindingField}>{`${ctaskNumber} · Backout plan`}</strong>
          <p className={styles.riskCheckText}>{backoutPlan}</p>
        </div>
      ))}
      <button className={styles.primaryButton} disabled={isWriting} onClick={onWrite} type="button">
        {isWriting ? 'Writing…' : `Write ${pluralise(pendingPlans.size, 'CTASK fix', 'CTASK fixes')} to ServiceNow`}
      </button>
    </div>
  );
}

/** Risk check, fix and re-check for an existing change together with every one of its CTASKs. */
export function ExistingChgRiskCheck({
  changeSysId,
  changeConfigItem,
  promptContext,
  fieldValues,
  onApplyChangeFields,
}: ExistingChgRiskCheckProps) {
  const { isUnlocked } = useAiAssist();
  const [ctasks, setCtasks] = useState<ReviewedCtask[]>([]);
  const [attachmentFileNames, setAttachmentFileNames] = useState<string[]>([]);
  // The stories read, with the keys they were read for — stories for keys the change no longer names are not used.
  const [loadedStories, setLoadedStories] = useState<{ storyKeysText: string; stories: JiraIssue[] }>({
    storyKeysText: '',
    stories: [],
  });
  const [reviewText, setReviewText] = useState<string | null>(null);
  const [isReviewOutOfDate, setIsReviewOutOfDate] = useState(false);
  const [pendingPlans, setPendingPlans] = useState<Map<string, string>>(new Map());
  const [promptSession, setPromptSession] = useState<AiAssistPromptSession | null>(null);
  const [isWriting, setIsWriting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const ruleFindings = useMemo(() => checkCtaskRules(ctasks, changeConfigItem), [ctasks, changeConfigItem]);
  const misalignedTasks = ctasks.filter((ctask) =>
    ruleFindings.some((finding) => finding.status === 'GAP' && readCtaskFindingTarget(finding.field)?.ctaskNumber === ctask.number
      && readCtaskFindingTarget(finding.field)?.aspect === 'configItem'));

  // Reads the tasks fresh from ServiceNow and returns them, so a round can work on what is there right now.
  const reloadCtasks = useCallback(async (): Promise<ReviewedCtask[]> => {
    try {
      const freshTasks = await fetchReviewedCtasks(changeSysId);
      setCtasks(freshTasks);
      return freshTasks;
    } catch (loadError) {
      setErrorMessage(loadError instanceof Error ? loadError.message : 'Could not read the change tasks.');
      return [];
    }
  }, [changeSysId]);

  // The first read when the check opens; a change switched away from mid-read is not written into this one.
  useEffect(() => {
    let isStale = false;
    fetchReviewedCtasks(changeSysId)
      .then((loadedTasks) => {
        if (!isStale) setCtasks(loadedTasks);
      })
      .catch((loadError: unknown) => {
        if (!isStale) setErrorMessage(loadError instanceof Error ? loadError.message : 'Could not read the change tasks.');
      });
    return () => {
      isStale = true;
    };
  }, [changeSysId]);

  // The files on the change — the test evidence Release Management attached. A failed read only leaves them out.
  useEffect(() => {
    let isStale = false;
    fetchChangeAttachmentFileNames(changeSysId)
      .then((fileNames) => {
        if (!isStale) setAttachmentFileNames(fileNames);
      })
      .catch(() => undefined);
    return () => {
      isStale = true;
    };
  }, [changeSysId]);

  // The Jira keys the change's text names, as one string so the stories are read again only when the keys change.
  const storyKeysText = useMemo(() => findJiraKeysInChangeText(Object.values(fieldValues)).join(','), [fieldValues]);
  const jiraStories = useMemo(
    () => (loadedStories.storyKeysText === storyKeysText ? loadedStories.stories : []),
    [loadedStories, storyKeysText],
  );

  // Reads the named stories; a change switched away from mid-read is not written into this one.
  useEffect(() => {
    if (storyKeysText === '') {
      return undefined;
    }
    let isStale = false;
    void fetchChangeJiraStories(storyKeysText.split(',')).then((stories) => {
      if (!isStale) setLoadedStories({ storyKeysText, stories });
    });
    return () => {
      isStale = true;
    };
  }, [storyKeysText]);

  // Writes one fix per task, one at a time, and reports any that ServiceNow refused.
  const writeTaskFixes = useCallback(async (fixes: Array<{ ctask: ReviewedCtask; fix: Parameters<typeof saveCtaskFix>[1] }>) => {
    const failedNumbers: string[] = [];
    for (const { ctask, fix } of fixes) {
      try {
        await saveCtaskFix(ctask, fix);
      } catch {
        failedNumbers.push(ctask.number);
      }
    }
    setErrorMessage(failedNumbers.length > 0 ? `ServiceNow did not accept the fix for ${failedNumbers.join(', ')}.` : '');
    return failedNumbers;
  }, []);

  const handleSetConfigItems = useCallback(async () => {
    setIsWriting(true);
    await writeTaskFixes(misalignedTasks.map((ctask) => ({ ctask, fix: { configItemSysId: changeConfigItem.sysId } })));
    const freshTasks = await reloadCtasks();
    setReviewText((currentReview) => (currentReview === null
      ? null
      : composeReviewWithRules(currentReview, checkCtaskRules(freshTasks, changeConfigItem))));
    setStatusMessage(`Set the CI on ${pluralise(misalignedTasks.length, 'task', 'tasks')} to ${changeConfigItem.displayName}.`);
    setIsWriting(false);
  }, [misalignedTasks, changeConfigItem, writeTaskFixes, reloadCtasks]);

  const handleOpenRiskCheck = useCallback(() => {
    setPromptSession({
      instructions: 'Copy this prompt into AI Assist to check the change AND every CTASK against the Release Manager\'s '
        + 'rules, then paste the reply below — one review covers them all.',
      promptText: buildChgRiskCheckPrompt(withTaskLines(promptContext, ctasks, jiraStories, attachmentFileNames), fieldValues, buildCtaskCheckPart(ctasks)),
      applyButtonLabel: 'Use this review',
      applyReply: (replyText) => {
        const { reviewText: pastedReview, revisedFieldsText } = splitRiskCheckReply(replyText);
        if (!pastedReview && !revisedFieldsText) {
          return { statusMessage: 'The pasted review is empty.', wasApplied: false };
        }
        setReviewText(applyTeamStandards(composeReviewWithRules(pastedReview, ruleFindings), readTaskDurationEstimates(ctasks), undefined, promptContext.changeOwnerLabel));
        const correctedCount = revisedFieldsText ? onApplyChangeFields(pickChangeFields(revisedFieldsText, resolveFixableFields([]))) : 0;
        setIsReviewOutOfDate(correctedCount > 0);
        return { statusMessage: 'Review captured — it is shown below the CTASK checks.', wasApplied: true };
      },
    });
  }, [promptContext, ctasks, jiraStories, attachmentFileNames, fieldValues, ruleFindings, onApplyChangeFields]);

  const handleOpenFixRound = useCallback(() => {
    // The gaps, plus every question for the owner — the assistant asks those in its own chat, then writes them in.
    const { changeGaps, backoutGaps } = readOpenGaps(reviewText ?? '', (finding) => isOpenFinding(finding) || finding.status === 'INFO');
    if (changeGaps.length === 0 && backoutGaps.length === 0) {
      setStatusMessage('Only CI gaps are left — use the Set CI button.');
      return;
    }
    const askedNumbers = backoutGaps.map((gap) => readCtaskFindingTarget(gap.field)?.ctaskNumber ?? '');
    setPromptSession({
      instructions: 'Copy this prompt into AI Assist to rewrite what closes the gaps, then paste the reply below — change '
        + 'fields go into this form, CTASK backout plans are staged for you to write to ServiceNow.',
      promptText: buildChgGapFixPrompt(withTaskLines(promptContext, ctasks, jiraStories, attachmentFileNames), fieldValues, changeGaps,
        backoutGaps.length > 0 ? buildCtaskFixPart(ctasks, backoutGaps) : undefined),
      applyButtonLabel: 'Apply the fixes',
      applyReply: (replyText) => {
        const { backoutPlansByNumber, changeReplyText } = parseCtaskBackoutReply(replyText, askedNumbers);
        const changeFields = changeGaps.length > 0 ? pickChangeFields(changeReplyText, resolveFixableFields(changeGaps)) : {};
        const changeFieldCount = Object.keys(changeFields).length > 0 ? onApplyChangeFields(changeFields) : 0;
        if (changeFieldCount === 0 && backoutPlansByNumber.size === 0) {
          return { statusMessage: 'No fixes were recognised in the pasted reply.', wasApplied: false };
        }
        setPendingPlans((currentPlans) => new Map([...currentPlans, ...backoutPlansByNumber]));
        setIsReviewOutOfDate(true);
        return {
          statusMessage: `Fixed ${pluralise(changeFieldCount, 'change field', 'change fields')} and staged `
            + `${pluralise(backoutPlansByNumber.size, 'CTASK backout plan', 'CTASK backout plans')} — write them, save the change, then Check again.`,
          wasApplied: true,
        };
      },
    });
  }, [reviewText, promptContext, ctasks, jiraStories, attachmentFileNames, fieldValues, onApplyChangeFields]);

  // Writes every staged backout plan, then reads the tasks back to prove each one stuck. A plan ServiceNow accepted
  // but did not keep (a read-only field) is named, rather than left to fail the next check without a reason.
  const writePendingPlans = useCallback(async (): Promise<ReviewedCtask[]> => {
    const fixes = [...pendingPlans.entries()]
      .map(([ctaskNumber, backoutPlan]) => ({ ctask: ctasks.find((ctask) => ctask.number === ctaskNumber), fix: { backoutPlan } }))
      .filter((entry): entry is { ctask: ReviewedCtask; fix: { backoutPlan: string } } => entry.ctask !== undefined);
    const failedNumbers = await writeTaskFixes(fixes);
    setPendingPlans((currentPlans) => new Map([...currentPlans].filter(([ctaskNumber]) => failedNumbers.includes(ctaskNumber))));
    const freshTasks = await reloadCtasks();
    const unkeptNumbers = fixes
      .map(({ ctask }) => ctask.number)
      .filter((ctaskNumber) => !failedNumbers.includes(ctaskNumber))
      .filter((ctaskNumber) => (freshTasks.find((freshTask) => freshTask.number === ctaskNumber)?.backoutPlan ?? '').trim() === '');
    if (unkeptNumbers.length > 0) {
      setErrorMessage(`ServiceNow did not keep the backout plan on ${unkeptNumbers.join(', ')} — the write was accepted but `
        + 'the field reads back empty. Check that field on the CTASK in ServiceNow.');
    }
    const keptCount = fixes.length - failedNumbers.length - unkeptNumbers.length;
    setStatusMessage(`Wrote ${pluralise(keptCount, 'CTASK fix', 'CTASK fixes')} to ServiceNow.`);
    // The task rules are re-judged from what ServiceNow now holds, so a fixed task's gap closes at once.
    setReviewText((currentReview) => (currentReview === null
      ? null
      : composeReviewWithRules(currentReview, checkCtaskRules(freshTasks, changeConfigItem))));
    return freshTasks;
  }, [pendingPlans, ctasks, writeTaskFixes, reloadCtasks, changeConfigItem]);

  const handleWritePendingPlans = useCallback(async () => {
    setIsWriting(true);
    await writePendingPlans();
    setIsWriting(false);
  }, [writePendingPlans]);

  const handleCheckAgain = useCallback(async () => {
    // Staged backout plans are written first: re-checking what ServiceNow holds without them only finds the same gap.
    const freshTasks = pendingPlans.size > 0 ? await writePendingPlans() : await reloadCtasks();
    const freshRules = checkCtaskRules(freshTasks, changeConfigItem);
    const baseReview = composeReviewWithRules(reviewText ?? '', freshRules);
    // Questions for the owner (INFO) and form fields (RECORD) are re-judged too, so an answered one can close.
    const { changeGaps, backoutGaps } = readOpenGaps(baseReview, isUnsettledFinding);
    if (changeGaps.length === 0 && backoutGaps.length === 0) {
      setReviewText(baseReview);
      setIsReviewOutOfDate(false);
      setStatusMessage('Re-checked the CTASK rules — nothing is left for AI Assist to judge.');
      return;
    }
    setPromptSession({
      instructions: 'Copy this prompt into AI Assist to re-check just the open gaps, then paste the reply below.',
      promptText: buildGapRecheckPrompt(withTaskLines(promptContext, freshTasks, jiraStories, attachmentFileNames), fieldValues, changeGaps,
        backoutGaps.length > 0 ? buildCtaskRecheckPart(freshTasks, backoutGaps) : undefined),
      applyButtonLabel: 'Use this re-check',
      applyReply: (replyText) => {
        const { closedCount, stillOpenCount } = countRecheckOutcome(replyText);
        if (closedCount + stillOpenCount === 0) {
          return { statusMessage: 'No PASS / GAP lines found in the pasted re-check.', wasApplied: false };
        }
        setReviewText(applyTeamStandards(
          composeReviewWithRules(mergeRecheckIntoReview(baseReview, replyText), freshRules),
          readTaskDurationEstimates(freshTasks),
          undefined,
          promptContext.changeOwnerLabel,
        ));
        setIsReviewOutOfDate(false);
        return { statusMessage: `Re-checked: ${closedCount} closed, ${stillOpenCount} still open.`, wasApplied: true };
      },
    });
  }, [pendingPlans, writePendingPlans, reloadCtasks, changeConfigItem, reviewText, promptContext, jiraStories, attachmentFileNames, fieldValues]);

  return (
    <section className={styles.section}>
      <div className={styles.clonePanel}>
        <h4 className={styles.panelSectionTitle}>Risk check — this change and its CTASKs</h4>
        <p className={styles.panelHint}>
          {`Every CTASK must be on the change's CI${changeConfigItem.displayName ? ` (${changeConfigItem.displayName})` : ''}, `
            + 'and every implementation CTASK needs a detailed backout plan.'}
        </p>
        {jiraStories.length > 0 ? (
          <p className={styles.panelHint}>
            {`Read ${pluralise(jiraStories.length, 'Jira story', 'Jira stories')} named in the change: `
              + `${jiraStories.map((story) => story.key).join(', ')} — the risk check is given them in full.`}
          </p>
        ) : null}
        <CtaskRuleSummary ruleFindings={ruleFindings} />
        <div className={styles.buttonRow}>
          {misalignedTasks.length > 0 && changeConfigItem.sysId ? (
            <button className={styles.primaryButton} disabled={isWriting} onClick={() => void handleSetConfigItems()} type="button">
              {`Set CI to ${changeConfigItem.displayName} on ${pluralise(misalignedTasks.length, 'task', 'tasks')}`}
            </button>
          ) : null}
          {isUnlocked ? (
            <button className={styles.aiAssistButton} disabled={isWriting} onClick={handleOpenRiskCheck} type="button">
              Risk check CHG + CTASKs with AI Assist
            </button>
          ) : null}
          <button className={styles.secondaryButton} disabled={isWriting} onClick={() => void reloadCtasks()} type="button">
            ↻ Reload CTASKs
          </button>
        </div>
        <PendingCtaskFixes isWriting={isWriting} onWrite={() => void handleWritePendingPlans()} pendingPlans={pendingPlans} />
        {reviewText !== null ? (
          <RiskCheckReviewPanel
            fieldValues={fieldValues}
            isOutOfDate={isReviewOutOfDate}
            onCheckAgain={isUnlocked ? () => void handleCheckAgain() : undefined}
            onFixGaps={isUnlocked ? handleOpenFixRound : undefined}
            reviewText={reviewText}
          />
        ) : null}
        {errorMessage ? <p className={styles.errorText} role="alert">{errorMessage}</p> : null}
        {statusMessage ? <p className={styles.successText}>{statusMessage}</p> : null}
      </div>
      {promptSession !== null ? (
        <AiAssistPromptModal key={promptSession.promptText} onClose={() => setPromptSession(null)} session={promptSession} />
      ) : null}
    </section>
  );
}
