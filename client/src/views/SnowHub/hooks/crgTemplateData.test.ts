// crgTemplateData.test.ts — Proves a change template snapshot keeps exactly the reusable parts of a draft.

import { describe, expect, it } from 'vitest';

import { buildCurrentTemplateData, type CrgTemplateSourceState } from './crgTemplateData.ts';

const EMPTY_REFERENCE = { sysId: '', displayName: '' };
const ENVIRONMENT = { isEnabled: true, plannedStartDate: '', plannedEndDate: '', configItem: EMPTY_REFERENCE } as unknown as CrgTemplateSourceState['relEnvironment'];

function buildSourceState(overrides: Partial<CrgTemplateSourceState> = {}): CrgTemplateSourceState {
  return {
    shortDescriptionConfig: { application: 'Payments', team: 'Blue', changeDetailsOverride: '' },
    chgBasicInfo: { category: 'software' } as CrgTemplateSourceState['chgBasicInfo'],
    chgPlanningAssessment: { impact: '3' } as CrgTemplateSourceState['chgPlanningAssessment'],
    chgPlanningContent: { implementationPlan: 'Deploy' } as CrgTemplateSourceState['chgPlanningContent'],
    customSnowFields: { extra: 'value' },
    relEnvironment: ENVIRONMENT,
    prdEnvironment: ENVIRONMENT,
    pfixEnvironment: ENVIRONMENT,
    ctaskTemplateIds: ['ctask-1'],
    reconcileAutoCtasks: true,
    ...overrides,
  };
}

describe('buildCurrentTemplateData', () => {
  it('copies the reusable parts of the draft', () => {
    const sourceState = buildSourceState();
    const templateData = buildCurrentTemplateData(sourceState);
    expect(templateData.chgBasicInfo).toBe(sourceState.chgBasicInfo);
    expect(templateData.chgPlanningContent).toBe(sourceState.chgPlanningContent);
    expect(templateData.ctaskTemplateIds).toEqual(['ctask-1']);
    expect(templateData.reconcileAutoCtasks).toBe(true);
    expect(Object.keys(templateData)).not.toContain('id');
  });

  it('falls back to no linked tasks and no reconcile when the draft predates them', () => {
    const templateData = buildCurrentTemplateData(buildSourceState({
      ctaskTemplateIds: undefined as unknown as string[], reconcileAutoCtasks: undefined as unknown as boolean,
    }));
    expect(templateData.ctaskTemplateIds).toEqual([]);
    expect(templateData.reconcileAutoCtasks).toBe(false);
  });
});
