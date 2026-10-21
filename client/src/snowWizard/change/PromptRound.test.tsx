// PromptRound.test.tsx — Proves the round shows the prompt to copy and hands the pasted reply to its reader.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import PromptRound from './PromptRound.tsx';

describe('PromptRound', () => {
  it('shows the prompt, waits for a reply, then reports what the reader said', () => {
    const onReadReply = vi.fn(() => 'Read 2 suggestions.');
    render(<PromptRound promptText="Review this change" copyLabel="Copy the prompt" readButtonLabel="Read the reply" onReadReply={onReadReply} />);

    expect(screen.getByDisplayValue('Review this change')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy the prompt' })).toBeTruthy();
    const readButton = screen.getByRole('button', { name: 'Read the reply' }) as HTMLButtonElement;
    expect(readButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Paste the assistant/), { target: { value: 'VERDICT: READY' } });
    fireEvent.click(readButton);
    expect(onReadReply).toHaveBeenCalledWith('VERDICT: READY');
    expect(screen.getByRole('status').textContent).toBe('Read 2 suggestions.');
  });

  it('pastes the reply from the clipboard and reads it in one click, and says so when the browser will not share it', async () => {
    const onReadReply = vi.fn(() => 'Read 3 fields.');
    const readText = vi.fn(async () => 'BACKOUT_PLAN: 1. Redeploy v1');
    Object.defineProperty(navigator, 'clipboard', { value: { readText, writeText: vi.fn(async () => undefined) }, configurable: true });
    render(<PromptRound promptText="Prompt" copyLabel="Copy the prompt" readButtonLabel="Read the reply" onReadReply={onReadReply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));
    await screen.findByText('Read 3 fields.');
    expect(onReadReply).toHaveBeenCalledWith('BACKOUT_PLAN: 1. Redeploy v1');
    expect((screen.getByLabelText(/Paste the assistant/) as HTMLTextAreaElement).value).toBe('BACKOUT_PLAN: 1. Redeploy v1');

    readText.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));
    await screen.findByText(/would not share the clipboard/);
  });
});
