// releaseAiAssistReply.test.ts — The release-notes round reads Google AI Mode's filled-in form (summary + two tables),
// still reads the old JSON object, never shows a half row, and offers a follow-up for what was left out (GH #499).

import { describe, expect, it } from 'vitest';

import {
  buildReleaseReplyFollowUpPrompt,
  buildReleaseReplyFormLines,
  readReleaseReplyForm,
  type ReleaseAiAssistReplyExpectation,
} from './releaseAiAssistReply.ts';
import { readReleaseAiAssistReply } from '../hooks/releaseAiAssistNotes.ts';

const EXPECTATION: ReleaseAiAssistReplyExpectation = { releaseName: 'Release 26.3', issueKeys: ['TBX-101', 'TBX-102'], featureKeys: ['TBX-1'] };
const ITEMS_HEADER = '| Issue key | Title | Release note | Customer impact | Technical details | Risks | Validation |';
const ROW_101 = '| TBX-101 | Release note generator | Adds a generator. | Saves time. | New module. | None. | Unit tests. |';
const ROW_102 = '| TBX-102 | Faster export | Export is quicker. | Less waiting. | Batched calls. | None. | Validation details pending. |';
const FEATURES_HEADER = '| Feature key | Narrative |';
const FEATURE_ROW = '| TBX-1 | Release notes now draft themselves. |';

/** A reply shaped the way AI Mode writes one: intro, heading, tables with dividers, closing offer. */
function buildAiModeReply(itemRows: string[]): string {
  return [
    'Here are the release notes for Release 26.3.',
    '',
    '## Release Summary',
    'This release adds a release-note generator and speeds up exports.',
    '',
    ITEMS_HEADER, '|---|---|---|---|---|---|---|', ...itemRows,
    '',
    FEATURES_HEADER, '|---|---|', FEATURE_ROW,
    '',
    'If you provide the deployment date I can add a rollout note.',
  ].join('\n');
}

describe('buildReleaseReplyFormLines', () => {
  it('pre-fills every item and Feature key with blanks', () => {
    const formLines = buildReleaseReplyFormLines(EXPECTATION);
    expect(formLines).toContain('RELEASE_SUMMARY: ___');
    expect(formLines).toContain('TBX-102 | ___ | ___ | ___ | ___ | ___ | ___');
    expect(formLines).toContain('FEATURE_NARRATIVES:\nFeature key | Narrative\nTBX-1 | ___');
  });
});

describe('readReleaseAiAssistReply — the filled-in form', () => {
  it('reads an AI Mode reply with intro, heading and closing offer into the same document', () => {
    const reading = readReleaseAiAssistReply(buildAiModeReply([ROW_101, ROW_102]), EXPECTATION);

    expect(reading.followUpPrompt).toBe('');
    expect(reading.message).toBeNull();
    expect(reading.document).toEqual({
      releaseName: 'Release 26.3',
      releaseSummary: 'This release adds a release-note generator and speeds up exports.',
      items: [
        { issueKey: 'TBX-101', title: 'Release note generator', releaseNote: 'Adds a generator.', customerImpact: 'Saves time.', technicalDetails: 'New module.', risks: 'None.', validation: 'Unit tests.' },
        { issueKey: 'TBX-102', title: 'Faster export', releaseNote: 'Export is quicker.', customerImpact: 'Less waiting.', technicalDetails: 'Batched calls.', risks: 'None.', validation: 'Validation details pending.' },
      ],
      featureNarratives: [{ featureKey: 'TBX-1', narrative: 'Release notes now draft themselves.' }],
    });
  });

  it('reads tab-separated tables and the RELEASE_SUMMARY marker line', () => {
    const toTabs = (tableRow: string) => tableRow.replace(/^\|\s*|\s*\|$/g, '').split(/\s*\|\s*/).join('\t');
    const replyText = ['RELEASE_SUMMARY: Two improvements.', toTabs(ITEMS_HEADER), toTabs(ROW_101), toTabs(ROW_102),
      toTabs(FEATURES_HEADER), toTabs(FEATURE_ROW)].join('\n');

    const reading = readReleaseAiAssistReply(replyText, EXPECTATION);

    expect(reading.document?.releaseSummary).toBe('Two improvements.');
    expect(reading.document?.items.map((row) => row.issueKey)).toEqual(['TBX-101', 'TBX-102']);
    expect(reading.document?.featureNarratives).toHaveLength(1);
  });

  it('shows the complete rows, never a half row, and asks a follow-up for the rest', () => {
    const halfRow = '| TBX-102 | Faster export | ___ | Less waiting. | Batched calls. | None. | Pending. |';
    const reading = readReleaseAiAssistReply(buildAiModeReply([ROW_101, halfRow]), EXPECTATION);

    expect(reading.document?.items.map((row) => row.issueKey)).toEqual(['TBX-101']);
    expect(reading.message).toMatch(/left out or left blank/);
    expect(reading.followUpPrompt).toContain('TBX-102 | ___');
    expect(reading.followUpPrompt).not.toContain('TBX-101 | ___');
    expect(reading.followUpPrompt).not.toContain('RELEASE_SUMMARY: ___');
  });

  it('a follow-up reply pasted under the first fills the gap', () => {
    const firstReply = buildAiModeReply([ROW_101]);
    const followUpReply = ['Here is the missing row.', ITEMS_HEADER, ROW_102].join('\n');

    const reading = readReleaseAiAssistReply(`${firstReply}\n\n${followUpReply}`, EXPECTATION);

    expect(reading.document?.items).toHaveLength(2);
    expect(reading.followUpPrompt).toBe('');
  });

  it('asks for the summary when only the tables came back', () => {
    const formReading = readReleaseReplyForm([ITEMS_HEADER, ROW_101, ROW_102, FEATURES_HEADER, FEATURE_ROW].join('\n'), EXPECTATION);

    expect(formReading.releaseSummary).toBe('');
    expect(buildReleaseReplyFollowUpPrompt(formReading)).toContain('RELEASE_SUMMARY: ___');
  });

  it('drops a row for an item not in the release', () => {
    const strayRow = '| TBX-999 | Stray | x | y | z | None. | v |';
    const reading = readReleaseAiAssistReply(buildAiModeReply([ROW_101, ROW_102, strayRow]), EXPECTATION);
    expect(reading.document?.items.map((row) => row.issueKey)).toEqual(['TBX-101', 'TBX-102']);
  });
});

describe('readReleaseAiAssistReply — other replies', () => {
  it('still reads the old JSON object', () => {
    const replyText = `Sure!\n\`\`\`json\n${JSON.stringify({
      releaseName: 'Release 26.3',
      releaseSummary: 'Summary.',
      items: [{ issueKey: 'TBX-101', title: 't', releaseNote: 'n', customerImpact: 'c', technicalDetails: 'd', risks: 'None.', validation: 'v' }],
    })}\n\`\`\``;

    const reading = readReleaseAiAssistReply(replyText, EXPECTATION);

    expect(reading.document?.items[0].issueKey).toBe('TBX-101');
    expect(reading.followUpPrompt).toBe('');
  });

  it('gives the whole form back when the reply is neither the form nor JSON', () => {
    const reading = readReleaseAiAssistReply('This release improves exports and adds a generator.', EXPECTATION);

    expect(reading.document).toBeNull();
    expect(reading.message).toBe('AI Assist response is not valid JSON.');
    expect(reading.followUpPrompt).toContain('could not be read');
    expect(reading.followUpPrompt).toContain('TBX-101 | ___');
    expect(reading.followUpPrompt).toContain('TBX-1 | ___');
  });
});
