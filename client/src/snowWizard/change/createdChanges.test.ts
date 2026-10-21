// createdChanges.test.ts — Proves created changes' tasks are read back, named for the AI, matched to their cards, and that
// saving writes each change's own environment values and every matched task.

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../services/snowApi.ts';
import { useCrgState, type CtaskTemplate } from '../../views/SnowHub/hooks/useCrgState.ts';
import type { CrgDraftState } from './changeDraft.ts';
import {
  describeCreatedChangesForPrompt, listCreatedChangeTasks, matchTasksToCards, saveCreatedChange, type CreatedChangeWriters,
} from './createdChanges.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

const BLANK = { sysId: '', displayName: '' };

function buildCard(cardId: string, shortDescription: string, environmentKeys?: Array<'REL' | 'PRD'>): CtaskTemplate {
  return { id: cardId, name: shortDescription, createdAt: '', shortDescription, description: '', assignmentGroup: BLANK, assignedTo: BLANK, plannedStartDate: '', plannedEndDate: '', closeNotes: '', environmentKeys } as CtaskTemplate;
}

/** A REL + PRD draft from the real hook, each environment with its own configuration item. */
function buildDraft(): CrgDraftState {
  const draft = renderHook(() => useCrgState({ storageKey: 'snowWizard:change:created-test' })).result.current.state;
  return {
    ...draft,
    generatedShortDescription: 'Payments 1.2',
    chgPlanningContent: { implementationPlan: '1. Deploy (CTASK1)', backoutPlan: '1. Redeploy v1', testPlan: '1. Smoke test' },
    relEnvironment: { ...draft.relEnvironment, isEnabled: true, configItem: { sysId: 'ci-rel', displayName: 'Payments - Release' } },
    prdEnvironment: { ...draft.prdEnvironment, isEnabled: true, configItem: { sysId: 'ci-prd', displayName: 'Payments - Production' } },
    changeTasks: [buildCard('c1', 'Deploy'), buildCard('c2', 'Business Checkout', ['PRD'])],
  };
}

function buildWriters(taskRecords = [{ sysId: 't1', number: 'CTASK1', shortDescription: 'Deploy' }]): CreatedChangeWriters {
  return {
    resolveChangeSysId: vi.fn(async () => 'chg-sys'),
    patchChange: vi.fn(async () => undefined),
    listTasks: vi.fn(async () => taskRecords),
    readChangeDefaults: vi.fn(async () => ({ configItemSysId: '', plannedStartDate: '', plannedEndDate: '' })),
    updateTask: vi.fn(async () => undefined),
  };
}

describe('listCreatedChangeTasks', () => {
  it('reads a change\'s tasks oldest first, whether ServiceNow sends plain or display values', async () => {
    vi.mocked(snowFetch).mockResolvedValueOnce({ result: [{ sys_id: 't1', number: { value: 'CTASK1', display_value: 'CTASK1' }, short_description: 'Deploy' }] });
    expect(await listCreatedChangeTasks('CHG1')).toEqual([{ sysId: 't1', number: 'CTASK1', shortDescription: 'Deploy' }]);
    expect(vi.mocked(snowFetch).mock.calls[0][0]).toContain(encodeURIComponent('change_request.number=CHG1^ORDERBYnumber'));
  });
});

describe('matchTasksToCards', () => {
  it('pairs by short description first, then the rest in order', () => {
    const cards = [buildCard('c1', 'Deploy'), buildCard('c2', 'Smoke test')];
    const records = [{ sysId: 'auto', number: 'CTASK1', shortDescription: 'Implementation' }, { sysId: 'dep', number: 'CTASK2', shortDescription: 'Deploy' }];
    const matches = matchTasksToCards(cards, records);
    expect(matches.map(({ card, taskRecord }) => `${card.id}:${taskRecord.sysId}`)).toEqual(['c1:dep', 'c2:auto']);
  });
});

describe('describeCreatedChangesForPrompt', () => {
  it('names each change with its environment and its tasks\' numbers', () => {
    const lines = describeCreatedChangesForPrompt(
      [{ environmentLabel: 'REL', changeNumber: 'CHG1' }, { environmentLabel: 'PRD', changeNumber: 'CHG2' }],
      { CHG1: [{ sysId: 't1', number: 'CTASK1', shortDescription: 'Deploy' }] },
    );
    expect(lines).toEqual(['REL change CHG1 — tasks: CTASK1 (Deploy)', 'PRD change CHG2 — tasks: none']);
  });
});

describe('saveCreatedChange', () => {
  it('writes the PRD change with PRD\'s own configuration item and the finished text, then each of its tasks', async () => {
    const writers = buildWriters([{ sysId: 't1', number: 'CTASK1', shortDescription: 'Deploy' }, { sysId: 't2', number: 'CTASK2', shortDescription: 'Business Checkout' }]);
    const summary = await saveCreatedChange({
      draft: buildDraft(), createdChange: { environmentLabel: 'PRD', changeNumber: 'CHG2' }, environmentValueByKey: { prd: 'Production' },
      ctaskEnvironmentPlan: { Deploy: { REL: true, PRD: true, PFIX: false }, 'Business Checkout': { REL: false, PRD: true, PFIX: false } },
    }, writers);
    const payload = vi.mocked(writers.patchChange).mock.calls[0][1] as Record<string, unknown>;
    expect(payload.cmdb_ci).toBe('ci-prd');
    expect(payload.u_environment).toBe('Production');
    expect(payload.short_description).toBe('Payments 1.2');
    expect(String(payload.implementation_plan)).toContain('1. Deploy (CTASK1)');
    expect(vi.mocked(writers.updateTask).mock.calls.map((call) => call[0])).toEqual(['t1', 't2']);
    expect(summary).toBe('CHG2 saved, with 2 tasks updated.');
  });

  it('leaves a task alone that is not on this environment\'s change', async () => {
    const writers = buildWriters();
    await saveCreatedChange({
      draft: buildDraft(), createdChange: { environmentLabel: 'REL', changeNumber: 'CHG1' }, environmentValueByKey: {},
      ctaskEnvironmentPlan: { Deploy: { REL: true, PRD: true, PFIX: false }, 'Business Checkout': { REL: false, PRD: true, PFIX: false } },
    }, writers);
    expect((vi.mocked(writers.patchChange).mock.calls[0][1] as Record<string, unknown>).cmdb_ci).toBe('ci-rel');
    expect(writers.updateTask).toHaveBeenCalledTimes(1);
  });

  it('refuses a change with no environment rather than guess its values', async () => {
    await expect(saveCreatedChange({ draft: buildDraft(), createdChange: { environmentLabel: null, changeNumber: 'CHG3' }, environmentValueByKey: {}, ctaskEnvironmentPlan: {} }, buildWriters()))
      .rejects.toThrow('CHG3 has no environment to save.');
  });
});
