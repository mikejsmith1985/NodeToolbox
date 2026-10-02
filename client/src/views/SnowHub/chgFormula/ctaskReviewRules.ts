// ctaskReviewRules.ts — The CTASK rules Toolbox checks itself, and how they join the AI review (GH #395).
//
// Two rules hold for every change task: its configuration item must be the change's, and an implementation
// task must carry a backout plan. Whether a CI matches is a fact Toolbox can read straight off the records, so
// it is never asked of the assistant — rules outrank the AI. Only whether a backout plan is DETAILED enough
// needs judgement; the assistant answers that, and these findings are folded into its review.

import type { SnowReference } from '../hooks/useCrgState.ts';
import type { ReviewedCtask } from './ctaskReviewRecord.ts';
import { renderReviewText } from './gapFocus.ts';
import { parseRiskCheckReview, type RiskCheckFinding } from './riskCheckReview.ts';

/** What part of a change task a finding is about. */
export type CtaskFindingAspect = 'configItem' | 'backoutPlan';

/** Which task and which part of it a finding names. */
export interface CtaskFindingTarget {
  ctaskNumber: string;
  aspect: CtaskFindingAspect;
}

const ASPECT_LABELS: Readonly<Record<CtaskFindingAspect, string>> = {
  configItem: 'Configuration item',
  backoutPlan: 'Backout plan',
};
// A finding's field as an assistant may write it: the task number, any separator, then the aspect.
const CTASK_FINDING_FIELD_PATTERN = /^\s*(CTASK\d+)\s*[·:|—–-]*\s*(.*)$/i;
const BACKOUT_FIX_TEXT =
  'Write the steps that restore the previous state, who runs them, how long they take, and how the restore is verified.';

/** "CTASK0012345 · Backout plan" — the name a CTASK finding carries, so a gap points at one task's one field. */
export function buildCtaskFindingField(ctaskNumber: string, aspect: CtaskFindingAspect): string {
  return `${ctaskNumber} · ${ASPECT_LABELS[aspect]}`;
}

/** The task and aspect a finding names, or null for a finding about the change itself. */
export function readCtaskFindingTarget(findingField: string): CtaskFindingTarget | null {
  const fieldMatch = CTASK_FINDING_FIELD_PATTERN.exec(findingField);
  if (!fieldMatch) {
    return null;
  }
  const aspectText = fieldMatch[2].toLowerCase();
  const aspect: CtaskFindingAspect | null = /backout/.test(aspectText)
    ? 'backoutPlan'
    : /config|\bci\b/.test(aspectText) ? 'configItem' : null;
  return aspect ? { ctaskNumber: fieldMatch[1].toUpperCase(), aspect } : null;
}

/** True when two CIs are the same record — by sys_id when both carry one, otherwise by name. */
function isSameConfigItem(firstItem: SnowReference, secondItem: SnowReference): boolean {
  if (firstItem.sysId && secondItem.sysId) {
    return firstItem.sysId === secondItem.sysId;
  }
  const firstName = firstItem.displayName.trim().toLowerCase();
  return firstName !== '' && firstName === secondItem.displayName.trim().toLowerCase();
}

/** The CI rule for one task. */
function checkConfigItem(ctask: ReviewedCtask, changeConfigItem: SnowReference): RiskCheckFinding {
  const field = buildCtaskFindingField(ctask.number, 'configItem');
  const changeName = changeConfigItem.displayName.trim();
  if (!changeConfigItem.sysId && changeName === '') {
    return { status: 'GAP', field, detail: 'The change has no configuration item for its tasks to match.', fix: 'Set the change\'s configuration item first.' };
  }
  if (isSameConfigItem(ctask.configItem, changeConfigItem)) {
    return { status: 'PASS', field, detail: `matches the change's (${changeName}).`, fix: '' };
  }
  const taskName = ctask.configItem.displayName.trim();
  return {
    status: 'GAP',
    field,
    detail: taskName === '' ? 'has no configuration item.' : `is "${taskName}", but the change's is "${changeName}".`,
    fix: `Set it to "${changeName}".`,
  };
}

/**
 * Every rule finding for the change's tasks: a CI line per task, and a backout line for each implementation
 * task that has no plan at all. A plan that exists is left to the assistant to judge for detail.
 */
export function checkCtaskRules(ctasks: readonly ReviewedCtask[], changeConfigItem: SnowReference): RiskCheckFinding[] {
  return ctasks.flatMap((ctask) => {
    const ruleFindings: RiskCheckFinding[] = [checkConfigItem(ctask, changeConfigItem)];
    if (ctask.isImplementation && ctask.backoutPlan.trim() === '') {
      ruleFindings.push({
        status: 'GAP',
        field: buildCtaskFindingField(ctask.number, 'backoutPlan'),
        detail: 'is an implementation task with no backout plan.',
        fix: BACKOUT_FIX_TEXT,
      });
    }
    return ruleFindings;
  });
}

/** True when two findings are about the same task's same aspect. */
function isSameCtaskTarget(firstTarget: CtaskFindingTarget | null, secondTarget: CtaskFindingTarget | null): boolean {
  return firstTarget !== null && secondTarget !== null
    && firstTarget.ctaskNumber === secondTarget.ctaskNumber && firstTarget.aspect === secondTarget.aspect;
}

/**
 * The AI review with the rule findings added: any AI line about a task's CI is dropped (the rules decide
 * that), any AI line a rule finding also covers gives way to the rule, and the verdict is recounted.
 */
export function composeReviewWithRules(aiReviewText: string, ruleFindings: readonly RiskCheckFinding[]): string {
  const ruleTargets = ruleFindings.map((ruleFinding) => readCtaskFindingTarget(ruleFinding.field));
  const keptAiFindings = parseRiskCheckReview(aiReviewText).findings.filter((aiFinding) => {
    const aiTarget = readCtaskFindingTarget(aiFinding.field);
    if (aiTarget?.aspect === 'configItem') {
      return false;
    }
    return !ruleTargets.some((ruleTarget) => isSameCtaskTarget(ruleTarget, aiTarget));
  });
  return renderReviewText([...keptAiFindings, ...ruleFindings]);
}
