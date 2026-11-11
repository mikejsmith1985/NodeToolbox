// index.test.tsx (AiPromptFile) — Proves a prompt too long for AI Mode's box is offered as a file with a short message (GH #499).

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiPromptFile } from './index.tsx';

afterEach(() => cleanup());

describe('AiPromptFile', () => {
  it('shows nothing for a prompt short enough to paste', () => {
    const { container } = render(<AiPromptFile promptText="Short prompt" fileBaseName="risk-check-prompt" />);
    expect(container.innerHTML).toBe('');
  });

  it('downloads a too-long prompt as a PDF or text file, and copies the short message to send with it', () => {
    const downloadFile = vi.fn();
    const writeText = vi.fn(async (_copiedText: string) => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<AiPromptFile promptText={'x'.repeat(5_000)} fileBaseName="risk-check-prompt" downloadFile={downloadFile} />);

    expect(screen.getByText(/takes 2,048 characters and drops\s+the rest; this prompt is 5,000/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Download the prompt (PDF)' }));
    expect(downloadFile.mock.calls[0][0]).toBe('risk-check-prompt.pdf');
    expect((downloadFile.mock.calls[0][1] as Blob).type).toBe('application/pdf');
    fireEvent.click(screen.getByRole('button', { name: 'or as a text file' }));
    expect(downloadFile.mock.calls[1][0]).toBe('risk-check-prompt.txt');
    fireEvent.click(screen.getByRole('button', { name: /Copy the message to send with it/ }));
    expect(writeText.mock.calls[0][0]).toContain('"risk-check-prompt.pdf" is my complete request');
  });
});
