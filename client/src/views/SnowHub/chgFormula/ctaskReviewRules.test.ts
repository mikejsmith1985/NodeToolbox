// ctaskReviewRules.test.ts — The CTASK rules Toolbox checks itself, and how they join the AI review (GH #395).

import { describe, expect, it } from 'vitest';

import type { ReviewedCtask } from './ctaskReviewRecord.ts';
import {
  buildCtaskFindingField,
  checkCtaskRules,
  composeReviewWithRules,
  readCtaskFindingTarget,
} from './ctaskReviewRules.ts';
import { parseRiskCheckReview } from './riskCheckReview.ts';

const CHANGE_CI = { sysId: 'ci-recon', displayName: 'Recon Service' };

function buildCtask(overrides: Partial<ReviewedCtask> = {}): ReviewedCtask {
  return {
    sysId: 'task-1',
    number: 'CTASK0012345',
    shortDescription: 'Deploy recon service',
    description: '',
    typeLabel: 'Implementation',
    isImplementation: true,
    assignedTo: { sysId: 'usr-1', displayName: 'Jane Smith' },
    assignmentGroup: { sysId: 'grp-1', displayName: 'Platform Team' },
    configItem: CHANGE_CI,
    backoutPlan: 'Redeploy v1.4 from the pipeline, then confirm the health check.',
    backoutFieldName: 'u_backout_plan',
    ...overrides,
  };
}

describe('CTASK finding names', () => {
  it('name the task and the aspect, and read back to both', () => {
    expect(buildCtaskFindingField('CTASK0012345', 'backoutPlan')).toBe('CTASK0012345 · Backout plan');
    expect(readCtaskFindingTarget('CTASK0012345 · Configuration item')).toEqual({ ctaskNumber: 'CTASK0012345', aspect: 'configItem' });
    expect(readCtaskFindingTarget('ctask0012345 - backout plan')).toEqual({ ctaskNumber: 'CTASK0012345', aspect: 'backoutPlan' });
    expect(readCtaskFindingTarget('Backout Plan')).toBeNull();
  });
});

describe('checkCtaskRules', () => {
  it('passes a task whose CI is the change\'s', () => {
    expect(checkCtaskRules([buildCtask()], CHANGE_CI)).toEqual([
      expect.objectContaining({ status: 'PASS', field: 'CTASK0012345 · Configuration item' }),
    ]);
  });

  it('flags a task on another CI, with the change\'s CI as the fix', () => {
    const [finding] = checkCtaskRules([buildCtask({ configItem: { sysId: 'ci-other', displayName: 'Billing' } })], CHANGE_CI);

    expect(finding).toEqual(expect.objectContaining({ status: 'GAP', field: 'CTASK0012345 · Configuration item' }));
    expect(finding.detail).toContain('Billing');
    expect(finding.fix).toContain('Recon Service');
  });

  it('flags a task with no CI', () => {
    expect(checkCtaskRules([buildCtask({ configItem: { sysId: '', displayName: '' } })], CHANGE_CI)[0].status).toBe('GAP');
  });

  it('flags an implementation task with no backout plan, but not a testing task', () => {
    const findings = checkCtaskRules([
      buildCtask({ backoutPlan: '' }),
      buildCtask({ number: 'CTASK0012346', isImplementation: false, backoutPlan: '' }),
    ], CHANGE_CI);

    expect(findings.filter((finding) => finding.field.endsWith('Backout plan'))).toEqual([
      expect.objectContaining({ status: 'GAP', field: 'CTASK0012345 · Backout plan' }),
    ]);
  });

  it('says the change itself needs a CI when it has none to match', () => {
    const [finding] = checkCtaskRules([buildCtask()], { sysId: '', displayName: '' });

    expect(finding.status).toBe('GAP');
    expect(finding.detail).toMatch(/change has no configuration item/i);
  });
});

describe('composeReviewWithRules', () => {
  it('adds the rule findings to the AI review and recounts the verdict', () => {
    const aiReview = 'PASS | Backout Plan — clear.\nGAP | CTASK0012345 · Backout plan — no restore check.\nVERDICT: NOT READY — 1 gap(s).';
    const ruleFindings = checkCtaskRules([buildCtask({ configItem: { sysId: 'ci-other', displayName: 'Billing' } })], CHANGE_CI);

    const review = parseRiskCheckReview(composeReviewWithRules(aiReview, ruleFindings));

    expect(review.findings.map((finding) => `${finding.status} ${finding.field}`)).toEqual([
      'PASS Backout Plan',
      'GAP CTASK0012345 · Backout plan',
      'GAP CTASK0012345 · Configuration item',
    ]);
    expect(review.verdict).toBe('NOT READY — 2 gap(s).');
  });

  it('lets the rules, not the AI, decide a CTASK\'s CI', () => {
    const aiReview = 'GAP | CTASK0012345 · Configuration item — looks wrong.\nVERDICT: NOT READY — 1 gap(s).';

    const review = parseRiskCheckReview(composeReviewWithRules(aiReview, checkCtaskRules([buildCtask()], CHANGE_CI)));

    expect(review.findings).toEqual([expect.objectContaining({ status: 'PASS', field: 'CTASK0012345 · Configuration item' })]);
    expect(review.isReady).toBe(true);
  });
});
