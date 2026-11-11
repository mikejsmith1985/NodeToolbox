// riskAiAssistReply.test.ts — The risk-refinement round reads Google AI Mode tables, still reads JSON arrays,
// never writes a half-filled template, and offers a follow-up for whatever was left out (GH #499).

import { describe, expect, it } from 'vitest';

import { buildRiskReplyFormLines, parseRiskAiReply } from './riskAiAssistReply.ts';

const VALID_KEYS = new Set(['PROJ-1', 'PROJ-2']);
const ASKED_KEYS = ['PROJ-1', 'PROJ-2'];
const HEADER = 'Issue key | There is a risk that | Probability | Impact if realized | Due to | Mitigation plan | Leadership ask | ROAM response | Priority';
const PROJ_1_ROW = '| PROJ-1 | the vendor slips | H | launch moves | late contract | weekly check-in by 6/1 | escalate contract | Mitigate | High |';
const PROJ_2_ROW = '| PROJ-2 | data is stale | M | wrong reports | nightly job gaps | add monitoring by 7/1 | none needed | Own | Medium |';
const PROJ_1_DESCRIPTION = [
  'There is a risk that: the vendor slips',
  'Probability: H',
  'Impact if Realized: launch moves',
  'Due to: late contract',
  'Mitigation Plan: weekly check-in by 6/1',
  'Leadership Ask: escalate contract',
].join('\n');

describe('buildRiskReplyFormLines', () => {
  it('ends the prompt with a table pre-filled with every risk key', () => {
    const formLines = buildRiskReplyFormLines(ASKED_KEYS);
    expect(formLines).toContain('RISK_TABLE:');
    expect(formLines).toContain(HEADER);
    expect(formLines).toContain('PROJ-2 | ___ | ___');
    expect(formLines).toContain('one of Resolve, Own, Accept, Mitigate');
  });
});

describe('parseRiskAiReply', () => {
  it('reads a markdown table with an intro and a closing offer, joining the template parts', () => {
    const replyText = ['Here are the refined risks.', '', `| ${HEADER} |`, '|---|---|---|---|---|---|---|---|---|', PROJ_1_ROW, PROJ_2_ROW, '',
      'If you provide the PI dates I can tighten the mitigation dates.'].join('\n');

    const reading = parseRiskAiReply(replyText, VALID_KEYS, ASKED_KEYS);

    expect(reading.errorMessage).toBeNull();
    expect(reading.followUpPrompt).toBe('');
    expect(reading.items[0]).toEqual({ key: 'PROJ-1', description: PROJ_1_DESCRIPTION, riskResponse: 'Mitigate', priority: 'High' });
    expect(reading.items).toHaveLength(2);
  });

  it('reads a tab-separated table copied from the AI Mode page', () => {
    const toTabs = (tableRow: string) => tableRow.replace(/^\|\s*|\s*\|$/g, '').split(/\s*\|\s*/).join('\t');
    const replyText = [toTabs(HEADER), toTabs(PROJ_1_ROW), toTabs(PROJ_2_ROW)].join('\n');

    const reading = parseRiskAiReply(replyText, VALID_KEYS, ASKED_KEYS);

    expect(reading.items.map((item) => item.key)).toEqual(['PROJ-1', 'PROJ-2']);
    expect(reading.items[0].description).toBe(PROJ_1_DESCRIPTION);
  });

  it('never writes a half-filled template — the row is chased by a follow-up instead', () => {
    const blankRow = '| PROJ-2 | data is stale | ___ | wrong reports | nightly job gaps | add monitoring | none | Own | Medium |';
    const reading = parseRiskAiReply([HEADER, PROJ_1_ROW, blankRow].join('\n'), VALID_KEYS, ASKED_KEYS);

    expect(reading.items.map((item) => item.key)).toEqual(['PROJ-1']);
    expect(reading.followUpPrompt).toContain('PROJ-2 | ___');
    expect(reading.followUpPrompt).not.toContain('PROJ-1 | ___');
  });

  it('asks a follow-up for risks a table left out entirely', () => {
    const reading = parseRiskAiReply([HEADER, PROJ_1_ROW].join('\n'), VALID_KEYS, ASKED_KEYS);
    expect(reading.followUpPrompt).toContain('left out or left blank PROJ-2');
  });

  it('returns the whole form as a follow-up when the reply cannot be read', () => {
    const reading = parseRiskAiReply('The vendor risk looks high to me.', VALID_KEYS, ASKED_KEYS);

    expect(reading.items).toEqual([]);
    expect(reading.errorMessage).toMatch(/could not be read/);
    expect(reading.followUpPrompt).toContain('PROJ-1 | ___');
    expect(reading.followUpPrompt).toContain('PROJ-2 | ___');
  });

  it('still reads the old JSON array and keeps its messages when no keys are asked', () => {
    const replyText = `Done:\n${JSON.stringify([{ key: 'proj-1', description: 'Old style.', riskResponse: 'Own' }])}`;
    expect(parseRiskAiReply(replyText, VALID_KEYS).items).toEqual([{ key: 'PROJ-1', description: 'Old style.', riskResponse: 'Own', priority: undefined }]);
    expect(parseRiskAiReply('No JSON here.', VALID_KEYS).errorMessage).toContain('No JSON array found');
  });

  it('drops keys outside this PI and reports when nothing usable remains', () => {
    const otherRow = '| PROJ-9 | x | H | y | z | m | l | Own | Low |';
    const reading = parseRiskAiReply([HEADER, otherRow].join('\n'), VALID_KEYS, ASKED_KEYS);

    expect(reading.items).toEqual([]);
    expect(reading.errorMessage).toContain('No valid risk updates found');
  });
});
