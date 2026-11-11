// corpusBrief.test.ts — Thirty extracts into the one brief a re-write prompt can actually carry.

import { describe, expect, it } from 'vitest';

import {
  buildCorpusBriefFollowUpPrompt,
  buildCorpusBriefPrompt,
  listMissingCorpusBriefSections,
  MAX_EXTRACT_CHARS_PER_PROMPT,
  parseCorpusBriefReply,
  renderCorpusBrief,
} from './corpusBrief.ts';
import type { CorpusBrief } from './corpusBrief.ts';
import type { DocumentExtract } from './documentExtract.ts';

/** An extract with a title and whatever lists the test needs. */
function extract(sourceTitle: string, fields: Partial<DocumentExtract> = {}): DocumentExtract {
  return {
    sourceId: sourceTitle.toLowerCase().replace(/\s+/g, '-'),
    sourceTitle,
    sourceOrigin: 'Pasted',
    summary: '',
    decisions: [],
    requirements: [],
    openQuestions: [],
    facts: [],
    extractedAtIso: '2026-08-27T00:00:00.000Z',
    ...fields,
  };
}

/** A reply carrying whatever fields the test cares about. */
function reply(fields: Record<string, unknown>): string {
  return JSON.stringify({ kind: 'corpusBrief', ...fields });
}

/** A brief with everything empty except what the test sets. */
function brief(fields: Partial<CorpusBrief> = {}): CorpusBrief {
  return {
    overview: '',
    decisions: [],
    requirements: [],
    openQuestions: [],
    conflicts: [],
    extractCount: 2,
    builtAtIso: '2026-08-27T00:00:00.000Z',
    ...fields,
  };
}

describe('buildCorpusBriefPrompt', () => {
  it('carries every extract, because a document left out cannot be de-duplicated against', () => {
    const prompt = buildCorpusBriefPrompt([
      extract('Billing Grid', { decisions: ['Consolidated statements'] }),
      extract('Cutover Email', { decisions: ['Cutover is 2026-10-01'] }),
    ]);

    expect(prompt).toContain('Billing Grid');
    expect(prompt).toContain('Cutover Email');
    expect(prompt).toContain('Consolidated statements');
    expect(prompt).toContain('Cutover is 2026-10-01');
  });

  it('asks for conflicts to be NAMED rather than smoothed over', () => {
    // A contradiction nobody spotted is how a Feature gets written against last year's answer.
    const prompt = buildCorpusBriefPrompt([extract('A'), extract('B')]);

    expect(prompt).toContain('DISAGREE');
    expect(prompt).toContain('Do not pick a winner');
  });

  it('asks for the reply shape it will actually parse', () => {
    const prompt = buildCorpusBriefPrompt([extract('A'), extract('B')]);

    // AI Mode follows labelled headings and bullet lists, not a JSON template (GH #499).
    expect(prompt).toContain('CONFLICTS:');
    expect(prompt).toContain('[Doc A; Doc B]');
    expect(prompt).not.toContain('"kind"');
  });

  it('says nothing for a single extract, which is already its own brief', () => {
    expect(buildCorpusBriefPrompt([extract('Only One')])).toBe('');
  });

  it('says nothing at all when there is nothing to consolidate', () => {
    expect(buildCorpusBriefPrompt([])).toBe('');
  });

  it('names the extracts that did not fit instead of dropping them silently', () => {
    const bulkyExtracts = Array.from({ length: 60 }, (_unused, index) =>
      extract(`Doc ${index}`, {
        summary: 'x'.repeat(1000),
        decisions: Array.from({ length: 12 }, (_ignored, itemIndex) => `decision ${itemIndex} `.repeat(10)),
      }));

    const prompt = buildCorpusBriefPrompt(bulkyExtracts);

    expect(prompt).toContain('did not fit');
  });

  it('holds the extracts within their budget', () => {
    const bulkyExtracts = Array.from({ length: 60 }, (_unused, index) =>
      extract(`Doc ${index}`, { summary: 'x'.repeat(2000) }));

    const prompt = buildCorpusBriefPrompt(bulkyExtracts);

    expect(prompt.length).toBeLessThan(MAX_EXTRACT_CHARS_PER_PROMPT + 5000);
  });
});

