// JiraIntake.test.tsx — View-wiring test: shows the config panel when unconfigured, and (when
// configured with auto-create) runs ingest → create-all on import. Underlying hooks are mocked.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import JiraIntake from './JiraIntake.tsx';
import { useIntakeConfig } from './hooks/useIntakeConfig.ts';
import { useIntakeQueue } from './hooks/useIntakeQueue.ts';
import { useCreateFromSubmission } from './hooks/useCreateFromSubmission.ts';
import { useJiraCreateMeta } from '../JiraTemplateMaker/hooks/useJiraCreateMeta.ts';
import type { IntakeConfig, QueueEntry } from './lib/intakeTypes.ts';

vi.mock('./hooks/useIntakeConfig.ts', () => ({ useIntakeConfig: vi.fn() }));
vi.mock('./hooks/useIntakeQueue.ts', () => ({ useIntakeQueue: vi.fn() }));
vi.mock('./hooks/useCreateFromSubmission.ts', () => ({ useCreateFromSubmission: vi.fn() }));
vi.mock('../JiraTemplateMaker/hooks/useJiraCreateMeta.ts', () => ({ useJiraCreateMeta: vi.fn() }));

const useIntakeConfigMock = vi.mocked(useIntakeConfig);
const useIntakeQueueMock = vi.mocked(useIntakeQueue);
const useCreateFromSubmissionMock = vi.mocked(useCreateFromSubmission);
const useJiraCreateMetaMock = vi.mocked(useJiraCreateMeta);

const CONFIG: IntakeConfig = {
  projectKey: 'ENFCT', projectId: '1', issueTypeId: '10001', issueTypeName: 'Story',
  fieldMappings: [], autoCreateOnImport: true, updatedAt: '', updatedBy: '',
};

const ENTRY: QueueEntry = {
  submission: {
    id: 's1', submittedAt: '2026-07-01T10:00:00Z', status: 'New',
    submitter: { displayName: 'Michael Smith', email: 'm@corp.com' },
    fields: { summary: 'Do it', description: '', acceptanceCriteria: '', issueType: 'Story', priority: 'High' },
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

afterEach(() => { vi.clearAllMocks(); });

describe('JiraIntake', () => {
  it('shows the configuration panel when no config exists', () => {
    stubConfig(null);
    useJiraCreateMetaMock.mockReturnValue({ issueTypes: [], loadFields: vi.fn(), getFieldDescriptors: () => [] } as never);
    useIntakeQueueMock.mockReturnValue({ entries: [], counts: { total: 0, newCount: 0, imported: 0, invalid: 0 }, ingestFile: vi.fn(), updateEntry: vi.fn(), errorMessage: null, reset: vi.fn() });
    useCreateFromSubmissionMock.mockReturnValue({ createFromSubmission: vi.fn(), createAllNew: vi.fn() });

    render(<JiraIntake />);
    expect(screen.getByRole('region', { name: /intake configuration/i })).toBeInTheDocument();
  });

  it('ingests and auto-creates on import when configured with auto-create', async () => {
    stubConfig(CONFIG);
    useJiraCreateMetaMock.mockReturnValue({ issueTypes: [], loadFields: vi.fn(), getFieldDescriptors: () => [] } as never);
    const ingestFile = vi.fn().mockResolvedValue([ENTRY]);
    const updateEntry = vi.fn();
    useIntakeQueueMock.mockReturnValue({ entries: [ENTRY], counts: { total: 1, newCount: 1, imported: 0, invalid: 0 }, ingestFile, updateEntry, errorMessage: null, reset: vi.fn() });
    const createAllNew = vi.fn().mockResolvedValue([{ ...ENTRY, state: 'imported', jiraKey: 'ENFCT-1' }]);
    useCreateFromSubmissionMock.mockReturnValue({ createFromSubmission: vi.fn(), createAllNew });

    render(<JiraIntake />);
    const input = screen.getByTestId('submission-file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'Jira-Intake.xlsx')] } });

    await waitFor(() => expect(ingestFile).toHaveBeenCalled());
    await waitFor(() => expect(createAllNew).toHaveBeenCalledWith([ENTRY]));
    await waitFor(() => expect(updateEntry).toHaveBeenCalled());
  });
});
