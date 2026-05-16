// richTextPlainText.test.ts — Unit tests for rich-text-to-plain-text normalization helpers.

import { describe, expect, it } from 'vitest';

import { normalizeRichTextToPlainText } from './richTextPlainText.ts';

describe('normalizeRichTextToPlainText', () => {
  it('strips HTML tags and inline style markup from string payloads', () => {
    const encodedHtmlText = '<p dir="auto" style="animation-duration:0.01ms;">Facets:</p><b>Done</b>';

    const normalizedText = normalizeRichTextToPlainText(encodedHtmlText);

    expect(normalizedText).toBe('Facets: Done');
  });

  it('decodes named and numeric HTML entities', () => {
    const encodedEntityText = 'Tom &amp; Jerry &#39;quoted&#39; &#x26A1;';

    const normalizedText = normalizeRichTextToPlainText(encodedEntityText);

    expect(normalizedText).toBe('Tom & Jerry \'quoted\' ⚡');
  });

  it('extracts visible text from Atlassian document-format payloads', () => {
    const documentPayload = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Given release is prepared' },
            { type: 'text', text: ' when deployed then succeeds' },
          ],
        },
      ],
    };

    const normalizedText = normalizeRichTextToPlainText(documentPayload);

    expect(normalizedText).toBe('Given release is prepared when deployed then succeeds');
  });

  it('returns an empty string for unsupported payloads', () => {
    expect(normalizeRichTextToPlainText(undefined)).toBe('');
    expect(normalizeRichTextToPlainText(null)).toBe('');
  });
});

