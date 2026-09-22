// IntakeLoopPanel.test.tsx — The Epic Intake is a pure copy-and-paste loop (GH #387 feedback): notes in, prompt out,
// answer in, next prompt out, Create — and the PO never answers a question or touches a dropdown on the way.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiAssistStore } from '../../../../store/aiAssistStore';
import type { CreateIssueRequest, JiraIssue } from '../../../../types/jira.ts';
import EpicIntakeWorkspace from '../EpicIntakeWorkspace.tsx';
import type { IntakeJiraDeps } from './IntakeTurnPanel.tsx';

const NOW_ISO = '2026-09-22T12:00:00.000Z';

const NOTES = [
  '•\tCore Integration (denp-632)',
  'o\tXL Enrollment',
  'o\tFulfillment M',
  '•\tPaperless Options',
  '•\tInvoice overhaul',
  'o\tFulfilment dev M',
  '•\tMass ID Card Reissue - future conversation',
].join('\n');

function buildOpenEpic(issueKey: string): JiraIssue {
  return {
    id: issueKey,
    key: issueKey,
    fields: { summary: 'Core Integration', issuetype: { name: 'Epic' }, status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } } },
  } as unknown as JiraIssue;
}

function createJiraDeps(createdRequests: CreateIssueRequest[]): IntakeJiraDeps {
  return {
    search: {
      getProjectIssueTypes: vi.fn(async () => ({ values: [{ id: '10000', name: 'Epic', subtask: false }] })),
      searchIssues: vi.fn(async () => []),
      fetchIssueByKey: vi.fn(async (issueKey: string) => buildOpenEpic(issueKey)),
      extractHttpStatus: vi.fn(() => null),
    },
    create: {
      createIssue: vi.fn(async (request: CreateIssueRequest) => {
        createdRequests.push(request);
        return { id: '901', key: 'DENP-901', self: '' };
      }),
      searchIssues: vi.fn(async () => []),
      nowIso: () => NOW_ISO,
    },
    loadCreateFields: vi.fn(async () => ({ values: [{ fieldId: 'summary', name: 'Summary', required: true, hasDefaultValue: false, schema: { type: 'string' } }] })) as unknown as IntakeJiraDeps['loadCreateFields'],
  };
}

/** Answers every item a prompt asks about, reading the ids straight off the prompt text — like the assistant would. */
function answerSorting(promptText: string): string {
  const askedIds = [...promptText.matchAll(/^(item-\d+) — answer:/gm)].map((match) => match[1]);
  const items = askedIds.map((itemId) => ({
    id: itemId, kind: 'work', owner: 'enrollment', enrollmentShare: 80, searchTerms: ['paperless options'], label: 'Roadmap', reason: 'from the notes',
  }));
  return JSON.stringify({ kind: 'epicIntakeClassify', items });
}

function answerResolve(promptText: string): string {
  const askedIds = [...new Set([...promptText.matchAll(/^(item-\d+):/gm)].map((match) => match[1]))];
  const items = askedIds.map((itemId) => ({ id: itemId, verdict: 'createNew', confidence: 'high', label: 'Roadmap', summary: 'Paperless options', description: 'Description:\nGo paperless.' }));
  return JSON.stringify({ kind: 'epicIntakeResolve', items });
}

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup({ delay: null });
  window.localStorage.clear();
  useAiAssistStore.setState({ isAiAssistUnlocked: true });
});

async function copyPromptAndPaste(answerFor: (promptText: string) => string): Promise<void> {
  const promptText = (screen.getByLabelText('Prompt to copy') as HTMLTextAreaElement).value;
  await user.click(screen.getByLabelText('Paste the answer here'));
  await user.paste(answerFor(promptText));
  await user.click(screen.getByRole('button', { name: 'Read the answer' }));
}

describe('the copy-and-paste loop', () => {
  it('goes notes → prompt → answer → automatic DENP check → prompt → answer → Create, with no questions asked', async () => {
    const createdRequests: CreateIssueRequest[] = [];
    const jiraDeps = createJiraDeps(createdRequests);
    render(<EpicIntakeWorkspace dashboardTeamProfileId="team-a" jiraDeps={jiraDeps} nowIso={() => NOW_ISO} />);

    await user.click(screen.getByLabelText('Pasted notes'));
    await user.paste(NOTES);
    await user.click(screen.getByRole('button', { name: 'Add pasted notes' }));
    await user.click(screen.getByRole('button', { name: 'Start intake' }));

    // Prompt 1 is on screen straight away — nothing to click first.
    expect(screen.getByRole('region', { name: 'Prompt 1' })).toBeInTheDocument();
    await copyPromptAndPaste(answerSorting);

    // DENP is checked without a click, then Prompt 2 appears.
    await screen.findByRole('region', { name: 'Prompt 2' });
    expect(jiraDeps.search.fetchIssueByKey).toHaveBeenCalledWith('DENP-632');
    await copyPromptAndPaste(answerResolve);

    // Only Create is left.
    await user.click(await screen.findByRole('button', { name: 'Create 1 Epic(s)' }));
    await waitFor(() => expect(createdRequests).toHaveLength(1));
    expect(createdRequests[0].fields).toMatchObject({ summary: 'Paperless options', labels: ['Roadmap'] });

    // No question was ever put to the PO.
    expect(screen.queryByRole('list', { name: 'Questions for you' })).not.toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Summary' });
    expect(within(summary).getByRole('link', { name: 'DENP-632' })).toBeInTheDocument();
    expect(within(summary).getByRole('link', { name: 'DENP-901' })).toBeInTheDocument();
  });

  it('asks again in the next prompt when an answer is unusable, instead of asking the PO', async () => {
    render(<EpicIntakeWorkspace dashboardTeamProfileId="team-a" jiraDeps={createJiraDeps([])} nowIso={() => NOW_ISO} />);
    await user.click(screen.getByLabelText('Pasted notes'));
    await user.paste('•\tPaperless Options');
    await user.click(screen.getByRole('button', { name: 'Add pasted notes' }));
    await user.click(screen.getByRole('button', { name: 'Start intake' }));

    await copyPromptAndPaste(() => JSON.stringify({ kind: 'epicIntakeClassify', items: [{ id: 'item-1', kind: 'banana' }] }));

    expect(screen.getByRole('region', { name: 'Prompt 2' })).toBeInTheDocument();
    expect(screen.getByText(/asked again in the next prompt/)).toBeInTheDocument();
    expect((screen.getByLabelText('Prompt to copy') as HTMLTextAreaElement).value).toContain('item-1 — answer: kind');
  });
});
