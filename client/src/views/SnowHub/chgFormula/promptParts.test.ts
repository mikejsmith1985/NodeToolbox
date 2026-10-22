// promptParts.test.ts — Proves a prompt too long for one AI chat message is halved into parts that each fit, with nothing
// lost, every part but the last telling the assistant to wait (GH #475: 134,856 characters against Copilot's 128,000).

import { describe, expect, it } from 'vitest';

import { ASSISTANT_PROMPT_CHARACTER_LIMIT, describePromptParts, splitPromptIntoParts } from './promptParts.ts';

/** A prompt of numbered lines, each about 70 characters. */
function buildLongPrompt(lineCount: number): string {
  return Array.from({ length: lineCount }, (_unused, lineIndex) => `line ${lineIndex} ${'w'.repeat(60)}`).join('\n');
}

/** A part with its heading and closing line taken off, so the pieces can be joined back. */
function readPartBody(partText: string): string {
  return partText.split('\n').slice(2).filter((line) => !line.startsWith('(End of part')).join('\n').replace(/\n$/, '');
}

describe('splitPromptIntoParts', () => {
  it('leaves a prompt that fits as one message, unchanged', () => {
    expect(splitPromptIntoParts('Write the change.')).toEqual(['Write the change.']);
  });

  it('halves a too-long prompt at line breaks until every part fits, losing nothing', () => {
    const promptText = buildLongPrompt(2_000);
    const parts = splitPromptIntoParts(promptText, 40_000);
    expect(parts.length).toBe(4);
    parts.forEach((partText) => expect(partText.length).toBeLessThanOrEqual(40_000));
    expect(parts.map(readPartBody).join('\n')).toBe(promptText);
  });

  it('heads every part, asks the assistant to wait on all but the last, and answers on the last', () => {
    const parts = splitPromptIntoParts(buildLongPrompt(2_000), ASSISTANT_PROMPT_CHARACTER_LIMIT);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatch(/^PART 1 OF 2 — .*Do not answer yet: reply only with "READY FOR PART 2"\./);
    expect(parts[0]).toMatch(/\(End of part 1 of 2\. Reply only with "READY FOR PART 2"\.\)$/);
    expect(parts[1]).toMatch(/^PART 2 OF 2 — the last part\. You now have the whole request: answer it now/);
    expect(parts[1]).not.toContain('READY FOR PART');
  });

  it('halves even one enormous line', () => {
    const parts = splitPromptIntoParts('x'.repeat(10_000), 3_000);
    parts.forEach((partText) => expect(partText.length).toBeLessThanOrEqual(3_000));
    expect(parts.map(readPartBody).join('')).toBe('x'.repeat(10_000));
  });
});

describe('describePromptParts', () => {
  it('says how to paste the parts, and nothing for one message', () => {
    expect(describePromptParts(1)).toBe('');
    expect(describePromptParts(3)).toContain('comes in 3 parts. Paste them in order into the same chat');
  });
});
