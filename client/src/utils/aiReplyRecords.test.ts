// aiReplyRecords.test.ts — Proves a filled-in table becomes the {kind, items[]} JSON a round's parser already reads.

import { describe, expect, it } from 'vitest';

import {
  buildRecordFormatFixPrompt,
  buildRecordReplyInstructions,
  extractRecordReplyPayload,
  isUnreadableRecordReply,
  type ReplyRecordSpec,
} from './aiReplyRecords.ts';

const SPEC: ReplyRecordSpec = {
  kind: 'piReview',
  replyMarker: 'PI_REVIEW_TABLE:',
  columns: [
    { field: 'issueKey', header: 'Issue key' },
    { field: 'summary', header: 'Feature', isNamingOnly: true },
    { field: 'size', header: 'Size', answerHint: 'XS, S, M, L, XL or XXL' },
    { field: 'devWork', header: 'Dev work', valueKind: 'boolean' },
    { field: 'links', header: 'Links', valueKind: 'list' },
  ],
};
const ROWS = [['DENP-1', 'Login'], ['DENP-2', 'Logout']];

describe('the prompt table', () => {
  it('ends with the marker and one row per item, its naming cells filled in and blanks to answer', () => {
    const instructions = buildRecordReplyInstructions(SPEC, ROWS);
    expect(instructions).toContain('- Size: XS, S, M, L, XL or XXL');
    expect(instructions.split('\n').slice(-3)).toEqual([
      'Issue key | Feature | Size | Dev work | Links',
      'DENP-1 | Login | ___ | ___ | ___',
      'DENP-2 | Logout | ___ | ___ | ___',
    ]);
  });

  it('offers the same table again as the follow-up', () => {
    expect(buildRecordFormatFixPrompt(SPEC, ROWS)).toMatch(/^Your last reply was not in the form I need[\s\S]*DENP-2 \| Logout/);
  });
});

describe('extractRecordReplyPayload', () => {
  it('reads a markdown table in any column order, typing each cell and skipping naming and blank cells', () => {
    const replyText = [
      'Here is the table:',
      '| **Size** | Issue key | Dev work | Feature | Links |',
      '|---|---|---|---|---|',
      '| L | DENP-1 | Yes | Login | DENP-7; DENP-8 |',
      '| ___ | DENP-2 | no |  | N/A |',
    ].join('\n');
    expect(JSON.parse(extractRecordReplyPayload(replyText, SPEC))).toEqual({
      kind: 'piReview',
      items: [
        { issueKey: 'DENP-1', size: 'L', devWork: true, links: ['DENP-7', 'DENP-8'] },
        { issueKey: 'DENP-2', devWork: false },
      ],
    });
  });

  it('reads a table copied from a web page as tabs', () => {
    const replyText = 'Issue key\tFeature\tSize\nDENP-1\tLogin\tM';
    expect(JSON.parse(extractRecordReplyPayload(replyText, SPEC)).items).toEqual([{ issueKey: 'DENP-1', size: 'M' }]);
  });

  it('still reads a JSON reply, and throws the usual error when the reply is neither', () => {
    expect(JSON.parse(extractRecordReplyPayload('```json\n{"kind":"piReview","items":[]}\n```', SPEC))).toEqual({ kind: 'piReview', items: [] });
    expect(() => extractRecordReplyPayload('DENP-1 looks like an L.', SPEC)).toThrow('No JSON object found in the assistant response.');
    expect(isUnreadableRecordReply('DENP-1 looks like an L.', SPEC)).toBe(true);
  });
});
