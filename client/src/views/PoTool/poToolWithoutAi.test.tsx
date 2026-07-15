// poToolWithoutAi.test.tsx — US9: the PO Tool works completely without the AI assist.
//
// This is the sweep, not a spot check. It drives a WHOLE split and a WHOLE composition to their Jira
// writes, in a session that has never unlocked AI Assist, and asserts that no AI affordance is reachable
// at any point along the way.
//
// It exists because "the AI is optional" is the kind of claim that quietly stops being true: one control
// that only appears when unlocked, one hint in the coaching, one step that assumes a proposal, and a
// locked PO is stuck. The feature is built so that cannot happen — every deterministic half shipped
// before its AI half — and this proves it rather than asserting it (FR-022, SC-005).

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockJiraGet,
  mockCreateIssue,
  mockCreateIssueLink,
  mockGetProjectIssueTypes,
  mockGetIssueTypeFields,
  mockSaveSimpleField,
  mockShowToast,
} = vi.hoisted(() => ({
  mockJiraGet: vi.fn(),
  mockCreateIssue: vi.fn(),
  mockCreateIssueLink: vi.fn(),
  mockGetProjectIssueTypes: vi.fn(),
  mockGetIssueTypeFields: vi.fn(),
  mockSaveSimpleField: vi.fn(),
  mockShowToast: vi.fn(),
}));

vi.mock('../../services/jiraApi.ts', () => ({
  jiraGet: mockJiraGet,
  createIssue: mockCreateIssue,
  createIssueLink: mockCreateIssueLink,
  getProjectIssueTypes: mockGetProjectIssueTypes,
  getIssueTypeFields: mockGetIssueTypeFields,
}));

vi.mock('../SprintDashboard/featureReviewFixes.ts', () => ({
  saveFeatureReviewSimpleField: mockSaveSimpleField,
}));

