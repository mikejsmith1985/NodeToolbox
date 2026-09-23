// checklistAiAssist.test.ts — The reply decides what gets ticked on a Definition of Done, so the reader has to
// be strict: only items that were offered, only once each, and never a tick without evidence.

import { describe, expect, it } from 'vitest';

import { buildChecklistPrompt, listSatisfiedItemIds, parseChecklistIngest } from './checklistAiAssist.ts';
import type { EpicChecklistSource } from './checklistField.ts';
import { listOpenItems, parseSmartChecklist } from './smartChecklist.ts';

const EPIC: EpicChecklistSource = {
  issueKey: 'DENP-905',
  summary: 'AEP enrollment intake',
  status: 'In Progress',
  description: 'Members enrol through the AEP channel. Stakeholders signed off the objective on 12 August.',
  acceptanceCriteria: 'Given a member enrols, the confirmation is issued within one day.',
  checklistText: '',
};

const CHECKLIST = parseSmartChecklist([
  '# Definition of Ready (DoR)',
  '## Business Readiness',
  '- [ ] Business objective, success criteria, and stakeholder alignment are established',
  '## Requirements Readiness',
  '- [ ] Scope and acceptance criteria are understood',
].join('\n'));

const OPEN_ITEM_IDS = listOpenItems(CHECKLIST).map((item) => item.id);

describe('buildChecklistPrompt', () => {
  it('gives the assistant the Epic before the checklist, with each item under its own id', () => {
    const prompt = buildChecklistPrompt(EPIC, listOpenItems(CHECKLIST), ['DENP-906 — Done — Build intake form']);

    expect(prompt.indexOf('AEP enrollment intake')).toBeLessThan(prompt.indexOf('not yet ticked'));
    expect(prompt).toContain(`${OPEN_ITEM_IDS[0]}: [Business Readiness] Business objective`);
    expect(prompt).toContain('DENP-906 — Done — Build intake form');
  });

  it('demands quoted evidence and forbids inventing items', () => {
    const prompt = buildChecklistPrompt(EPIC, listOpenItems(CHECKLIST));

    expect(prompt).toContain('only if you can quote the words that satisfy it');
    expect(prompt).toContain('Do not invent items');
  });

  it('says plainly when the Epic records no acceptance criteria', () => {
    expect(buildChecklistPrompt({ ...EPIC, acceptanceCriteria: '' }, listOpenItems(CHECKLIST)))
      .toContain('(none recorded)');
  });
});

describe('parseChecklistIngest', () => {
  function buildReply(items: unknown[]): string {
    return JSON.stringify({ kind: 'epicChecklistReview', items });
  }

  it('reads a well-formed reply', () => {
    const { verdicts, errors } = parseChecklistIngest(
      buildReply([
        { itemId: OPEN_ITEM_IDS[0], isSatisfied: true, evidence: 'Stakeholders signed off the objective on 12 August.' },
        { itemId: OPEN_ITEM_IDS[1], isSatisfied: false, evidence: 'No scope statement in the Epic.' },
      ]),
      OPEN_ITEM_IDS,
    );

    expect(errors).toEqual([]);
    expect(listSatisfiedItemIds(verdicts)).toEqual([OPEN_ITEM_IDS[0]]);
  });

  it('refuses to tick an item it was never shown', () => {
    const { verdicts, errors } = parseChecklistIngest(
      buildReply([
        { itemId: 'line-999', isSatisfied: true, evidence: 'Looks fine.' },
        { itemId: OPEN_ITEM_IDS[0], isSatisfied: true, evidence: 'Stakeholders signed off.' },
        { itemId: OPEN_ITEM_IDS[1], isSatisfied: false, evidence: 'Not stated.' },
      ]),
      OPEN_ITEM_IDS,
    );

    expect(listSatisfiedItemIds(verdicts)).toEqual([OPEN_ITEM_IDS[0]]);
    expect(errors[0]).toContain('line-999');
  });

  it('will not tick an item the assistant could quote nothing for', () => {
    const { verdicts } = parseChecklistIngest(
      buildReply([
        { itemId: OPEN_ITEM_IDS[0], isSatisfied: true, evidence: '   ' },
        { itemId: OPEN_ITEM_IDS[1], isSatisfied: false, evidence: 'Not stated.' },
      ]),
      OPEN_ITEM_IDS,
    );

    expect(listSatisfiedItemIds(verdicts)).toEqual([]);
    expect(verdicts[0].evidence).toContain('quoted nothing');
  });

  it('keeps the first answer when an item is answered twice', () => {
    const { verdicts, errors } = parseChecklistIngest(
      buildReply([
        { itemId: OPEN_ITEM_IDS[0], isSatisfied: true, evidence: 'Signed off.' },
        { itemId: OPEN_ITEM_IDS[0], isSatisfied: false, evidence: 'Actually not.' },
        { itemId: OPEN_ITEM_IDS[1], isSatisfied: false, evidence: 'Not stated.' },
      ]),
      OPEN_ITEM_IDS,
    );

    expect(verdicts.filter((verdict) => verdict.itemId === OPEN_ITEM_IDS[0])).toHaveLength(1);
    expect(listSatisfiedItemIds(verdicts)).toEqual([OPEN_ITEM_IDS[0]]);
    expect(errors.some((error) => error.includes('answered twice'))).toBe(true);
  });

  it('says which items went unanswered, and leaves them alone', () => {
    const { verdicts, errors } = parseChecklistIngest(
      buildReply([{ itemId: OPEN_ITEM_IDS[0], isSatisfied: true, evidence: 'Signed off.' }]),
      OPEN_ITEM_IDS,
    );

    expect(verdicts).toHaveLength(1);
    expect(errors.some((error) => error.includes(OPEN_ITEM_IDS[1]))).toBe(true);
  });

  it('reads a reply wrapped in prose or a code fence', () => {
    const { verdicts } = parseChecklistIngest(
      `Here you go:\n\`\`\`json\n${buildReply([
        { itemId: OPEN_ITEM_IDS[0], isSatisfied: true, evidence: 'Signed off.' },
        { itemId: OPEN_ITEM_IDS[1], isSatisfied: false, evidence: 'Not stated.' },
      ])}\n\`\`\``,
      OPEN_ITEM_IDS,
    );

    expect(verdicts).toHaveLength(2);
  });

  it('turns an unusable reply into one plain message rather than throwing', () => {
    expect(parseChecklistIngest('I could not do that.', OPEN_ITEM_IDS).errors).toHaveLength(1);
    expect(parseChecklistIngest(JSON.stringify({ kind: 'featureCompositionIngest', items: [] }), OPEN_ITEM_IDS).errors[0])
      .toContain('is not epicChecklistReview');
  });
});
