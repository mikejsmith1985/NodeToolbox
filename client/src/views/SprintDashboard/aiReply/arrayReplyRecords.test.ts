// arrayReplyRecords.test.ts — The table-or-JSON-array reader behind the pointing and risk AI rounds.

import { describe, expect, it } from 'vitest';

import {
  buildArrayFormatFixPrompt,
  buildMissingRowsFollowUpPrompt,
  listUnansweredKeys,
  readArrayOrTableReply,
} from './arrayReplyRecords.ts';
import type { ReplyRecordSpec } from '../../../utils/aiReplyRecords.ts';

const SAMPLE_SPEC: ReplyRecordSpec = {
  kind: 'sample',
  replyMarker: 'SAMPLE_TABLE:',
  columns: [{ field: 'key', header: 'Issue key' }, { field: 'note', header: 'Note' }],
};

describe('readArrayOrTableReply', () => {
  it('reads the round table first', () => {
    const reading = readArrayOrTableReply('Here you go.\n| Issue key | Note |\n|---|---|\n| A-1 | fine |', SAMPLE_SPEC);
    expect(reading).toEqual({ source: 'table', items: [{ key: 'A-1', note: 'fine' }] });
  });

  it('still reads the old JSON array inside prose', () => {
    expect(readArrayOrTableReply('Sure: [{"key":"A-1"}] done', SAMPLE_SPEC)).toEqual({ source: 'json', items: [{ key: 'A-1' }] });
  });

  it('names why a reply could not be read', () => {
    expect(readArrayOrTableReply('no table here', SAMPLE_SPEC)).toEqual({ source: 'none', failure: 'noPayload' });
    expect(readArrayOrTableReply('[{ broken }]', SAMPLE_SPEC)).toEqual({ source: 'none', failure: 'invalidJson' });
  });
});

describe('follow-ups', () => {
  it('lists unanswered keys case-insensitively, in asked order', () => {
    expect(listUnansweredKeys(['A-1', 'a-2', 'A-3'], new Set(['A-2']))).toEqual(['A-1', 'A-3']);
  });

  it('asks only for the missing rows, and nothing when none are missing', () => {
    const followUp = buildMissingRowsFollowUpPrompt(SAMPLE_SPEC, ['A-3']);
    expect(followUp).toContain('A-3 | ___');
    expect(followUp).not.toContain('A-1');
    expect(buildMissingRowsFollowUpPrompt(SAMPLE_SPEC, [])).toBe('');
  });

  it('re-asks the whole table when the reply was unreadable', () => {
    const followUp = buildArrayFormatFixPrompt(SAMPLE_SPEC, ['A-1', 'A-2']);
    expect(followUp).toContain('could not be read');
    expect(followUp).toContain('A-1 | ___');
    expect(followUp).toContain('A-2 | ___');
    expect(buildArrayFormatFixPrompt(SAMPLE_SPEC, [])).toBe('');
  });
});
