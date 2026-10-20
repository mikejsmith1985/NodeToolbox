// WhichChangeStep.test.tsx — Proves a modify loads the change through Toolbox's own load path, keeps its tasks out of the draft,
// and sends a closed change to Review.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { snowFetch } from '../../../services/snowApi.ts';
import { useCrgState } from '../../../views/SnowHub/hooks/useCrgState.ts';
import { createChangeWizardSession } from '../changeWizardSession.ts';
import { fetchChangeForModify, fetchExistingTaskNames } from '../modifyLoad.ts';
import WhichChangeStep from './WhichChangeStep.tsx';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));
vi.mock('../modifyLoad.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../modifyLoad.ts')>()),
  fetchChangeForModify: vi.fn(),
  fetchExistingTaskNames: vi.fn(async () => ['CTASK1 — Smoke test']),
}));

const LOADED_CHANGE = {
  changeSysId: 'sys-1', changeNumber: 'CHG0001', stateLabel: 'New', isEditable: true,
  snapshot: { backout_plan: 'Roll back' }, plannedStartInput: '2026-11-02T19:00', plannedEndInput: '2026-11-02T21:00',
};

/** What the harness last rendered, written after each render (never during it). */
const observed = { latestTaskCount: -1, latestPrdStart: '' };

function Harness({ onExit }: { onExit: () => void }) {
  const crg = useCrgState({ storageKey: 'snowWizard:change:which-test' });
  useEffect(() => { observed.latestTaskCount = crg.state.changeTasks.length; observed.latestPrdStart = crg.state.prdEnvironment.plannedStartDate; });
  const [session, setSession] = useState(createChangeWizardSession('modify'));
  return <WhichChangeStep crg={crg} session={session} updateSession={(update) => setSession((previous) => ({ ...previous, ...update }))} goToStep={vi.fn()} onExit={onExit} />;
}

/** The ServiceNow reads Toolbox's own load path makes: the change, then its tasks to copy. */
function mockCloneReads() {
  vi.mocked(snowFetch).mockImplementation(async (path: string) => {
    if (path.includes('/change_request?')) {
      return { result: [{ sys_id: { value: 'sys-1' }, short_description: 'Payments', u_environment: { value: 'production', display_value: 'Production' } }] } as never;
    }
    return { result: [{ sys_id: 'task-1', number: 'CTASK1', short_description: 'Smoke test' }] } as never;
  });
}

describe('WhichChangeStep', () => {
  beforeEach(() => localStorage.clear());

  it('loads an editable change, clears its copied tasks, and sets its window', async () => {
    vi.mocked(fetchChangeForModify).mockResolvedValueOnce(LOADED_CHANGE);
    mockCloneReads();
    render(<Harness onExit={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Change number'), { target: { value: 'chg0001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look it up' }));

    await waitFor(() => expect(screen.getByText(/CHG0001 \(New\) is loaded/)).toBeTruthy());
    expect(fetchExistingTaskNames).toHaveBeenCalledWith('sys-1');
    expect(observed.latestTaskCount).toBe(0);
    expect(observed.latestPrdStart).toBe('2026-11-02T19:00');
  });

  it('sends a closed change to Review instead', async () => {
    vi.mocked(fetchChangeForModify).mockResolvedValueOnce({ ...LOADED_CHANGE, stateLabel: 'Closed', isEditable: false });
    const onExit = vi.fn();
    render(<Harness onExit={onExit} />);
    fireEvent.change(screen.getByLabelText('Change number'), { target: { value: 'CHG0001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Look it up' }));

    await waitFor(() => expect(screen.getByText('This change is Closed, so it can no longer be changed.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Back to home to review it' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('asks for a proper number', () => {
    render(<Harness onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Look it up' }));
    expect(screen.getByText(/Type a change number/)).toBeTruthy();
  });
});