vi.mock('../../components/Toast/ToastContext.ts', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

import { useAiAssistStore } from '../../store/aiAssistStore';
import FeatureCompositionTab from './FeatureCompositionTab';
import FeatureSplitterTab from './FeatureSplitterTab';

/**
 * Every way an AI affordance could leak onto the screen.
 *
 * Broad enough that a control appearing where it should not is caught, but deliberately NOT a bare text
 * scan for "propose" or "prompt": the Definition of Ready legitimately says a Feature should "let a team
 * propose a better one", and the split coaching talks about proposals too. Matching those would fail on
 * the tool's own advice, which is exactly the coaching a locked PO is supposed to see.
 *
 * So this looks for the things only the assist itself produces: its panel, its icon, its controls.
 */
function findAnyAiAffordance(): HTMLElement[] {
  return [
    ...screen.queryAllByLabelText(/^Propose a split$/),
    ...screen.queryAllByLabelText(/^Draft this Feature$/),
    ...screen.queryAllByText(/⚡/),
    ...screen.queryAllByText(/\bAI\b/),
    ...screen.queryAllByText(/assistant/i),
    ...screen.queryAllByText(/unlock/i),
    ...screen.queryAllByRole('button', { name: /prompt|reply/i }),
    ...screen.queryAllByRole('textbox', { name: /prompt|assistant/i }),
  ];
}

const SOURCE_FEATURE = {
  key: 'ABC-1',
  fields: {
    project: { key: 'ABC' },
    issuetype: { id: '10001', name: 'Feature' },
    summary: 'Claims platform',
    description: 'Everything about claims.',
    customfield_10200: 'Given a claim…',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  // The whole point: this session has NEVER unlocked AI Assist.
  useAiAssistStore.setState({ isAiAssistUnlocked: false });

  mockJiraGet.mockImplementation(async (path: string) => {
    if (path.startsWith('/rest/api/2/field')) {
      return [{ id: 'customfield_10200', name: 'Acceptance Criteria' }];
    }
    if (path.startsWith('/rest/api/2/issueLinkType')) {
      return { issueLinkTypes: [{ name: 'relates to' }] };
    }
    if (path.includes('/rest/api/2/issue/ABC-1')) {
      return SOURCE_FEATURE;
    }
    if (path.includes('/issue/ABC-7')) {
      return { key: 'ABC-7', fields: { summary: 'Stub from last week', description: 'Thin.' } };
    }
    throw new Error(`Unexpected read: ${path}`);
  });
  mockGetProjectIssueTypes.mockResolvedValue({ values: [{ id: '10001', name: 'Feature', subtask: false }] });
  mockGetIssueTypeFields.mockResolvedValue({
    values: [{ fieldId: 'summary', name: 'Summary', required: true }],
  });
  mockCreateIssue.mockResolvedValue({ id: '2', key: 'ABC-2', self: '' });
  mockCreateIssueLink.mockResolvedValue(undefined);
  mockSaveSimpleField.mockResolvedValue(undefined);
});

describe('US9 — a whole split, never having unlocked AI (FR-022, SC-005)', () => {
  it('carries a PO from an empty tab to created Jira issues with no AI anywhere', async () => {
    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);

    // 1. The coaching is there before anything is loaded.
    expect(screen.getByText('How to break this down')).toBeInTheDocument();
    expect(findAnyAiAffordance()).toEqual([]);

    // 2. Load the Feature to split.
    await userEvent.type(screen.getByLabelText(/feature key/i), 'ABC-1');
    await userEvent.click(screen.getByRole('button', { name: /load feature/i }));
    await waitFor(() => expect(screen.getByText(/ABC-1 · Feature/)).toBeInTheDocument());
    expect(findAnyAiAffordance()).toEqual([]);

    // 3. Write two increments by hand.
    for (const summary of ['Submit a claim with one document', 'Handle a rejected claim']) {
      await userEvent.click(screen.getByRole('button', { name: /add increment/i }));
      const summaryInputs = screen.getAllByLabelText('Summary');
      await userEvent.type(summaryInputs[summaryInputs.length - 1], summary);
    }
    expect(findAnyAiAffordance()).toEqual([]);

    // 4. Review — every write itemised, nothing written.
    await userEvent.click(screen.getByRole('button', { name: /review 2 increment/i }));
    expect(within(screen.getByLabelText('Issues to create')).getAllByRole('listitem')).toHaveLength(2);
    expect(mockCreateIssue).not.toHaveBeenCalled();
    expect(findAnyAiAffordance()).toEqual([]);

    // 5. Commit — the split lands.
    await userEvent.click(screen.getByRole('button', { name: /create 2 feature/i }));
    await waitFor(() => expect(mockCreateIssue).toHaveBeenCalledTimes(2));
    expect(mockCreateIssueLink).toHaveBeenCalledTimes(2);

    // 6. Still nothing AI, having gone the whole way.
    expect(findAnyAiAffordance()).toEqual([]);
  });

  it('lets a locked PO resume a split across sessions', async () => {
    const { unmount } = render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);
    await userEvent.type(screen.getByLabelText(/feature key/i), 'ABC-1');
    await userEvent.click(screen.getByRole('button', { name: /load feature/i }));
    await waitFor(() => expect(screen.getByText(/ABC-1 · Feature/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /add increment/i }));
    await userEvent.type(screen.getAllByLabelText('Summary')[0], 'Written while locked');
    unmount();

    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);
    await userEvent.type(screen.getByLabelText(/feature key/i), 'ABC-1');
    await userEvent.click(screen.getByRole('button', { name: /load feature/i }));

    expect(await screen.findByDisplayValue('Written while locked')).toBeInTheDocument();
    expect(findAnyAiAffordance()).toEqual([]);
  });
});