describe('parseCorpusBriefReply', () => {
  const extracts = [extract('Billing Grid'), extract('Cutover Email')];

  it('keeps each point with the documents behind it', () => {
    const parsed = parseCorpusBriefReply(
      reply({ decisions: [{ text: 'Consolidated statements', sources: ['Billing Grid', 'Cutover Email'] }] }),
      extracts,
      '2026-08-27T00:00:00.000Z',
    );

    expect(parsed.decisions).toEqual([
      { text: 'Consolidated statements', sourceTitles: ['Billing Grid', 'Cutover Email'] },
    ]);
  });

  it('drops a source title no document actually had', () => {
    // Provenance that cannot be followed back to a document is worse than none: it reads as
    // verified and is not.
    const parsed = parseCorpusBriefReply(
      reply({ requirements: [{ text: 'Support LIS', sources: ['Billing Grid', 'Invented Standard'] }] }),
      extracts,
      'now',
    );

    expect(parsed.requirements[0].sourceTitles).toEqual(['Billing Grid']);
  });

  it('keeps a point whose sources were all invented, rather than losing the point', () => {
    const parsed = parseCorpusBriefReply(
      reply({ decisions: [{ text: 'A real decision', sources: ['Nowhere'] }] }),
      extracts,
      'now',
    );

    expect(parsed.decisions).toEqual([{ text: 'A real decision', sourceTitles: [] }]);
  });

  it('reads a conflict with both of its positions', () => {
    const parsed = parseCorpusBriefReply(
      reply({
        conflicts: [{
          subject: 'Runout ownership',
          positions: [
            { text: 'Blue owns runout', sources: ['Billing Grid'] },
            { text: 'Purple owns runout', sources: ['Cutover Email'] },
          ],
        }],
      }),
      extracts,
      'now',
    );

    expect(parsed.conflicts).toHaveLength(1);
    expect(parsed.conflicts[0].subject).toBe('Runout ownership');
    expect(parsed.conflicts[0].positions).toHaveLength(2);
  });

  it('drops a conflict with no subject or no positions', () => {
    const parsed = parseCorpusBriefReply(
      reply({ conflicts: [{ subject: '', positions: [{ text: 'x' }] }, { subject: 'Named', positions: [] }] }),
      extracts,
      'now',
    );

    expect(parsed.conflicts).toEqual([]);
  });

  it('records how many extracts fed it, so half a corpus cannot pass as the whole', () => {
    const parsed = parseCorpusBriefReply(reply({ overview: 'A brief.' }), extracts, 'now');

    expect(parsed.extractCount).toBe(2);
  });

  it('refuses a reply of the wrong kind', () => {
    expect(() => parseCorpusBriefReply('{"kind":"documentExtract"}', extracts, 'now')).toThrow('corpusBrief');
  });

  it('refuses a reply that is not JSON at all', () => {
    expect(() => parseCorpusBriefReply('Here is your brief!', extracts, 'now')).toThrow();
  });
});

describe('renderCorpusBrief', () => {
  it('puts CONFLICTS ahead of the settled material', () => {
    // A re-write made against a contradiction nobody flagged is the expensive failure this pipeline
    // exists to prevent, and burying it under three lists of agreed points is how it gets missed.
    const rendered = renderCorpusBrief(brief({
      decisions: [{ text: 'Consolidated statements', sourceTitles: ['Billing Grid'] }],
      conflicts: [{
        subject: 'Runout ownership',
        positions: [
          { text: 'Blue owns runout', sourceTitles: ['Billing Grid'] },
          { text: 'Purple owns runout', sourceTitles: ['Cutover Email'] },
        ],
      }],
    }));

    expect(rendered.indexOf('CONFLICTS')).toBeLessThan(rendered.indexOf('Decisions:'));
    expect(rendered).toContain('Runout ownership');
    expect(rendered).toContain('Blue owns runout');
    expect(rendered).toContain('Purple owns runout');
  });

  it('shows each point with its sources so it can be checked', () => {
    const rendered = renderCorpusBrief(brief({
      requirements: [{ text: 'Support LIS-to-Subscriber', sourceTitles: ['Billing Grid'] }],
    }));

    expect(rendered).toContain('Support LIS-to-Subscriber  [Billing Grid]');
  });

  it('shows a point with no traceable source without empty brackets', () => {
    const rendered = renderCorpusBrief(brief({ decisions: [{ text: 'Untraced', sourceTitles: [] }] }));

    expect(rendered).toContain('- Untraced');
    expect(rendered).not.toContain('[]');
  });

  it('says how many documents it was built from', () => {
    expect(renderCorpusBrief(brief({ extractCount: 31 }))).toContain('31 documents');
  });

  it('leaves out an empty list rather than printing an empty heading', () => {
    const rendered = renderCorpusBrief(brief({ decisions: [{ text: 'One', sourceTitles: [] }] }));

    expect(rendered).not.toContain('Open questions:');
    expect(rendered).not.toContain('CONFLICTS');
  });
});

