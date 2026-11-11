// NlToJqlControl.test.tsx — Verifies the gated NL→JQL helper is hidden when locked and additive when unlocked.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setAiAssistUnlocked } from '../../../store/aiAssistStore.ts';
import { AI_MODE_MESSAGE_CHARACTER_LIMIT } from '../../../utils/aiModeParts.ts';
import { NlToJqlControl } from './NlToJqlControl.tsx';

describe('NlToJqlControl', () => {
  afterEach(() => {
    act(() => setAiAssistUnlocked(false));
  });

  it('renders nothing when AI Assist is locked (manual parity)', () => {
    act(() => setAiAssistUnlocked(false)); // AI Assist is on by default now — lock it for the locked case.
    const { container } = render(<NlToJqlControl projectKey="ENCUC" piName="PI 26.3" onAcceptJql={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers a prompt too long for AI Mode\'s message box in parts that each fit AI Mode (GH #499)', () => {
    act(() => setAiAssistUnlocked(true));
    render(<NlToJqlControl projectKey="ENCUC" piName="PI 26.3" onAcceptJql={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Ask/ }));
    fireEvent.change(screen.getByLabelText(/Describe the scope/), { target: { value: 'x'.repeat(AI_MODE_MESSAGE_CHARACTER_LIMIT + 1) } });

    expect(screen.getByRole('button', { name: /^Copy part 1 of \d+$/ })).toBeInTheDocument();
  });

  it('proposes a JQL from a valid reply and accepts it into the scope box', () => {
    act(() => setAiAssistUnlocked(true));
    const onAcceptJql = vi.fn();
    render(<NlToJqlControl projectKey="ENCUC" piName="PI 26.3" onAcceptJql={onAcceptJql} />);

    fireEvent.click(screen.getByRole('button', { name: /Ask/ }));
    fireEvent.change(screen.getByLabelText(/Paste reply/), { target: { value: '{"kind":"scopeQuery","jql":"project = ENCUC AND labels = ENCUC"}' } });
    fireEvent.click(screen.getByRole('button', { name: /Get JQL/ }));
    fireEvent.click(screen.getByRole('button', { name: /Use this query/ }));

    expect(onAcceptJql).toHaveBeenCalledWith('project = ENCUC AND labels = ENCUC');
  });

  it('shows a descriptive error on a malformed reply and proposes nothing', () => {
    act(() => setAiAssistUnlocked(true));
    const onAcceptJql = vi.fn();
    render(<NlToJqlControl projectKey="ENCUC" piName="PI 26.3" onAcceptJql={onAcceptJql} />);

    fireEvent.click(screen.getByRole('button', { name: /Ask/ }));
    fireEvent.change(screen.getByLabelText(/Paste reply/), { target: { value: 'not json' } });
    fireEvent.click(screen.getByRole('button', { name: /Get JQL/ }));

    expect(screen.getByText(/No JQL query found/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Use this query/ })).not.toBeInTheDocument();
    expect(onAcceptJql).not.toHaveBeenCalled();
    // A follow-up for the same AI chat asks for just the JQL line.
    expect((screen.getByLabelText(/follow-up for the same ai chat/i) as HTMLTextAreaElement).value).toContain('JQL: [text]');
  });

  it('proposes only the query from an AI Mode reply with an intro, a ```jql block and a closing offer (GH #499)', () => {
    act(() => setAiAssistUnlocked(true));
    const onAcceptJql = vi.fn();
    render(<NlToJqlControl projectKey="ENCUC" piName="PI 26.3" onAcceptJql={onAcceptJql} />);

    fireEvent.click(screen.getByRole('button', { name: /Ask/ }));
    fireEvent.change(screen.getByLabelText(/Paste reply/), {
      target: { value: 'Use this query to find them.\n\nJQL:\n```jql\nproject = ENCUC AND labels = ENCUC\n```\nIf you want, I can add a status filter.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Get JQL/ }));
    fireEvent.click(screen.getByRole('button', { name: /Use this query/ }));

    expect(onAcceptJql).toHaveBeenCalledWith('project = ENCUC AND labels = ENCUC');
  });
});
