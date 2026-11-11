// intakeResolveAiMode.test.ts — The resolve exchange read from Google AI Mode answers (GH #499): a pre-filled table
// plus one labelled or headed nine-section description per new Epic, markdown or TAB-separated, with an intro and a
// closing offer; and a follow-up for the same chat when an answer could not be read or left something out.

import { describe, expect, it } from 'vitest';

import { SECTION_LABELS } from '../../ai/featureDocSections.ts';
import { createIntakeItem, EPIC_INTAKE_SCHEMA_VERSION, type Decision, type EpicIntake, type IntakeItem } from '../epicIntakeModel.ts';
import { buildResolveFollowUpPrompt, buildResolveRequests, parseResolveReply, RESOLVE_REPLY_KIND, RESOLVE_TABLE_SPEC } from './intakeResolveRound.ts';

const NOW_ISO = '2026-09-18T12:00:00.000Z';
const TABLE_HEADER = '| Item | Current title | Verdict | Existing Epic key | Confidence | Label | Epic summary | Reason |';
const NINE_SECTION_DESCRIPTION = ['Description:', 'Let members enrol online.', 'Benefit Hypothesis:', 'Fewer calls.', 'Acceptance Criteria:', '- A member can enrol.'].join('\n');
const ASKED_ITEM_IDS = ['item-1', 'item-2'];

function settled<TValue>(value: TValue): Decision<TValue> {
  return { state: 'settled', value, settledBy: 'rule', reason: 'test', aiAttempts: 0 };
}

/** An Enrollment work item searched against DENP, its match still open. */
function buildSearchedItem(itemNumber: number, candidateKeys: string[]): IntakeItem {
  const item = createIntakeItem(itemNumber, `Item ${itemNumber}`, [itemNumber]);
  item.decisions.kind = settled('work');
  item.decisions.owner = settled('enrollment');
  item.decisions.searchTerms = settled(['term']);
  item.searchStatus = 'ok';
  item.candidates = candidateKeys.map((key) => ({ key, summary: `Epic ${key}`, statusName: 'In Progress', statusCategory: 'indeterminate', descriptionExcerpt: '', foundBy: 'search' }));
  return item;
}

function buildIntake(items: IntakeItem[]): EpicIntake {
  return {
    schemaVersion: EPIC_INTAKE_SCHEMA_VERSION, id: 'i', teamProfileId: 't', name: 'n', targetProjectKey: 'DENP',
    createdAtIso: NOW_ISO, updatedAtIso: NOW_ISO, sourceTitles: [], items, setAsideLines: [],
    lines: items.map((item) => ({ lineNumber: item.lineNumbers[0], text: item.title, rawText: `• ${item.title}`, outlineLevel: 1 as const })),
    epicType: { state: 'resolved', id: '10000', name: 'Epic' }, batchRequiredFieldValues: {}, roundHistory: [],
  };
}

const intake = buildIntake([buildSearchedItem(1, ['DENP-632']), buildSearchedItem(2, [])]);
const ITEM_TWO_ROW = '| item-2 | Item 2 | createNew | ___ | high | Roadmap | Online enrolment | nothing covers it |';

describe('the resolve request as a fill-in table', () => {
  it('pre-fills one row per asked item and labels a description for each possible new Epic', () => {
    const [request] = buildResolveRequests(intake);
    expect(request.text).toContain(RESOLVE_TABLE_SPEC.replyMarker);
    expect(request.text).toMatch(/^item-1 \| Item 1 \| ___/m);
    expect(request.text).toMatch(/^item-2 \| Item 2 \| ___/m);
    expect(request.text).toContain('item-2 DESCRIPTION:');
  });
});