// ── Google AI Mode replies (GH #499) ──

describe('parseCorpusBriefReply — an AI Mode document', () => {
  const extracts = [extract('Billing Grid'), extract('Cutover Email')];
  const aiModeReply = [
    'Here is the consolidated brief across both documents.',
    '',
    '## Overview',
    'Billing for LIS members is moving to consolidated statements.',
    '',
    '## Conflicts',
    '* **Runout ownership**',
    '    * Blue owns runout [Billing Grid]',
    '    * Purple owns runout [Cutover Email]',
    '',
    '## Decisions',
    '* Consolidated statements [Billing Grid; Cutover Email]',
    '* Paper invoices retire (Sources: Billing Grid, Invented Standard)',
    '',
    '## Requirements',
    '- Support LIS-to-Subscriber [Billing Grid]',
    '',
    '## Open Questions',
    '- None',
    '',
    'Let me know if you want this as a table.',
  ].join('\n');

  it('reads each point with the documents behind it', () => {
    const parsed = parseCorpusBriefReply(aiModeReply, extracts, 'now');

    expect(parsed.overview).toBe('Billing for LIS members is moving to consolidated statements.');
    expect(parsed.decisions[0]).toEqual({ text: 'Consolidated statements', sourceTitles: ['Billing Grid', 'Cutover Email'] });
    expect(parsed.requirements).toEqual([{ text: 'Support LIS-to-Subscriber', sourceTitles: ['Billing Grid'] }]);
    expect(parsed.openQuestions).toEqual([]);
  });

  it('still drops a source title no document had', () => {
    const parsed = parseCorpusBriefReply(aiModeReply, extracts, 'now');

    expect(parsed.decisions[1]).toEqual({ text: 'Paper invoices retire', sourceTitles: ['Billing Grid'] });
  });

  it('reads a conflict as its subject with the positions indented beneath it', () => {
    const parsed = parseCorpusBriefReply(aiModeReply, extracts, 'now');

    expect(parsed.conflicts).toEqual([{
      subject: 'Runout ownership',
      positions: [
        { text: 'Blue owns runout', sourceTitles: ['Billing Grid'] },
        { text: 'Purple owns runout', sourceTitles: ['Cutover Email'] },
      ],
    }]);
  });

  it('asks for no follow-up when every heading came back', () => {
    expect(buildCorpusBriefFollowUpPrompt(aiModeReply)).toBe('');
    expect(listMissingCorpusBriefSections(aiModeReply)).toEqual([]);
  });

  it('asks only for the headings a reply left out, and names them', () => {
    const partialReply = '## Overview\nA brief.\n\n## Decisions\n- Ship it [Billing Grid]';

    expect(listMissingCorpusBriefSections(partialReply)).toEqual(['CONFLICTS', 'REQUIREMENTS', 'OPEN_QUESTIONS']);
    const followUp = buildCorpusBriefFollowUpPrompt(partialReply);
    expect(followUp).toContain('CONFLICTS: [text]');
    expect(followUp).not.toContain('OVERVIEW: [text]');
  });

  it('reads the first reply and its follow-up answer pasted together as one brief', () => {
    const combinedReply = '## Overview\nA brief.\n\n## Decisions\n- Ship it [Billing Grid]\n\n'
      + 'CONFLICTS:\n- None\nREQUIREMENTS:\n- Must ship [Cutover Email]\nOPEN_QUESTIONS:\n- None';

    expect(listMissingCorpusBriefSections(combinedReply)).toEqual([]);
    expect(parseCorpusBriefReply(combinedReply, extracts, 'now').requirements[0].text).toBe('Must ship');
  });

  it('asks for the whole form again when the reply could not be read', () => {
    const followUp = buildCorpusBriefFollowUpPrompt('Here is your brief!');

    expect(followUp).toContain('could not be read');
    expect(followUp).toContain('OVERVIEW: [text]');
  });
});
