// compositionModeToggle.test.tsx — Switching Feature Composition to Epic Intake and back never touches the Feature
// being composed (spec 037, FR-001, quickstart V-14). Kept separate so the shipped composition test stays unmodified.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet, mockGetProjectIssueTypes, mockGetIssueTypeFields } = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockGetProjectIssueTypes: vi.fn(),
  mockGetIssueTypeFields: vi.fn(),
}));

vi.mock('../../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  createIssue: vi.fn(),
  createIssueLink: vi.fn(),
  getProjectIssueTypes: mockGetProjectIssueTypes,
  getIssueTypeFields: mockGetIssueTypeFields,
}));

vi.mock('../../../components/Toast/ToastContext.ts', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { useAiAssistStore } from '../../../store/aiAssistStore';
import FeatureCompositionTab from '../FeatureCompositionTab';

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  useAiAssistStore.setState({ isAiAssistUnlocked: false });
  mockJiraGet.mockResolvedValue([]);
  mockGetProjectIssueTypes.mockResolvedValue({ values: [{ id: '10001', name: 'Feature', subtask: false }] });
  mockGetIssueTypeFields.mockResolvedValue({ values: [{ fieldId: 'summary', name: 'Summary', required: true }] });
});

describe('Feature Composition mode switch', () => {
  it('opens in compose mode, shows the intake on switch, and keeps the Feature draft on the way back', async () => {
    const user = userEvent.setup({ delay: null });
    render(<FeatureCompositionTab dashboardTeamProfileId="profile-alpha" defaultProjectKey="ABC" />);

    expect(screen.getByRole('radio', { name: 'Compose one Feature' })).toHaveAttribute('aria-checked', 'true');
    await user.type(screen.getByLabelText('Summary'), 'Claimant document submission');

    await user.click(screen.getByRole('radio', { name: 'Epic Intake from notes' }));
    expect(screen.queryByLabelText('Summary')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start intake' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Compose one Feature' }));
    expect(screen.getByLabelText('Summary')).toHaveValue('Claimant document submission');
  });
});
