// changeWizardSteps.test.ts — Proves the change wizard's step order, done-when rules, resume rule and paperwork skip.

import { describe, expect, it } from 'vitest';

import {
  buildShellSteps,
  deriveChangeWizardStep,
  evaluateStepCompletion,
  listChangeWizardPhases,
  listChangeWizardStepIds,
  readPaperworkNeed,
  resolveResumeStep,
  type ChangeWizardProgress,
} from './changeWizardSteps.ts';

/** Progress for a create job with every step's data complete and every step passed. */
function buildCompleteProgress(overrides: Partial<ChangeWizardProgress> = {}): ChangeWizardProgress {
  return {
    mode: 'create',
    isChangeLoaded: false,
    selectedIssueCount: 3,
    detailsGaps: [],
    planningGaps: [],
    environmentProblems: [],
    taskProblems: [],
    reviewedStepIds: ['scope', 'details', 'planning', 'environments', 'tasks', 'aiDraft', 'createChanges', 'checks', 'paperwork'],
    isChecksSatisfied: true,
    paperworkNeed: { isNeeded: false, reason: 'No Production environment is in this change.' },
    isPaperworkDone: false,
    areChangesCreated: true,
    ...overrides,
  };
}

describe('listChangeWizardStepIds', () => {
  it('runs Toolbox order, guided: every pick, AI Assist, create in ServiceNow, then risk check and save', () => {
    expect(listChangeWizardStepIds('create')).toEqual([
      'scope', 'details', 'planning', 'environments', 'tasks', 'aiDraft', 'createChanges', 'checks', 'paperwork', 'finish',
    ]);
  });

  it('groups every step of each mode into exactly one stage', () => {
    for (const mode of ['create', 'modify'] as const) {
      const phases = listChangeWizardPhases(mode);
      expect(phases.flatMap((phase) => phase.stepIds).sort()).toEqual(listChangeWizardStepIds(mode).sort());
    }
    expect(listChangeWizardPhases('create').map((phase) => phase.label)).toEqual(['① Pick', '② AI writes it', '③ Create in ServiceNow', '④ Risk check & save']);
  });

  it('holds "Create in ServiceNow" until every environment has its change', () => {
    expect(evaluateStepCompletion('createChanges', buildCompleteProgress({ areChangesCreated: false })).blockedReason).toBe('Create the changes in ServiceNow first.');
    expect(evaluateStepCompletion('createChanges', buildCompleteProgress()).canGoNext).toBe(true);
  });

  it('starts a modify with "Which change?" and builds its tasks on the same step as a new change', () => {
    const modifyStepIds = listChangeWizardStepIds('modify');
    expect(modifyStepIds[0]).toBe('whichChange');
    expect(modifyStepIds).toContain('tasks');
    expect(modifyStepIds.at(-1)).toBe('finish');
  });
});

