// intakeClassifyAiMode.test.ts — The sorting exchange read from Google AI Mode answers (GH #499): a pre-filled table
// instead of JSON, markdown or TAB-separated, with an intro and a closing offer; and a follow-up for the same chat
// when an answer could not be read or left items out — never a guessed value.

import { describe, expect, it } from 'vitest';

import type { ReferencedSource } from '../../sources/sourceModel.ts';
import { GH387_NOTES_TEXT } from '../gh387Notes.fixture.ts';
import { startEpicIntake } from '../startIntake.ts';
import {
  buildClassifyFollowUpPrompt,
  buildClassifyRequests,
  CLASSIFY_REPLY_KIND,
  CLASSIFY_TABLE_SPEC,
  parseClassifyReply,
} from './intakeClassifyRound.ts';

const NOW_ISO = '2026-09-18T12:00:00.000Z';
const TABLE_HEADER = '| Item | Current title | Kind | Owner | Enrollment share | Search terms | Label | Clearer title | Lines | Set aside | Reason |';

function startIntake() {
  const source: ReferencedSource = { kind: 'paste', id: 'paste-1', label: 'Notes', text: GH387_NOTES_TEXT };
  return startEpicIntake({ teamProfileId: 't', sources: [source], nowIso: NOW_ISO, mintId: () => 'intake-1' });
}

/** The header as a page-copied table: TAB-separated, no outer bars. */
function toTabRow(cells: readonly string[]): string {
  return cells.join('\t');
}

const intake = startIntake();
const [request] = buildClassifyRequests(intake);
const [firstId, secondId] = request.itemIds;
const firstItem = intake.items.find((item) => item.id === firstId)!;

describe('the sorting request as a fill-in table', () => {
  it('pre-fills one row per asked item, so the answer cannot invent or drop one', () => {
    expect(request.text).toContain(CLASSIFY_TABLE_SPEC.replyMarker);
    for (const itemId of request.itemIds) {
      expect(request.text).toMatch(new RegExp(`^${itemId} \\| [^\\n]+ \\| ___`, 'm'));
    }
  });
});

describe('reading a sorting answer written by Google AI Mode', () => {
  it('reads a markdown table with an intro sentence and a closing offer into the same answers', () => {
    const replyText = [
      'Here is the sorted table for your meeting notes.',
      '',
      TABLE_HEADER,
      '|---|---|---|---|---|---|---|---|---|---|---|',
      `| ${firstId} | x | **work** | enrollment | 70% | core integration; partner feed | Roadmap | ___ | ___ | ___ | new capability |`,
      `| ${secondId} | y | noise | ___ | ___ | ___ | ___ | ___ | ___ | ___ | not work |`,
      '',
      'If you provide the sizing for the other items, I can refine the owners.',
    ].join('\n');
    const outcome = parseClassifyReply(replyText, intake, request.itemIds);
    expect(outcome.rejected).toEqual([]);
    expect(outcome.accepted[0]).toMatchObject({
      itemId: firstId, kind: 'work', owner: 'enrollment', enrollmentShare: 70, hasEnrollmentShare: true,
      searchTerms: ['core integration', 'partner feed'], labelProposal: 'Roadmap', reason: 'new capability',
    });
    expect(outcome.accepted[1]).toMatchObject({ itemId: secondId, kind: 'noise', hasEnrollmentShare: false });
  });

  it('reads a TAB-separated table pasted from the answer page', () => {
    const replyText = [
      toTabRow(['Item', 'Current title', 'Kind', 'Owner', 'Enrollment share', 'Search terms', 'Label', 'Clearer title', 'Lines', 'Set aside', 'Reason']),
      toTabRow([firstId, 'x', 'work', 'shared', '50', 'core integration', 'Stability', '', '', '', 'both teams']),
    ].join('\n');
    const outcome = parseClassifyReply(replyText, intake, request.itemIds);
    expect(outcome.accepted[0]).toMatchObject({ itemId: firstId, kind: 'work', owner: 'shared', enrollmentShare: 50, labelProposal: 'Stability' });
  });

  it('reads line numbers and set-aside entries written as cells', () => {
    const linesCell = firstItem.lineNumbers.map((lineNumber) => `[${lineNumber}]`).join('; ');
    const setAsideLine = firstItem.lineNumbers[firstItem.lineNumbers.length - 1];
    const replyText = [TABLE_HEADER, `| ${firstId} | x | work | ___ | ___ | core | Roadmap | ___ | ${linesCell} | ${setAsideLine}: contextOnly | r |`].join('\n');
    const outcome = parseClassifyReply(replyText, intake, request.itemIds);
    expect(outcome.accepted[0].lineNumbers).toEqual([...firstItem.lineNumbers].sort((left, right) => left - right));
    expect(outcome.setAside).toEqual([{ lineNumber: setAsideLine, reason: 'contextOnly' }]);
  });

  it('still refuses an item the request did not ask about, by name', () => {
    const outcome = parseClassifyReply([TABLE_HEADER, '| item-999 | x | work | ___ | ___ | ___ | ___ | ___ | ___ | ___ | r |'].join('\n'), intake, request.itemIds);
    expect(outcome.rejected).toEqual([{ itemId: 'item-999', reason: '"item-999" is not an item in this request.' }]);
  });

  it('still reads a JSON answer', () => {
    const outcome = parseClassifyReply(JSON.stringify({ kind: CLASSIFY_REPLY_KIND, items: [{ id: firstId, kind: 'work' }] }), intake, request.itemIds);
    expect(outcome.accepted[0]).toMatchObject({ itemId: firstId, kind: 'work' });
  });
});

describe('the follow-up for the same chat', () => {
  it('offers the whole table again when the answer could not be read', () => {
    const outcome = parseClassifyReply('Sure! Item one looks like work for Enrollment.', intake, request.itemIds);
    const followUp = buildClassifyFollowUpPrompt(intake, request.itemIds, outcome);
    expect(followUp).toContain('not in the form I need');
    expect(followUp).toContain(CLASSIFY_TABLE_SPEC.replyMarker);
    request.itemIds.forEach((itemId) => expect(followUp).toMatch(new RegExp(`^${itemId} \\|`, 'm')));
  });

  it('asks only for the rows an answer left out', () => {
    const partial = parseClassifyReply([TABLE_HEADER, `| ${firstId} | x | work | ___ | ___ | core | Roadmap | ___ | ___ | ___ | r |`].join('\n'), intake, request.itemIds);
    const followUp = buildClassifyFollowUpPrompt(intake, request.itemIds, partial);
    expect(followUp).toContain(`did not answer ${request.itemIds.slice(1).join(', ')} in full`);
    expect(followUp).not.toMatch(new RegExp(`^${firstId} \\|`, 'm'));
  });

  it('asks nothing when every asked item came back', () => {
    const complete = parseClassifyReply(JSON.stringify({ kind: CLASSIFY_REPLY_KIND, items: request.itemIds.map((itemId) => ({ id: itemId, kind: 'work' })) }), intake, request.itemIds);
    expect(buildClassifyFollowUpPrompt(intake, request.itemIds, complete)).toBe('');
  });
});
