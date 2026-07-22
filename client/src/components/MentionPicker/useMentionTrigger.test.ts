// useMentionTrigger.test.ts — Unit tests for when the @-picker opens and what it inserts.
//
// The word-boundary rule below is what makes "type an email address without tagging anyone" true by
// construction, rather than depending on the user noticing an unwanted popup and dismissing it.

import { describe, expect, it } from 'vitest';

import {
  MIN_MENTION_QUERY_LENGTH,
  insertMentionAtTrigger,
  isMentionTriggerPosition,
  readActiveMentionQuery,
} from './useMentionTrigger.ts';

describe('isMentionTriggerPosition', () => {
  it.each([
    ['at the very start of an empty draft', '@', 0, true],
    ['after a space', 'Hi @', 3, true],
    ['after a newline', 'Hi\n@', 3, true],
    ['after a tab', 'Hi\t@', 3, true],
    ['inside an email address', 'mike@example.com', 4, false],
    ['directly after a word character', 'foo@', 3, false],
    ['after an opening bracket', '(@', 1, false],
    ['on the second of two @ characters', '@@', 1, false],
  ])('%s → %s', (_label, draftText, atIndex, expected) => {
    expect(isMentionTriggerPosition(draftText, atIndex)).toBe(expected);
  });
});

describe('readActiveMentionQuery', () => {
  it('returns the text typed since a word-boundary @', () => {
    expect(readActiveMentionQuery('Hi @ja', 6)).toEqual({ atIndex: 3, query: 'ja' });
  });

  it('returns an empty query immediately after the @ is typed', () => {
    expect(readActiveMentionQuery('Hi @', 4)).toEqual({ atIndex: 3, query: '' });
  });

  it('closes once whitespace is typed, because a mention query is a single token', () => {
    expect(readActiveMentionQuery('Hi @ja ', 7)).toBeNull();
  });

  it('ignores an @ that is part of an email address', () => {
    expect(readActiveMentionQuery('write to mike@example', 21)).toBeNull();
  });

  it('returns null when there is no @ before the caret at all', () => {
    expect(readActiveMentionQuery('just typing away', 16)).toBeNull();
  });

  it('tracks the most recent @ when the draft has an earlier completed one', () => {
    expect(readActiveMentionQuery('Hi @jane and @bo', 16)).toEqual({ atIndex: 13, query: 'bo' });
  });

  it('reads a query when the caret sits mid-draft, not only at the end', () => {
    expect(readActiveMentionQuery('Hi @ja rest of sentence', 6)).toEqual({ atIndex: 3, query: 'ja' });
  });

  it('requires at least two characters before a search is worth running', () => {
    expect(MIN_MENTION_QUERY_LENGTH).toBe(2);
  });
});

describe('insertMentionAtTrigger', () => {
  it('replaces the @query with the token and leaves the rest of the draft byte-identical', () => {
    const result = insertMentionAtTrigger('Hi @ja', 3, 6, '[~jsmith]');

    expect(result.text).toBe('Hi [~jsmith] ');
    expect(result.caretIndex).toBe(result.text.length);
  });

  it('inserts into the middle of a sentence without disturbing what follows', () => {
    const result = insertMentionAtTrigger('Hi @ja please look', 3, 6, '[~jsmith]');

    expect(result.text).toBe('Hi [~jsmith]  please look');
    // Caret lands just after the inserted mention and its trailing space, ready to keep typing.
    expect(result.caretIndex).toBe('Hi [~jsmith] '.length);
  });

  it('inserts when only the @ has been typed', () => {
    const result = insertMentionAtTrigger('Hi @', 3, 4, '[~jsmith]');

    expect(result.text).toBe('Hi [~jsmith] ');
  });

  it('inserts at the very start of a draft', () => {
    const result = insertMentionAtTrigger('@ja', 0, 3, '[~accountid:557058:ab-12]');

    expect(result.text).toBe('[~accountid:557058:ab-12] ');
  });
});