describe('evaluateStepCompletion', () => {
  it('holds Scope until at least one issue is chosen', () => {
    const scopeCompletion = evaluateStepCompletion('scope', buildCompleteProgress({ selectedIssueCount: 0 }));
    expect(scopeCompletion.canGoNext).toBe(false);
    expect(scopeCompletion.blockedReason).toMatch(/at least one Jira issue/);
  });

  it('names the missing details and planning values', () => {
    expect(evaluateStepCompletion('details', buildCompleteProgress({ detailsGaps: ['an owner', 'a category'] })).blockedReason)
      .toBe('Still needed: an owner, a category.');
    expect(evaluateStepCompletion('planning', buildCompleteProgress({ planningGaps: ['the backout plan'] })).canGoNext).toBe(true);
    expect(evaluateStepCompletion('aiDraft', buildCompleteProgress({ planningGaps: ['the backout plan'] })).blockedReason).toBe('Still needed: the backout plan.');
  });

  it('holds Environments and the task cards on their first problem', () => {
    expect(evaluateStepCompletion('environments', buildCompleteProgress({ environmentProblems: ['Tick at least one environment.'] })).blockedReason)
      .toBe('Tick at least one environment.');
    expect(evaluateStepCompletion('tasks', buildCompleteProgress({ taskProblems: ['Task 1 needs a short description.'] })).blockedReason)
      .toBe('Task 1 needs a short description.');
  });

  it('counts a step done only once it has been passed', () => {
    const progress = buildCompleteProgress({ reviewedStepIds: [] });
    expect(evaluateStepCompletion('paperwork', progress)).toEqual({ canGoNext: true, isDone: false });
  });

  it('holds Checks until they pass or are acknowledged', () => {
    expect(evaluateStepCompletion('checks', buildCompleteProgress({ isChecksSatisfied: false })).canGoNext).toBe(false);
  });

  it('lets paperwork go on when it is not needed, and holds it when it is needed and not done', () => {
    expect(evaluateStepCompletion('paperwork', buildCompleteProgress()).canGoNext).toBe(true);
    const neededProgress = buildCompleteProgress({ paperworkNeed: { isNeeded: true, reason: '' } });
    expect(evaluateStepCompletion('paperwork', neededProgress).canGoNext).toBe(false);
    expect(evaluateStepCompletion('paperwork', { ...neededProgress, isPaperworkDone: true }).canGoNext).toBe(true);
  });

  it('never counts Scope as needed on a modify', () => {
    expect(evaluateStepCompletion('scope', buildCompleteProgress({ mode: 'modify', selectedIssueCount: 0 })).canGoNext).toBe(true);
  });
});

describe('deriveChangeWizardStep and resolveResumeStep', () => {
  it('lands on the first step that is not done', () => {
    expect(deriveChangeWizardStep(buildCompleteProgress({ planningGaps: ['the test plan'] }))).toBe('aiDraft');
    expect(deriveChangeWizardStep(buildCompleteProgress())).toBe('finish');
  });

  it('never resumes ahead of a step whose prerequisites are missing', () => {
    const progress = buildCompleteProgress({ detailsGaps: ['an owner'] });
    expect(resolveResumeStep('checks', progress)).toBe('details');
    expect(resolveResumeStep('scope', progress)).toBe('scope');
  });

  it('falls back to the derived step for an unknown recorded step', () => {
    expect(resolveResumeStep('nonsense', buildCompleteProgress({ reviewedStepIds: [] }))).toBe('scope');
  });
});

describe('readPaperworkNeed', () => {
  it('is needed only for a Production change while the restricted change period applies', () => {
    expect(readPaperworkNeed({ hasProduction: true, isRcpActive: true }).isNeeded).toBe(true);
    expect(readPaperworkNeed({ hasProduction: false, isRcpActive: true })).toEqual({
      isNeeded: false, reason: 'No Production environment is in this change, so no approval email or change plan PDF is needed.',
    });
    expect(readPaperworkNeed({ hasProduction: true, isRcpActive: false }).reason).toMatch(/restricted change period/);
  });
});

describe('buildShellSteps', () => {
  it('marks done, current and to-do steps with plain titles', () => {
    const shellSteps = buildShellSteps('create', 'planning', buildCompleteProgress({ reviewedStepIds: ['scope', 'details'] }));
    expect(shellSteps[0]).toEqual({ id: 'scope', title: 'What\'s in this change?', state: 'done' });
    expect(shellSteps[1]).toEqual({ id: 'details', title: 'Tell us about the change', state: 'done' });
    expect(shellSteps[2]).toEqual({ id: 'planning', title: 'How will it go?', state: 'current' });
    expect(shellSteps[3].state).toBe('todo');
    expect(shellSteps.at(-1)?.title).toBe('Save to ServiceNow');
  });

  it('calls the last step Save on a modify', () => {
    expect(buildShellSteps('modify', 'whichChange', buildCompleteProgress({ mode: 'modify' })).at(-1)?.title).toBe('Save the change');
  });
});
