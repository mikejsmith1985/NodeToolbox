// JiraIntake.test.tsx — View-wiring test: shows settings when unconfigured, and (when configured
// with auto-create + a project) runs ingest → create-all on import. Underlying hooks are mocked.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import JiraIntake from './JiraIntake.tsx';
import { useIntakeConfig } from './hooks/useIntakeConfig.ts';
import { useIntakeQueue } from './hooks/useIntakeQueue.ts';
import { useCreateFromSubmission } from './hooks/useCreateFromSubmission.ts';
import { useSharePointPull } from './hooks/useSharePointPull.ts';
import type { IntakeConfig, QueueEntry } from './lib/intakeTypes.ts';

vi.mock('./hooks/useIntakeConfig.ts', () => ({ useIntakeConfig: vi.fn() }));
vi.mock('./hooks/useIntakeQueue.ts', () => ({ useIntakeQueue: vi.fn() }));
vi.mock('./hooks/useCreateFromSubmission.ts', () => ({ useCreateFromSubmission: vi.fn() }));
vi.mock('./hooks/useSharePointPull.ts', () => ({ useSharePointPull: vi.fn() }));

const useIntakeConfigMock = vi.mocked(useIntakeConfig);
const useIntakeQueueMock = vi.mocked(useIntakeQueue);
const useCreateFromSubmissionMock = vi.mocked(useCreateFromSubmission);
const useSharePointPullMock = vi.mocked(useSharePointPull);

const CONFIG: IntakeConfig = {
  projectKey: 'ENFCT', acceptanceCriteriaFieldId: 'customfield_10200', autoCreateOnImport: true, updatedAt: '', updatedBy: '',
};

const ENTRY: QueueEntry = {
  submission: {
    id: 's1', submittedAt: '2026-07-01T10:00:00Z', status: 'New',
    submitter: { displayName: 'Michael Smith', email: 'm@corp.com' },
    fields: { summary: 'Do it', description: '', acceptanceCriteria: '', issueType: 'Story', priority: 'High', project: '' },
    extras: {}, rowIndex: 0, parseErrors: [],
  },
  state: 'new', jiraKey: null, blockingReasons: [], reporterOutcome: null,
};

function stubConfig(config: IntakeConfig | null): void {
  useIntakeConfigMock.mockReturnValue({
    config, ledger: [], isLoading: false, errorMessage: null,
    reload: vi.fn(), saveConfig: vi.fn(), recordProcessed: vi.fn(),
  });
}

function stubQueue(overrides: Partial<ReturnType<typeof useIntakeQueue>> = {}): void {
  useIntakeQueueMock.mockReturnValue({
    entries: [], counts: { total: 0, newCount: 0, imported: 0, invalid: 0 },
    ingestFile: vi.fn().mockResolvedValue([]), ingestRows: vi.fn().mockReturnValue([]),
    updateEntry: vi.fn(), dismissEntry: vi.fn(), errorMessage: null, reset: vi.fn(), ...overrides,
  });
}

function stubPull(overrides: Partial<ReturnType<typeof useSharePointPull>> = {}): void {
  useSharePointPullMock.mockReturnValue({
    isConnected: false, refreshStatus: vi.fn(), pull: vi.fn().mockResolvedValue(null),
    isPulling: false, errorMessage: null, ...overrides,
  });
}

afterEach(() => { vi.clearAllMocks(); });

describe('JiraIntake', () => {
  it('shows the settings panel when no config exists', () => {
    stubConfig(null);
    stubQueue();
    stubPull();
    useCreateFromSubmissionMock.mockReturnValue({ createFromSubmission: vi.fn(), createAllNew: vi.fn(), reconcileExisting: vi.fn() });

    render(<JiraIntake />);
    expect(screen.getByRole('region', { name: /intake settings/i })).toBeInTheDocument();
  });

  it('runs the dedup pre-scan then auto-creates the remaining rows on file import', async () => {
    stubConfig(CONFIG);
    const ingestFile = vi.fn().mockResolvedValue([ENTRY]);
    const updateEntry = vi.fn();
    stubQueue({ entries: [ENTRY], counts: { total: 1, newCount: 1, imported: 0, invalid: 0 }, ingestFile, updateEntry });
    stubPull();
    const reconcileExisting = vi.fn().mockResolvedValue([ENTRY]); // nothing already existed
    const createAllNew = vi.fn().mockResolvedValue([{ ...ENTRY, state: 'imported', jiraKey: 'ENFCT-1' }]);
    useCreateFromSubmissionMock.mockReturnValue({ createFromSubmission: vi.fn(), createAllNew, reconcileExisting });

    render(<JiraIntake />);
    fireEvent.change(screen.getByTestId('submission-file-input'), { target: { files: [new File(['x'], 'Jira-Intake.xlsx')] } });

    await waitFor(() => expect(ingestFile).toHaveBeenCalled());
    await waitFor(() => expect(reconcileExisting).toHaveBeenCalledWith([ENTRY]));
    await waitFor(() => expect(createAllNew).toHaveBeenCalledWith([ENTRY]));
    await waitFor(() => expect(updateEntry).toHaveBeenCalled());
  });

  it('pulls from SharePoint and runs the same dedup + create flow (ingestRows path)', async () => {
    const spConfig: IntakeConfig = { ...CONFIG, sharePointSiteRelativeUrl: '/sites/CUCIntake', sharePointListName: 'Jira-Intake' };
    stubConfig(spConfig);
    const ingestRows = vi.fn().mockReturnValue([ENTRY]);
    const updateEntry = vi.fn();
    stubQueue({ entries: [ENTRY], counts: { total: 1, newCount: 1, imported: 0, invalid: 0 }, ingestRows, updateEntry });
    stubPull({ isConnected: true, pull: vi.fn().mockResolvedValue({ rows: [{ id: 's1' }], missingColumns: [], itemCount: 1 }) });
    const reconcileExisting = vi.fn().mockResolvedValue([ENTRY]);
    const createAllNew = vi.fn().mockResolvedValue([{ ...ENTRY, state: 'imported', jiraKey: 'ENCUC-1' }]);
    useCreateFromSubmissionMock.mockReturnValue({ createFromSubmission: vi.fn(), createAllNew, reconcileExisting });

    render(<JiraIntake />);
    fireEvent.click(screen.getByRole('button', { name: /pull from sharepoint/i }));

    await waitFor(() => expect(ingestRows).toHaveBeenCalledWith([{ id: 's1' }]));
    await waitFor(() => expect(reconcileExisting).toHaveBeenCalledWith([ENTRY]));
    await waitFor(() => expect(createAllNew).toHaveBeenCalledWith([ENTRY]));
  });
});
