// templatePicks.test.ts — Proves a template keeps only the picks, and opening one never brings old writing or dates in.

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCrgState, type CrgTemplate, type CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import type { CrgDraftState } from './changeDraft.ts';
import { buildPicksOnlyDraft, buildPicksOnlyTemplate, keepTaskPicks } from './templatePicks.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

const GROUP = { sysId: 'grp-1', displayName: 'SCM' };
const TASK = { id: 't1', name: 'Deploy', createdAt: '', shortDescription: 'Deploy', description: 'repo x, branch release/1023', assignmentGroup: GROUP, assignedTo: GROUP, plannedStartDate: '2026-10-23T21:00', plannedEndDate: '2026-10-23T22:00', closeNotes: 'done', changeTaskType: 'implementation' } as CtaskTemplate;

function buildDraft(): CrgDraftState {
  const draft = renderHook(() => useCrgState({ storageKey: 'snowWizard:change:picks-test' })).result.current.state;
  return {
    ...draft,
    generatedShortDescription: 'ENCUC October release', generatedDescription: 'Fixes ENCUC-2334',
    chgBasicInfo: { ...draft.chgBasicInfo, category: 'software', assignmentGroup: GROUP },
    chgPlanningContent: { implementationPlan: '1. Deploy', backoutPlan: '1. Undo', testPlan: '1. Test' },
    prdEnvironment: { ...draft.prdEnvironment, isEnabled: true, plannedStartDate: '2026-10-23T21:00', plannedEndDate: '2026-10-24T06:00', configItem: GROUP },
    changeTasks: [TASK],
  };
}

describe('templatePicks', () => {
  it('saves the picks only: no writing, plans, dates or task descriptions', () => {
    const picks = buildPicksOnlyDraft(buildDraft());
    expect(picks.chgBasicInfo.category).toBe('software');
    expect(picks.chgPlanningContent).toEqual({ implementationPlan: '', backoutPlan: '', testPlan: '' });
    expect(picks.prdEnvironment).toMatchObject({ isEnabled: true, configItem: GROUP, plannedStartDate: '', plannedEndDate: '' });
    expect(picks.changeTasks[0]).toMatchObject({ shortDescription: 'Deploy', assignmentGroup: GROUP, changeTaskType: 'implementation', description: '', plannedStartDate: '', closeNotes: '' });
  });

  it('opens an older template that still holds text without bringing its writing or dates in', () => {
    const draft = buildDraft();
    const olderTemplate = {
      id: 'tpl-1', name: 'Monthly', createdAt: '', chgBasicInfo: { ...draft.chgBasicInfo, category: 'hardware' }, chgPlanningAssessment: draft.chgPlanningAssessment,
      chgPlanningContent: { implementationPlan: 'OLD plan', backoutPlan: 'OLD backout', testPlan: 'OLD test' },
      prdEnvironment: { ...draft.prdEnvironment, plannedStartDate: '2025-01-01T00:00', plannedEndDate: '2025-01-01T01:00' },
    } as CrgTemplate;
    const opened = buildPicksOnlyTemplate(olderTemplate, draft);
    expect(opened.chgBasicInfo.category).toBe('hardware');
    expect(opened.chgPlanningContent).toEqual(draft.chgPlanningContent);
    expect(opened.prdEnvironment).toMatchObject({ plannedStartDate: '2026-10-23T21:00', plannedEndDate: '2026-10-24T06:00' });
    expect(keepTaskPicks(TASK).description).toBe('');
  });
});
