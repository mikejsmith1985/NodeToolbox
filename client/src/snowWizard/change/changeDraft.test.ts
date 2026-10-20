// changeDraft.test.ts — Proves how the wizard reads a change draft: gaps per step, environments, text fields, writes.

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCrgState } from '../../views/SnowHub/hooks/useCrgState.ts';
import {
  applyChangeTextField,
  buildEnvironmentValueByKey,
  hasProductionEnvironment,
  readChangeTextFields,
  readDetailsGaps,
  readEnabledPlanEnvironments,
  readEnvironmentProblems,
  readPlanningGaps,
  readProductionEnvironmentKey,
  readSelectedIssues,
  type CrgDraftState,
} from './changeDraft.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

/** A blank draft straight from the real hook, so the reader is tested against the real state shape. */
function readBlankDraft(): CrgDraftState {
  return renderHook(() => useCrgState({ storageKey: 'snowWizard:change:draft-test' })).result.current.state;
}

const SAMPLE_REFERENCE = { sysId: 'sys-1', displayName: 'Someone' };

describe('readDetailsGaps', () => {
  it('names every required value in plain words', () => {
    expect(readDetailsGaps(readBlankDraft())).toEqual([
      'a title', 'a category', 'a change type', 'an assignment group', 'an owner', 'a configuration item',
    ]);
  });

  it('is empty once each is set', () => {
    const draft = readBlankDraft();
    const completeDraft: CrgDraftState = {
      ...draft,
      generatedShortDescription: 'Release 1.2',
      chgBasicInfo: { ...draft.chgBasicInfo, category: 'software', changeType: 'normal', assignmentGroup: SAMPLE_REFERENCE, assignedTo: SAMPLE_REFERENCE, configItem: SAMPLE_REFERENCE },
    };
    expect(readDetailsGaps(completeDraft)).toEqual([]);
  });
});

describe('readPlanningGaps', () => {
  it('names each empty plan', () => {
    const draft = readBlankDraft();
    expect(readPlanningGaps({ ...draft, chgPlanningContent: { implementationPlan: '1. Deploy', backoutPlan: ' ', testPlan: '' } }))
      .toEqual(['the backout plan', 'the test plan']);
  });
});

describe('environments', () => {
  it('asks for at least one environment', () => {
    expect(readEnvironmentProblems(readBlankDraft())).toEqual(['Tick at least one environment.']);
  });

  it('asks for both dates and an end after the start', () => {
    const draft = readBlankDraft();
    const problems = readEnvironmentProblems({
      ...draft,
      relEnvironment: { ...draft.relEnvironment, isEnabled: true, plannedStartDate: '2026-11-01T08:00', plannedEndDate: '' },
      prdEnvironment: { ...draft.prdEnvironment, isEnabled: true, plannedStartDate: '2026-11-02T09:00', plannedEndDate: '2026-11-02T08:00' },
    });
    expect(problems[0]).toBe('REL needs a start and an end.');
    expect(problems[1]).toMatch(/^PRD: the planned end date is on or before/);
  });

  it('lists enabled environments and spots Production', () => {
    const draft = readBlankDraft();
    const twoEnvironmentDraft = {
      ...draft,
      relEnvironment: { ...draft.relEnvironment, isEnabled: true },
      pfixEnvironment: { ...draft.pfixEnvironment, isEnabled: true },
    };
    expect(readEnabledPlanEnvironments(twoEnvironmentDraft)).toEqual(['REL', 'PFIX']);
    expect(hasProductionEnvironment(twoEnvironmentDraft)).toBe(true);
    expect(readProductionEnvironmentKey(twoEnvironmentDraft)).toBe('pfix');
    expect(hasProductionEnvironment({ ...draft, relEnvironment: { ...draft.relEnvironment, isEnabled: true } })).toBe(false);
  });
});

describe('text fields', () => {
  it('reads the seven texts and writes each back through the hook\'s own setter', () => {
    const draft = readBlankDraft();
    const textFields = readChangeTextFields({ ...draft, generatedJustification: 'Because', chgPlanningContent: { ...draft.chgPlanningContent, testPlan: 'Test it' } });
    expect(textFields.justification).toBe('Because');
    expect(textFields.testPlan).toBe('Test it');

    const actions = { updateGeneratedField: vi.fn(), setChgPlanningContent: vi.fn() };
    applyChangeTextField(actions, 'riskImpact', 'Low');
    applyChangeTextField(actions, 'backoutPlan', 'Roll back');
    expect(actions.updateGeneratedField).toHaveBeenCalledWith('riskImpact', 'Low');
    expect(actions.setChgPlanningContent).toHaveBeenCalledWith({ backoutPlan: 'Roll back' });
  });

  it('reads only the chosen issues', () => {
    const draft = readBlankDraft();
    const issues = [{ key: 'ABC-1' }, { key: 'ABC-2' }] as CrgDraftState['fetchedIssues'];
    expect(readSelectedIssues({ ...draft, fetchedIssues: issues, selectedIssueKeys: new Set(['ABC-2']) }).map((issue) => issue.key)).toEqual(['ABC-2']);
  });
});

describe('buildEnvironmentValueByKey', () => {
  it("picks each card's value from ServiceNow's own list, first match winning", () => {
    expect(buildEnvironmentValueByKey([
      { value: 'pre_prod', label: 'Pre-Production Release' },
      { value: 'production', label: 'Production' },
      { value: 'prod_fix', label: 'Production Fix' },
      { value: 'prod2', label: 'Production 2' },
    ])).toEqual({ rel: 'pre_prod', prd: 'production', pfix: 'prod_fix' });
  });
});
