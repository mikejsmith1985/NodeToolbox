// EpicIntakeWorkspace.test.tsx — The Epic Intake mode with the assistant unlocked: a pasted sorting answer is checked
// and applied straight into the review table (a close call becomes Shared and is flagged, never asked), and the intake
// survives the tab closing and resumes exactly as it was left (spec 037, US1, US6, GH #387 feedback).

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
  it('builds the sorting request, applies a pasted answer, and settles a close call as Shared with a flag', async () => {
    renderWorkspace();
    await startIntakeFromNotes();

    // The loop shows the prompt straight away — nothing to click first.
    const request = (screen.getByLabelText('Prompt to copy') as HTMLTextAreaElement).value;
    expect(request).toContain('Paperless Options');

    const answer = JSON.stringify({
      kind: 'epicIntakeClassify',
      items: [
        { id: 'item-1', kind: 'work', enrollmentShare: 80, searchTerms: ['paperless options'], labelProposal: 'Roadmap' },
        { id: 'item-2', kind: 'work', enrollmentShare: 50, searchTerms: ['tech debt'], labelProposal: 'Stability', reason: 'shared platform' },
        { id: 'item-99', kind: 'work' },
      ],
    });
    await user.click(screen.getByLabelText('Paste the answer here'));
    await user.paste(answer);
    await user.click(screen.getByRole('button', { name: 'Read the answer' }));

    expect(screen.getAllByText(/item-99/).length).toBeGreaterThan(0);
    const review = screen.getByRole('region', { name: 'Review the items' });
    expect(within(review).getByRole('combobox', { name: 'Owner for "Tech Debt/Performance Enhancements"' })).toHaveValue('shared');
    expect(within(review).getByRole('combobox', { name: 'Owner for "Paperless Options"' })).toHaveValue('enrollment');
    expect(within(review).getByText(/⚠ Shared/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Questions for you' })).not.toBeInTheDocument();
  });

  it('saves as it goes and resumes on the same prompt after the tab is closed (US6-1)', async () => {
    const firstRender = renderWorkspace();
    await startIntakeFromNotes();
    const answer = JSON.stringify({ kind: 'epicIntakeClassify', items: [{ id: 'item-1', kind: 'work', owner: 'fulfillment', searchTerms: ['paperless'] }] });
    await user.click(screen.getByLabelText('Paste the answer here'));
    await user.paste(answer);
    await user.click(screen.getByRole('button', { name: 'Read the answer' }));
    firstRender.unmount();

    renderWorkspace();
    const savedList = screen.getByRole('region', { name: 'Saved intakes' });
    await user.click(within(savedList).getByRole('button', { name: 'Resume' }));
    // Paperless was answered and saved; the next prompt asks only about the item still open.
    expect(screen.getByRole('region', { name: 'Prompt 2' })).toBeInTheDocument();
    const promptText = (screen.getByLabelText('Prompt to copy') as HTMLTextAreaElement).value;
    expect(promptText).toContain('item-2 — answer:');
    expect(promptText).not.toContain('item-1 — answer:');
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
