// jqlValue.test.ts — The escaping that decides whether a query matches anything at all.
//
// The characters under test are the two that are hardest to write literally in a test file, so they
// are built by code point. A test whose own escaping is ambiguous cannot pin anybody else's.

import { describe, expect, it } from 'vitest';

import { escapeJqlValue } from './jqlValue.ts';

const BACKSLASH = String.fromCharCode(92);
const DOUBLE_QUOTE = String.fromCharCode(34);

describe('escapeJqlValue', () => {
  it('leaves an ordinary value alone', () => {
    expect(escapeJqlValue('08/27/2026 B (scope pushed from july)')).toBe('08/27/2026 B (scope pushed from july)');
  });

  it('escapes a double quote, which would otherwise end the literal early', () => {
    expect(escapeJqlValue(`a${DOUBLE_QUOTE}b`)).toBe(`a${BACKSLASH}${DOUBLE_QUOTE}b`);
  });

  it('escapes a backslash', () => {
    expect(escapeJqlValue(`a${BACKSLASH}b`)).toBe(`a${BACKSLASH}${BACKSLASH}b`);
  });

  it('escapes backslashes BEFORE quotes, so it never doubles its own output', () => {
    // Doing quotes first would then escape the backslash this function had just introduced.
    expect(escapeJqlValue(`a${BACKSLASH}${DOUBLE_QUOTE}b`))
      .toBe(`a${BACKSLASH}${BACKSLASH}${BACKSLASH}${DOUBLE_QUOTE}b`);
  });

  it('handles an empty value without inventing one', () => {
    expect(escapeJqlValue('')).toBe('');
  });
});
