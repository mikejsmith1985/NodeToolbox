// aiModeParts.test.ts — Proves a prompt too long for AI Mode's 2,048-character box becomes parts that each fit, with
// nothing lost, every part but the last asking for "READY" (GH #499).

import { describe, expect, it } from 'vitest';

import {
  AI_MODE_MESSAGE_CHARACTER_LIMIT,
  buildAiModePromptFile,
  isPromptTooLongForAiMode,
  measureAiModeMessage,
  splitPromptForAiMode,
} from './aiModeParts.ts';

/** A prompt of numbered lines, each about 70 characters — the shape of the app's real prompts. */
function buildLongPrompt(lineCount: number): string {
  return Array.from({ length: lineCount }, (_unused, lineIndex) => `line ${lineIndex} ${'w'.repeat(60)}`).join('\n');
}

describe('measureAiModeMessage', () => {
  it('counts a line break twice, in case the box counts it as two characters', () => {
    expect(measureAiModeMessage('ab\ncd')).toBe(6);
  });
});

describe('isPromptTooLongForAiMode', () => {
  it('is false up to the 2,048-character box and true past it', () => {
    expect(AI_MODE_MESSAGE_CHARACTER_LIMIT).toBe(2_048);
    expect(isPromptTooLongForAiMode('x'.repeat(2_048))).toBe(false);
    expect(isPromptTooLongForAiMode('x'.repeat(2_049))).toBe(true);
  });
});

describe('splitPromptForAiMode', () => {
  it('leaves a prompt that fits as one message, unchanged and unheaded', () => {
    expect(splitPromptForAiMode('Write the change.')).toEqual([{ partNumber: 1, messageText: 'Write the change.', bodyText: 'Write the change.' }]);
  });

  it('packs a 44,000-character prompt into parts that each fit the box, losing nothing', () => {
    const promptText = buildLongPrompt(620);
    const parts = splitPromptForAiMode(promptText);
    parts.forEach((part) => expect(measureAiModeMessage(part.messageText)).toBeLessThanOrEqual(AI_MODE_MESSAGE_CHARACTER_LIMIT));
    expect(parts.map((part) => part.bodyText).join('')).toBe(promptText);
    // Packed full, not halved: within a few parts of the least possible.
    expect(parts.length).toBeLessThanOrEqual(Math.ceil(measureAiModeMessage(promptText) / 1_800) + 1);
  });

  it('breaks at line ends, so no line of the prompt is split across two parts', () => {
    const parts = splitPromptForAiMode(buildLongPrompt(200));
    parts.slice(0, -1).forEach((part) => expect(part.bodyText.endsWith('\n')).toBe(true));
  });

  it('explains the exchange in part 1, asks for READY on every part but the last, and answers on the last', () => {
    const parts = splitPromptForAiMode(buildLongPrompt(200));
    const partCount = parts.length;
    expect(parts[0].messageText).toMatch(new RegExp(`^PART 1 OF ${partCount}\\. My request is too long for one message`));
    expect(parts[0].messageText).toMatch(/Do not search and do not answer yet/);
    expect(parts[1].messageText).toMatch(new RegExp(`^PART 2 OF ${partCount}, continued\\.`));
    expect(parts[1].messageText).toMatch(/\(End of part 2 of \d+\. Reply only "READY FOR PART 3"\.\)$/);
    expect(parts[partCount - 1].messageText).toMatch(new RegExp(`^PART ${partCount} OF ${partCount}, the last part\\. You now have my whole request: answer it now`));
    expect(parts[partCount - 1].messageText).not.toContain('READY FOR PART');
  });

  it('cuts even one enormous line without losing a character', () => {
    const promptText = 'x'.repeat(10_000);
    const parts = splitPromptForAiMode(promptText);
    parts.forEach((part) => expect(measureAiModeMessage(part.messageText)).toBeLessThanOrEqual(AI_MODE_MESSAGE_CHARACTER_LIMIT));
    expect(parts.map((part) => part.bodyText).join('')).toBe(promptText);
  });
});

describe('buildAiModePromptFile', () => {
  it('wraps the whole prompt in a dated .txt file, losing nothing', async () => {
    const promptFile = buildAiModePromptFile('Line one\nLine two', new Date('2026-11-12T13:05:00'));
    expect(promptFile.fileName).toBe('ai-mode-prompt-2026-11-12_1305.txt');
    expect(promptFile.blob.type).toBe('text/plain');
    expect(await promptFile.blob.text()).toBe('Line one\nLine two');
  });

  it('pads single-digit months, days, hours and minutes to two digits', () => {
    const promptFile = buildAiModePromptFile('x', new Date('2026-01-09T08:07:00'));
    expect(promptFile.fileName).toBe('ai-mode-prompt-2026-01-09_0807.txt');
  });
});
