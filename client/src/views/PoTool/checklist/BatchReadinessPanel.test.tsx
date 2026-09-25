// BatchReadinessPanel.test.tsx — A JQL-wide review reports on Epics a PO may not open individually, so these
// prove the summary never overstates: an Epic whose part was never pasted reads "not reviewed", not "ready".

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import BatchReadinessPanel from './BatchReadinessPanel.tsx';
import { setAiAssistUnlocked } from '../../../store/aiAssistStore.ts';
import { DEFAULT_DOR_CRITERIA } from './dorCriteria.ts';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn() }));
vi.mock('../../Hygiene/checks/hygieneFieldConfig.ts', async () => {
  const actualModule = await vi.importActual<typeof import('../../Hygiene/checks/hygieneFieldConfig.ts')>(
    '../../Hygiene/checks/hygieneFieldConfig.ts',
  );
  return { ...actualModule, loadHygieneFieldConfig: vi.fn().mockResolvedValue({ acceptanceCriteriaFieldIds: [] }) };
});

import { jiraGet } from '../../../services/jiraApi.ts';

/** Two Epics returned by the query, plus one child. */
function installJira(options: { total?: number } = {}): void {
  const { total = 2 } = options;

  vi.mocked(jiraGet).mockImplementation((path: string) => {
    if (path === '/rest/api/2/field') {
      return Promise.resolve([{ id: 'customfield_22222', name: 'Smart Checklist' }]) as never;
    }
    if (path.includes('parent')) {
      return Promise.resolve({ issues: [] }) as never;
    }
    return Promise.resolve({
      total,
      issues: [
        { key: 'DENP-1', fields: { summary: 'First Epic', status: { name: 'To Do' }, description: 'Signed off in August.' } },
        { key: 'DENP-2', fields: { summary: 'Second Epic', status: { name: 'To Do' }, description: '' } },
      ],
    }) as never;
  });
}

async function runQuery(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText('JQL query'), 'project = DENP AND issuetype = Epic');
  await user.click(screen.getByRole('button', { name: 'Run query' }));
  await waitFor(() => expect(screen.getByText('2 Epic(s) to review')).toBeInTheDocument());
}

/** A reply covering only DENP-1, leaving DENP-2 unanswered. */
function buildPartialReply(): string {
  return JSON.stringify({
    kind: 'epicReadinessBatch',
    items: DEFAULT_DOR_CRITERIA.map((criterion) => ({
      key: 'DENP-1',
      criterionId: criterion.id,
      status: 'satisfied',
      evidence: 'Signed off in August.',
      whatIsMissing: '',
    })),
  });
}

/** A reply that finds real gaps, with the instruction a PO acts on. */
function buildGapReply(): string {
  return JSON.stringify({
    kind: 'epicReadinessBatch',
    items: [
      {
        key: 'DENP-1',
        criterionId: DEFAULT_DOR_CRITERIA[0].id,
        status: 'missing',
        evidence: '',
        whatIsMissing: 'State the business objective and how success will be measured.',
      },
      {
        key: 'DENP-1',
        criterionId: DEFAULT_DOR_CRITERIA[2].id,
        status: 'partial',
        evidence: 'Mentions ESI but names no upstream systems.',
        whatIsMissing: 'Name the two upstream systems this depends on.',
      },
    ],
  });
}

