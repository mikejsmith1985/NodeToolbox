// aiReplySections.test.ts — Proves a prose reply's sections are found by marker or by heading (GH #499).

import { describe, expect, it } from 'vitest';

import { buildSectionsFollowUpPrompt, listMissingSections, readReplySections, type ReplySection } from './aiReplySections.ts';

const SECTIONS: readonly ReplySection<'summary' | 'plan' | 'backout'>[] = [
  { key: 'summary', marker: 'SUMMARY', headingPattern: /^summary$/i },
  { key: 'plan', marker: 'PLAN', headingPattern: /^(?:implementation\s+)?plan$/i },
  { key: 'backout', marker: 'BACKOUT_PLAN', headingPattern: /^back[\s-]?out\s+plan$/i },
];

describe('readReplySections', () => {
  it('reads the asked-for markers, each value running to the next marker', () => {
    const sectionTexts = readReplySections('```text\nSUMMARY: Ship it\nPLAN: 1. Deploy\n2. Verify\nBACKOUT_PLAN: Revert\n```', SECTIONS);
    expect(sectionTexts).toEqual({ summary: 'Ship it', plan: '1. Deploy\n2. Verify', backout: 'Revert' });
  });

  it('reads headings an answer engine writes instead, dropping its intro and its closing offer', () => {
    const replyText = [
      'Here are the drafted fields.',
      '## **Summary**',
      'Ship the release',
      'Implementation Plan (REL then PRD)',
      '1. Deploy',
      'Back-out Plan:',
      '• Revert the deploy',
      'If you provide the missing details, I can finish the draft.',
    ].join('\n');
    expect(readReplySections(replyText, SECTIONS)).toEqual({ summary: 'Ship the release', plan: '1. Deploy', backout: '• Revert the deploy' });
  });

  it('never reads a list entry as a heading, and keeps a section named again as text of the one it is in', () => {
    const replyText = 'Summary: ship it\nPlan\n• Backout Plan: owner decides\nSummary: see above\nBackout Plan\nRevert';
    const sectionTexts = readReplySections(replyText, SECTIONS);
    expect(sectionTexts.plan).toBe('• Backout Plan: owner decides\nSummary: see above');
    expect(sectionTexts.summary).toBe('ship it');
    expect(sectionTexts.backout).toBe('Revert');
  });
});

describe('the follow-up', () => {
  it('asks only for the sections left out, by their markers', () => {
    const missingSections = listMissingSections({ summary: 'x' }, SECTIONS);
    const followUp = buildSectionsFollowUpPrompt(missingSections, false);
    expect(followUp).toContain('did not include PLAN, BACKOUT_PLAN');
    expect(followUp).toContain('PLAN: [text]');
    expect(followUp).not.toContain('SUMMARY: [text]');
  });

  it('says the reply could not be read when nothing was found', () => {
    expect(buildSectionsFollowUpPrompt(SECTIONS, true)).toMatch(/^Your last reply was not in the form I need/);
  });
});
