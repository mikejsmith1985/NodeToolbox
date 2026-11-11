// promptFile.test.ts — Proves a prompt too long for AI Mode's 2,048-character box becomes an attachable file (GH #499).

import { describe, expect, it } from 'vitest';

import {
  AI_MODE_MESSAGE_CHARACTER_LIMIT,
  buildPromptFileMessage,
  buildPromptPdfBytes,
  isPromptTooLongToPaste,
} from './promptFile.ts';

/** The PDF's bytes as text, one character per byte, so its structure can be read. */
function readPdfText(pdfBytes: Uint8Array): string {
  return Array.from(pdfBytes, (byteValue) => String.fromCharCode(byteValue)).join('');
}

describe('isPromptTooLongToPaste', () => {
  it('is false up to AI Mode\'s 2,048 characters and true past them', () => {
    expect(AI_MODE_MESSAGE_CHARACTER_LIMIT).toBe(2_048);
    expect(isPromptTooLongToPaste('x'.repeat(2_048))).toBe(false);
    expect(isPromptTooLongToPaste('x'.repeat(2_049))).toBe(true);
  });
});

describe('buildPromptFileMessage', () => {
  it('names the file and asks for the request inside it to be answered, within the box\'s limit', () => {
    const message = buildPromptFileMessage('risk-check-prompt.pdf');
    expect(message).toContain('risk-check-prompt.pdf');
    expect(message).toMatch(/follow its instructions/i);
    expect(message.length).toBeLessThanOrEqual(AI_MODE_MESSAGE_CHARACTER_LIMIT);
  });
});

describe('buildPromptPdfBytes', () => {
  it('writes a PDF whose text holds every line of the prompt, special characters escaped', () => {
    const pdfText = readPdfText(buildPromptPdfBytes('Review (this) change\\now\nRow | ___ | ___'));
    expect(pdfText.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfText.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdfText).toContain('(Review \\(this\\) change\\\\now) Tj');
    expect(pdfText).toContain('(Row | ___ | ___) Tj');
  });

  it('wraps a long line instead of losing its end, and starts a new page when one fills', () => {
    const longLine = `start ${'w'.repeat(250)} end`;
    const manyLines = Array.from({ length: 150 }, (_unused, lineIndex) => `line ${lineIndex}`).join('\n');
    const pdfText = readPdfText(buildPromptPdfBytes(`${longLine}\n${manyLines}`));
    expect(pdfText).toContain(' end) Tj');
    expect(pdfText).toContain('(line 149) Tj');
    expect((pdfText.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });

  it('writes typographic marks in the PDF\'s own encoding and spells out arrows', () => {
    const pdfText = readPdfText(buildPromptPdfBytes('REL → PRD — “done” • ok'));
    expect(pdfText).toContain('(REL -> PRD \\227 \\223done\\224 \\225 ok) Tj');
  });

  it('points the cross-reference table at each object\'s true byte offset', () => {
    const pdfText = readPdfText(buildPromptPdfBytes('one line'));
    const startXref = Number(/startxref\s+(\d+)/.exec(pdfText)?.[1]);
    expect(pdfText.slice(startXref, startXref + 4)).toBe('xref');
    const firstOffset = Number(/xref\s+0 \d+\s+0000000000 65535 f \s*\n(\d{10}) 00000 n/.exec(pdfText)?.[1]);
    expect(pdfText.slice(firstOffset, firstOffset + 7)).toBe('1 0 obj');
  });
});
