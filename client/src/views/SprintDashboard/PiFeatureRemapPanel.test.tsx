// PiFeatureRemapPanel.test.tsx — Render and workflow tests for the Team Dashboard PI carryover remap panel.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockShowToast,
  mockExecuteFeatureRemap,
  mockFetchFeatureRemapCandidateIssues,
  mockFetchFeatureRemapPiOptions,
} = vi.hoisted(() => ({
  mockShowToast: vi.fn(),
  mockExecuteFeatureRemap: vi.fn(),
  mockFetchFeatureRemapCandidateIssues: vi.fn(),
  mockFetchFeatureRemapPiOptions: vi.fn(),
}));

vi.mock('../../components/Toast/ToastContext.ts', () => ({
  useToast: () => ({
    showToast: mockShowToast,
  }),
}));

vi.mock('./piFeatureRemap.ts', () => ({
  executeFeatureRemap: mockExecuteFeatureRemap,
  fetchFeatureRemapCandidateIssues: mockFetchFeatureRemapCandidateIssues,
  fetchFeatureRemapPiOptions: mockFetchFeatureRemapPiOptions,
}));

import PiFeatureRemapPanel from './PiFeatureRemapPanel.tsx';

describe('PiFeatureRemapPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('loads prior/current PI feature dropdowns, previews child records, and moves them to the new feature', async () => {
    mockFetchFeatureRemapPiOptions.mockResolvedValue({
      currentPiName: 'PI 26.3 (05/01/26 - 06/30/26)',
      priorPiName: 'PI 26.2 (02/01/26 - 04/30/26)',
      priorPiFeatures: [
        { key: 'ART-5000', summary: 'Prior PI authentication hardening', piValue: 'PI 26.2 (02/01/26 - 04/30/26)' },
      ],
      currentPiFeatures: [
        { key: 'ART-6000', summary: 'Current PI authentication hardening', piValue: 'PI 26.3 (05/01/26 - 06/30/26)' },
      ],
    });
    mockFetchFeatureRemapCandidateIssues.mockResolvedValue([
      {
        key: 'TBX-7001',
        summary: 'Carry over API hardening',
        statusName: 'In Progress',
        issueTypeName: 'Story',
        currentFeatureKey: 'ART-5000',
        currentPiValue: 'PI 26.2 (02/01/26 - 04/30/26)',
      },
    ]);
    mockExecuteFeatureRemap.mockResolvedValue({
      movedIssueKeys: ['TBX-7001'],
      failedIssueKeys: [],
      failureMessages: [],
      targetPiValue: 'PI 26.3 (05/01/26 - 06/30/26)',
    });

    render(
      <PiFeatureRemapPanel
        projectKey="TBX"
        selectedPiName=""
      />,
    );

    const user = userEvent.setup();

    const oldFeatureSelect = await screen.findByLabelText(/old feature/i);
    const newFeatureSelect = await screen.findByLabelText(/new feature/i);
    expect(screen.getByText(/old pi:/i)).toHaveTextContent('PI 26.2 (02/01/26 - 04/30/26)');
    expect(screen.getByText(/new pi:/i)).toHaveTextContent('PI 26.3 (05/01/26 - 06/30/26)');

    expect((oldFeatureSelect as HTMLSelectElement).value).toBe('ART-5000');
    expect((newFeatureSelect as HTMLSelectElement).value).toBe('ART-6000');

    expect(await screen.findByText('TBX-7001')).toBeInTheDocument();
    expect(screen.getByText(/story - in progress/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /move open child issues/i }));

    await waitFor(() => {
      expect(mockExecuteFeatureRemap).toHaveBeenCalledWith([
        expect.objectContaining({ key: 'TBX-7001' }),
      ], 'ART-6000');
    });
    expect(await screen.findByText(/matched 1 open child issues\. updated 1 and left 0 requiring follow-up\./i)).toBeInTheDocument();
    expect(mockShowToast).toHaveBeenCalledWith(
      'Moved 1 open child issues to ART-6000 and copied Program Increment PI 26.3 (05/01/26 - 06/30/26).',
      'success',
    );
  });

  it('shows a warning when the user tries to run without selecting an old feature', async () => {
    mockFetchFeatureRemapPiOptions.mockResolvedValue({
      currentPiName: 'PI 26.3 (05/01/26 - 06/30/26)',
      priorPiName: 'PI 26.2 (02/01/26 - 04/30/26)',
      priorPiFeatures: [],
      currentPiFeatures: [
        { key: 'ART-6000', summary: 'Current PI authentication hardening', piValue: 'PI 26.3 (05/01/26 - 06/30/26)' },
      ],
    });

    render(
      <PiFeatureRemapPanel
        projectKey="TBX"
        selectedPiName=""
      />,
    );

    const user = userEvent.setup();
    await screen.findByLabelText(/new feature/i);
    await user.click(screen.getByRole('button', { name: /move open child issues/i }));

    expect(mockShowToast).toHaveBeenCalledWith(
      'Enter the old feature and new feature before running carryover remap.',
      'warning',
    );
    expect(mockExecuteFeatureRemap).not.toHaveBeenCalled();
  });
});
