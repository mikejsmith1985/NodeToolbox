// draftReadinessFacts.test.ts — Proves the facts a change draft hands the shared readiness engine, and where each fix sends the user.

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { buildChangeReadiness, type ChangeReadinessFacts, type ReadinessAction } from '../../views/SnowHub/guided/changeReadiness.ts';
import { useCrgState } from '../../views/SnowHub/hooks/useCrgState.ts';
import type { CrgDraftState } from './changeDraft.ts';
import { buildDraftReadinessFacts, isWritingCheck, resolveFixStepId, type DraftReadinessInput } from './draftReadinessFacts.ts';
import { buildTaskFingerprint } from './modifyTasks.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

const OWNER = { sysId: 'usr-1', displayName: 'Pat Owner' };
const CONFIG_ITEM = { sysId: 'ci-1', displayName: 'Payments API' };

/** A Production draft with every text written and one staged Business Checkout task. */
function buildProductionDraft(): CrgDraftState {
  const draft = renderHook(() => useCrgState({ storageKey: 'snowWizard:change:facts-test' })).result.current.state;
  return {
    ...draft,
    generatedShortDescription: 'Payments 1.2', generatedDescription: 'What', generatedJustification: 'Why', generatedRiskImpact: 'Low',
    chgPlanningContent: { implementationPlan: '1. Deploy', backoutPlan: '1. Roll back', testPlan: '1. Smoke test' },
    chgBasicInfo: { ...draft.chgBasicInfo, assignedTo: OWNER, configItem: CONFIG_ITEM },
    prdEnvironment: { ...draft.prdEnvironment, isEnabled: true, plannedStartDate: '2026-11-02T19:00', plannedEndDate: '2026-11-02T21:00' },
    changeTasks: [{
      id: 'task-1', name: 'Business Checkout', createdAt: '', shortDescription: 'Business Checkout', description: '',
      assignmentGroup: OWNER, assignedTo: OWNER, plannedStartDate: '', plannedEndDate: '', closeNotes: '', changeTaskType: 'review',
    }],
  };
}

function buildInput(overrides: Partial<DraftReadinessInput> = {}): DraftReadinessInput {
  return {
    mode: 'create', draft: buildProductionDraft(), riskReview: { isReady: true }, isRcpRulesEnabled: false,
    todayIso: '2026-10-20', evidenceFileNames: ['results.pdf'], prbRows: [], ...overrides,
  };
}

describe('buildDraftReadinessFacts — a new change', () => {
  it('reads the owner, texts, window and environment from the draft', () => {
    const facts = buildDraftReadinessFacts(buildInput());
    expect(facts.change).toEqual({ changeNumber: '', stateLabel: '', ownerName: 'Pat Owner', configItemName: 'Payments API' });
    expect(facts.textFields?.backoutPlan).toBe('1. Roll back');
    expect(facts.isProduction).toBe(true);
    expect(facts.plannedWindow?.plannedStartUtc).toBe(new Date('2026-11-02T19:00').toISOString());
    expect(facts.attachmentFileNames).toEqual(['results.pdf']);
  });

  it('counts the outage a Production change is created with, and the staged tasks as they will be created', () => {
    const facts = buildDraftReadinessFacts(buildInput());
    expect(facts.outageCount).toBe(1);
    expect(facts.ctasks).toEqual([{ number: 'Business Checkout', isImplementation: false, isConfigItemMatching: true, hasBackoutPlan: false, hasPlannedDates: true }]);
  });

  it('counts a mentioned PRB with no change as linked, because creating the change links it', () => {
    const facts = buildDraftReadinessFacts(buildInput({ prbRows: [{ prbNumber: 'PRB1', linkStatus: 'unlinked' }, { prbNumber: 'PRB2', linkStatus: 'otherChange' }] }));
    expect(facts.prbs).toEqual([{ prbNumber: 'PRB1', linkStatus: 'thisChange' }, { prbNumber: 'PRB2', linkStatus: 'otherChange' }]);
  });

  it('turns an unread PRB scan into "could not check", never a pass', () => {
    const items = buildChangeReadiness(buildDraftReadinessFacts(buildInput({ prbRows: null, prbFailureReason: 'Could not read the problem records.' })));
    expect(items.find((item) => item.id === 'prbs')).toMatchObject({ state: 'couldNotCheck', reason: 'Not checked: Could not read the problem records.' });
  });

  it('judges a draft with every fact in place as ready on the record items', () => {
    const items = buildChangeReadiness(buildDraftReadinessFacts(buildInput()));
    const notPassing = items.filter((item) => item.state === 'needsAction' || item.state === 'couldNotCheck').map((item) => item.id);
    expect(notPassing).toEqual([]);
  });

  it('asks for the RCP checks only while the rules apply, and reports the ones that need the record as not checked', () => {
    const items = buildChangeReadiness(buildDraftReadinessFacts(buildInput({ isRcpRulesEnabled: true })));
    expect(items.find((item) => item.id === 'rcp')?.state).not.toBe('done');
  });
});

