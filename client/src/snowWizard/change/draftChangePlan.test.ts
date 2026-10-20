// draftChangePlan.test.ts — Proves the draft's RCP verdicts and printable plan come from the draft itself.

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCrgState } from '../../views/SnowHub/hooks/useCrgState.ts';
import type { CrgDraftState } from './changeDraft.ts';
import { buildDraftChangePlan, evaluateDraftRcp, UNNUMBERED_CHANGE_LABEL } from './draftChangePlan.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

function buildDraft(isProduction: boolean): CrgDraftState {
  const draft = renderHook(() => useCrgState({ storageKey: 'snowWizard:change:plan-doc-test' })).result.current.state;
  return {
    ...draft,
    generatedShortDescription: 'Payments 1.2',
    generatedJustification: 'Regulatory deadline on 1 Dec.',
    chgPlanningContent: { implementationPlan: '1. Deploy', backoutPlan: '1. Roll back', testPlan: '1. Smoke' },
    chgBasicInfo: { ...draft.chgBasicInfo, configItem: { sysId: 'ci', displayName: 'Payments API' }, requestedBy: { sysId: 'd', displayName: 'Dana Director' } },
    prdEnvironment: { ...draft.prdEnvironment, isEnabled: isProduction, plannedStartDate: '2026-11-07T19:00', plannedEndDate: '2026-11-07T21:00' },
    changeTasks: [{ id: 't', name: 'Business Checkout', createdAt: '', shortDescription: 'Business Checkout', description: 'Check it',
      assignmentGroup: { sysId: 'g', displayName: 'Payments' }, assignedTo: { sysId: '', displayName: '' }, plannedStartDate: '', plannedEndDate: '', closeNotes: '' }],
  };
}

describe('evaluateDraftRcp', () => {
  it('judges a Production draft and gives the email its facts', () => {
    const evaluation = evaluateDraftRcp(buildDraft(true), '2026-10-20');
    expect(evaluation?.results.length).toBeGreaterThan(0);
    expect(evaluation?.emailContext).toMatchObject({ shortDescription: 'Payments 1.2', configItemName: 'Payments API', directorName: 'Dana Director', environmentLabel: 'PRD' });
  });

  it('has nothing to judge for a non-Production draft', () => {
    expect(evaluateDraftRcp(buildDraft(false), '2026-10-20')).toBeNull();
  });
});

describe('buildDraftChangePlan', () => {
  it('fills the printable plan from the draft, naming an unnumbered change plainly', () => {
    const plan = buildDraftChangePlan(buildDraft(true), '');
    expect(plan.changeNumber).toBe(UNNUMBERED_CHANGE_LABEL);
    expect(plan).toMatchObject({ shortDescription: 'Payments 1.2', environmentLabel: 'PRD', backoutPlan: '1. Roll back', configItemName: 'Payments API' });
    expect(plan.windowText).not.toBe('');
    expect(plan.tasks).toEqual([expect.objectContaining({ number: 'Business Checkout', assignmentGroupName: 'Payments', description: 'Check it' })]);
  });

  it('uses the change number of a change being modified', () => {
    expect(buildDraftChangePlan(buildDraft(false), 'CHG0001').changeNumber).toBe('CHG0001');
  });
});
