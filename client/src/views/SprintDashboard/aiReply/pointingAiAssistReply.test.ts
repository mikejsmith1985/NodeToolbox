// pointingAiAssistReply.test.ts — The pointing round reads Google AI Mode tables, still reads JSON arrays, keeps
// the on-scale rule, and offers a follow-up for stories left out (GH #499).

import { describe, expect, it } from 'vitest';

import { buildPointingReplyFormLines, parsePointingAiReply } from './pointingAiAssistReply.ts';

const SCALE = [1, 2, 3, 5, 8, 13];
const QUEUE_KEYS = new Set(['TBX-1', 'TBX-2']);
const ASKED_KEYS = ['TBX-1', 'TBX-2'];
const EXPECTED_ITEMS = [
  { key: 'TBX-1', points: 5, reasoning: 'Two integrations.' },
  { key: 'TBX-2', points: 3, reasoning: 'Small change.' },
];

describe('buildPointingReplyFormLines', () => {
  it('lists every story with blanks and states the scale', () => {
    const formLines = buildPointingReplyFormLines(ASKED_KEYS, SCALE, 8);
    expect(formLines).toContain('POINTING_TABLE:');
    expect(formLines).toContain('TBX-1 | ___ | ___');
    expect(formLines).toContain('one of 1, 2, 3, 5, 8, 13');
    expect(formLines).toContain('above 8 points');
  });
});

describe('parsePointingAiReply', () => {
  it('reads a markdown table with an intro and a closing offer', () => {
    const replyText = ['Here are my estimates:', '| Issue key | Points | Reasoning |', '|---|---|---|',
      '| **TBX-1** | 5 pts | Two integrations. |', '| TBX-2 | 3 | Small change. |', 'Let me know if you want a breakdown.'].join('\n');

    const reading = parsePointingAiReply(replyText, QUEUE_KEYS, SCALE, ASKED_KEYS);

    expect(reading.items).toEqual(EXPECTED_ITEMS);
    expect(reading.followUpPrompt).toBe('');
  });

  it('reads a tab-separated table', () => {
    const replyText = ['Issue key\tPoints\tReasoning', 'TBX-1\t5\tTwo integrations.', 'TBX-2\t3\tSmall change.'].join('\n');
    expect(parsePointingAiReply(replyText, QUEUE_KEYS, SCALE, ASKED_KEYS).items).toEqual(EXPECTED_ITEMS);
  });

  it('never rounds an off-scale value — the story is chased in a follow-up instead', () => {
    const replyText = ['Issue key | Points | Reasoning', 'TBX-1 | 5 | Two integrations.', 'TBX-2 | 4 | Between sizes.'].join('\n');

    const reading = parsePointingAiReply(replyText, QUEUE_KEYS, SCALE, ASKED_KEYS);

    expect(reading.items.map((item) => item.key)).toEqual(['TBX-1']);
    expect(reading.followUpPrompt).toContain('TBX-2 | ___ | ___');
    expect(reading.followUpPrompt).not.toContain('TBX-1 | ___');
  });

  it('gives the whole form back when the reply cannot be read', () => {
    const reading = parsePointingAiReply('I think TBX-1 is about five points.', QUEUE_KEYS, SCALE, ASKED_KEYS);

    expect(reading.errorMessage).toMatch(/could not be read/);
    expect(reading.followUpPrompt).toContain('TBX-1 | ___ | ___');
    expect(reading.followUpPrompt).toContain('TBX-2 | ___ | ___');
  });

  it('still reads the old JSON array and keeps its messages', () => {
    const replyText = JSON.stringify([{ key: 'TBX-1', points: 5, reasoning: 'x' }, { key: 'TBX-9', points: 3 }]);
    expect(parsePointingAiReply(replyText, QUEUE_KEYS, SCALE).items).toEqual([{ key: 'TBX-1', points: 5, reasoning: 'x' }]);
    expect(parsePointingAiReply('nothing', QUEUE_KEYS, SCALE).errorMessage).toContain('No JSON array found');
  });
});
