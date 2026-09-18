// namedKeys.test.ts — Contract tests for reading Jira keys the notes name explicitly, and for rejecting
// PI/quarter/fiscal-year tokens that only look like one (spec 037, contracts/deterministic-rules.md §2).

import { describe, expect, it } from 'vitest';

import type { SourceLine } from './epicIntakeModel.ts';
import { extractNamedKeys, JIRA_KEY_IN_TEXT_PATTERN } from './namedKeys.ts';

/** Builds a minimal SourceLine for a test, with rawText mirroring text unless overridden. */
function buildLine(lineNumber: number, text: string): SourceLine {
  return { lineNumber, text, rawText: text, outlineLevel: 1 };
}

describe('JIRA_KEY_IN_TEXT_PATTERN', () => {
  it('is a global regex so it can be reused across matchAll calls', () => {
    expect(JIRA_KEY_IN_TEXT_PATTERN.global).toBe(true);
  });
});

describe('extractNamedKeys', () => {
  it('reads a lower-case key in parentheses and upper-cases it', () => {
    const lines = [buildLine(1, 'Core Integration (denp-632)')];
    const namedKeys = extractNamedKeys(lines, [1]);
    expect(namedKeys).toEqual([
      { key: 'DENP-632', projectKey: 'DENP', lineNumber: 1, lookup: { status: 'notRun' } },
    ]);
  });

  it('reads a key named in plain prose', () => {
    const lines = [buildLine(1, 'see ENCUC-12 for context')];
    const namedKeys = extractNamedKeys(lines, [1]);
    expect(namedKeys).toEqual([
      { key: 'ENCUC-12', projectKey: 'ENCUC', lineNumber: 1, lookup: { status: 'notRun' } },
    ]);
  });

  it('rejects PI names, quarters and fiscal years that only look like a key', () => {
    const lines = [
      buildLine(1, 'Target PI-26'),
      buildLine(2, 'Due Q3-2026'),
      buildLine(3, 'Budget FY-27'),
      buildLine(4, 'Starts H1-2027'),
      buildLine(5, 'Cost 1.2M'),
    ];
    expect(extractNamedKeys(lines, [1, 2, 3, 4, 5])).toEqual([]);
  });

  it('de-duplicates the same key within a call, keeping the first line', () => {
    const lines = [buildLine(1, 'DENP-632 again'), buildLine(2, 'see denp-632 above')];
    const namedKeys = extractNamedKeys(lines, [1, 2]);
    expect(namedKeys).toEqual([
      { key: 'DENP-632', projectKey: 'DENP', lineNumber: 1, lookup: { status: 'notRun' } },
    ]);
  });

  it('only scans the requested line numbers', () => {
    const lines = [buildLine(1, 'DENP-632'), buildLine(2, 'ENCUC-12')];
    const namedKeys = extractNamedKeys(lines, [2]);
    expect(namedKeys).toEqual([
      { key: 'ENCUC-12', projectKey: 'ENCUC', lineNumber: 2, lookup: { status: 'notRun' } },
    ]);
  });

  it('returns an empty array when nothing looks like a key', () => {
    expect(extractNamedKeys([buildLine(1, 'Large for all')], [1])).toEqual([]);
  });
});
