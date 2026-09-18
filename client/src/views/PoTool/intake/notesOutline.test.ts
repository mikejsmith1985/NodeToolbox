// notesOutline.test.ts — Contract tests for turning raw notes into numbered lines and a first grouping of items
// from their bullet structure (spec 037, contracts/deterministic-rules.md §1).

import { describe, expect, it } from 'vitest';

import { createIntakeItem, type SourceLine } from './epicIntakeModel.ts';
import { GH387_NOTES_TEXT } from './gh387Notes.fixture.ts';
import {
  buildOutlineBaseline,
  numberSourceLines,
  proveLineCoverage,
  splitLinesIntoPromptParts,
} from './notesOutline.ts';

describe('numberSourceLines', () => {
  it('numbers non-blank lines from 1, strips the marker into text and keeps the raw line', () => {
    const lines = numberSourceLines('Heading\n\n•\tCore Integration (denp-632)\no\tFulfillment M\n   \n');
    expect(lines).toEqual([
      { lineNumber: 1, text: 'Heading', rawText: 'Heading', outlineLevel: 0 },
      { lineNumber: 2, text: 'Core Integration (denp-632)', rawText: '•\tCore Integration (denp-632)', outlineLevel: 1 },
      { lineNumber: 3, text: 'Fulfillment M', rawText: 'o\tFulfillment M', outlineLevel: 2 },
    ]);
  });

  it('reads dashes, stars and numbers as top-level, and indented top-level markers as sub-bullets', () => {
    const lines = numberSourceLines('- One\n  - One point one\n* Two\n2. Three\n\t• Three point one');
    expect(lines.map((line) => line.outlineLevel)).toEqual([1, 2, 1, 1, 2]);
    expect(lines.map((line) => line.text)).toEqual(['One', 'One point one', 'Two', 'Three', 'Three point one']);
  });

  it('does not read a word that starts with "o" as a sub-bullet', () => {
    const lines = numberSourceLines('• Plans\nOregon rollout\noffshore team');
    expect(lines.map((line) => line.outlineLevel)).toEqual([1, 0, 0]);
  });

  it('treats every line as its own item when the notes have no bullets at all', () => {
    const lines = numberSourceLines('Paperless Options\nInvoice overhaul\nTech Debt');
    expect(lines.every((line) => line.outlineLevel === 1)).toBe(true);
  });

  it('handles Windows line endings', () => {
    expect(numberSourceLines('• A\r\no\tB').map((line) => line.text)).toEqual(['A', 'B']);
  });
});

describe('buildOutlineBaseline on GH #387', () => {
  const lines = numberSourceLines(GH387_NOTES_TEXT);
  const { items, setAsideLines } = buildOutlineBaseline(lines);

  it('starts one item per top-level bullet', () => {
    const topLevelCount = lines.filter((line) => line.outlineLevel === 1).length;
    expect(items).toHaveLength(topLevelCount);
    expect(items.length).toBeGreaterThanOrEqual(24);
  });

  it('attaches the sizing sub-bullets to Core Integration', () => {
    const coreIntegration = items.find((item) => item.title === 'Core Integration (denp-632)');
    const attachedTexts = coreIntegration?.lineNumbers.map((lineNumber) => lines[lineNumber - 1].text);
    expect(attachedTexts).toEqual([
      'Core Integration (denp-632)', '(1.2M) XL Enrollment', 'Fulfillment M', 'Infra XL', 'Facets M',
    ]);
  });

  it('sets aside headings and prose with a reason', () => {
    const setAsideTexts = setAsideLines.map((setAside) => lines[setAside.lineNumber - 1].text);
    expect(setAsideTexts).toEqual(expect.arrayContaining(['New Since OnSite', 'Notes from OnSite']));
    expect(setAsideTexts.some((text) => text.startsWith('Rules for Tagging'))).toBe(true);
    expect(setAsideLines.every((setAside) => setAside.reason === 'headingOrProse' && setAside.settledBy === 'rule')).toBe(true);
  });

  it('accounts for every line exactly once', () => {
    expect(proveLineCoverage({ lines, items, setAsideLines })).toEqual({ isComplete: true, missing: [], duplicated: [] });
  });

  it('gives items stable sequential ids', () => {
    expect(items.map((item) => item.id).slice(0, 3)).toEqual(['item-1', 'item-2', 'item-3']);
  });
});

describe('buildOutlineBaseline edge cases', () => {
  it('makes a sub-bullet with no item above it an item of its own', () => {
    const { items } = buildOutlineBaseline(numberSourceLines('o\tOrphan\n•\tParent'));
    expect(items.map((item) => item.title)).toEqual(['Orphan', 'Parent']);
  });
});

describe('proveLineCoverage', () => {
  const lines: SourceLine[] = [1, 2, 3, 4].map((lineNumber) => ({ lineNumber, text: `l${lineNumber}`, rawText: `l${lineNumber}`, outlineLevel: 1 }));

  it('names missing and duplicated lines', () => {
    const items = [createIntakeItem(1, 'l1', [1, 2]), createIntakeItem(2, 'l2', [2])];
    const setAsideLines = [{ lineNumber: 3, reason: 'notWork' as const, settledBy: 'po' as const, note: null }];
    expect(proveLineCoverage({ lines, items, setAsideLines })).toEqual({ isComplete: false, missing: [4], duplicated: [2] });
  });
});

describe('performance', () => {
  // The plan's target is a few milliseconds for 200 lines; the budget here is generous on purpose so a busy machine
  // running the whole suite in parallel never turns this guard into a flaky failure. It still catches a slide into
  // quadratic work, which would cost far more than this.
  const OUTLINE_BUDGET_MS = 50;

  it('numbers, groups and proves coverage for 200 lines well within budget', () => {
    const longNotes = Array.from({ length: 100 }, (_, index) => `•\tItem ${index}\no\tDetail ${index} XL Enrollment`).join('\n');
    const startedAt = performance.now();
    const lines = numberSourceLines(longNotes);
    const baseline = buildOutlineBaseline(lines);
    proveLineCoverage({ lines, ...baseline });
    expect(lines).toHaveLength(200);
    expect(performance.now() - startedAt).toBeLessThan(OUTLINE_BUDGET_MS);
  });
});

describe('splitLinesIntoPromptParts', () => {
  const lines = numberSourceLines(Array.from({ length: 6 }, (_, index) => `• Item ${index + 1} ${'x'.repeat(40)}`).join('\n'));
  const { items } = buildOutlineBaseline(lines);

  it('keeps everything in one part when it fits', () => {
    expect(splitLinesIntoPromptParts(items, lines, 10_000)).toEqual([items]);
  });

  it('breaks only between items and never loses one', () => {
    const parts = splitLinesIntoPromptParts(items, lines, 150);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.flat()).toEqual(items);
  });

  it('puts an item larger than the limit in a part of its own', () => {
    const parts = splitLinesIntoPromptParts(items, lines, 10);
    expect(parts).toHaveLength(items.length);
  });

  it('returns no parts for no items', () => {
    expect(splitLinesIntoPromptParts([], lines, 100)).toEqual([]);
  });
});
