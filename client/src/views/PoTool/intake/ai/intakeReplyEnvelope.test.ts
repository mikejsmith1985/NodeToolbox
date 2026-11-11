// intakeReplyEnvelope.test.ts — The shared reply reader turns every whole-reply problem into a sentence, never a throw.

import { describe, expect, it } from 'vitest';

import {
  buildTableFollowUpPrompt,
  listUnansweredItemIds,
  readBoundedString,
  readReplyEnvelope,
  readVocabularyValue,
  resolveItemId,
  sanitizeTableCell,
  UNREADABLE_TABLE_REPLY_ERROR,
} from './intakeReplyEnvelope.ts';

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

describe('reading a fill-in table (GH #499)', () => {
  const tableSpec = {
    kind: 'k',
    replyMarker: 'TABLE:',
    columns: [{ field: 'id', header: 'Item' }, { field: 'name', header: 'Name', isNamingOnly: true }, { field: 'verdict', header: 'Verdict' }],
  };
  const rows = [['item-1', 'One'], ['item-2', 'Two']];

  it('reads a markdown table into the same envelope, and JSON still', () => {
    const tableReply = 'Intro.\n| Item | Name | Verdict |\n|---|---|---|\n| item-1 | One | createNew |\nIf you like, I can help more.';
    expect(readReplyEnvelope(tableReply, 'k', tableSpec)).toMatchObject({ items: [{ id: 'item-1', verdict: 'createNew' }], wholeReplyError: null });
    expect(readReplyEnvelope('{"kind":"k","items":[{"id":"item-2"}]}', 'k', tableSpec).items).toEqual([{ id: 'item-2' }]);
  });

  it('says the table was not found when the reply is prose', () => {
    expect(readReplyEnvelope('It is new work.', 'k', tableSpec).wholeReplyError).toBe(UNREADABLE_TABLE_REPLY_ERROR);
  });

  it('builds the whole table again, only the missing rows, or nothing', () => {
    expect(buildTableFollowUpPrompt(tableSpec, rows, true, [])).toMatch(/^item-2 \| Two \| ___$/m);
    const partial = buildTableFollowUpPrompt(tableSpec, rows, false, listUnansweredItemIds(['item-1', 'item-2'], ['item-1']));
    expect(partial).toContain('did not answer item-2 in full');
    expect(partial).not.toMatch(/^item-1 \|/m);
    expect(buildTableFollowUpPrompt(tableSpec, rows, false, [])).toBe('');
  });

  it('makes a cell one line with no bar in it', () => {
    expect(sanitizeTableCell(' a | b\n c ')).toBe('a / b c');
  });
});
