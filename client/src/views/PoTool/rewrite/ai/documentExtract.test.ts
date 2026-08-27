// documentExtract.test.ts — Reading a corpus one document at a time, because it fits no other way.

import { describe, expect, it } from 'vitest';

import {
  buildDocumentExtractPrompts,
  isDocumentExtractEmpty,
  MAX_DOCUMENT_CHARS_PER_PROMPT,
  MAX_ITEMS_PER_LIST,
  mergeDocumentExtracts,
  parseDocumentExtractReply,
  renderDocumentExtract,
} from './documentExtract.ts';
import type { DocumentExtract } from './documentExtract.ts';
import type { ReferencedSource } from '../../sources/sourceModel.ts';

function pasteSource(text: string, label = 'Billing Grid'): ReferencedSource {
  return { kind: 'paste', id: 'paste-1', label, text };
}

/** A reply carrying whatever fields the test cares about. */
function reply(fields: Record<string, unknown>): string {
  return JSON.stringify({ kind: 'documentExtract', ...fields });
}

/** An extract with everything empty except what the test sets. */
function extract(fields: Partial<DocumentExtract> = {}): DocumentExtract {
  return {
    sourceId: 'paste-1',
    sourceTitle: 'Billing Grid',
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

describe('buildDocumentExtractPrompts', () => {
  it('names the document and where it came from, so the extract can be traced back', () => {
    const [prompt] = buildDocumentExtractPrompts(pasteSource('LIS billing moves to consolidated statements.'));

    expect(prompt).toContain('Billing Grid');
    expect(prompt).toContain('Pasted');
    expect(prompt).toContain('LIS billing moves to consolidated statements.');
  });

  it('asks for the reply shape it will actually parse', () => {
    const [prompt] = buildDocumentExtractPrompts(pasteSource('anything'));

    expect(prompt).toContain('"kind":"documentExtract"');
    expect(prompt).toContain('openQuestions');
  });

  it('builds one prompt for a document that fits', () => {
    expect(buildDocumentExtractPrompts(pasteSource('short'))).toHaveLength(1);
  });

  it('splits a long document rather than truncating it', () => {
    // Truncating would drop the back half of a notebook page while the extract still looked
    // complete — worse than an extra round trip, because nothing would say anything was missing.
    const longText = Array.from({ length: 4000 }, (_unused, index) => `line ${index} of the notebook`).join('\n');

    const prompts = buildDocumentExtractPrompts(pasteSource(longText));

    expect(prompts.length).toBeGreaterThan(1);
    expect(prompts[0]).toContain('part 1 of');
    expect(prompts[prompts.length - 1]).toContain(`part ${prompts.length} of ${prompts.length}`);
  });

  it('keeps every part within the prompt cap', () => {
    const longText = 'x'.repeat(MAX_DOCUMENT_CHARS_PER_PROMPT * 3);

    buildDocumentExtractPrompts(pasteSource(longText)).forEach((prompt) => {
      expect(prompt.length).toBeLessThan(MAX_DOCUMENT_CHARS_PER_PROMPT + 2000);
    });
  });

  it('loses nothing across the seam between two parts', () => {
    const lines = Array.from({ length: 3000 }, (_unused, index) => `requirement-${index}`);

    const joinedPrompts = buildDocumentExtractPrompts(pasteSource(lines.join('\n'))).join('\n');

    lines.forEach((line) => expect(joinedPrompts).toContain(line));
  });

  it('says nothing at all for a document with no text', () => {
    expect(buildDocumentExtractPrompts(pasteSource('   '))).toEqual([]);
  });
});

describe('parseDocumentExtractReply', () => {
  it('takes the source from the document, not from the reply', () => {
    // The assistant has no way to know a source id, and echoing a title back is one more thing it
    // can get subtly wrong while the wrong provenance rides all the way through to the brief.
    const parsed = parseDocumentExtractReply(
      reply({ summary: 'Billing comparison.', sourceTitle: 'Something Else' }),
      pasteSource('x'),
      '2026-08-27T00:00:00.000Z',
    );

    expect(parsed.sourceId).toBe('paste-1');
    expect(parsed.sourceTitle).toBe('Billing Grid');
    expect(parsed.extractedAtIso).toBe('2026-08-27T00:00:00.000Z');
  });

  it('keeps the four lists apart, because a decision is not an open question', () => {
    const parsed = parseDocumentExtractReply(
      reply({
        decisions: ['Consolidated statements'],
        requirements: ['Must support LIS-to-Subscriber'],
        openQuestions: ['Who owns runout?'],
        facts: ['Cutover 2026-10-01'],
      }),
      pasteSource('x'),
      '2026-08-27T00:00:00.000Z',
    );

    expect(parsed.decisions).toEqual(['Consolidated statements']);
    expect(parsed.requirements).toEqual(['Must support LIS-to-Subscriber']);
    expect(parsed.openQuestions).toEqual(['Who owns runout?']);
    expect(parsed.facts).toEqual(['Cutover 2026-10-01']);
  });

  it('caps a list, so a long document cannot return an extract as long as itself', () => {
    const manyItems = Array.from({ length: 50 }, (_unused, index) => `requirement ${index}`);

    const parsed = parseDocumentExtractReply(reply({ requirements: manyItems }), pasteSource('x'), 'now');

    expect(parsed.requirements).toHaveLength(MAX_ITEMS_PER_LIST);
  });

  it('drops repeats and blanks rather than carrying them into the brief', () => {
    const parsed = parseDocumentExtractReply(
      reply({ decisions: ['Same', 'Same', '   ', 'Other'] }),
      pasteSource('x'),
      'now',
    );

    expect(parsed.decisions).toEqual(['Same', 'Other']);
  });

  it('treats a missing list as empty rather than as a failure', () => {
    // A document that settles nothing genuinely has no decisions; refusing the extract over that
    // would demand a fabricated one.
    const parsed = parseDocumentExtractReply(reply({ summary: 'A note.' }), pasteSource('x'), 'now');

    expect(parsed.decisions).toEqual([]);
    expect(parsed.summary).toBe('A note.');
  });

  it('refuses a reply of the wrong kind', () => {
    expect(() => parseDocumentExtractReply('{"kind":"featureRewriteBatch"}', pasteSource('x'), 'now'))
      .toThrow('documentExtract');
  });

  it('refuses a reply that is not JSON at all', () => {
    expect(() => parseDocumentExtractReply('I could not read that document.', pasteSource('x'), 'now')).toThrow();
  });
});

describe('mergeDocumentExtracts', () => {
  it('ADDS a later part rather than replacing the earlier one', () => {
    // A 40,000-character notebook page takes four prompts. A fourth reply that overwrote the first
    // three would leave an extract of the document's last quarter wearing the whole document's name.
    const merged = mergeDocumentExtracts(
      extract({ decisions: ['From part one'], facts: ['Fact one'] }),
      extract({ decisions: ['From part two'], facts: ['Fact two'] }),
    );

    expect(merged.decisions).toEqual(['From part one', 'From part two']);
    expect(merged.facts).toEqual(['Fact one', 'Fact two']);
  });

  it('does not repeat a point both parts made', () => {
    const merged = mergeDocumentExtracts(
      extract({ requirements: ['Shared point'] }),
      extract({ requirements: ['Shared point', 'New point'] }),
    );

    expect(merged.requirements).toEqual(['Shared point', 'New point']);
  });

  it('holds to the cap while merging', () => {
    const merged = mergeDocumentExtracts(
      extract({ facts: Array.from({ length: 10 }, (_unused, index) => `early ${index}`) }),
      extract({ facts: Array.from({ length: 10 }, (_unused, index) => `late ${index}`) }),
    );

    expect(merged.facts).toHaveLength(MAX_ITEMS_PER_LIST);
  });

  it('joins two summaries rather than losing the first', () => {
    const merged = mergeDocumentExtracts(extract({ summary: 'First half.' }), extract({ summary: 'Second half.' }));

    expect(merged.summary).toBe('First half. Second half.');
  });

  it('does not repeat one summary when both parts gave the same one', () => {
    const merged = mergeDocumentExtracts(extract({ summary: 'The grid.' }), extract({ summary: 'The grid.' }));

    expect(merged.summary).toBe('The grid.');
  });
});

describe('renderDocumentExtract', () => {
  it('names the document and its origin, because the brief will be challenged', () => {
    const rendered = renderDocumentExtract(extract({ summary: 'Billing comparison.', decisions: ['Consolidated'] }));

    expect(rendered).toContain('### Billing Grid (Pasted)');
    expect(rendered).toContain('Decisions:');
    expect(rendered).toContain('  - Consolidated');
  });

  it('leaves out a list that is empty rather than printing an empty heading', () => {
    const rendered = renderDocumentExtract(extract({ decisions: ['One'] }));

    expect(rendered).not.toContain('Requirements:');
    expect(rendered).not.toContain('Open questions:');
  });

  it('is far smaller than the document it stands in for', () => {
    const rendered = renderDocumentExtract(extract({
      summary: 'A page of the notebook.',
      decisions: Array.from({ length: MAX_ITEMS_PER_LIST }, (_unused, index) => `decision ${index}`),
      requirements: Array.from({ length: MAX_ITEMS_PER_LIST }, (_unused, index) => `requirement ${index}`),
    }));

    expect(rendered.length).toBeLessThan(MAX_DOCUMENT_CHARS_PER_PROMPT / 4);
  });
});

describe('isDocumentExtractEmpty', () => {
  it('is true when the document yielded nothing, so the UI can say so', () => {
    expect(isDocumentExtractEmpty(extract())).toBe(true);
  });

  it('is false when it yielded even one fact', () => {
    expect(isDocumentExtractEmpty(extract({ facts: ['Cutover 2026-10-01'] }))).toBe(false);
  });
});