describe('US9 — a whole composition, never having unlocked AI (FR-022, SC-005)', () => {
  it('carries a PO from an empty tab to a created Feature with no AI anywhere', async () => {
    render(<FeatureCompositionTab dashboardTeamProfileId="profile-alpha" defaultProjectKey="ABC" />);

    // 1. The Definition of Ready is there from the start.
    expect(screen.getByText(/what "ready" looks like/i)).toBeInTheDocument();
    expect(findAnyAiAffordance()).toEqual([]);

    // 2. Gather material by hand.
    await userEvent.type(screen.getByLabelText(/paste anything else/i), 'Teams thread');
    await userEvent.type(screen.getByLabelText('Pasted content'), 'Jana confirmed the SLA is 48 hours.');
    await userEvent.click(screen.getByRole('button', { name: /add note/i }));
    expect(await screen.findByLabelText('Referenced sources')).toBeInTheDocument();
    expect(findAnyAiAffordance()).toEqual([]);

    // 3. Write the Feature by hand.
    await userEvent.type(screen.getByLabelText('Summary'), 'Claimant document submission');
    await userEvent.type(screen.getByLabelText('Description'), 'Claimants cannot attach documents today.');
    await waitFor(() => expect(screen.getByLabelText(/issue type/i)).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/issue type/i), '10001');
    expect(findAnyAiAffordance()).toEqual([]);

    // 4. Create it.
    await userEvent.click(screen.getByRole('button', { name: /create feature in jira/i }));
    await waitFor(() => expect(mockCreateIssue).toHaveBeenCalledTimes(1));

    // 5. Still nothing AI.
    expect(findAnyAiAffordance()).toEqual([]);
  });

  it('lets a locked PO enrich an existing Feature end to end', async () => {
    render(<FeatureCompositionTab dashboardTeamProfileId="profile-alpha" defaultProjectKey="ABC" />);

    await userEvent.type(screen.getByLabelText(/enrich an existing feature/i), 'ABC-7');
    await userEvent.click(screen.getByRole('button', { name: 'Load' }));
    await waitFor(() => expect(screen.getByDisplayValue('Stub from last week')).toBeInTheDocument());

    await userEvent.clear(screen.getByLabelText('Summary'));
    await userEvent.type(screen.getByLabelText('Summary'), 'Claimant document submission');
    await userEvent.click(screen.getByRole('button', { name: /save changes to ABC-7/i }));

    await waitFor(() => expect(mockSaveSimpleField).toHaveBeenCalled());
    expect(mockCreateIssue).not.toHaveBeenCalled();
    expect(findAnyAiAffordance()).toEqual([]);
  });
});

describe('US9 — the sweep itself has teeth', () => {
  it('DOES find the assist when the gate is unlocked, proving the checks above are not vacuous', async () => {
    // Without this, every "expect(findAnyAiAffordance()).toEqual([])" above could pass by finding
    // nothing for the wrong reason — a typo'd selector proves as much as a working one.
    useAiAssistStore.setState({ isAiAssistUnlocked: true });

    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);
    await userEvent.type(screen.getByLabelText(/feature key/i), 'ABC-1');
    await userEvent.click(screen.getByRole('button', { name: /load feature/i }));
    await waitFor(() => expect(screen.getByText(/ABC-1 · Feature/)).toBeInTheDocument());

    expect(findAnyAiAffordance().length).toBeGreaterThan(0);

    useAiAssistStore.setState({ isAiAssistUnlocked: false });
  });

  it('DOES find the assist on the Composition tab when unlocked', async () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: true });

    render(<FeatureCompositionTab dashboardTeamProfileId="profile-alpha" defaultProjectKey="ABC" />);

    expect(findAnyAiAffordance().length).toBeGreaterThan(0);

    useAiAssistStore.setState({ isAiAssistUnlocked: false });
  });
});

describe('US9 — nothing about the coaching depends on the AI (SC-013)', () => {
  it('shows the split heuristics in full, with no network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(<FeatureSplitterTab dashboardTeamProfileId="profile-alpha" />);

    expect(screen.getByText('Happy path first')).toBeInTheDocument();
    expect(screen.getByText('By workflow step')).toBeInTheDocument();
    expect(screen.getByText('Separate the expensive part')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('shows the Definition of Ready in full, with no network call', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    render(<FeatureCompositionTab dashboardTeamProfileId="profile-alpha" defaultProjectKey="ABC" />);

    expect(screen.getByText('The problem is stated, not the solution')).toBeInTheDocument();
    expect(screen.getByText('Acceptance criteria are testable')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