describe('BatchReadinessPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAiAssistUnlocked(true);
  });

  it('runs the query and reports how many Epics it will review', async () => {
    installJira();
    render(<BatchReadinessPanel />);

    await runQuery(userEvent.setup());

    expect(screen.getByRole('button', { name: /Review these Epics|Build the prompt/ })).toBeInTheDocument();
  });

  it('says when the query matched more Epics than one review covers', async () => {
    installJira({ total: 57 });
    render(<BatchReadinessPanel />);

    await runQuery(userEvent.setup());

    expect(screen.getByText(/The query matched 57/)).toBeInTheDocument();
  });

  it('refuses an empty query rather than running it', async () => {
    installJira();
    const user = userEvent.setup();
    render(<BatchReadinessPanel />);

    await user.click(screen.getByRole('button', { name: 'Run query' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/Enter a JQL query/);
    expect(jiraGet).not.toHaveBeenCalled();
  });

  it('summarises every Epic, and calls an unanswered one not reviewed', async () => {
    installJira();
    const user = userEvent.setup();
    render(<BatchReadinessPanel />);
    await runQuery(user);

    await user.click(screen.getByRole('button', { name: 'Build the prompt' }));
    await user.click(screen.getByLabelText(/Paste the assistant/i));
    await user.paste(buildPartialReply());
    await user.click(screen.getByRole('button', { name: 'Read the reply' }));

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    const summaryTable = screen.getByRole('table');
    // DENP-1's Definition of Ready is met; DENP-2 was never answered and reads "not reviewed" rather than
    // being counted as anything. Definition of Done is not being checked in this mode by default.
    expect(within(summaryTable).getByText('MET — all 6')).toBeInTheDocument();
    expect(within(summaryTable).getAllByText('not reviewed').length).toBeGreaterThan(0);
  });

  it('writes the gaps out under the table, without anyone having to click', async () => {
    // The reported complaint: the table said "9 outstanding" and kept the nine to itself.
    installJira();
    const user = userEvent.setup();
    render(<BatchReadinessPanel />);
    await runQuery(user);

    await user.click(screen.getByRole('button', { name: 'Build the prompt' }));
    await user.click(screen.getByLabelText(/Paste the assistant/i));
    await user.paste(buildGapReply());
    await user.click(screen.getByRole('button', { name: 'Read the reply' }));

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(screen.getByText('Add: State the business objective and how success will be measured.')).toBeInTheDocument();
    expect(screen.getByText('Add: Name the two upstream systems this depends on.')).toBeInTheDocument();
    expect(screen.getByText(/What the Epic says: Mentions ESI/)).toBeInTheDocument();
  });

  it('says which findings are waiting on a reply that has not been pasted', async () => {
    installJira();
    const user = userEvent.setup();
    render(<BatchReadinessPanel />);
    await runQuery(user);

    await user.click(screen.getByRole('button', { name: 'Build the prompt' }));
    await user.click(screen.getByLabelText(/Paste the assistant/i));
    await user.paste(buildGapReply());
    await user.click(screen.getByRole('button', { name: 'Read the reply' }));

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(screen.getAllByText(/has not been pasted back yet/).length).toBeGreaterThan(0);
  });

  it('checks Definition of Ready only by default, so a funnel Epic is not judged against Done', async () => {
    installJira();
    const user = userEvent.setup();
    render(<BatchReadinessPanel />);
    await runQuery(user);

    await user.click(screen.getByRole('button', { name: 'Build the prompt' }));

    const promptText = (screen.getByLabelText(/read it, then copy it/i) as HTMLTextAreaElement).value;
    expect(promptText).toContain('dor-business-objective');
    expect(promptText).not.toContain('dod-closure-decision');
  });

  it('checks Definition of Done when that is what is being asked', async () => {
    installJira();
    const user = userEvent.setup();
    render(<BatchReadinessPanel />);
    await runQuery(user);

    await user.selectOptions(screen.getByLabelText('Which definition to check'), 'dod');
    await user.click(screen.getByRole('button', { name: 'Build the prompt' }));

    const promptText = (screen.getByLabelText(/read it, then copy it/i) as HTMLTextAreaElement).value;
    expect(promptText).toContain('dod-closure-decision');
    expect(promptText).not.toContain('dor-business-objective');
  });

  it('never writes to Jira — this mode only reports', async () => {
    installJira();
    const user = userEvent.setup();
    render(<BatchReadinessPanel />);
    await runQuery(user);

    await user.click(screen.getByRole('button', { name: 'Build the prompt' }));
    await user.click(screen.getByLabelText(/Paste the assistant/i));
    await user.paste(buildPartialReply());
    await user.click(screen.getByRole('button', { name: 'Read the reply' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy for Jira' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Tick/ })).not.toBeInTheDocument();
  });
});
