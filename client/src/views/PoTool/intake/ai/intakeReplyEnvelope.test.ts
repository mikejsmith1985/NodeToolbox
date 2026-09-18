// intakeReplyEnvelope.test.ts — The shared reply reader turns every whole-reply problem into a sentence, never a throw.

import { describe, expect, it } from 'vitest';

import { readBoundedString, readReplyEnvelope, readVocabularyValue, resolveItemId } from './intakeReplyEnvelope.ts';

describe('readReplyEnvelope', () => {
  it('reads items from a fenced reply with prose around it', () => {
    const reply = 'Here you go:\n```json\n{"kind":"epicIntakeMatch","items":[{"id":"item-1"}]}\n```\nThanks';
    expect(readReplyEnvelope(reply, 'epicIntakeMatch')).toMatchObject({ items: [{ id: 'item-1' }], wholeReplyError: null });
  });

  it('explains a reply with no JSON', () => {
    expect(readReplyEnvelope('sorry, I cannot', 'epicIntakeMatch').wholeReplyError).toMatch(/No JSON/);
  });

  it('explains invalid JSON', () => {
    expect(readReplyEnvelope('{"kind": "epicIntakeMatch", "items": [ {"id": } ] }', 'epicIntakeMatch').wholeReplyError).toMatch(/not valid JSON/);
  });

  it('explains a reply for another round', () => {
    expect(readReplyEnvelope('{"kind":"epicIntakeDraft","items":[]}', 'epicIntakeMatch').wholeReplyError).toMatch(/epicIntakeDraft/);
  });

  it('explains a missing items list', () => {
    expect(readReplyEnvelope('{"kind":"epicIntakeMatch"}', 'epicIntakeMatch').wholeReplyError).toMatch(/items/);
  });

  it('drops non-object items', () => {
    expect(readReplyEnvelope('{"kind":"k","items":[1,"x",{"id":"item-2"}]}', 'k').items).toEqual([{ id: 'item-2' }]);
  });
});

describe('field readers', () => {
  it('resolves item ids case-insensitively', () => {
    expect(resolveItemId(' ITEM-3 ', ['item-1', 'item-3'])).toBe('item-3');
    expect(resolveItemId('item-99', ['item-1'])).toBeNull();
    expect(resolveItemId(3, ['item-3'])).toBeNull();
  });

  it('bounds strings', () => {
    expect(readBoundedString('  Core  ', 10)).toBe('Core');
    expect(readBoundedString('', 10)).toBeNull();
    expect(readBoundedString('x'.repeat(11), 10)).toBeNull();
  });

  it('reads closed vocabularies in their own spelling', () => {
    expect(readVocabularyValue('ROADMAP', ['Roadmap', 'Stability'] as const)).toBe('Roadmap');
    expect(readVocabularyValue('epic', ['Roadmap', 'Stability'] as const)).toBeNull();
  });
});
