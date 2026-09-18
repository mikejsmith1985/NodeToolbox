// EpicIntakeWorkspace.test.tsx — The Epic Intake mode with the assistant unlocked: a pasted sorting answer is checked
// and applied, and the intake survives the tab closing and resumes on the same step (spec 037, US1, US6).

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAiAssistStore } from '../../../store/aiAssistStore';
import type { IntakeJiraDeps } from './components/IntakeTurnPanel.tsx';
import EpicIntakeWorkspace from './EpicIntakeWorkspace.tsx';

const NOW_ISO = '2026-09-18T12:00:00.000Z';
const NOTES = '•\tPaperless Options\n•\tTech Debt/Performance Enhancements';

function createIdleJiraDeps(): IntakeJiraDeps {
  return {
    search: { getProjectIssueTypes: vi.fn(), searchIssues: vi.fn(), fetchIssueByKey: vi.fn(), extractHttpStatus: vi.fn(() => null) },
    create: { createIssue: vi.fn(), searchIssues: vi.fn(), nowIso: () => NOW_ISO },
    loadCreateFields: vi.fn(),
  };
}

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  user = userEvent.setup({ delay: null });
  window.localStorage.clear();
  useAiAssistStore.setState({ isAiAssistUnlocked: true });
});

function renderWorkspace() {
  return render(<EpicIntakeWorkspace dashboardTeamProfileId="team-a" jiraDeps={createIdleJiraDeps()} nowIso={() => NOW_ISO} />);
}

async function startIntakeFromNotes(): Promise<void> {
  await user.click(screen.getByLabelText('Pasted notes'));
  await user.paste(NOTES);
  await user.click(screen.getByRole('button', { name: 'Add pasted notes' }));
  await user.click(screen.getByRole('button', { name: 'Start intake' }));
}

describe('EpicIntakeWorkspace', () => {
  it('builds the sorting request, applies a pasted answer, and hands the close call to the PO', async () => {
    renderWorkspace();
    await startIntakeFromNotes();

    await user.click(screen.getByRole('button', { name: 'Build the prompt' }));
    const request = (screen.getByLabelText(/^Prompt/) as HTMLTextAreaElement).value;
    expect(request).toContain('Paperless Options');

    const answer = JSON.stringify({
      kind: 'epicIntakeClassify',
      items: [
        { id: 'item-1', kind: 'work', enrollmentShare: 80, searchTerms: ['paperless options'], labelProposal: 'Roadmap' },
        { id: 'item-2', kind: 'work', enrollmentShare: 50, searchTerms: ['tech debt'], labelProposal: 'Stability', reason: 'shared platform' },
        { id: 'item-99', kind: 'work' },
      ],
    });
    await user.click(screen.getByLabelText(/Paste the assistant/));
    await user.paste(answer);
    await user.click(screen.getByRole('button', { name: 'Read the reply' }));

    expect(screen.getByText(/item-99/)).toBeInTheDocument();
    const questions = screen.getByRole('list', { name: 'Questions for you' });
    expect(within(questions).getByLabelText(/Who owns "Tech Debt\/Performance Enhancements"/)).toBeInTheDocument();
    expect(within(questions).getByText(/close call/)).toBeInTheDocument();
  });

  it('saves as it goes and resumes on the same step after the tab is closed (US6-1)', async () => {
    const firstRender = renderWorkspace();
    await startIntakeFromNotes();
    await user.click(screen.getByRole('button', { name: 'Answer these myself' }));
    expect(screen.getByLabelText(/What is "Paperless Options"/)).toBeInTheDocument();
    firstRender.unmount();

    renderWorkspace();
    const savedList = screen.getByRole('region', { name: 'Saved intakes' });
    await user.click(within(savedList).getByRole('button', { name: 'Resume' }));
    expect(screen.getByLabelText(/What is "Paperless Options"/)).toBeInTheDocument();
  });

  it('discards a saved intake only after confirmation', async () => {
    const firstRender = renderWorkspace();
    await startIntakeFromNotes();
    firstRender.unmount();

    renderWorkspace();
    const savedList = screen.getByRole('region', { name: 'Saved intakes' });
    await user.click(within(savedList).getByRole('button', { name: 'Discard' }));
    await user.click(within(savedList).getByRole('button', { name: 'Keep it' }));
    expect(within(savedList).getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    await user.click(within(savedList).getByRole('button', { name: 'Discard' }));
    await user.click(within(savedList).getByRole('button', { name: 'Yes, discard' }));
    expect(within(savedList).queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
  });
});
