// cardDetail.test.ts — Proves the detailed card reads real context and never invents any.

import { describe, expect, it } from 'vitest';

import { buildCardDetailIndex, excerpt, formatCommentDate, readCardDetail } from './cardDetail.ts';

describe('excerpt — a card, not a document', () => {
  it('leaves short text alone', () => {
    expect(excerpt('Short enough', 100)).toBe('Short enough');
  });

  it('collapses the whitespace Jira descriptions are full of', () => {
    expect(excerpt('one\n\n  two\t three', 100)).toBe('one two three');
  });

  it('cuts on a word boundary when one is near the end', () => {
    const cut = excerpt('alpha beta gamma delta epsilon', 20);

    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toContain('delt…');
  });

  it('cuts mid-token rather than gutting the excerpt for one long word', () => {
    // Breaking on the only space would leave almost nothing.
    const cut = excerpt('a ' + 'x'.repeat(60), 20);
    expect(cut.length).toBeGreaterThan(15);
  });

  it('survives missing text', () => {
    expect(excerpt(undefined as unknown as string, 10)).toBe('');
  });
});

describe('readCardDetail', () => {
  it('reads the description, attachment count and last comment', () => {
    const detail = readCardDetail({
      fields: {
        description: 'The thing needs doing.',
        attachment: [{ id: '1' }, { id: '2' }],
        comment: {
          comments: [
            { author: { displayName: 'First, Person' }, created: '2026-01-01T00:00:00.000+0000', body: 'older' },
            { author: { displayName: 'Smith, Michael (CTR)' }, created: '2026-02-01T00:00:00.000+0000', body: 'newest' },
          ],
        },
      },
    });

    expect(detail.descriptionExcerpt).toBe('The thing needs doing.');
    expect(detail.attachmentCount).toBe(2);
    expect(detail.lastComment?.authorDisplayName).toBe('Smith, Michael (CTR)');
    expect(detail.lastComment?.excerpt).toBe('newest');
  });

  it('takes the NEWEST comment whoever wrote it, including automation', () => {
    // A build or deployment notice is often the latest news; filtering bots would hide it.
    const detail = readCardDetail({
      fields: {
        comment: {
          comments: [
            { author: { displayName: 'A Human' }, created: '2026-01-01', body: 'human note' },
            { author: { displayName: 'Jira Automation' }, created: '2026-02-01', body: 'deployed to INT' },
          ],
        },
      },
    });

    expect(detail.lastComment?.excerpt).toBe('deployed to INT');
  });

  it('reports no description rather than an empty string', () => {
    expect(readCardDetail({ fields: { description: '   ' } }).descriptionExcerpt).toBeNull();
  });

  it('reports no comment rather than a blank one', () => {
    expect(readCardDetail({ fields: { comment: { comments: [] } } }).lastComment).toBeNull();
  });

  it('does not throw on an issue with none of these fields', () => {
    const detail = readCardDetail({ fields: {} });

    expect(detail.descriptionExcerpt).toBeNull();
    expect(detail.attachmentCount).toBe(0);
    expect(detail.lastComment).toBeNull();
  });

  it('does not throw on a missing issue', () => {
    expect(readCardDetail(undefined).attachmentCount).toBe(0);
  });

  it('names an unknown comment author rather than showing nothing', () => {
    const detail = readCardDetail({ fields: { comment: { comments: [{ body: 'anon' }] } } });
    expect(detail.lastComment?.authorDisplayName).toBe('Unknown');
  });
});

describe('buildCardDetailIndex', () => {
  it('keys the detail by issue key', () => {
    const index = buildCardDetailIndex([
      { key: 'ENCUC-1', fields: { description: 'first' } },
      { key: 'ENCUC-2', fields: { attachment: [{ id: 'a' }] } },
    ]);

    expect(index['ENCUC-1'].descriptionExcerpt).toBe('first');
    expect(index['ENCUC-2'].attachmentCount).toBe(1);
  });
});

describe('formatCommentDate', () => {
  it('shortens a Jira timestamp', () => {
    expect(formatCommentDate('2026-02-01T10:00:00.000+0000')).not.toContain('T');
  });

  it('shows the raw value rather than inventing a date it cannot parse', () => {
    expect(formatCommentDate('not a date')).toBe('not a date');
  });
});