describe('reading a resolve answer written by Google AI Mode', () => {
  it('reads a markdown table plus a headed description, dropping the intro and the closing offer', () => {
    const replyText = [
      'Here is the resolution for each item based on the notes you provided.',
      TABLE_HEADER,
      '|---|---|---|---|---|---|---|---|',
      '| item-1 | Item 1 | existing | DENP-632 | high | ___ | ___ | same scope |',
      '| item-2 | Item 2 | createNew | ___ | low | Roadmap | Online enrolment | nothing covers it |',
      '',
      '### item-2 — Description',
      NINE_SECTION_DESCRIPTION,
      '',
      'If you would like, I can also draft the Stories for this Epic.',
    ].join('\n');
    const outcome = parseResolveReply(replyText, intake, ASKED_ITEM_IDS);
    expect(outcome.rejected).toEqual([]);
    expect(outcome.accepted[0]).toMatchObject({ itemId: 'item-1', verdict: { verdict: 'existing', key: 'DENP-632' }, isConfident: true, reason: 'same scope' });
    expect(outcome.accepted[1]).toMatchObject({ verdict: { verdict: 'createNew' }, label: 'Roadmap', isConfident: false });
    const draft = outcome.accepted[1].draft!;
    expect(draft.summary).toBe('Online enrolment');
    expect(draft.description).toContain('Let members enrol online.');
    expect(draft.description).toContain('- A member can enrol.');
    expect(draft.description).not.toMatch(/draft the Stories|item-1/);
    expect(SECTION_LABELS.every((label) => draft.description.includes(`${label}:`))).toBe(true);
    expect(buildResolveFollowUpPrompt(intake, ASKED_ITEM_IDS, outcome)).toBe('');
  });

  it('reads a TAB-separated table with the description under the asked-for label', () => {
    const replyText = [
      ['Item', 'Current title', 'Verdict', 'Existing Epic key', 'Confidence', 'Label', 'Epic summary', 'Reason'].join('\t'),
      ['item-2', 'Item 2', 'createNew', '', 'high', 'Stability', 'Patch the feed', 'upgrade'].join('\t'),
      'item-2 DESCRIPTION:',
      NINE_SECTION_DESCRIPTION,
    ].join('\n');
    const outcome = parseResolveReply(replyText, intake, ASKED_ITEM_IDS);
    expect(outcome.accepted).toHaveLength(1);
    expect(outcome.accepted[0]).toMatchObject({ itemId: 'item-2', label: 'Stability', draft: { summary: 'Patch the feed' } });
    expect(outcome.accepted[0].draft!.description).toContain('Let members enrol online.');
  });

  it('still refuses a key that was not found for that item', () => {
    const outcome = parseResolveReply([TABLE_HEADER, '| item-2 | Item 2 | existing | DENP-632 | high | ___ | ___ | r |'].join('\n'), intake, ASKED_ITEM_IDS);
    expect(outcome.accepted[0].verdict).toBeNull();
    expect(outcome.accepted[0].fieldErrors.verdict).toBe('DENP-632 was not among the Epics found for item-2.');
  });

  it('never makes up a description that was not written', () => {
    const outcome = parseResolveReply([TABLE_HEADER, ITEM_TWO_ROW].join('\n'), intake, ASKED_ITEM_IDS);
    expect(outcome.accepted[0].draft).toBeNull();
    expect(outcome.accepted[0].fieldErrors.draft).toBeDefined();
  });

  it('still reads a JSON answer, description included', () => {
    const jsonReply = JSON.stringify({ kind: RESOLVE_REPLY_KIND, items: [{ id: 'item-2', verdict: 'createNew', summary: 'S', description: NINE_SECTION_DESCRIPTION }] });
    expect(parseResolveReply(jsonReply, intake, ASKED_ITEM_IDS).accepted[0].draft?.summary).toBe('S');
  });
});

describe('the follow-up for the same chat', () => {
  it('asks again for the whole table when the answer could not be read', () => {
    const outcome = parseResolveReply('Item 1 is probably the same as DENP-632.', intake, ASKED_ITEM_IDS);
    const followUp = buildResolveFollowUpPrompt(intake, ASKED_ITEM_IDS, outcome);
    expect(followUp).toContain('not in the form I need');
    expect(followUp).toMatch(/^item-1 \| Item 1 \| ___/m);
    expect(followUp).toContain('item-2 DESCRIPTION:');
  });

  it('asks for an item left out and for a new Epic whose description is missing', () => {
    const outcome = parseResolveReply([TABLE_HEADER, ITEM_TWO_ROW].join('\n'), intake, ASKED_ITEM_IDS);
    const followUp = buildResolveFollowUpPrompt(intake, ASKED_ITEM_IDS, outcome);
    expect(followUp).toContain('did not answer item-1, item-2 in full');
    expect(followUp).toContain('item-2 DESCRIPTION:');
  });

  it('asks only for the item left out when the rest is complete', () => {
    const outcome = parseResolveReply([TABLE_HEADER, ITEM_TWO_ROW, 'item-2 DESCRIPTION:', NINE_SECTION_DESCRIPTION].join('\n'), intake, ASKED_ITEM_IDS);
    const followUp = buildResolveFollowUpPrompt(intake, ASKED_ITEM_IDS, outcome);
    expect(followUp).toMatch(/^item-1 \| Item 1 \| ___/m);
    expect(followUp).not.toMatch(/^item-2 \|/m);
  });
});
