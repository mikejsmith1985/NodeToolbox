// crgTemplateData.ts — Builds the reusable snapshot of a change draft that a saved change template stores.
//
// Shared by Toolbox's Create CHG tab and the SNow Wizard so both save templates with the very same fields.

import type { CrgTemplate, useCrgState } from './useCrgState.ts';

/** The parts of a change draft a template is built from. */
export type CrgTemplateSourceState = Pick<
  ReturnType<typeof useCrgState>['state'],
  'shortDescriptionConfig' | 'chgBasicInfo' | 'chgPlanningAssessment' | 'chgPlanningContent' | 'customSnowFields'
  | 'relEnvironment' | 'prdEnvironment' | 'pfixEnvironment' | 'ctaskTemplateIds' | 'reconcileAutoCtasks'
>;

/** The template's values without its identity (id, name, created date). */
export type CrgTemplateData = Omit<CrgTemplate, 'id' | 'name' | 'createdAt'>;

/** The values a template keeps from the draft in hand, ready for saveTemplate / updateTemplate. */
export function buildCurrentTemplateData(state: CrgTemplateSourceState): CrgTemplateData {
  return {
    shortDescriptionConfig: state.shortDescriptionConfig,
    chgBasicInfo:          state.chgBasicInfo,
    chgPlanningAssessment: state.chgPlanningAssessment,
    chgPlanningContent:    state.chgPlanningContent,
    customSnowFields:      state.customSnowFields,
    relEnvironment:        state.relEnvironment,
    prdEnvironment:        state.prdEnvironment,
    pfixEnvironment:       state.pfixEnvironment,
    ctaskTemplateIds:      state.ctaskTemplateIds ?? [],
    reconcileAutoCtasks:   state.reconcileAutoCtasks ?? false,
  };
}
