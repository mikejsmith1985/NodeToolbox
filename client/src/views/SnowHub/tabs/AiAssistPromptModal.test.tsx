// AiAssistPromptModal.test.tsx — The shared copy-out / paste-back modal every CHG AI Assist round uses (GH #395).

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AiAssistPromptModal, type AiAssistPromptSession } from './AiAssistPromptModal.tsx';

function buildSession(overrides: Partial<AiAssistPromptSession> = {}): AiAssistPromptSession {
  return {
    instructions: 'Copy this prompt into AI Assist.',
    promptText: 'Review this change.',
    applyButtonLabel: 'Use this review',
    applyReply: vi.fn(() => ({ statusMessage: 'Review captured.', wasApplied: true })),
    ...overrides,
  };
}

describe('AiAssistPromptModal', () => {
  it('shows the instructions and the prompt to copy', () => {
    render(<AiAssistPromptModal onClose={vi.fn()} session={buildSession()} />);

    expect(screen.getByText('Copy this prompt into AI Assist.')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Review this change.')).toBeInTheDocument();
  });

  it('splits a prompt too long for one chat message into parts, each copied on its own (GH #475)', () => {
    const writeText = vi.fn(async (_copiedText: string) => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const longPrompt = Array.from({ length: 3_000 }, (_unused, lineIndex) => `line ${lineIndex} ${'w'.repeat(60)}`).join('\n');
    render(<AiAssistPromptModal onClose={vi.fn()} session={buildSession({ promptText: longPrompt })} />);

    expect(screen.getByText(/comes in 2 parts\. Paste them in order into the same chat/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Copy to Clipboard/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Copy part 2 of 2/ }));
    expect(writeText.mock.calls[0][0]).toMatch(/^PART 2 OF 2 — the last part/);
    expect((screen.getByLabelText('Prompt part 1 of 2') as HTMLTextAreaElement).value).toMatch(/^PART 1 OF 2 — /);
  });

  it('hands the pasted reply to the session, shows the outcome and clears a used reply', () => {
    const session = buildSession();
    render(<AiAssistPromptModal onClose={vi.fn()} session={session} />);
    const replyBox = screen.getByLabelText(/Paste the assistant/);

    fireEvent.change(replyBox, { target: { value: 'PASS | Short Description — clear.' } });
    fireEvent.click(screen.getByRole('button', { name: /Use this review/ }));

    expect(session.applyReply).toHaveBeenCalledWith('PASS | Short Description — clear.');
    expect(screen.getByRole('status')).toHaveTextContent('Review captured.');
    expect(replyBox).toHaveValue('');
  });

  it('keeps a reply the session could not use, so it can be corrected', () => {
    render(<AiAssistPromptModal
      onClose={vi.fn()}
      session={buildSession({ applyReply: () => ({ statusMessage: 'Nothing recognisable.', wasApplied: false }) })}
    />);
    const replyBox = screen.getByLabelText(/Paste the assistant/);

    fireEvent.change(replyBox, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /Use this review/ }));

    expect(replyBox).toHaveValue('hello');
  });

  it('closes on request', () => {
    const handleClose = vi.fn();
    render(<AiAssistPromptModal onClose={handleClose} session={buildSession()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(handleClose).toHaveBeenCalled();
  });
});
