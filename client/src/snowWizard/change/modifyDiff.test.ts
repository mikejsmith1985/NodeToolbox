// modifyDiff.test.ts — Proves a modify knows which steps were edited, and which values ServiceNow changed since load.

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCrgState } from '../../views/SnowHub/hooks/useCrgState.ts';
import type { CrgDraftState } from './changeDraft.ts';
import { detectRemoteConflicts, listEditedSteps, readRecordSnapshot, readStepValues } from './modifyDiff.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

function readBlankDraft(): CrgDraftState {
  return renderHook(() => useCrgState({ storageKey: 'snowWizard:change:diff-test' })).result.current.state;
}

describe('listEditedSteps', () => {
  it('names only the steps whose values changed', () => {
    const loadedDraft = readBlankDraft();
    const loadedValues = readStepValues(loadedDraft);
    const editedDraft: CrgDraftState = { ...loadedDraft, chgPlanningContent: { ...loadedDraft.chgPlanningContent, backoutPlan: 'New backout' } };
    expect(listEditedSteps(loadedValues, readStepValues(editedDraft))).toEqual(['planning']);
  });

  it('is empty when nothing changed', () => {
    const draft = readBlankDraft();
    expect(listEditedSteps(readStepValues(draft), readStepValues(draft))).toEqual([]);
  });

  it('counts a newly added task and a new window as edits of their own steps', () => {
    const draft = readBlankDraft();
    const editedDraft: CrgDraftState = {
      ...draft,
      prdEnvironment: { ...draft.prdEnvironment, isEnabled: true, plannedStartDate: '2026-11-01T08:00' },
      changeTasks: [{ ...({} as CrgDraftState['changeTasks'][number]), id: 'new', shortDescription: 'Business Checkout' }],
    };
    expect(listEditedSteps(readStepValues(draft), readStepValues(editedDraft))).toEqual(['environments', 'tasks']);
  });
});

describe('detectRemoteConflicts', () => {
  const loadedSnapshot = { short_description: 'Old title', backout_plan: 'Roll back', test_plan: 'Test' };

  it('returns each value ServiceNow changed since load, with both values', () => {
    const conflicts = detectRemoteConflicts(loadedSnapshot, { short_description: 'Old title', backout_plan: 'Changed in ServiceNow', test_plan: 'Test' }, ['planning']);
    expect(conflicts).toEqual([{ fieldLabel: 'Backout plan', stepId: 'planning', loadedValue: 'Roll back', serviceNowValue: 'Changed in ServiceNow', isEditedHere: true }]);
  });

  it('still warns about a remote change on a step not edited here, because saving would write the loaded value back', () => {
    const conflicts = detectRemoteConflicts(loadedSnapshot, { ...loadedSnapshot, short_description: 'Renamed' }, ['planning']);
    expect(conflicts).toEqual([{ fieldLabel: 'Title', stepId: 'details', loadedValue: 'Old title', serviceNowValue: 'Renamed', isEditedHere: false }]);
  });

  it('is empty when nothing changed remotely', () => {
    expect(detectRemoteConflicts(loadedSnapshot, { ...loadedSnapshot }, [])).toEqual([]);
  });
});

describe('readRecordSnapshot', () => {
  it('keeps the tracked fields as plain text, reading display values when given', () => {
    expect(readRecordSnapshot({ short_description: 'Title', assigned_to: { display_value: 'Pat', value: 'sys-1' }, other: 'ignored' }))
      .toMatchObject({ short_description: 'Title', assigned_to: 'Pat', backout_plan: '' });
  });
});
