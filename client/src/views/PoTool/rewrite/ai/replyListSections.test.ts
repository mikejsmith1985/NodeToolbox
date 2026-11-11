// replyListSections.test.ts — Proves a headed bullet list from Google's AI Mode reads back into plain entries.

import { describe, expect, it } from 'vitest';

import { isEmptyListEntry, readKindedJsonReply, readListEntries, readListEntryText } from './replyListSections.ts';

describe('readListEntryText', () => {
  it('removes every kind of list mark an answer engine uses', () => {
    expect(readListEntryText('- one')).toBe('one');
    expect(readListEntryText('• two')).toBe('two');
    expect(readListEntryText('  ◦ three')).toBe('three');
    expect(readListEntryText('4. four')).toBe('four');
    expect(readListEntryText('* **five**')).toBe('five');
  });

  it('turns a horizontal rule or a code fence into nothing', () => {
    expect(readListEntryText('---')).toBe('');
    expect(readListEntryText('```')).toBe('');
  });
});

describe('isEmptyListEntry', () => {
  it('recognises the ways a list says it is empty', () => {
    expect(isEmptyListEntry('None')).toBe(true);
    expect(isEmptyListEntry('None stated.')).toBe(true);
    expect(isEmptyListEntry('(nothing recorded)')).toBe(true);
    expect(isEmptyListEntry('N/A')).toBe(true);
  });

  it('keeps a real entry that merely starts with "None"', () => {
    expect(isEmptyListEntry('None of the legacy invoices migrate')).toBe(false);
  });
});

describe('readListEntries', () => {
  it('reads one entry per line, skipping blanks and "None"', () => {
    expect(readListEntries('- a\n\n- None\n• b')).toEqual(['a', 'b']);
  });

  it('reads a missing section as no entries', () => {
    expect(readListEntries(undefined)).toEqual([]);
  });
});

describe('readKindedJsonReply', () => {
  it('reads a JSON reply that names its kind', () => {
    expect(readKindedJsonReply('Sure!\n{"kind":"x","items":[]}')).toEqual({ kind: 'x', items: [] });
  });

  it('returns null for a document reply, so it is read by its headings instead', () => {
    expect(readKindedJsonReply('## Summary\nA note.')).toBeNull();
  });

  it('returns null for JSON with no kind, which is not a round reply', () => {
    expect(readKindedJsonReply('{"note":"x"}')).toBeNull();
  });
});
