// riskCheckTable.test.ts — The risk check's fill-in table and its follow-up for rows left out (GH #499).

import { describe, expect, it } from 'vitest';

import { FORMULA_CARD_FIELDS, FORMULA_CARD_QUALITY_GATE } from './formulaCard.ts';
import {
  appendRoundReply,
  buildRiskCheckFollowUp,
  buildRiskCheckTableLines,
  listFullCheckItems,
  listUnansweredItems,
} from './riskCheckTable.ts';

describe('listFullCheckItems', () => {
  it('lists every card field, then every gate question, then any extra rows', () => {
    const items = listFullCheckItems(['CTASK0012345 · Backout plan']);

    expect(items).toHaveLength(FORMULA_CARD_FIELDS.length + FORMULA_CARD_QUALITY_GATE.length + 1);
    expect(items[0]).toBe('Short Description');
    expect(items[items.length - 1]).toBe('CTASK0012345 · Backout plan');
  });
});

describe('buildRiskCheckTableLines', () => {
  it('ends with the marker and a table naming each item, every answer left blank', () => {
    const tableLines = buildRiskCheckTableLines(['Blast Radius', 'Is success objective?']);

    expect(tableLines.slice(-4)).toEqual([
      'RISK_CHECK_TABLE:',
      'Item | Answer | Finding | Fix',
      'Blast Radius | ___ | ___ | ___',
      'Is success objective? | ___ | ___ | ___',
    ]);
    expect(tableLines.join('\n')).toContain('PASS, GAP, N/A, INFO or RECORD');
  });
});

describe('listUnansweredItems', () => {
  const finding = (field: string) => ({ status: 'PASS' as const, field, detail: '', fix: '' });

  it('matches exact names first, so "Impact" is not counted as answered by "Data Impact"', () => {
    expect(listUnansweredItems([finding('Data Impact')], ['Impact', 'Data Impact'])).toEqual(['Impact']);
  });

  it('accepts a lightly reworded name when nothing matches exactly', () => {
    expect(listUnansweredItems([finding('Backout Trigger(s)')], ['Backout Trigger'])).toEqual([]);
  });
});

describe('buildRiskCheckFollowUp', () => {
  const askedItems = ['Short Description', 'Blast Radius', 'Backout Trigger'];

  it('asks for nothing when every row is answered', () => {
    const reply = [
      'Item | Answer | Finding | Fix',
      'Short Description | PASS | Clear. | ___',
      'Blast Radius | GAP | No consumers. | List them in RISK_AND_IMPACT.',
      'Backout Trigger | PASS | Stated. | —',
    ].join('\n');

    expect(buildRiskCheckFollowUp(reply, askedItems)).toBe('');
  });

  it('asks only for the rows left blank, in the same table', () => {
    const reply = [
      'Here is the review of your change request.',
      '| Item | Answer | Finding | Fix |',
      '|---|---|---|---|',
      '| Short Description | PASS | Clear. | ___ |',
      '| Blast Radius | ___ | ___ | ___ |',
      'If you would like, I can also draft the missing text.',
    ].join('\n');

    const followUp = buildRiskCheckFollowUp(reply, askedItems);

    expect(followUp).toMatch(/left 2 rows unanswered/);
    expect(followUp).toContain('Blast Radius | ___ | ___ | ___');
    expect(followUp).toContain('Backout Trigger | ___ | ___ | ___');
    expect(followUp).not.toContain('Short Description | ___');
  });

  it('asks for the whole table again when the reply could not be read at all', () => {
    const followUp = buildRiskCheckFollowUp('The change looks mostly fine, but the backout plan is thin.', askedItems);

    expect(followUp).toMatch(/could not be read/);
    expect(followUp).toContain('Short Description | ___ | ___ | ___');
  });

  it('is satisfied once a follow-up reply supplies the rows the first one left out', () => {
    const firstReply = 'Item | Answer | Finding | Fix\nShort Description | PASS | Clear. | ___';
    const followUpReply = 'Item | Answer | Finding | Fix\nBlast Radius | PASS | Listed. | ___\nBackout Trigger | PASS | Stated. | ___';

    expect(buildRiskCheckFollowUp(appendRoundReply(appendRoundReply('', firstReply), followUpReply), askedItems)).toBe('');
  });
});
