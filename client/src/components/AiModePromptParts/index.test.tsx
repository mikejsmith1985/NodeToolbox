// index.test.tsx (AiModePromptParts) — Proves a prompt too long for AI Mode's box is walked through part by part (GH #499).

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { splitPromptForAiMode } from '../../utils/aiModeParts.ts';
import { AiModePromptParts } from './index.tsx';

afterEach(() => cleanup());

/** A prompt of numbered lines long enough to need several AI Mode parts. */
const LONG_PROMPT = Array.from({ length: 120 }, (_unused, lineIndex) => `line ${lineIndex} ${'w'.repeat(60)}`).join('\n');

describe('AiModePromptParts', () => {
  it('shows nothing for a prompt short enough to paste', () => {
    const { container } = render(<AiModePromptParts promptText="Short prompt" />);
    expect(container.innerHTML).toBe('');
  });

  it('copies one part at a time, stepping on to the next, and says when all are copied', () => {
    const writeText = vi.fn();
    const expectedParts = splitPromptForAiMode(LONG_PROMPT);
    const partCount = expectedParts.length;
    render(<AiModePromptParts promptText={LONG_PROMPT} writeText={writeText} />);

    expect(screen.getByText(`Too long for one AI Mode message — send it in ${partCount} parts`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: `Copy part 1 of ${partCount}` }));
    expect(writeText).toHaveBeenLastCalledWith(expectedParts[0].messageText);
    expect(screen.getByText(new RegExp(`^Part 1 of ${partCount} copied — paste it into AI Mode, wait for "READY FOR PART 2"`))).toBeTruthy();
    expect(screen.getByRole('button', { name: `Copy part 2 of ${partCount}` })).toBeTruthy();

    for (let partNumber = 2; partNumber <= partCount; partNumber += 1) {
      fireEvent.click(screen.getByRole('button', { name: `Copy part ${partNumber} of ${partCount}` }));
    }
    expect(writeText).toHaveBeenLastCalledWith(expectedParts[partCount - 1].messageText);
    expect(screen.getByText(new RegExp(`^Part ${partCount} of ${partCount} copied — paste it into AI Mode; it answers now`))).toBeTruthy();
  });

  it('goes back a part, or starts over at part 1', () => {
    const partCount = splitPromptForAiMode(LONG_PROMPT).length;
    render(<AiModePromptParts promptText={LONG_PROMPT} writeText={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: `Copy part 1 of ${partCount}` }));
    fireEvent.click(screen.getByRole('button', { name: `Copy part 2 of ${partCount}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Back a part' }));
    expect(screen.getByRole('button', { name: `Copy part 2 of ${partCount}` })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));
    expect(screen.getByRole('button', { name: `Copy part 1 of ${partCount}` })).toBeTruthy();
  });

  it('starts again at part 1 when the prompt changes', () => {
    const partCount = splitPromptForAiMode(LONG_PROMPT).length;
    const { rerender } = render(<AiModePromptParts promptText={LONG_PROMPT} writeText={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: `Copy part 1 of ${partCount}` }));
    rerender(<AiModePromptParts promptText={`${LONG_PROMPT}\nmore`} writeText={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Copy part 1 of \d+$/ })).toBeTruthy();
  });
});
