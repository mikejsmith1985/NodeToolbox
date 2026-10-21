// useCreatedTaskNumbers.test.ts — Proves a job reads back, once, the task numbers of created changes it does not know yet.

import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../services/snowApi.ts';
import { createChangeWizardSession, type ChangeWizardSession } from './changeWizardSession.ts';
import { useCreatedTaskNumbers } from './useCreatedTaskNumbers.ts';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

const WIPED_SESSION: ChangeWizardSession = {
  ...createChangeWizardSession('create'),
  createdChanges: [{ environmentLabel: 'REL', changeNumber: 'CHG1' }, { environmentLabel: 'PRD', changeNumber: 'CHG2' }],
};

describe('useCreatedTaskNumbers', () => {
  it('reads the task numbers of a change picked up by number, once, and leaves known ones alone', async () => {
    vi.mocked(snowFetch).mockReset().mockResolvedValue({ result: [{ sys_id: 't9', number: 'CTASK9', short_description: 'Deploy' }] } as never);
    const updateSession = vi.fn();
    const session = { ...WIPED_SESSION, createdTasks: { CHG1: [] } };
    renderHook(() => useCreatedTaskNumbers(session, updateSession));
    await waitFor(() => expect(updateSession).toHaveBeenCalledWith({ createdTasks: { CHG1: [], CHG2: [{ sysId: 't9', number: 'CTASK9', shortDescription: 'Deploy' }] } }));
    expect(snowFetch).toHaveBeenCalledTimes(1);
  });
});
