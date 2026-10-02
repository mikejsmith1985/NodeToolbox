// ctaskReviewPrompt.test.ts — The CTASK parts of the risk-check loop's prompts, and reading their replies (GH #395).

import { describe, expect, it } from 'vitest';

import { buildGapRecheckPrompt } from './gapFocus.ts';
import { buildChgGapFixPrompt } from './chgGapFixPrompt.ts';
import { buildChgRiskCheckPrompt } from './chgRiskCheckPrompt.ts';
import type { ChgPromptContext } from './chgPromptContext.ts';
import type { ReviewedCtask } from './ctaskReviewRecord.ts';
import {
  buildCtaskCheckPart,
  buildCtaskFixPart,
  buildCtaskRecheckPart,
  parseCtaskBackoutReply,
} from './ctaskReviewPrompt.ts';
import type { RiskCheckFinding } from './riskCheckReview.ts';

const CONTEXT: ChgPromptContext = {
  categoryLabel: 'Software',
  changeTypeLabel: 'Normal',
  isExpedited: false,
  configItemLabel: 'Recon Service',
  assignmentGroupLabel: 'Cleanup Crew',
  changeOwnerLabel: 'Smith, Mike',
  environmentLines: [],
  assessmentLines: [],
  changeTaskLines: [],
};
const FIELDS = {
  shortDescription: 'Recon | deploy v1.5 | REL',
  description: 'Deploys v1.5.',
  justification: 'Fixes LIS mismatch.',
  riskImpact: 'Low.',
  implementationPlan: 'Run pipeline.',
  testPlan: 'Smoke test.',
  backoutPlan: 'Redeploy v1.4.',
};

function buildCtask(overrides: Partial<ReviewedCtask> = {}): ReviewedCtask {
  return {
    sysId: 'task-1',
    number: 'CTASK0012345',
    shortDescription: 'Deploy recon service',
    description: 'Run the pipeline.',
    typeLabel: 'Implementation',
    isImplementation: true,
    configItem: { sysId: 'ci-recon', displayName: 'Recon Service' },
    backoutPlan: 'Revert.',
    backoutFieldName: 'u_backout_plan',
    ...overrides,
  };
}

const BACKOUT_GAP: RiskCheckFinding = {
  status: 'GAP', field: 'CTASK0012345 · Backout plan', detail: 'only says "Revert."', fix: 'Name the steps.',
};

describe('the risk check with change tasks', () => {
  it('lists every task and asks for one backout line per implementation task only', () => {
    const prompt = buildChgRiskCheckPrompt(CONTEXT, FIELDS, buildCtaskCheckPart([
      buildCtask(),
      buildCtask({ number: 'CTASK0012346', isImplementation: false, typeLabel: 'Testing', shortDescription: 'Smoke test' }),
    ]));

    expect(prompt).toContain('CTASK0012345 — Deploy recon service');
    expect(prompt).toContain('CTASK0012346 — Smoke test');
    expect(prompt).toContain('CTASK0012345 · Backout plan');
    expect(prompt).not.toContain('CTASK0012346 · Backout plan');
    expect(prompt).toMatch(/do not judge configuration items/i);
  });

  it('leaves the change-only prompt exactly as it was when there are no tasks', () => {
    expect(buildChgRiskCheckPrompt(CONTEXT, FIELDS, buildCtaskCheckPart([]))).toBe(buildChgRiskCheckPrompt(CONTEXT, FIELDS));
  });
});

describe('the fix round with change tasks', () => {
  it('asks only for the gap tasks\' backout plans when no change field has a gap', () => {
    const prompt = buildChgGapFixPrompt(CONTEXT, FIELDS, [], buildCtaskFixPart([buildCtask()], [BACKOUT_GAP]));

    expect(prompt).toContain('CTASK0012345_BACKOUT_PLAN:');
    expect(prompt).toContain('Revert.');
    expect(prompt).not.toContain('SHORT_DESCRIPTION:');
    expect(prompt).not.toContain('Short Description:');
  });

  it('asks for the change field and the task together when both have gaps', () => {
    const changeGap: RiskCheckFinding = { status: 'GAP', field: 'Backout Plan', detail: 'no timing', fix: '' };
    const prompt = buildChgGapFixPrompt(CONTEXT, FIELDS, [changeGap], buildCtaskFixPart([buildCtask()], [BACKOUT_GAP]));

    expect(prompt.indexOf('BACKOUT_PLAN:')).toBeLessThan(prompt.indexOf('CTASK0012345_BACKOUT_PLAN:'));
    expect(prompt).toContain('- CTASK0012345 · Backout plan');
  });
});

describe('the re-check with change tasks', () => {
  it('re-checks a task\'s backout plan against the backout rule', () => {
    const prompt = buildGapRecheckPrompt(CONTEXT, FIELDS, [], buildCtaskRecheckPart([buildCtask({ backoutPlan: 'Redeploy v1.4 via pipeline.' })], [BACKOUT_GAP]));

    expect(prompt).toContain('- CTASK0012345 · Backout plan');
    expect(prompt).toContain('Redeploy v1.4 via pipeline.');
    expect(prompt).toMatch(/restore/i);
  });
});

describe('parseCtaskBackoutReply', () => {
  it('reads each task\'s plan and hands the rest back for the change fields', () => {
    const reply = '```text\nBACKOUT_PLAN:\nRedeploy v1.4.\nCTASK0012345_BACKOUT_PLAN:\n1. Stop the job.\n2. Redeploy v1.4.\n```';

    const { backoutPlansByNumber, changeReplyText } = parseCtaskBackoutReply(reply, ['CTASK0012345']);

    expect(backoutPlansByNumber.get('CTASK0012345')).toBe('1. Stop the job.\n2. Redeploy v1.4.');
    expect(changeReplyText.trim()).toBe('BACKOUT_PLAN:\nRedeploy v1.4.');
  });

  it('recovers a flattened reply and ignores tasks it was not asked about', () => {
    const reply = 'CTASK0012345_BACKOUT_PLAN: Stop the job. CTASK0099999_BACKOUT_PLAN: Not mine.';

    const { backoutPlansByNumber } = parseCtaskBackoutReply(reply, ['CTASK0012345']);

    expect([...backoutPlansByNumber.entries()]).toEqual([['CTASK0012345', 'Stop the job.']]);
  });
});
