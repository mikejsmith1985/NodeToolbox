// CopyButton.test.tsx — Proves every copy in the Wizard tells the user it worked, or how to finish it by hand (the
// owner's probe finding: "Copy result" gave no feedback).

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CopyButton, { COPIED_CONFIRMATION_MS } from './CopyButton.tsx';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
});

describe('CopyButton', () => {
  it('copies the text and says "Copied ✓", then returns to its label', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<CopyButton text="hello" label="Copy note" />);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy note' })); });

    expect(writeText).toHaveBeenCalledWith('hello');
    expect(screen.getByRole('button').textContent).toBe('Copied ✓');
    act(() => { vi.advanceTimersByTime(COPIED_CONFIRMATION_MS + 1); });
    expect(screen.getByRole('button').textContent).toBe('Copy note');
  });

  it('selects the text and says "Press Ctrl+C" when the browser blocks copying', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    render(<><textarea id="note-text" defaultValue="hello" /><CopyButton text="hello" label="Copy note" fallbackTargetId="note-text" /></>);

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy note' })); });

    expect(screen.getByRole('button').textContent).toBe('Press Ctrl+C');
    const noteField = document.getElementById('note-text') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(noteField);
    expect(noteField.selectionEnd - noteField.selectionStart).toBe(5);
  });

  it('falls back the same way when there is no clipboard at all', async () => {
    render(<CopyButton text="hello" label="Copy note" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy note' })); });
    expect(screen.getByRole('button').textContent).toBe('Press Ctrl+C');
  });
});