describe('buildDraftReadinessFacts — an existing change', () => {
  const existingFacts: ChangeReadinessFacts = {
    change: { changeNumber: 'CHG0001', stateLabel: 'New', ownerName: 'Old Owner', configItemName: 'Old CI' },
    textFields: null, isProduction: true, plannedWindow: null, riskReview: null, isRcpActive: false, rcpChecks: [],
    outageCount: 0, ctasks: [], prbs: [{ prbNumber: 'PRB9', linkStatus: 'unlinked' }], attachmentFileNames: null, failureReasons: {},
  };

  it('keeps what ServiceNow holds and lays the edits on top', () => {
    const facts = buildDraftReadinessFacts(buildInput({ mode: 'modify', existingFacts, evidenceFileNames: [] }));
    expect(facts.change).toEqual({ changeNumber: 'CHG0001', stateLabel: 'New', ownerName: 'Pat Owner', configItemName: 'Payments API' });
    expect(facts.outageCount).toBe(0);
    expect(facts.prbs).toEqual([{ prbNumber: 'PRB9', linkStatus: 'unlinked' }]);
    expect(facts.textFields?.description).toBe('What');
    expect(facts.attachmentFileNames).toBeNull();
    expect(facts.riskReview).toEqual({ isReady: true });
  });

  it('judges the user’s task cards: an untouched task as ServiceNow holds it, an edited one as it will be saved', () => {
    const draft = buildProductionDraft();
    const loadedTask = { ...draft.changeTasks[0], id: 'card-1', name: 'CTASK0001', description: '' };
    const links = [{ taskId: 'card-1', sysId: 'sys-1', number: 'CTASK0001', loadedFingerprint: buildTaskFingerprint(loadedTask) }];
    const serviceNowCtask = { number: 'CTASK0001', isImplementation: false, isConfigItemMatching: false, hasBackoutPlan: false, hasPlannedDates: true };
    const factsWith = (changeTasks: CrgDraftState['changeTasks']) => buildDraftReadinessFacts(buildInput({
      mode: 'modify', draft: { ...draft, changeTasks }, existingFacts: { ...existingFacts, ctasks: [serviceNowCtask] }, existingTaskLinks: links,
    }));
    expect(factsWith([loadedTask]).ctasks).toEqual([serviceNowCtask]);
    expect(factsWith([{ ...loadedTask, shortDescription: 'Checkout v2' }]).ctasks).toEqual([
      { number: 'Checkout v2', isImplementation: false, isConfigItemMatching: true, hasBackoutPlan: false, hasPlannedDates: true },
    ]);
  });
});

describe('resolveFixStepId', () => {
  const cases: Array<[ReadinessAction, string]> = [
    [{ kind: 'openStep', stepId: 'changeDetails', label: '' }, 'details'],
    [{ kind: 'openStep', stepId: 'changeText', label: '', focusField: 'backoutPlan' }, 'planning'],
    [{ kind: 'openStep', stepId: 'changeText', label: '', focusField: 'justification' }, 'details'],
    [{ kind: 'openStep', stepId: 'schedule', label: '' }, 'environments'],
    [{ kind: 'openStep', stepId: 'riskCheck', label: '' }, 'aiEnhance'],
    [{ kind: 'openStep', stepId: 'rcpChecklist', label: '' }, 'paperwork'],
    [{ kind: 'openStep', stepId: 'ctaskTimeline', label: '' }, 'tasks'],
    [{ kind: 'openStep', stepId: 'problems', label: '' }, 'scope'],
    [{ kind: 'openStep', stepId: 'testEvidence', label: '' }, 'evidence'],
    [{ kind: 'fixNow', fixId: 'createPlannedOutage', label: '', targetCount: 1 }, 'environments'],
  ];

  it.each(cases)('sends %o to %s', (action, expectedStepId) => {
    expect(resolveFixStepId(action)).toBe(expectedStepId);
  });
});

describe('isWritingCheck', () => {
  it('is true only for a check that names a text field to rewrite', () => {
    const writingItem = { id: 'formulaBackout', label: 'Backout', state: 'needsAction', reason: '', action: { kind: 'openStep', stepId: 'changeText', label: 'Write it', focusField: 'backoutPlan' } } as const;
    const valueItem = { id: 'ctaskDates', label: 'Task dates', state: 'needsAction', reason: '', action: { kind: 'openStep', stepId: 'ctaskTimeline', label: 'Set dates' } } as const;
    expect(isWritingCheck(writingItem)).toBe(true);
    expect(isWritingCheck(valueItem)).toBe(false);
    expect(isWritingCheck({ ...valueItem, action: null })).toBe(false);
  });
});
