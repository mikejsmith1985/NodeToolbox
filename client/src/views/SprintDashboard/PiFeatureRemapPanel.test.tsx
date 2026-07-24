// PiFeatureRemapPanel.test.tsx — Render and workflow tests for the Unplanned Work Mapping panel.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockShowToast,
  mockExecuteFeatureRemap,
  mockFetchFeatureRemapCandidateIssues,
  mockFetchFeatureRemapPiOptions,
  mockFetchFeaturesForPi,
} = vi.hoisted(() => ({
  mockShowToast: vi.fn(),
  mockExecuteFeatureRemap: vi.fn(),
  mockFetchFeatureRemapCandidateIssues: vi.fn(),
  mockFetchFeatureRemapPiOptions: vi.fn(),
  mockFetchFeaturesForPi: vi.fn(),
}));

vi.mock('../../components/Toast/ToastContext.ts', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

vi.mock('./piFeatureRemap.ts', () => ({
  executeFeatureRemap: mockExecuteFeatureRemap,
  fetchFeatureRemapCandidateIssues: mockFetchFeatureRemapCandidateIssues,
  fetchFeatureRemapPiOptions: mockFetchFeatureRemapPiOptions,
  fetchFeaturesForPi: mockFetchFeaturesForPi,
}));

import PiFeatureRemapPanel from './PiFeatureRemapPanel.tsx';
import { useStandupRosterStore } from './hooks/useStandupRosterStore.ts';

const PI_263 = 'PI 26.3 (05/21/26 - 07/29/26)';
const PI_264 = 'PI 26.4 (07/30/26 - 09/30/26)';

describe('PiFeatureRemapPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // The Feature dropdowns are scoped to the team's Product Owner, so a roster with a flagged PO must
    // be present for Features to load — exactly as the PI Review pull requires.
    useStandupRosterStore.getState().replaceRosterMembers([
      {
        displayName: 'Pat Owner',
        assigneeQueryValue: 'powner',
        roleCapabilities: { canDevelop: false, canInternalTest: false, canExternalTest: false, canProductOwner: true },
      },
    ]);
    mockFetchFeatureRemapPiOptions.mockResolvedValue({
      allPiNames: [PI_264, PI_263, 'PI 26.2 (03/12/26 - 05/20/26)'],
      defaultSourcePiName: PI_263,
      defaultTargetPiName: PI_264,
    });
    // Features differ per PI, so we can prove the right PI's Features load into each selector.
    mockFetchFeaturesForPi.mockImplementation((piName: string) =>
      Promise.resolve(piName === PI_263
        ? [{ key: 'ENCUC-100', summary: '26.3 unplanned bucket', piValue: PI_263 }]
        : [{ key: 'ENCUC-200', summary: '26.4 unplanned bucket', piValue: PI_264 }]));
  });

  it('defaults the source PI to the current one and the target PI to the next, and loads each PI’s Features', async () => {
    mockFetchFeatureRemapCandidateIssues.mockResolvedValue([
      { key: 'TBX-7001', summary: 'Unplanned API work', statusName: 'In Progress', issueTypeName: 'Story', currentFeatureKey: 'ENCUC-100', currentPiValue: PI_263 },
    ]);
    mockExecuteFeatureRemap.mockResolvedValue({ movedIssueKeys: ['TBX-7001'], failedIssueKeys: [], failureMessages: [], targetPiValue: PI_264 });

    render(<PiFeatureRemapPanel projectKey="ENCUC" selectedPiName="" />);
    const user = userEvent.setup();

    // Closeout default: from the current PI (26.3) INTO the next (26.4).
    expect((await screen.findByLabelText(/source pi/i) as HTMLSelectElement).value).toBe(PI_263);
    expect((screen.getByLabelText(/target pi/i) as HTMLSelectElement).value).toBe(PI_264);
    // Each PI's own Features loaded into the right selector.
    await waitFor(() => expect((screen.getByLabelText(/source feature/i) as HTMLSelectElement).value).toBe('ENCUC-100'));
    await waitFor(() => expect((screen.getByLabelText(/target feature/i) as HTMLSelectElement).value).toBe('ENCUC-200'));

    expect(await screen.findByText('TBX-7001')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /move open child issues/i }));

    await waitFor(() => {
      expect(mockExecuteFeatureRemap).toHaveBeenCalledWith([expect.objectContaining({ key: 'TBX-7001' })], 'ENCUC-200');
    });
    expect(mockShowToast).toHaveBeenCalledWith(
      `Moved 1 open child issues to ENCUC-200 and copied Program Increment ${PI_264}.`,
      'success',
    );
  });

  it('lets the user re-point to ANY PI — picking a different source PI loads that PI’s Features', async () => {
    render(<PiFeatureRemapPanel projectKey="ENCUC" selectedPiName="" />);
    const user = userEvent.setup();

    await waitFor(() => expect((screen.getByLabelText(/source feature/i) as HTMLSelectElement).value).toBe('ENCUC-100'));

    // Switch the source PI to 26.4; its Features must replace 26.3's.
    await user.selectOptions(screen.getByLabelText(/source pi/i), PI_264);

    await waitFor(() => expect((screen.getByLabelText(/source feature/i) as HTMLSelectElement).value).toBe('ENCUC-200'));
  });

  it('filters the target Feature dropdown by typed text', async () => {
    // Two Features on the target PI so the filter has something to narrow.
    mockFetchFeaturesForPi.mockImplementation((piName: string) =>
      Promise.resolve(piName === PI_264
        ? [
            { key: 'ENCUC-200', summary: 'Payments migration', piValue: PI_264 },
            { key: 'ENCUC-201', summary: 'Search revamp', piValue: PI_264 },
          ]
        : [{ key: 'ENCUC-100', summary: '26.3 unplanned bucket', piValue: PI_263 }]));

    render(<PiFeatureRemapPanel projectKey="ENCUC" selectedPiName="" />);
    const user = userEvent.setup();

    const targetFeatureSelect = await screen.findByLabelText('Target Feature');
    await waitFor(() => expect(targetFeatureSelect).toHaveTextContent('Payments migration'));
    expect(targetFeatureSelect).toHaveTextContent('Search revamp');

    // Typing narrows the options to the matching Feature only.
    await user.type(screen.getByLabelText('Filter target options'), 'search');
    await waitFor(() => expect(targetFeatureSelect).not.toHaveTextContent('Payments migration'));
    expect(targetFeatureSelect).toHaveTextContent('Search revamp');
  });

  it('prompts to import the roster when the team has no Product Owner to scope Features', async () => {
    useStandupRosterStore.getState().replaceRosterMembers([]);
    render(<PiFeatureRemapPanel projectKey="ENCUC" selectedPiName="" />);

    expect(await screen.findByText(/import this team.*roster/i)).toBeInTheDocument();
    // With no team scope, the Feature query is never run.
    expect(mockFetchFeaturesForPi).not.toHaveBeenCalled();
  });

  it('warns when no Feature is selected, in unplanned-work terms', async () => {
    mockFetchFeaturesForPi.mockResolvedValue([]); // no Features on either PI
    render(<PiFeatureRemapPanel projectKey="ENCUC" selectedPiName="" />);
    const user = userEvent.setup();

    await screen.findByLabelText(/target feature/i);
    await user.click(screen.getByRole('button', { name: /move open child issues/i }));

    expect(mockShowToast).toHaveBeenCalledWith(
      'Pick a source Feature and a target Feature before moving unplanned work.',
      'warning',
    );
    expect(mockExecuteFeatureRemap).not.toHaveBeenCalled();
  });
});
