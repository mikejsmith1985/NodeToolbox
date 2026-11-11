// monthlyReportAiReply.test.ts — Proves the Monthly Report's pillar table reads back into the same entries a JSON reply gave.

import { describe, expect, it } from 'vitest';

import {
  buildMonthlyReportFollowUpPrompt,
  buildMonthlyReportReplyForm,
  readMonthlyReportColumnHeader,
  readMonthlyReportReplyEntries,
} from './monthlyReportAiReply.ts';

describe('buildMonthlyReportReplyForm', () => {
  it('ends with a fill-in table listing every pillar as a row, not a JSON shape (GH #499)', () => {
    const replyForm = buildMonthlyReportReplyForm();

    expect(replyForm).not.toMatch(/JSON ARRAY|"pillar"/);
    expect(replyForm.split('\n').slice(-4)).toEqual([
      'Pillar | Initiative name | Product areas | What was accomplished | Business outcomes | Stakeholders',
      'Growth | ___ | ___ | ___ | ___ | ___',
      'Affordability | ___ | ___ | ___ | ___ | ___',
      'Operating Model | ___ | ___ | ___ | ___ | ___',
    ]);
  });

  it('names the column each narrative field is written in', () => {
    expect(readMonthlyReportColumnHeader('accomplished')).toBe('What was accomplished');
    expect(readMonthlyReportColumnHeader('unknownField')).toBe('unknownField');
  });
});

describe('readMonthlyReportReplyEntries', () => {
  it('reads an AI Mode markdown table with an intro and closing offer, dropping the blank pillars', () => {
    const replyText = [
      'Here is the monthly report draft, classified by pillar.',
      '',
      '| Pillar | Initiative name | Product areas | What was accomplished | Business outcomes | Stakeholders |',
      '|---|---|---|---|---|---|',
      '| **Growth** | Enrollment uplift | Enrollment | • Grew signups • Launched portal | More members | Sales |',
      '| Affordability | ___ | ___ | ___ | ___ | ___ |',
      '| Operating Model | ___ | ___ | ___ | ___ | ___ |',
      '',
      'If you provide the delivered metrics, I can quantify the outcomes.',
    ].join('\n');

    expect(readMonthlyReportReplyEntries(replyText)).toEqual([{
      pillar: 'Growth',
      initiativeName: 'Enrollment uplift',
      productAreas: 'Enrollment',
      accomplished: '• Grew signups\n• Launched portal',
      outcomes: 'More members',
      stakeholders: 'Sales',
    }]);
  });

  it('reads a table pasted from the web page as tab-separated cells, one entry per filled pillar', () => {
    const replyText = [
      'Pillar\tInitiative name\tWhat was accomplished',
      'Growth\tUplift\t• Grew signups',
      'Affordability\tCost\t• Cut costs',
    ].join('\n');

    expect(readMonthlyReportReplyEntries(replyText)).toEqual([
      { pillar: 'Growth', initiativeName: 'Uplift', accomplished: '• Grew signups' },
      { pillar: 'Affordability', initiativeName: 'Cost', accomplished: '• Cut costs' },
    ]);
  });

  it('still reads a JSON array or a single JSON object from another assistant', () => {
    expect(readMonthlyReportReplyEntries('[{"pillar":"Growth","accomplished":"• a"}]')).toEqual([{ pillar: 'Growth', accomplished: '• a' }]);
    expect(readMonthlyReportReplyEntries('```json\n{"pillar":"Affordability"}\n```')).toEqual([{ pillar: 'Affordability' }]);
  });

  it('throws the usual error for a reply that is neither, so the follow-up can be offered', () => {
    expect(() => readMonthlyReportReplyEntries('The team grew signups this month [CONFIRM].')).toThrow('No JSON found in the response.');
  });
});

describe('buildMonthlyReportFollowUpPrompt', () => {
  it('asks the same chat for the same table, keeping the answers it gave', () => {
    const followUp = buildMonthlyReportFollowUpPrompt();

    expect(followUp).toMatch(/^Your last reply was not in the form I need/);
    expect(followUp).toContain('Operating Model | ___');
  });
});
