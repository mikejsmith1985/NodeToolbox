// CheckInTab.test.tsx — The workspace where a status message is prepared before it is sent.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockJiraGet } = vi.hoisted(() => ({ mockJiraGet: vi.fn() }));

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: mockJiraGet }));

import CheckInTab from './CheckInTab.tsx';
import { setAiAssistUnlocked } from '../../../store/aiAssistStore.ts';
import { CHECK_IN_REPLY_KIND } from './checkInPrompt.ts';

/** One Jira issue, carrying only what the tab reads. */
function jiraIssue(key: string, fields: Record<string, unknown> = {}) {
  return {
    key,
    fields: {
      summary: `Summary for ${key}`,
      issuetype: { name: 'Story' },
      status: { name: 'In Progress' },
      updated: '2026-08-25T00:00:00.000Z',
      statuscategorychangedate: '2026-08-18T00:00:00.000Z',
      ...fields,
    },
  };
}

/** Renders the tab for a simulated person. */
function renderTab() {
  render(
    <CheckInTab
      subject={{ kind: 'user', accountId: '557058:ab-12', displayName: 'Reynolds, Kevin' }}
      memberIdentifiers={[]}
      subjectName="Reynolds, Kevin"
    />,
  );
}

/** A well-formed reply for the given issue. */
function replyFor(issueKey: string, looksFine = false): string {
  return JSON.stringify({
    kind: CHECK_IN_REPLY_KIND,
    opening: 'Quick check-in when you get a sec:',
    items: [{
      issueKey,
      observation: 'Has sat at this stage 9 days.',
      question: 'Still waiting on the Axway change?',
      suggestion: '',
      looksFine,
    }],
  });
}

describe('CheckInTab', () => {
  beforeEach(() => {
    mockJiraGet.mockReset();
    setAiAssistUnlocked(true);
  });

  it('names the person the check-in is about', async () => {
    mockJiraGet.mockResolvedValue({ issues: [jiraIssue('ENCUC-1')] });

    renderTab();

    expect(await screen.findByText(/Status check-in — Reynolds, Kevin/)).toBeInTheDocument();
  });

  it('shows the plate, so the sender sees what is being asked about before asking it', async () => {
    mockJiraGet.mockResolvedValue({ issues: [jiraIssue('ENCUC-1')] });

    renderTab();

    const plate = await screen.findByLabelText('Work to check in on');

    expect(plate).toHaveTextContent('ENCUC-1');
    expect(plate).toHaveTextContent('Summary for ENCUC-1');
  });

  it('says an item has no comments, because that is itself the signal', async () => {
    mockJiraGet.mockResolvedValue({ issues: [jiraIssue('ENCUC-1')] });

    renderTab();

    expect(await screen.findByLabelText('Work to check in on')).toHaveTextContent('no comments');
  });

  it('says so plainly when the person has nothing open', async () => {
    mockJiraGet.mockResolvedValue({ issues: [] });

    renderTab();

    expect(await screen.findByText(/has no open assigned work/)).toBeInTheDocument();
  });

  it('renders nothing of the AI round trip while AI Assist is locked', async () => {
    setAiAssistUnlocked(false);
    mockJiraGet.mockResolvedValue({ issues: [jiraIssue('ENCUC-1')] });

    renderTab();

    await screen.findByLabelText('Work to check in on');
    expect(screen.queryByText(/Draft the check-in message/)).not.toBeInTheDocument();
  });

  it('turns a pasted reply into a message that can be sent', async () => {
    const user = userEvent.setup();
    mockJiraGet.mockResolvedValue({ issues: [jiraIssue('ENCUC-1')] });

    renderTab();
    await screen.findByLabelText('Work to check in on');

    const replyBox = screen.getByRole('textbox', { name: /reply/i });
    await user.click(replyBox);
    await user.paste(replyFor('ENCUC-1'));
    await user.click(screen.getByRole('button', { name: /read the reply/i }));

    const messageBox = await screen.findByLabelText('Message to send');

    expect((messageBox as HTMLTextAreaElement).value).toContain('Still waiting on the Axway change?');
    expect((messageBox as HTMLTextAreaElement).value).toContain('ENCUC-1 — Summary for ENCUC-1');
  });

  it('says how many items need asking about before the sender reads the message', async () => {
    const user = userEvent.setup();
    mockJiraGet.mockResolvedValue({ issues: [jiraIssue('ENCUC-1')] });

    renderTab();
    await screen.findByLabelText('Work to check in on');

    const replyBox = screen.getByRole('textbox', { name: /reply/i });
    await user.click(replyBox);
    await user.paste(replyFor('ENCUC-1'));
    await user.click(screen.getByRole('button', { name: /read the reply/i }));

    expect(await screen.findByText('1 item to ask about')).toBeInTheDocument();
  });

  it('surfaces a reply it could not read instead of failing quietly', async () => {
    const user = userEvent.setup();
    mockJiraGet.mockResolvedValue({ issues: [jiraIssue('ENCUC-1')] });

    renderTab();
    await screen.findByLabelText('Work to check in on');

    const replyBox = screen.getByRole('textbox', { name: /reply/i });
    await user.click(replyBox);
    await user.paste('I could not do that.');
    await user.click(screen.getByRole('button', { name: /read the reply/i }));

    // Whatever the parser objected to, the sender has to see that the paste did not take — and must
    // not be handed a message drafted from a reply that was never read.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByLabelText('Message to send')).not.toBeInTheDocument();
  });

  it('lets the sender edit the message, because their own wording beats a drafted one', async () => {
    const user = userEvent.setup();
    mockJiraGet.mockResolvedValue({ issues: [jiraIssue('ENCUC-1')] });

    renderTab();
    await screen.findByLabelText('Work to check in on');

    const replyBox = screen.getByRole('textbox', { name: /reply/i });
    await user.click(replyBox);
    await user.paste(replyFor('ENCUC-1'));
    await user.click(screen.getByRole('button', { name: /read the reply/i }));

    const messageBox = await screen.findByLabelText('Message to send');
    await user.clear(messageBox);
    await user.type(messageBox, 'My own wording.');

    expect(messageBox).toHaveValue('My own wording.');
    expect(screen.getByRole('button', { name: /reset to the draft/i })).toBeInTheDocument();
  });

  it('says plainly when the work could not be loaded', async () => {
    mockJiraGet.mockRejectedValue(new Error('Jira is unreachable'));

    renderTab();

    expect(await screen.findByText('Jira is unreachable')).toBeInTheDocument();
  });
});
